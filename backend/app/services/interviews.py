from __future__ import annotations

from app.db import repo
from app.domain.assign import SALES_LABEL, build_meeting_url
from app.domain.calendar_util import now_iso
from app.domain.slots import candidate_slots, sales_can_take_slot
from app.errors import raise_bad_request, raise_conflict, raise_not_found
from app.services import availability as availability_svc
from app.services import members as members_svc
from app.services import meta as meta_svc
from app.services import notifications as notif_svc
from app.services import sales_assignees as sales_svc
from app.services import sections as sections_svc
from app.services.sections import SECTION_IDS


def _interview_key(member_id: int) -> tuple[str, str]:
    return f"MEMBER#{member_id}", "INTERVIEW"


def _gsi_for(section_id: str, status: str, member_id: int) -> dict:
    return {
        "GSI1PK": f"SECTION#{section_id}",
        "GSI1SK": f"INTERVIEW#{status}#{member_id}",
        "GSI2PK": f"STATUS#{status}",
        "GSI2SK": f"MEMBER#{member_id}",
    }


def _to_interview(item: dict, sales_assignee_id: str | None = None) -> dict:
    prefs = item.get("preferences") or {}
    return {
        "memberId": int(item["memberId"]),
        "status": item.get("status") or "unadjusted",
        "submittedAt": item.get("submittedAt"),
        "confirmedSlotId": item.get("confirmedSlotId"),
        "confirmedSalesId": item.get("confirmedSalesId"),
        "confirmedOverride": item.get("confirmedOverride"),
        "assignReason": item.get("assignReason"),
        "meetingUrl": item.get("meetingUrl"),
        "pendingNote": item.get("pendingNote"),
        "remindedAt": item.get("remindedAt"),
        "changeRequest": item.get("changeRequest"),
        "preferences": {
            "difficultDates": prefs.get("difficultDates") or [],
            "preferredTimeNote": prefs.get("preferredTimeNote") or "",
            "note": prefs.get("note") or "",
        },
        "votes": item.get("votes") or {},
        "salesAssigneeId": sales_assignee_id,
        "sectionId": item.get("sectionId"),
    }


def get_interview_item(member_id: int) -> dict:
    item = repo().get(*_interview_key(member_id))
    if not item:
        raise_not_found("面談が見つかりません", "INTERVIEW_NOT_FOUND")
    return item


def get_interview(member_id: int) -> dict:
    item = get_interview_item(member_id)
    assignees = sales_svc.get_sales_assignees()
    return _to_interview(item, assignees.get(str(member_id)))


def list_interviews(*, section_id: str | None = None, status: str | None = None) -> list[dict]:
    assignees = sales_svc.get_sales_assignees()
    items: list[dict] = []
    if section_id and status:
        items = [
            i
            for i in repo().query_gsi1(f"SECTION#{section_id}", f"INTERVIEW#{status}#")
            if i.get("entityType") == "Interview"
        ]
    elif section_id:
        items = [
            i
            for i in repo().query_gsi1(f"SECTION#{section_id}", "INTERVIEW#")
            if i.get("entityType") == "Interview"
        ]
    elif status:
        items = [
            i
            for i in repo().query_gsi2(f"STATUS#{status}")
            if i.get("entityType") == "Interview"
        ]
    else:
        for sid in SECTION_IDS + ["unset"]:
            items.extend(
                [
                    i
                    for i in repo().query_gsi1(f"SECTION#{sid}", "INTERVIEW#")
                    if i.get("entityType") == "Interview"
                ]
            )
    result = [_to_interview(i, assignees.get(str(i.get("memberId")))) for i in items]
    result.sort(key=lambda x: x["memberId"])
    return result


def _load_slot_context():
    settings = meta_svc.get_settings()
    period = meta_svc.get_interview_period()
    avail = availability_svc.list_all_availability()
    day_marks = {vid: a["dayMarks"] for vid, a in avail.items()}
    hour_marks = {vid: a["hourMarks"] for vid, a in avail.items()}
    return settings, period, day_marks, hour_marks


def section_slots(section_id: str) -> list[dict]:
    settings, period, day_marks, hour_marks = _load_slot_context()
    return candidate_slots(
        section_id=section_id,
        hongo_joins=settings["hongoJoins"],
        day_marks=day_marks,
        hour_marks=hour_marks,
        range_start=period["startDate"],
        range_end=period["endDate"],
    )


def _start_held_by(except_member_id: int, start: str) -> int | None:
    for interview in list_interviews():
        mid = interview["memberId"]
        if mid == except_member_id:
            continue
        if interview["status"] not in ("confirmed", "change_requested"):
            continue
        held = None
        if interview.get("confirmedOverride") and interview["confirmedOverride"].get("start"):
            held = interview["confirmedOverride"]["start"]
        elif interview.get("confirmedSlotId"):
            member = members_svc.get_member(mid)
            slot = next(
                (s for s in section_slots(member["sectionId"]) if s["id"] == interview["confirmedSlotId"]),
                None,
            )
            held = slot["start"] if slot else None
        if held == start:
            return mid
    return None


def _pick_sales_for_slot(member_id: int, slot: dict, except_member_id: int | None = None) -> str | None:
    settings, _, day_marks, hour_marks = _load_slot_context()
    assignees = sales_svc.get_sales_assignees()
    assigned = assignees.get(str(member_id))
    candidates = [assigned] if assigned in ("salesA", "salesB") else ["salesA", "salesB"]
    busy = {"salesA": set(), "salesB": set()}
    for interview in list_interviews():
        mid = interview["memberId"]
        if except_member_id is not None and mid == except_member_id:
            continue
        if interview["status"] not in ("confirmed", "change_requested"):
            continue
        sales_id = interview.get("confirmedSalesId")
        if not sales_id:
            continue
        held = None
        if interview.get("confirmedOverride") and interview["confirmedOverride"].get("start"):
            held = interview["confirmedOverride"]["start"]
        elif interview.get("confirmedSlotId"):
            member = members_svc.get_member(mid)
            s = next(
                (x for x in section_slots(member["sectionId"]) if x["id"] == interview["confirmedSlotId"]),
                None,
            )
            held = s["start"] if s else None
        if held:
            busy[sales_id].add(held)
    for sales_id in candidates:
        if not sales_can_take_slot(day_marks, hour_marks, sales_id, slot):
            continue
        if slot["start"] in busy.get(sales_id, set()):
            continue
        return sales_id
    return None


def _confirmed_start_iso(interview: dict, section_id: str) -> str | None:
    """確定済み面談の開始日時（ISO）。override 優先、なければ confirmedSlotId から解決。"""
    override = interview.get("confirmedOverride") or {}
    if override.get("start"):
        return override["start"]
    slot_id = interview.get("confirmedSlotId")
    if not slot_id:
        return None
    slot = next((s for s in section_slots(section_id) if s["id"] == slot_id), None)
    return slot["start"] if slot else None


def put_confirmed_time(member_id: int, body: dict) -> dict:
    interview = get_interview_item(member_id)
    member = members_svc.get_member(member_id)
    source = body.get("source") or "admin"
    settings = meta_svc.get_settings()
    start = body.get("start")
    end = body.get("end")
    confirmed_slot_id = None
    sales_id = body.get("salesId") or interview.get("confirmedSalesId")
    before_start = _confirmed_start_iso(interview, member["sectionId"])

    if body.get("slotId"):
        slot = next((s for s in section_slots(member["sectionId"]) if s["id"] == body["slotId"]), None)
        if not slot:
            raise_bad_request("枠が見つかりません", "SLOT_NOT_FOUND")
        holder = _start_held_by(member_id, slot["start"])
        if holder:
            raise_conflict(f"その時間は{members_svc.get_member(holder)['name']}さんの確定枠です")
        start = slot["start"]
        end = slot["end"]
        confirmed_slot_id = slot["id"]
        sales_id = _pick_sales_for_slot(member_id, slot, member_id)
        if not sales_id:
            raise_conflict("その時間に空いている営業がいません")
    else:
        if not start or not end:
            raise_bad_request("開始・終了日時または枠 ID を指定してください")
        if not sales_id:
            sales_id = "salesA"

    status = "confirmed"
    updates = {
        "status": status,
        "confirmedSlotId": confirmed_slot_id,
        "confirmedSalesId": sales_id,
        "confirmedOverride": None if confirmed_slot_id else {"start": start, "end": end},
        "assignReason": (
            f"Mgrによる日時変更（{SALES_LABEL[sales_id]}担当）"
            if source == "mgr"
            else f"管理者による手動変更（{SALES_LABEL[sales_id]}担当）"
        ),
        "meetingUrl": build_meeting_url(settings["provider"], member_id, start),
        "pendingNote": None,
        "changeRequest": None,
        "updatedAt": now_iso(),
        **_gsi_for(member["sectionId"], status, member_id),
    }
    repo().update(*_interview_key(member_id), updates)
    actor = "Mgr" if source == "mgr" else "管理者"
    display_name = member.get("surname") or member["name"]
    if before_start and start:
        notif_svc.push_notification(
            route=member["sectionId"],
            body=notif_svc.format_confirmed_time_change_body(
                display_name=display_name,
                actor=actor,
                before_iso=before_start,
                after_iso=start,
            ),
            label_style="mgr_confirmed",
        )
    return get_interview(member_id)


def send_reminder(member_id: int) -> dict:
    interview = get_interview_item(member_id)
    member = members_svc.get_member(member_id)
    deadline = sections_svc.get_section_deadline(member["sectionId"]).get("deadline")
    locked = interview.get("status") in ("confirmed", "change_requested")
    text = (
        f"{member['name']}さんへ確定済み面談のリマインドを送りました。"
        if locked
        else f"{member['name']}さんへ回答リマインドを送りました。期限: {deadline or '—'}"
    )
    repo().update(*_interview_key(member_id), {"remindedAt": now_iso(), "updatedAt": now_iso()})
    notif_svc.push_notification(
        route=member["sectionId"],
        body=text,
    )
    return get_interview(member_id)


def reopen_interview(member_id: int) -> dict:
    member = members_svc.get_member(member_id)
    status = "adjusting"
    updates = {
        "status": status,
        "confirmedSlotId": None,
        "confirmedSalesId": None,
        "confirmedOverride": None,
        "assignReason": None,
        "meetingUrl": None,
        "pendingNote": None,
        "changeRequest": None,
        "updatedAt": now_iso(),
        **_gsi_for(member["sectionId"], status, member_id),
    }
    repo().update(*_interview_key(member_id), updates)
    return get_interview(member_id)


VALID_VOTE_MARKS = {"first", "ok", "ng"}


def _is_locked(interview: dict) -> bool:
    return interview.get("status") in ("confirmed", "change_requested")


def put_interview_votes(member_id: int, votes: dict | None) -> dict:
    """OpenSpec putInterviewVotes / store.saveMemberVotes."""
    interview = get_interview_item(member_id)
    if _is_locked(interview):
        raise_conflict("確定済みのため、優先度は保存できません", "INTERVIEW_LOCKED")

    member = members_svc.get_member(member_id)
    section_id = member["sectionId"]
    if section_id == "unset" or not section_id:
        raise_bad_request("セクション未所属のため投票できません")

    settings, period, day_marks, hour_marks = _load_slot_context()
    slots = candidate_slots(
        section_id=section_id,
        hongo_joins=settings["hongoJoins"],
        day_marks=day_marks,
        hour_marks=hour_marks,
        range_start=period["startDate"],
        range_end=period["endDate"],
    )
    assignees = sales_svc.get_sales_assignees()
    sales_id = assignees.get(str(member_id))
    allowed_ids = {
        s["id"]
        for s in slots
        if sales_id and sales_can_take_slot(day_marks, hour_marks, sales_id, s)
    }

    cleaned: dict[str, str] = {}
    for slot_id, mark in (votes or {}).items():
        if not mark or mark == "ok":
            continue
        if mark not in VALID_VOTE_MARKS:
            raise_bad_request(f"優先度マークが不正です: {mark}")
        if slot_id not in allowed_ids:
            continue
        cleaned[str(slot_id)] = mark

    status = interview.get("status") or "unadjusted"
    if status == "unadjusted":
        status = "adjusting"

    updates = {
        "votes": cleaned,
        "status": status,
        "submittedAt": now_iso(),
        "pendingNote": None,
        "updatedAt": now_iso(),
        **_gsi_for(section_id, status, member_id),
    }
    repo().update(*_interview_key(member_id), updates)
    return get_interview(member_id)


def put_interview_preferences(member_id: int, preferences: dict | None) -> dict:
    """OpenSpec putInterviewPreferences / store.savePreferences."""
    get_interview_item(member_id)
    prefs = preferences or {}
    difficult = prefs.get("difficultDates") or []
    if not isinstance(difficult, list):
        raise_bad_request("difficultDates は配列である必要があります")
    cleaned = {
        "difficultDates": [str(d) for d in difficult],
        "preferredTimeNote": str(prefs.get("preferredTimeNote") or ""),
        "note": str(prefs.get("note") or ""),
    }
    repo().update(
        *_interview_key(member_id),
        {"preferences": cleaned, "updatedAt": now_iso()},
    )
    return get_interview(member_id)


def create_change_request(member_id: int, body: dict) -> dict:
    """OpenSpec createChangeRequest / store.requestChange."""
    reason = str((body or {}).get("reason") or "").strip()
    preferred = str((body or {}).get("preferredDates") or "").strip()
    if not reason or not preferred:
        raise_bad_request("理由と希望日を入力してください")

    interview = get_interview_item(member_id)
    if not _is_locked(interview):
        raise_conflict("確定後に変更希望を出せます", "NOT_CONFIRMED")

    member = members_svc.get_member(member_id)
    status = "change_requested"
    change_request = {
        "reason": reason,
        "preferredDates": preferred,
        "at": now_iso(),
    }
    updates = {
        "status": status,
        "changeRequest": change_request,
        "updatedAt": now_iso(),
        **_gsi_for(member["sectionId"], status, member_id),
    }
    repo().update(*_interview_key(member_id), updates)
    notif_svc.push_notification(
        route=member["sectionId"],
        body=(
            f"{member['name']}さんから日程変更の希望が届きました。\n"
            f"理由: {reason}\n希望: {preferred}"
        ),
    )
    return get_interview(member_id)


def send_section_requests(section_id: str) -> dict:
    sections_svc.get_section_item(section_id)
    slots = section_slots(section_id)
    members = members_svc.list_interview_members(section_id=section_id)
    if len(slots) < len(members):
        raise_bad_request(
            f"共通の空きが{len(slots)}枠です。エンジニア{len(members)}名分の1時間枠が必要です"
        )
    assignees = sales_svc.get_sales_assignees()
    without = [m for m in members if not assignees.get(str(m["id"]))]
    if without:
        names = "、".join(m["surname"] for m in without)
        raise_bad_request(f"営業担当が未設定のエンジニアがいます（{names}）")

    for member in members:
        item = get_interview_item(member["id"])
        if item.get("status") == "unadjusted":
            status = "adjusting"
            repo().update(
                *_interview_key(member["id"]),
                {
                    "status": status,
                    "updatedAt": now_iso(),
                    **_gsi_for(section_id, status, member["id"]),
                },
            )
    deadline = sections_svc.get_section_deadline(section_id).get("deadline")
    section_name = sections_svc.section_display_name(section_id)
    notif_svc.push_notification(
        route=section_id,
        body=(
            f"{sections_svc.section_mgr_name(section_id)} さんが調整依頼を送りました。\n"
            f"対象: {'、'.join(m['name'] for m in members)}\n"
            f"回答期限: {deadline or '—'}\n共通空き枠: {len(slots)}件"
        ),
    )
    return {"success": True, "message": f"{section_name}のエンジニアへ調整依頼を送りました"}
