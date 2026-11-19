from __future__ import annotations

from app.config import campaign_pk
from app.db import repo
from app.domain.calendar_util import now_iso
from app.errors import raise_bad_request, raise_not_found

SECTION_IDS = ["meguro", "yamamoto", "ishibashi", "tanaka", "hamada"]

# DynamoDB に name/mgr が無いときのみ使う汎用フォールバック
SECTION_META: dict[str, dict[str, str]] = {
    "meguro": {"name": "Section A", "mgr": "Mgr A"},
    "yamamoto": {"name": "Section B", "mgr": "Mgr B"},
    "ishibashi": {"name": "Section C", "mgr": "Mgr C"},
    "tanaka": {"name": "Section D", "mgr": "Mgr D"},
    "hamada": {"name": "Section E", "mgr": "Mgr E"},
}


def _section_field_from_db(section_id: str, field: str) -> str | None:
    """DynamoDB SECTION レコードの表示フィールドを優先取得する。"""
    if not section_id or section_id == "unset":
        return None
    try:
        item = repo().get(campaign_pk(), f"SECTION#{section_id}")
    except Exception:
        # DB 未接続・設定不足時は呼び出し側で SECTION_META フォールバック
        return None
    if not item:
        return None
    value = item.get(field)
    return str(value) if value else None


def section_display_name(section_id: str) -> str:
    """セクション表示名。DB の name を優先し、無いときのみ汎用フォールバック。"""
    from_db = _section_field_from_db(section_id, "name")
    if from_db:
        return from_db
    meta = SECTION_META.get(section_id)
    return meta["name"] if meta else section_id


def section_mgr_name(section_id: str) -> str:
    """セクション Mgr 表示名。DB の mgr を優先し、無いときのみ汎用フォールバック。"""
    from_db = _section_field_from_db(section_id, "mgr")
    if from_db:
        return from_db
    meta = SECTION_META.get(section_id)
    return meta["mgr"] if meta else section_id


def _sales_display_label() -> str:
    from app.domain.assign import sales_names_joined

    return sales_names_joined()


def list_sections() -> list[dict]:
    items = repo().query_pk(campaign_pk(), "SECTION#")
    sales_label = _sales_display_label()
    sections = []
    for item in items:
        sid = item["sectionId"]
        sections.append(
            {
                "id": sid,
                "name": item.get("name") or section_display_name(sid),
                "mgr": item.get("mgr") or section_mgr_name(sid),
                # 表示は常に role=sales メンバーから動的解決（DB の仮称を上書き）
                "sales": sales_label,
            }
        )
    sections.sort(
        key=lambda s: SECTION_IDS.index(s["id"]) if s["id"] in SECTION_IDS else 999
    )
    return sections


def get_section_item(section_id: str) -> dict:
    if section_id not in SECTION_IDS:
        raise_not_found("セクションが見つかりません", "SECTION_NOT_FOUND")
    item = repo().get(campaign_pk(), f"SECTION#{section_id}")
    if not item:
        raise_not_found("セクションが見つかりません", "SECTION_NOT_FOUND")
    return item


def get_section_deadline(section_id: str) -> dict:
    item = get_section_item(section_id)
    return {
        "sectionId": section_id,
        "deadline": item.get("deadline"),
        "judgedAt": item.get("judgedAt"),
    }


def put_section_deadline(section_id: str, deadline: str) -> dict:
    get_section_item(section_id)
    if not deadline:
        raise_bad_request("期限が不正です")
    repo().update(
        campaign_pk(),
        f"SECTION#{section_id}",
        {"deadline": deadline, "updatedAt": now_iso()},
    )
    return get_section_deadline(section_id)


def set_judged_at(section_id: str, judged_at: str) -> None:
    repo().update(
        campaign_pk(),
        f"SECTION#{section_id}",
        {"judgedAt": judged_at, "updatedAt": now_iso()},
    )
