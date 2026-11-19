"""Slack OAuth（Sign in with Slack）と画面アクセスロール判定。"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

from app.config import get_settings
from app.errors import raise_bad_request, raise_forbidden, raise_unauthorized

SESSION_COOKIE = "wizway_session"
ACCESS_ROLES = ("admin", "mgr", "engineer", "denied")
DEV_LOGIN_ROLES = ("admin", "mgr", "engineer")

HOME_PATH_BY_ROLE = {
    "admin": "/admin",
    "mgr": "/mgr",
    "engineer": "/engineer",
    "denied": "/access-denied",
}

ALLOWED_PATHS_BY_ROLE = {
    "admin": ["/", "/admin", "/mgr", "/sales", "/engineer"],
    "mgr": ["/mgr"],
    "engineer": ["/engineer"],
    "denied": ["/access-denied"],
}

_SLACK_AUTHORIZE_URL = "https://slack.com/oauth/v2/authorize"
_SLACK_OAUTH_ACCESS_URL = "https://slack.com/api/oauth.v2.access"
_SLACK_USERS_IDENTITY_URL = "https://slack.com/api/users.identity"


def resolve_access_role(slack_user_id: str, slack_team_id: str) -> str:
    """team_id から画面アクセスロールを判定する。

    社内テスト公開中: ウィズウェイ Slack ワークスペース所属なら全員 admin
    （Admin / Mgr / Engineer 全画面操作可）。他社ワークスペースは denied。
    slack_user_id は呼び出し互換のため受け取るが、現状はロール判定に使わない。
    """
    settings = get_settings()
    team_id = (slack_team_id or "").strip()
    if not team_id:
        return "denied"
    if team_id == settings["slack_team_id"]:
        return "admin"
    return "denied"


def role_home_path(access_role: str) -> str:
    return HOME_PATH_BY_ROLE.get(access_role, "/access-denied")


def role_allowed_paths(access_role: str) -> list[str]:
    return list(ALLOWED_PATHS_BY_ROLE.get(access_role, ["/access-denied"]))


def _b64url_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _b64url_decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + padding)


def issue_session_token(
    *,
    slack_user_id: str,
    slack_team_id: str,
    access_role: str,
    display_name: str | None = None,
) -> str:
    settings = get_settings()
    now = int(time.time())
    payload = {
        "sub": slack_user_id,
        "team": slack_team_id,
        "role": access_role,
        "name": display_name or "",
        "iat": now,
        "exp": now + int(settings["auth_session_ttl_seconds"]),
    }
    body = _b64url_encode(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    )
    sig = _b64url_encode(
        hmac.new(
            settings["auth_session_secret"].encode("utf-8"),
            body.encode("ascii"),
            hashlib.sha256,
        ).digest()
    )
    return f"{body}.{sig}"


def decode_session_token(token: str | None) -> dict[str, Any] | None:
    if not token or "." not in token:
        return None
    settings = get_settings()
    body, _, sig = token.partition(".")
    if not body or not sig:
        return None
    expected = _b64url_encode(
        hmac.new(
            settings["auth_session_secret"].encode("utf-8"),
            body.encode("ascii"),
            hashlib.sha256,
        ).digest()
    )
    if not hmac.compare_digest(sig, expected):
        return None
    try:
        payload = json.loads(_b64url_decode(body).decode("utf-8"))
    except (ValueError, UnicodeDecodeError, json.JSONDecodeError):
        return None
    if int(payload.get("exp") or 0) < int(time.time()):
        return None
    role = payload.get("role")
    if role not in ACCESS_ROLES:
        return None
    return payload


def build_session_response(
    *,
    authenticated: bool,
    token: str | None = None,
    slack_user_id: str | None = None,
    slack_team_id: str | None = None,
    access_role: str | None = None,
    display_name: str | None = None,
) -> dict[str, Any]:
    if not authenticated or not access_role:
        return {"authenticated": False}
    return {
        "authenticated": True,
        "token": token,
        "user": {
            "slackUserId": slack_user_id or "",
            "slackTeamId": slack_team_id or "",
            "displayName": display_name or "",
            "accessRole": access_role,
        },
        "homePath": role_home_path(access_role),
        "allowedPaths": role_allowed_paths(access_role),
    }


def session_from_payload(payload: dict[str, Any], token: str | None = None) -> dict[str, Any]:
    return build_session_response(
        authenticated=True,
        token=token,
        slack_user_id=str(payload.get("sub") or ""),
        slack_team_id=str(payload.get("team") or ""),
        access_role=str(payload.get("role") or "denied"),
        display_name=str(payload.get("name") or ""),
    )


def new_oauth_state() -> str:
    return secrets.token_urlsafe(24)


def _normalize_redirect_uri(uri: str) -> str:
    """比較用に scheme/host を正規化し、path 末尾スラッシュを除去する。"""
    raw = (uri or "").strip()
    if not raw:
        return ""
    parsed = urllib.parse.urlparse(raw)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        return ""
    path = parsed.path.rstrip("/")
    return urllib.parse.urlunparse(
        (parsed.scheme.lower(), parsed.netloc.lower(), path, "", "", "")
    )


def allowed_slack_redirect_uris() -> set[str]:
    """
    許可 redirect_uri:
    - SLACK_REDIRECT_URI
    - SLACK_REDIRECT_URI_ALLOWLIST（任意・カンマ区切り）
    - CORS_ORIGINS 各 origin + /auth/slack/callback
    """
    settings = get_settings()
    allowed: set[str] = set()
    primary = _normalize_redirect_uri(settings.get("slack_redirect_uri") or "")
    if primary:
        allowed.add(primary)
    for extra in settings.get("slack_redirect_uri_allowlist") or []:
        norm = _normalize_redirect_uri(extra)
        if norm:
            allowed.add(norm)
    for origin in settings.get("cors_origins") or []:
        base = (origin or "").strip().rstrip("/")
        if not base:
            continue
        norm = _normalize_redirect_uri(f"{base}/auth/slack/callback")
        if norm:
            allowed.add(norm)
    return allowed


def assert_redirect_uri_allowed(redirect_uri: str) -> str:
    """許可リスト外の redirect_uri を拒否し、正規化前の使用 URI を返す。"""
    uri = (redirect_uri or "").strip()
    if not uri:
        raise_bad_request("SLACK_REDIRECT_URI が未設定です", "SLACK_REDIRECT_URI_MISSING")
    norm = _normalize_redirect_uri(uri)
    if not norm or norm not in allowed_slack_redirect_uris():
        raise_bad_request(
            "redirect_uri が許可されていません",
            "SLACK_REDIRECT_URI_NOT_ALLOWED",
        )
    return uri


def build_slack_authorize_url(redirect_uri: str | None = None) -> dict[str, str]:
    settings = get_settings()
    client_id = settings["slack_client_id"]
    if not client_id:
        raise_bad_request("SLACK_CLIENT_ID が未設定です", "SLACK_CLIENT_ID_MISSING")
    uri = assert_redirect_uri_allowed(
        redirect_uri or settings["slack_redirect_uri"] or ""
    )
    state = new_oauth_state()
    query = urllib.parse.urlencode(
        {
            "client_id": client_id,
            "user_scope": "identity.basic",
            "redirect_uri": uri,
            "state": state,
        }
    )
    return {
        "authorizeUrl": f"{_SLACK_AUTHORIZE_URL}?{query}",
        "redirectUri": uri,
        "state": state,
    }


def _post_form(url: str, data: dict[str, str], headers: dict[str, str] | None = None) -> dict[str, Any]:
    body = urllib.parse.urlencode(data).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        headers={
            "Content-Type": "application/x-www-form-urlencoded",
            **(headers or {}),
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            raw = resp.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise_unauthorized(f"Slack API エラー: {detail}", "SLACK_HTTP_ERROR")
    except urllib.error.URLError as exc:
        raise_bad_request(f"Slack API へ接続できません: {exc.reason}", "SLACK_NETWORK_ERROR")
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        raise_bad_request("Slack API の応答が不正です", "SLACK_RESPONSE_INVALID")


def _get_json(url: str, token: str) -> dict[str, Any]:
    req = urllib.request.Request(
        url,
        headers={"Authorization": f"Bearer {token}"},
        method="GET",
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            raw = resp.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise_unauthorized(f"Slack API エラー: {detail}", "SLACK_HTTP_ERROR")
    except urllib.error.URLError as exc:
        raise_bad_request(f"Slack API へ接続できません: {exc.reason}", "SLACK_NETWORK_ERROR")
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        raise_bad_request("Slack API の応答が不正です", "SLACK_RESPONSE_INVALID")


def exchange_slack_code(code: str, redirect_uri: str | None = None) -> dict[str, Any]:
    """oauth.v2.access → users.identity で user_id / team_id を取得する。"""
    settings = get_settings()
    client_id = settings["slack_client_id"]
    client_secret = settings["slack_client_secret"]
    if not client_id or not client_secret:
        raise_bad_request(
            "SLACK_CLIENT_ID / SLACK_CLIENT_SECRET が未設定です",
            "SLACK_OAUTH_CONFIG_MISSING",
        )
    if not code.strip():
        raise_bad_request("認可コードが空です", "SLACK_CODE_MISSING")
    uri = assert_redirect_uri_allowed(
        redirect_uri or settings["slack_redirect_uri"] or ""
    )

    access = _post_form(
        _SLACK_OAUTH_ACCESS_URL,
        {
            "client_id": client_id,
            "client_secret": client_secret,
            "code": code.strip(),
            "redirect_uri": uri,
        },
    )
    if not access.get("ok"):
        raise_unauthorized(
            f"Slack OAuth に失敗しました: {access.get('error') or 'unknown'}",
            "SLACK_OAUTH_FAILED",
        )

    authed_user = access.get("authed_user") or {}
    user_token = authed_user.get("access_token") or access.get("access_token") or ""
    slack_user_id = str(authed_user.get("id") or access.get("user_id") or "")
    team = access.get("team") or {}
    slack_team_id = str(team.get("id") or access.get("team_id") or "")
    display_name = ""

    if user_token:
        identity = _get_json(_SLACK_USERS_IDENTITY_URL, user_token)
        if identity.get("ok"):
            user = identity.get("user") or {}
            team_info = identity.get("team") or {}
            slack_user_id = str(user.get("id") or slack_user_id)
            slack_team_id = str(team_info.get("id") or slack_team_id)
            display_name = str(user.get("name") or user.get("real_name") or "")

    if not slack_user_id or not slack_team_id:
        raise_unauthorized(
            "Slack ユーザー情報を取得できませんでした",
            "SLACK_IDENTITY_MISSING",
        )

    access_role = resolve_access_role(slack_user_id, slack_team_id)
    token = issue_session_token(
        slack_user_id=slack_user_id,
        slack_team_id=slack_team_id,
        access_role=access_role,
        display_name=display_name,
    )
    return build_session_response(
        authenticated=True,
        token=token,
        slack_user_id=slack_user_id,
        slack_team_id=slack_team_id,
        access_role=access_role,
        display_name=display_name,
    )


def issue_dev_login(role: str) -> dict[str, Any]:
    settings = get_settings()
    if not settings["allow_dev_auth"]:
        raise_forbidden("開発用ログインは無効です", "DEV_AUTH_DISABLED")
    if role not in DEV_LOGIN_ROLES:
        raise_bad_request(
            f"role が不正です（許可: {', '.join(DEV_LOGIN_ROLES)}）",
            "DEV_LOGIN_ROLE_INVALID",
        )
    fake_user = {
        "admin": "DEV_ADMIN",
        "mgr": "DEV_MGR",
        "engineer": "DEV_ENGINEER",
    }[role]
    display = {
        "admin": "開発用・管理者",
        "mgr": "開発用・Mgr/本郷",
        "engineer": "開発用・エンジニア",
    }[role]
    team_id = settings["slack_team_id"] if role != "denied" else "T_EXTERNAL"
    token = issue_session_token(
        slack_user_id=fake_user,
        slack_team_id=team_id,
        access_role=role,
        display_name=display,
    )
    return build_session_response(
        authenticated=True,
        token=token,
        slack_user_id=fake_user,
        slack_team_id=team_id,
        access_role=role,
        display_name=display,
    )


def extract_bearer_token(authorization: str | None) -> str | None:
    if not authorization:
        return None
    scheme, _, value = authorization.partition(" ")
    if scheme.lower() != "bearer" or not value.strip():
        return None
    return value.strip()
