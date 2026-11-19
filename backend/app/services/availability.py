from __future__ import annotations

from app.db import repo
from app.domain.calendar_util import HOUR_VALUES, now_iso
from app.errors import raise_bad_request, raise_not_found

VALID_VOTERS = {
    "salesA",
    "salesB",
    "hongo",
    "meguro",
    "yamamoto",
    "ishibashi",
    "tanaka",
    "hamada",
}


def _key(voter_id: str) -> tuple[str, str]:
    return f"AVAIL#{voter_id}", "DATA"


def get_availability(voter_id: str) -> dict:
    if voter_id not in VALID_VOTERS:
        raise_not_found("投票者が見つかりません", "VOTER_NOT_FOUND")
    item = repo().get(*_key(voter_id))
    if not item:
        return {"voterId": voter_id, "dayMarks": {}, "hourMarks": {}}
    return {
        "voterId": voter_id,
        "dayMarks": item.get("dayMarks") or {},
        "hourMarks": item.get("hourMarks") or {},
    }


def list_all_availability() -> dict[str, dict]:
    result = {}
    for voter_id in VALID_VOTERS:
        result[voter_id] = get_availability(voter_id)
    return result


def put_availability(voter_id: str, day_marks: dict, hour_marks: dict) -> dict:
    if voter_id not in VALID_VOTERS:
        raise_not_found("投票者が見つかりません", "VOTER_NOT_FOUND")
    if day_marks is None or hour_marks is None:
        raise_bad_request("dayMarks と hourMarks は必須です")
    cleaned_hours: dict = {}
    for day, hours in (hour_marks or {}).items():
        if not isinstance(hours, list):
            continue
        unique = sorted({int(h) for h in hours if int(h) in HOUR_VALUES})
        if len(unique) == len(HOUR_VALUES):
            continue
        cleaned_hours[day] = unique
    item = {
        "PK": f"AVAIL#{voter_id}",
        "SK": "DATA",
        "entityType": "Availability",
        "campaignId": "current",
        "voterId": voter_id,
        "dayMarks": day_marks or {},
        "hourMarks": cleaned_hours,
        "updatedAt": now_iso(),
    }
    repo().put(item)
    return get_availability(voter_id)
