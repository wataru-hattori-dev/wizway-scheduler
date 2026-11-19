from __future__ import annotations

import json
import logging
import urllib.error
import urllib.request
import uuid
from datetime import datetime

from app.config import campaign_pk, get_settings
from app.db import repo
from app.domain.calendar_util import JST, now_iso

logger = logging.getLogger("wizway.slack")
if not logger.handlers:
    _handler = logging.StreamHandler()
    _handler.setFormatter(logging.Formatter("%(levelname)s:%(name)s:%(message)s"))
    logger.addHandler(_handler)
    logger.setLevel(logging.INFO)
    logger.propagate = False

_SLACK_CHAT_POST_MESSAGE_URL = "https://slack.com/api/chat.postMessage"

# Slack 本文用。半角スペースやタブだとコードブロック扱いになるため全角スペースを使う
_FW_SPACE = "\u3000"
_WEEKDAY_JA = ("月", "火", "水", "木", "金", "土", "日")


def format_slack_datetime(start_iso: str) -> str:
    """JST 基準で `M/D（曜日） HH:mm～` を返す（終了時刻は出さない）。"""
    dt = datetime.fromisoformat(start_iso)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=JST)
    else:
        dt = dt.astimezone(JST)
    weekday = _WEEKDAY_JA[dt.weekday()]
    return f"{dt.month}/{dt.day}（{weekday}）{dt.hour:02d}:{dt.minute:02d}～"


def format_mgr_confirmed_slot_line(display_name: str, start_iso: str) -> str:
    """面談確定通知の1行: `　・{氏名} {M/D（曜日）} HH:mm～`"""
    return f"{_FW_SPACE}・{display_name}{_FW_SPACE}{format_slack_datetime(start_iso)}"


def format_confirmed_time_change_body(
    *,
    display_name: str,
    actor: str,
    before_iso: str,
    after_iso: str,
) -> str:
    """確定日時変更通知の本文（ヘッダー行は label_style 側で付与）。"""
    before = format_slack_datetime(before_iso)
    after = format_slack_datetime(after_iso)
    return (
        f"{display_name}さんの確定日時を{actor}が変更しました。\n"
        f"\n"
        f"{_FW_SPACE}・{display_name}\n"
        f"{_FW_SPACE}{_FW_SPACE}変更前　~{before}~\n"
        f"{_FW_SPACE}{_FW_SPACE}変更後　*{after}*"
    )


# 振り分けルート: 各セクション + 営業
SLACK_ROUTES = (
    "meguro",
    "yamamoto",
    "ishibashi",
    "tanaka",
    "hamada",
    "sales",
)

# DB 欠落時のみ使う汎用フォールバック（表示名の正は DynamoDB SECTION / 営業ロール）
_ROUTE_DISPLAY_NAMES_FALLBACK: dict[str, str] = {
    "meguro": "Section A",
    "yamamoto": "Section B",
    "ishibashi": "Section C",
    "tanaka": "Section D",
    "hamada": "Section E",
    "sales": "営業",
}


def list_notifications(limit: int = 40) -> list[dict]:
    items = repo().query_pk(campaign_pk(), "NOTIF#")
    items.sort(key=lambda i: i.get("at") or i.get("SK") or "", reverse=True)
    result = []
    for item in items[:limit]:
        result.append(
            {
                "id": item.get("id") or item.get("SK"),
                "at": item.get("at"),
                "channel": item.get("channel") or "",
                "body": item.get("body") or "",
            }
        )
    return result


def _normalize_route(route: str) -> str:
    key = (route or "").strip()
    if key in _ROUTE_DISPLAY_NAMES_FALLBACK:
        return key
    # "section_meguro" / "MEGURO" なども許容
    lowered = key.lower().removeprefix("section_")
    if lowered in _ROUTE_DISPLAY_NAMES_FALLBACK:
        return lowered
    raise ValueError(f"unknown Slack route: {route!r} (expected one of {SLACK_ROUTES})")


def _section_name_from_db(section_id: str) -> str | None:
    """DynamoDB のセクション表示名を優先（本番・ローカルとも UI/通知を維持）。"""
    try:
        from app.services import sections as sections_svc

        for section in sections_svc.list_sections():
            if section.get("id") == section_id and section.get("name"):
                return str(section["name"])
    except Exception:
        return None
    return None


def route_display_name(route: str) -> str:
    key = _normalize_route(route)
    if key == "sales":
        return _ROUTE_DISPLAY_NAMES_FALLBACK["sales"]
    return _section_name_from_db(key) or _ROUTE_DISPLAY_NAMES_FALLBACK[key]


def resolve_route_channel_id(route: str) -> str:
    """ルートキーから .env のチャンネル ID を解決する。"""
    key = _normalize_route(route)
    routes = get_settings().get("slack_channel_routes") or {}
    return (routes.get(key) or "").strip()


def _apply_destination_label(*, route: str, body: str) -> str:
    """宛先ラベル付与の唯一の入口。外すときは SLACK_DESTINATION_LABELS=false。"""
    if not get_settings().get("slack_destination_labels"):
        return body
    name = route_display_name(route)
    label = f"【これは{name}への通知です】"
    return f"{label}\n{body}" if body else label


def _mgr_confirmed_header(*, route: str, test_mode: bool) -> str:
    """セクション向け統合ヘッダー（チャンネルIDや「本来の送信先」行は付けない）。"""
    name = route_display_name(route)
    if test_mode:
        return f"【テスト通知：これは{name}への通知です】"
    return f"【これは{name}への通知です】"


def _resolve_delivery(
    *, route: str, body: str, label_style: str = "default"
) -> tuple[str, str, str, str]:
    """送信先チャンネルと本文を決定する。

    Returns:
        (delivery_channel, body_for_send, intended_label, route_key)
    """
    settings = get_settings()
    route_key = _normalize_route(route)
    intended_id = resolve_route_channel_id(route_key)
    intended_label = f"{route_display_name(route_key)} ({intended_id or '未設定'})"
    test_mode = bool(settings.get("slack_test_mode"))

    if label_style == "mgr_confirmed":
        header = _mgr_confirmed_header(route=route_key, test_mode=test_mode)
        prefixed = f"{header}\n{body}" if body else header
        if test_mode:
            test_channel = (settings.get("slack_test_channel_id") or "").strip()
            return test_channel or intended_id, prefixed, intended_label, route_key
        return intended_id, prefixed, intended_label, route_key

    body_labeled = _apply_destination_label(route=route_key, body=body)

    if test_mode:
        test_channel = (settings.get("slack_test_channel_id") or "").strip()
        delivery = test_channel or intended_id
        test_label = f"【テスト通知】本来の送信先: {intended_label}"
        prefixed = f"{test_label}\n{body_labeled}" if body_labeled else test_label
        return delivery, prefixed, intended_label, route_key

    return intended_id, body_labeled, intended_label, route_key


def _log_slack_payload(payload: dict) -> None:
    line = f"slack_payload {json.dumps(payload, ensure_ascii=False)}"
    logger.info(line)
    # uvicorn 既定では app logger の INFO が見えないことがあるため stdout にも出す
    print(line, flush=True)


def _post_json(url: str, payload: dict, *, headers: dict[str, str] | None = None) -> dict:
    data = json.dumps(payload).encode("utf-8")
    req_headers = {"Content-Type": "application/json; charset=utf-8"}
    if headers:
        req_headers.update(headers)
    request = urllib.request.Request(url, data=data, headers=req_headers, method="POST")
    with urllib.request.urlopen(request, timeout=15) as response:
        raw = response.read().decode("utf-8")
        if not raw:
            return {"ok": True}
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return {"ok": True, "raw": raw}


def _send_via_bot_token(*, bot_token: str, channel: str, text: str) -> dict:
    return _post_json(
        _SLACK_CHAT_POST_MESSAGE_URL,
        {"channel": channel, "text": text},
        headers={"Authorization": f"Bearer {bot_token}"},
    )


def _send_via_webhook(*, webhook_url: str, channel: str, text: str) -> dict:
    # Incoming Webhook は通常チャンネル固定だが、互換のため channel も付与する
    return _post_json(webhook_url, {"channel": channel, "text": text})


def _deliver_slack(
    *,
    delivery_channel: str,
    intended_channel: str,
    route: str,
    body: str,
    notification_id: str,
    at: str,
) -> None:
    """設定に応じて Slack へ実送信、またはドライランでログ出力する。"""
    settings = get_settings()
    webhook = (settings.get("slack_webhook_url") or "").strip()
    bot_token = (settings.get("slack_bot_token") or "").strip()
    dry_run = bool(settings.get("slack_dry_run", True))
    test_mode = bool(settings.get("slack_test_mode"))

    if not webhook and not bot_token:
        return

    transport = "bot_token" if bot_token else "webhook"
    base_payload = {
        "notificationId": notification_id,
        "at": at,
        "route": route,
        "intendedChannel": intended_channel,
        "deliveryChannel": delivery_channel,
        "testMode": test_mode,
        "dryRun": dry_run,
        "transport": transport,
        "text": body,
        "webhookConfigured": bool(webhook),
        "botTokenConfigured": bool(bot_token),
    }

    if dry_run:
        _log_slack_payload(
            {
                **base_payload,
                "mode": "dry_run",
                "note": "HTTP request to Slack is skipped (SLACK_DRY_RUN=true)",
            }
        )
        return

    try:
        if bot_token:
            if not delivery_channel:
                raise ValueError(
                    "delivery channel is empty; set SLACK_CHANNEL_MEGURO etc. / "
                    "SLACK_CHANNEL_SALES (and SLACK_TEST_CHANNEL_ID when test mode)"
                )
            result = _send_via_bot_token(
                bot_token=bot_token, channel=delivery_channel, text=body
            )
            if isinstance(result, dict) and result.get("ok") is False:
                raise RuntimeError(result.get("error") or "chat.postMessage failed")
        else:
            result = _send_via_webhook(
                webhook_url=webhook, channel=delivery_channel, text=body
            )
        _log_slack_payload({**base_payload, "mode": "sent", "response": result})
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, ValueError, RuntimeError) as err:
        _log_slack_payload({**base_payload, "mode": "error", "error": str(err)})
        logger.exception("slack delivery failed: %s", err)


def push_notification(
    *,
    route: str,
    body: str,
    at: str | None = None,
    label_style: str = "default",
) -> dict:
    """Slack 通知をルート（A–F / sales）に振り分けて送信する。

    label_style:
      - "default": 従来の宛先ラベル / テスト通知ヘッダー
      - "mgr_confirmed": セクション向け統合ヘッダー
        （面談確定・確定日時変更など。チャンネルIDや「本来の送信先」行なし）
    """
    ts = at or now_iso()
    nid = f"n_{uuid.uuid4().hex[:8]}"
    delivery_channel, body_for_send, intended_label, route_key = _resolve_delivery(
        route=route, body=body, label_style=label_style
    )
    item = {
        "PK": campaign_pk(),
        "SK": f"NOTIF#{ts}#{nid}",
        "entityType": "Notification",
        "campaignId": "current",
        "id": nid,
        "at": ts,
        "channel": intended_label,
        "route": route_key,
        "body": body_for_send,
        "deliveryChannel": delivery_channel,
        "updatedAt": now_iso(),
    }
    repo().put(item)
    _deliver_slack(
        delivery_channel=delivery_channel,
        intended_channel=intended_label,
        route=route_key,
        body=body_for_send,
        notification_id=nid,
        at=ts,
    )
    return {"id": nid, "at": ts, "channel": intended_label, "body": body_for_send}
