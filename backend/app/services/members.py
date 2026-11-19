from __future__ import annotations

from app.config import campaign_pk
from app.db import repo
from app.domain.calendar_util import now_iso
from app.errors import raise_bad_request, raise_not_found
from app.services.sections import SECTION_IDS, section_display_name

VALID_SECTIONS = [*SECTION_IDS, "unset"]
VALID_ROLES = {"engineer", "mgr", "sales", "hongo", "other"}


def member_display_name(surname: str, section_id: str) -> str:
    if section_id == "unset":
        return surname
    return f"{section_display_name(section_id)}-{surname}"


def _to_member(item: dict) -> dict:
    is_interviewer = item.get("isInterviewer")
    if is_interviewer is None:
        is_interviewer = True
    return {
        "id": int(item["memberId"]),
        "surname": item.get("surname") or "",
        "sectionId": item.get("sectionId") or "unset",
        "name": item.get("name")
        or member_display_name(item.get("surname") or "", item.get("sectionId") or "unset"),
        "role": item.get("role") or "engineer",
        "isInterviewer": bool(is_interviewer),
        "isDeleted": bool(item.get("isDeleted")),
    }


def _member_keys(member_id: int) -> tuple[str, str]:
    return f"MEMBER#{member_id}", "PROFILE"


def get_member_item(member_id: int) -> dict:
    item = repo().get(*_member_keys(member_id))
    if not item:
        raise_not_found("社員が見つかりません", "MEMBER_NOT_FOUND")
    return item


def get_member(member_id: int) -> dict:
    return _to_member(get_member_item(member_id))


def list_members(*, include_deleted: bool = False, section_id: str | None = None) -> list[dict]:
    if section_id:
        if section_id not in VALID_SECTIONS:
            raise_bad_request("sectionId が不正です")
        items = [
            i
            for i in repo().query_gsi1(f"SECTION#{section_id}", "MEMBER#")
            if i.get("entityType") == "Member"
            and (i.get("sectionId") or "unset") == section_id
        ]
    else:
        # 全件は PROFILE を Scan（sectionId はアイテム属性が正）。GSI 遅延で移動が消えて見えるのを防ぐ
        items = [
            i
            for i in repo().scan_entity("Member")
            if i.get("SK") == "PROFILE"
        ]
    members = [_to_member(i) for i in items]
    if not include_deleted:
        members = [m for m in members if not m["isDeleted"]]
    members.sort(key=lambda m: m["id"])
    return members


def list_interview_members(*, section_id: str | None = None) -> list[dict]:
    """日程調整・面談候補者: isInterviewer=true かつ未削除のみ。"""
    return [
        m
        for m in list_members(include_deleted=False, section_id=section_id)
        if m.get("isInterviewer", True)
    ]


def _next_member_id() -> int:
    key = (campaign_pk(), "COUNTER#MEMBER")
    table = repo().table
    try:
        result = table.update_item(
            Key={"PK": key[0], "SK": key[1]},
            UpdateExpression="SET nextValue = if_not_exists(nextValue, :start) + :inc, updatedAt = :ts",
            ExpressionAttributeValues={":inc": 1, ":start": 1, ":ts": now_iso()},
            ReturnValues="UPDATED_NEW",
        )
        # after increment, nextValue is the *next* free id; allocated = nextValue - 1
        return int(result["Attributes"]["nextValue"]) - 1
    except Exception:
        # fallback: max existing + 1
        members = list_members(include_deleted=True)
        return (max((m["id"] for m in members), default=0) + 1)


def _normalize_role(role: str | None) -> str:
    value = (role or "engineer").strip() or "engineer"
    if value not in VALID_ROLES:
        raise_bad_request(f"role が不正です（許可: {', '.join(sorted(VALID_ROLES))}）")
    return value


def create_member(
    surname: str,
    section_id: str | None = None,
    *,
    role: str | None = "engineer",
    is_interviewer: bool | None = True,
) -> dict:
    surname = (surname or "").strip()
    if not surname:
        raise_bad_request("氏名を入力してください")
    sid = section_id or "unset"
    if sid not in VALID_SECTIONS:
        raise_bad_request("sectionId が不正です")
    member_role = _normalize_role(role)
    interviewer = True if is_interviewer is None else bool(is_interviewer)
    member_id = _next_member_id()
    ts = now_iso()
    gsi1pk = f"SECTION#{sid}"
    profile = {
        "PK": f"MEMBER#{member_id}",
        "SK": "PROFILE",
        "entityType": "Member",
        "campaignId": "current",
        "memberId": member_id,
        "surname": surname,
        "sectionId": sid,
        "name": member_display_name(surname, sid),
        "role": member_role,
        "isInterviewer": interviewer,
        "isDeleted": False,
        "GSI1PK": gsi1pk,
        "GSI1SK": f"MEMBER#{member_id}",
        "updatedAt": ts,
    }
    interview = {
        "PK": f"MEMBER#{member_id}",
        "SK": "INTERVIEW",
        "entityType": "Interview",
        "campaignId": "current",
        "memberId": member_id,
        "sectionId": sid,
        "status": "unadjusted",
        "submittedAt": None,
        "confirmedSlotId": None,
        "confirmedSalesId": None,
        "confirmedOverride": None,
        "assignReason": None,
        "meetingUrl": None,
        "pendingNote": None,
        "remindedAt": None,
        "changeRequest": None,
        "preferences": {"difficultDates": [], "preferredTimeNote": "", "note": ""},
        "votes": {},
        "GSI1PK": gsi1pk,
        "GSI1SK": f"INTERVIEW#unadjusted#{member_id}",
        "GSI2PK": "STATUS#unadjusted",
        "GSI2SK": f"MEMBER#{member_id}",
        "updatedAt": ts,
    }
    r = repo()
    r.put(profile)
    r.put(interview)
    return _to_member(profile)


def _update_expression(updates: dict) -> tuple[str, dict[str, str], dict[str, object]]:
    names: dict[str, str] = {}
    values: dict[str, object] = {}
    parts: list[str] = []
    for i, (key, value) in enumerate(updates.items()):
        nk = f"#k{i}"
        vk = f":v{i}"
        names[nk] = key
        values[vk] = value
        parts.append(f"{nk} = {vk}")
    return "SET " + ", ".join(parts), names, values


def patch_member(member_id: int, body: dict) -> dict:
    item = get_member_item(member_id)
    surname = body.get("surname", item.get("surname"))
    section_id = body.get("sectionId", item.get("sectionId"))
    if section_id not in VALID_SECTIONS:
        raise_bad_request("sectionId が不正です")
    if not surname:
        raise_bad_request("氏名が不正です")
    role = item.get("role") or "engineer"
    if "role" in body:
        role = _normalize_role(body.get("role"))
    is_interviewer = item.get("isInterviewer")
    if is_interviewer is None:
        is_interviewer = True
    if "isInterviewer" in body:
        is_interviewer = bool(body.get("isInterviewer"))
    ts = now_iso()
    gsi1pk = f"SECTION#{section_id}"
    profile_updates = {
        "surname": surname,
        "sectionId": section_id,
        "name": member_display_name(surname, section_id),
        "role": role,
        "isInterviewer": is_interviewer,
        "GSI1PK": gsi1pk,
        "GSI1SK": f"MEMBER#{member_id}",
        "updatedAt": ts,
    }
    r = repo()
    interview = r.get(f"MEMBER#{member_id}", "INTERVIEW")
    # セクション移動時は Member.PROFILE と Interview の sectionId / GSI1 を同一トランザクションで更新
    if interview and ("sectionId" in body or item.get("sectionId") != section_id):
        status = interview.get("status") or "unadjusted"
        interview_updates = {
            "sectionId": section_id,
            "GSI1PK": gsi1pk,
            "GSI1SK": f"INTERVIEW#{status}#{member_id}",
            "updatedAt": ts,
        }
        table_name = r.table.name
        profile_expr, profile_names, profile_values = _update_expression(profile_updates)
        interview_expr, interview_names, interview_values = _update_expression(interview_updates)
        r.transact_write(
            [
                {
                    "Update": {
                        "TableName": table_name,
                        "Key": {"PK": f"MEMBER#{member_id}", "SK": "PROFILE"},
                        "UpdateExpression": profile_expr,
                        "ExpressionAttributeNames": profile_names,
                        "ExpressionAttributeValues": profile_values,
                    }
                },
                {
                    "Update": {
                        "TableName": table_name,
                        "Key": {"PK": f"MEMBER#{member_id}", "SK": "INTERVIEW"},
                        "UpdateExpression": interview_expr,
                        "ExpressionAttributeNames": interview_names,
                        "ExpressionAttributeValues": interview_values,
                    }
                },
            ]
        )
    else:
        r.update(*_member_keys(member_id), profile_updates)
        if interview:
            status = interview.get("status") or "unadjusted"
            r.update(
                f"MEMBER#{member_id}",
                "INTERVIEW",
                {
                    "sectionId": section_id,
                    "GSI1PK": gsi1pk,
                    "GSI1SK": f"INTERVIEW#{status}#{member_id}",
                    "updatedAt": ts,
                },
            )
    return get_member(member_id)


def delete_member(member_id: int) -> dict:
    get_member_item(member_id)
    repo().update(*_member_keys(member_id), {"isDeleted": True, "updatedAt": now_iso()})
    return get_member(member_id)
