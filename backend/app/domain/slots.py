from __future__ import annotations

from app.domain.calendar_util import HOURS, business_days, slot_bounds


def party_ids_for(section_id: str, hongo_joins: bool) -> list[str]:
    return ["hongo", section_id] if hongo_joins else [section_id]


def blocking_voters(day_marks: dict, voter_ids: list[str], day: str) -> list[str]:
    return [vid for vid in voter_ids if (day_marks.get(vid) or {}).get(day) == "ng"]


def available_hours(hour_marks: dict, voter_ids: list[str], day_iso: str) -> list[dict]:
    selected = [h["hour"] for h in HOURS]
    for vid in voter_ids:
        picked = (hour_marks.get(vid) or {}).get(day_iso)
        if not isinstance(picked, list):
            continue
        selected = [h for h in selected if h in picked]
    return [h for h in HOURS if h["hour"] in selected]


def candidate_slots(
    *,
    section_id: str,
    hongo_joins: bool,
    day_marks: dict[str, dict],
    hour_marks: dict[str, dict],
    range_start: str,
    range_end: str,
) -> list[dict]:
    voters = party_ids_for(section_id, hongo_joins)
    slots: list[dict] = []
    for day in business_days(range_start, range_end):
        blocking = blocking_voters(day_marks, voters, day["iso"])
        if blocking:
            continue
        for hour in available_hours(hour_marks, voters, day["iso"]):
            bounds = slot_bounds(day["iso"], hour["hour"])
            slots.append(
                {
                    "id": f"{section_id}-{day['iso']}-{hour['hour']:02d}",
                    "sectionId": section_id,
                    "day": day["iso"],
                    "avoided": hour["avoided"],
                    **bounds,
                }
            )
    slots.sort(key=lambda s: s["start"])
    return slots


def sales_can_take_slot(day_marks: dict, hour_marks: dict, sales_id: str, slot: dict) -> bool:
    day = slot.get("day") or str(slot.get("start", ""))[:10]
    hour = int(str(slot.get("start", ""))[11:13]) if slot.get("start") else None
    if not day:
        return False
    if (day_marks.get(sales_id) or {}).get(day) == "ng":
        return False
    hours = (hour_marks.get(sales_id) or {}).get(day)
    if isinstance(hours, list) and hour is not None and hour not in hours:
        return False
    return True
