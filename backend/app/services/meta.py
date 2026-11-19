from __future__ import annotations

from app.config import campaign_pk
from app.db import repo
from app.domain.calendar_util import DEFAULT_RANGE_END, DEFAULT_RANGE_START, now_iso
from app.errors import raise_bad_request, raise_not_found


def _meta_key() -> tuple[str, str]:
    return campaign_pk(), "META"


def get_meta() -> dict:
    item = repo().get(*_meta_key())
    if not item:
        raise_not_found("キャンペーン設定が見つかりません", "META_NOT_FOUND")
    return item


def ensure_meta() -> dict:
    item = repo().get(*_meta_key())
    if item:
        return item
    seed = {
        "PK": campaign_pk(),
        "SK": "META",
        "entityType": "Meta",
        "campaignId": "current",
        "quarterLabel": "2026年12月 三者面談",
        "hongoJoins": True,
        "provider": "meet",
        "interviewPeriod": {"startDate": DEFAULT_RANGE_START, "endDate": DEFAULT_RANGE_END},
        "responseDeadlines": {"mgrSalesDeadline": "2026-11-20", "engineerDeadline": "2026-12-05"},
        "updatedAt": now_iso(),
    }
    return repo().put(seed)


def get_settings() -> dict:
    meta = get_meta()
    return {
        "quarterLabel": meta.get("quarterLabel") or "",
        "hongoJoins": bool(meta.get("hongoJoins", True)),
        "provider": meta.get("provider") or "meet",
    }


def patch_settings(body: dict) -> dict:
    meta = get_meta()
    updates = {"updatedAt": now_iso()}
    if "quarterLabel" in body and body["quarterLabel"] is not None:
        updates["quarterLabel"] = body["quarterLabel"]
    if "hongoJoins" in body and body["hongoJoins"] is not None:
        updates["hongoJoins"] = bool(body["hongoJoins"])
    if "provider" in body and body["provider"] is not None:
        if body["provider"] not in ("meet", "zoom"):
            raise_bad_request("provider が不正です")
        updates["provider"] = body["provider"]
    if len(updates) == 1:
        raise_bad_request("更新項目がありません")
    repo().update(*_meta_key(), updates)
    return get_settings()


def get_interview_period() -> dict:
    meta = get_meta()
    period = meta.get("interviewPeriod") or {}
    return {
        "startDate": period.get("startDate") or DEFAULT_RANGE_START,
        "endDate": period.get("endDate") or DEFAULT_RANGE_END,
    }


def put_interview_period(body: dict) -> dict:
    start = body.get("startDate")
    end = body.get("endDate")
    if not start or not end:
        raise_bad_request("開始日と終了日を入力してください")
    if start > end:
        raise_bad_request("終了日は開始日以降にしてください")
    repo().update(
        *_meta_key(),
        {"interviewPeriod": {"startDate": start, "endDate": end}, "updatedAt": now_iso()},
    )
    return get_interview_period()


def get_response_deadlines() -> dict:
    meta = get_meta()
    deadlines = meta.get("responseDeadlines") or {}
    return {
        "mgrSalesDeadline": deadlines.get("mgrSalesDeadline") or "",
        "engineerDeadline": deadlines.get("engineerDeadline") or "",
    }


def put_response_deadlines(body: dict) -> dict:
    mgr = body.get("mgrSalesDeadline")
    eng = body.get("engineerDeadline")
    if not mgr or not eng:
        raise_bad_request("Mgr/営業とエンジニアの回答期限を両方入力してください")
    repo().update(
        *_meta_key(),
        {
            "responseDeadlines": {"mgrSalesDeadline": mgr, "engineerDeadline": eng},
            "updatedAt": now_iso(),
        },
    )
    return get_response_deadlines()
