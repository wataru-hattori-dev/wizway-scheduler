from __future__ import annotations

from app.config import campaign_pk
from app.db import repo
from app.domain.calendar_util import now_iso
from app.errors import raise_bad_request

SALES_IDS = {"salesA", "salesB"}


def get_sales_assignees() -> dict[str, str]:
    """OpenAPI SalesAssigneeMap: memberId(string) -> salesId."""
    item = repo().get(campaign_pk(), "SALES_ASSIGNEES")
    assignees = (item or {}).get("assignees") or {}
    cleaned: dict[str, str] = {}
    for key, value in assignees.items():
        if value in SALES_IDS:
            cleaned[str(key)] = value
    return cleaned


def put_sales_assignees(body: dict) -> dict[str, str]:
    raw = body.get("assignees") if isinstance(body, dict) and "assignees" in body and len(body) == 1 else body
    if not isinstance(raw, dict):
        raise_bad_request("assignees が不正です")
    cleaned: dict[str, str] = {}
    for key, value in raw.items():
        if value is None or value == "":
            continue
        if value not in SALES_IDS:
            raise_bad_request(f"営業 ID が不正です: {value}")
        cleaned[str(key)] = value
    repo().put(
        {
            "PK": campaign_pk(),
            "SK": "SALES_ASSIGNEES",
            "entityType": "SalesAssignees",
            "campaignId": "current",
            "assignees": cleaned,
            "updatedAt": now_iso(),
        }
    )
    return get_sales_assignees()
