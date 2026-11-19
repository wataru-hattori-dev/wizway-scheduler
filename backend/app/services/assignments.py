from __future__ import annotations

from app.db import repo
from app.domain.assign import SALES_LABEL, assign_section, build_meeting_url
from app.domain.calendar_util import now_iso
from app.domain.slots import sales_can_take_slot
from app.errors import raise_bad_request, raise_conflict, raise_not_found
from app.services import availability as availability_svc
from app.services import interviews as interviews_svc
from app.services import members as members_svc
from app.services import meta as meta_svc
from app.services import notifications as notif_svc
from app.services import sales_assignees as sales_svc
from app.services import sections as sections_svc


def _override_key(member_id: int) -> tuple[str, str]:
    return f"MEMBER#{member_id}", "ASSIGN_OVERRIDE"


def put_override(member_id: int, slot_id: str) -> dict:
    """確定前の割当変更（Mgr「日時の変更」含む）。関係者空きと重複を検証して保存する。"""
    member = members_svc.get_member(member_id)
    interview = interviews_svc.get_interview_item(member_id)
    if interview.get("status") in ("confirmed", "change_requested"):
        raise_conflict("確定済み面談の日時変更は confirmed-time API を使ってください", "INTERVIEW_LOCKED")

    slot = next((s for s in interviews_svc.section_slots(member["sectionId"]) if s["id"] == slot_id), None)
    if not slot:
        raise_bad_request("枠が見つかりません（関係者の空きがない日時の可能性があります）", "SLOT_NOT_FOUND")

    settings, _, day_marks, hour_marks = interviews_svc._load_slot_context()
    assignees = sales_svc.get_sales_assignees()
    sales_id = assignees.get(str(member_id))
    if not sales_id:
        raise_bad_request("担当営業が未設定です", "SALES_NOT_ASSIGNED")
    if not sales_can_take_slot(day_marks, hour_marks, sales_id, slot):
        raise_bad_request("担当営業が参加できない日時です", "SALES_UNAVAILABLE")

    difficult = (interview.get("preferences") or {}).get("difficultDates") or []
    if slot.get("day") in difficult:
        raise_bad_request("エンジニアが参加できない日です", "ENGINEER_UNAVAILABLE")
    if (interview.get("votes") or {}).get(slot_id) == "ng":
        raise_bad_request("エンジニアが参加できない日時です", "ENGINEER_UNAVAILABLE")

    # 確定済み面談との重複（同一営業 / 同一Mgr / 本郷参加時）
    for other in interviews_svc.list_interviews():
        oid = other["memberId"]
        if oid == member_id:
            continue
        if other.get("status") not in ("confirmed", "change_requested"):
            continue
        other_start = None
        if other.get("confirmedOverride") and other["confirmedOverride"].get("start"):
            other_start = other["confirmedOverride"]["start"]
        elif other.get("confirmedSlotId"):
            other_member = members_svc.get_member(oid)
            other_slot = next(
                (
                    s
                    for s in interviews_svc.section_slots(other_member["sectionId"])
                    if s["id"] == other["confirmedSlotId"]
                ),
                None,
            )
            other_start = other_slot["start"] if other_slot else None
        if not other_start or other_start != slot["start"]:
            continue
        if settings.get("hongoJoins"):
            raise_conflict(f"その時間は{members_svc.get_member(oid)['name']}さんの確定枠です")
        if other.get("confirmedSalesId") == sales_id:
            raise_conflict(f"その時間は{members_svc.get_member(oid)['name']}さんの確定枠です")
        other_member = members_svc.get_member(oid)
        if other_member.get("sectionId") == member["sectionId"]:
            raise_conflict(f"その時間は{other_member['name']}さんの確定枠です")

    # clear other overrides that share the same start
    for other in members_svc.list_members(include_deleted=True):
        oid = other["id"]
        if oid == member_id:
            continue
        existing = repo().get(*_override_key(oid))
        if not existing:
            continue
        other_slot = next(
            (
                s
                for s in interviews_svc.section_slots(other["sectionId"])
                if s["id"] == existing.get("slotId")
            ),
            None,
        )
        if other_slot and other_slot["start"] == slot["start"]:
            repo().delete(*_override_key(oid))

    repo().put(
        {
            "PK": f"MEMBER#{member_id}",
            "SK": "ASSIGN_OVERRIDE",
            "entityType": "AssignmentOverride",
            "campaignId": "current",
            "memberId": member_id,
            "slotId": slot_id,
            "updatedAt": now_iso(),
        }
    )
    return {"memberId": member_id, "slotId": slot_id}


def delete_override(member_id: int) -> None:
    item = repo().get(*_override_key(member_id))
    if not item:
        raise_not_found("オーバーライドが見つかりません")
    repo().delete(*_override_key(member_id))


def list_overrides() -> dict[int, str]:
    result: dict[int, str] = {}
    for member in members_svc.list_members(include_deleted=True):
        item = repo().get(*_override_key(member["id"]))
        if item and item.get("slotId"):
            result[member["id"]] = item["slotId"]
    return result


def _confirmed_starts() -> set[str]:
    starts: set[str] = set()
    for interview in interviews_svc.list_interviews():
        if interview["status"] not in ("confirmed", "change_requested"):
            continue
        if interview.get("confirmedOverride") and interview["confirmedOverride"].get("start"):
            starts.add(interview["confirmedOverride"]["start"])
            continue
        if interview.get("confirmedSlotId"):
            member = members_svc.get_member(interview["memberId"])
            slot = next(
                (
                    s
                    for s in interviews_svc.section_slots(member["sectionId"])
                    if s["id"] == interview["confirmedSlotId"]
                ),
                None,
            )
            if slot:
                starts.add(slot["start"])
    return starts


def _sales_busy() -> dict[str, list[str]]:
    busy = {"salesA": [], "salesB": []}
    for interview in interviews_svc.list_interviews():
        if interview["status"] not in ("confirmed", "change_requested"):
            continue
        sales_id = interview.get("confirmedSalesId")
        if sales_id not in busy:
            continue
        start = None
        if interview.get("confirmedOverride") and interview["confirmedOverride"].get("start"):
            start = interview["confirmedOverride"]["start"]
        elif interview.get("confirmedSlotId"):
            member = members_svc.get_member(interview["memberId"])
            slot = next(
                (
                    s
                    for s in interviews_svc.section_slots(member["sectionId"])
                    if s["id"] == interview["confirmedSlotId"]
                ),
                None,
            )
            start = slot["start"] if slot else None
        if start:
            busy[sales_id].append(start)
    return busy


def _sales_offers_for_section(section_id: str, slots: list[dict]) -> dict:
    """memberId -> slotId -> [salesId] based on assignee + availability."""
    _, _, day_marks, hour_marks = interviews_svc._load_slot_context()
    assignees = sales_svc.get_sales_assignees()
    offers: dict = {}
    members = members_svc.list_interview_members(section_id=section_id)
    for member in members:
        mid = str(member["id"])
        sales_id = assignees.get(mid)
        offers[mid] = {}
        for slot in slots:
            if sales_id and sales_can_take_slot(day_marks, hour_marks, sales_id, slot):
                offers[mid][slot["id"]] = [sales_id]
            else:
                offers[mid][slot["id"]] = []
    return offers


def apply_judge(section_ids: list[str], assign_unanswered: bool = False) -> dict:
    if not section_ids:
        raise_bad_request("sectionIds は必須です")
    settings = meta_svc.get_settings()
    used_starts = _confirmed_starts()
    sales_busy = _sales_busy()
    section_results = []
    summaries = []
    now = now_iso()

    for section_id in section_ids:
        sections_svc.get_section_item(section_id)
        if assign_unanswered:
            deadline_info = sections_svc.get_section_deadline(section_id)
            deadline = deadline_info.get("deadline")
            if deadline and deadline > now:
                sections_svc.put_section_deadline(section_id, now)

        slots = interviews_svc.section_slots(section_id)
        members_raw = members_svc.list_interview_members(section_id=section_id)
        members = []
        for m in members_raw:
            iv = interviews_svc.get_interview(m["id"])
            members.append(
                {
                    "id": m["id"],
                    "status": iv["status"],
                    "submittedAt": iv.get("submittedAt"),
                    "confirmedSlotId": iv.get("confirmedSlotId"),
                    "confirmedSalesId": iv.get("confirmedSalesId"),
                    "votes": iv.get("votes") or {},
                }
            )
        offers = _sales_offers_for_section(section_id, slots)
        result = assign_section(
            slots=slots,
            members=members,
            assign_unanswered=assign_unanswered,
            blocked_starts=list(used_starts),
            sales_busy=sales_busy,
            sales_offers=offers,
        )
        for item in result["assignments"]:
            slot = next((s for s in slots if s["id"] == item["slotId"]), None)
            if slot:
                used_starts.add(slot["start"])
                sales_busy[item["salesId"]].append(slot["start"])
            status = "confirmed"
            updates = {
                "status": status,
                "confirmedSlotId": item["slotId"],
                "confirmedSalesId": item["salesId"],
                "confirmedOverride": None,
                "assignReason": item["reason"],
                "meetingUrl": build_meeting_url(
                    settings["provider"], item["memberId"], slot["start"] if slot else ""
                ),
                "pendingNote": None,
                "changeRequest": None,
                "updatedAt": now,
                **interviews_svc._gsi_for(section_id, status, item["memberId"]),
            }
            repo().update(*interviews_svc._interview_key(item["memberId"]), updates)

        for item in result["manual"]:
            repo().update(
                *interviews_svc._interview_key(item["memberId"]),
                {"pendingNote": item["reason"], "updatedAt": now},
            )

        sections_svc.set_judged_at(section_id, now)
        section_name = sections_svc.section_display_name(section_id)
        summary = f"{section_name}: 確定{len(result['assignments'])}名 / 手動待ち{len(result['manual'])}名"
        summaries.append(summary)
        lines = []
        for item in result["assignments"]:
            slot = next((s for s in slots if s["id"] == item["slotId"]), None)
            member = members_svc.get_member(item["memberId"])
            lines.append(f"・{member['name']}: {slot['start'] if slot else item['slotId']}（{item['reason']}）")
        for item in result["manual"]:
            member = members_svc.get_member(item["memberId"])
            lines.append(f"・{member['name']}: {item['reason']}")
        notif_svc.push_notification(
            route=section_id,
            body=(
                f"{'期限到来の自動判定' if assign_unanswered else '回答済みの自動判定'}を実行しました。\n"
                + ("\n".join(lines) if lines else "新たに確定したメンバーはいません。")
            ),
        )
        section_results.append(
            {
                "sectionId": section_id,
                "assignments": result["assignments"],
                "manual": result["manual"],
                "summary": summary,
            }
        )

    return {"sections": section_results, "message": " / ".join(summaries)}


def manual_assign(member_id: int, slot_id: str) -> dict:
    member = members_svc.get_member(member_id)
    slot = next((s for s in interviews_svc.section_slots(member["sectionId"]) if s["id"] == slot_id), None)
    if not slot:
        raise_bad_request("枠が見つかりません", "SLOT_NOT_FOUND")
    holder = interviews_svc._start_held_by(member_id, slot["start"])
    if holder:
        raise_conflict(f"その時間は{members_svc.get_member(holder)['name']}さんの確定枠です")
    sales_id = interviews_svc._pick_sales_for_slot(member_id, slot, member_id)
    if not sales_id:
        raise_conflict("その時間に空いている営業がいません")
    settings = meta_svc.get_settings()
    status = "confirmed"
    updates = {
        "status": status,
        "confirmedSlotId": slot_id,
        "confirmedSalesId": sales_id,
        "confirmedOverride": None,
        "assignReason": f"Mgrによる手動割り当て（{SALES_LABEL[sales_id]}担当）",
        "meetingUrl": build_meeting_url(settings["provider"], member_id, slot["start"]),
        "pendingNote": None,
        "changeRequest": None,
        "updatedAt": now_iso(),
        **interviews_svc._gsi_for(member["sectionId"], status, member_id),
    }
    repo().update(*interviews_svc._interview_key(member_id), updates)
    notif_svc.push_notification(
        route=member["sectionId"],
        body=(
            f"{member['name']}さんの面談日時を手動で確定しました。\n"
            f"{slot['start']} – {slot['end']}\n担当: {SALES_LABEL[sales_id]}"
        ),
    )
    try:
        delete_override(member_id)
    except Exception:
        pass
    return interviews_svc.get_interview(member_id)


def confirm_assignments(items: list[dict]) -> dict:
    if not items:
        raise_bad_request("items は必須です")
    settings = meta_svc.get_settings()
    confirmed = []
    line_entries: list[tuple[str, str]] = []  # (start_iso, line)
    for item in items:
        member_id = int(item["memberId"])
        slot_id = item["slotId"]
        member = members_svc.get_member(member_id)
        slot = next(
            (s for s in interviews_svc.section_slots(member["sectionId"]) if s["id"] == slot_id),
            None,
        )
        if not slot:
            continue
        holder = interviews_svc._start_held_by(member_id, slot["start"])
        if holder:
            continue
        sales_id = interviews_svc._pick_sales_for_slot(member_id, slot, member_id)
        if not sales_id:
            continue
        status = "confirmed"
        updates = {
            "status": status,
            "confirmedSlotId": slot_id,
            "confirmedSalesId": sales_id,
            "confirmedOverride": None,
            "assignReason": f"（{SALES_LABEL[sales_id]}担当）",
            "meetingUrl": build_meeting_url(settings["provider"], member_id, slot["start"]),
            "pendingNote": None,
            "changeRequest": None,
            "updatedAt": now_iso(),
            **interviews_svc._gsi_for(member["sectionId"], status, member_id),
        }
        repo().update(*interviews_svc._interview_key(member_id), updates)
        try:
            if repo().get(*_override_key(member_id)):
                repo().delete(*_override_key(member_id))
        except Exception:
            pass
        interview = interviews_svc.get_interview(member_id)
        confirmed.append(interview)
        surname = member.get("surname") or member["name"]
        line_entries.append(
            (slot["start"], notif_svc.format_mgr_confirmed_slot_line(surname, slot["start"]))
        )

    if not confirmed:
        raise_bad_request("確定できる割当がありません")

    # この通知に限り開始日時の昇順で並べる（他通知・画面の並びには影響させない）
    line_entries.sort(key=lambda entry: entry[0])
    lines = [line for _, line in line_entries]

    first = members_svc.get_member(int(items[0]["memberId"]))
    notif_svc.push_notification(
        route=first["sectionId"],
        body="【Mgrが面談を確定しました。】\n\n" + "\n".join(lines),
        label_style="mgr_confirmed",
    )
    return {
        "confirmedCount": len(confirmed),
        "interviews": confirmed,
        "message": f"{len(confirmed)}名の面談を確定しました",
    }
