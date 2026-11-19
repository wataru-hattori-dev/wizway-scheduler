from __future__ import annotations

import random
from datetime import datetime

SALES_IDS = ["salesA", "salesB"]

_SALES_LABEL_FALLBACK = {"salesA": "Sales A", "salesB": "Sales B"}


def sales_label_map() -> dict[str, str]:
    """role=sales のメンバーを ID 昇順で salesA/salesB に対応付けた表示名。"""
    labels = dict(_SALES_LABEL_FALLBACK)
    try:
        from app.services.members import list_members

        sales = sorted(
            [m for m in list_members() if m.get("role") == "sales"],
            key=lambda m: int(m["id"]),
        )
        for idx, sid in enumerate(SALES_IDS):
            if idx < len(sales):
                labels[sid] = sales[idx].get("surname") or sales[idx].get("name") or labels[sid]
    except Exception:
        pass
    return labels


def sales_label(sales_id: str) -> str:
    return sales_label_map().get(sales_id, sales_id)


def sales_names_joined(separator: str = "・") -> str:
    labels = sales_label_map()
    return separator.join(labels[sid] for sid in SALES_IDS if labels.get(sid))


class _LazySalesLabels(dict):
    """既存の SALES_LABEL[id] アクセスを動的解決へ橋渡し。"""

    def __getitem__(self, key):  # type: ignore[override]
        return sales_label(str(key))

    def get(self, key, default=None):  # type: ignore[override]
        labels = sales_label_map()
        return labels.get(key, default)


SALES_LABEL = _LazySalesLabels(_SALES_LABEL_FALLBACK)


def _hour_of(start: str) -> int:
    return int(str(start)[11:13])


def _by_open_preference(slot: dict) -> tuple:
    return (1 if _hour_of(slot["start"]) == 10 else 0, slot["start"])


def _offered_sales(sales_offers: dict | None, member_id: int, slot_id: str) -> list[str]:
    if not sales_offers:
        return list(SALES_IDS)
    entry = (sales_offers.get(str(member_id)) or sales_offers.get(member_id) or {}).get(slot_id)
    if not entry:
        return []
    if isinstance(entry, list):
        return [sid for sid in entry if sid in SALES_IDS]
    return [sid for sid in SALES_IDS if entry.get(sid) == "ok"]


def _pick_sales(candidates: list[str], start: str, busy: dict[str, set]) -> str | None:
    for sales_id in candidates:
        if start not in busy.get(sales_id, set()):
            return sales_id
    return None


def assign_section(
    *,
    slots: list[dict],
    members: list[dict],
    assign_unanswered: bool = False,
    blocked_starts: list[str] | None = None,
    sales_busy: dict | None = None,
    sales_offers: dict | None = None,
) -> dict:
    ordered = sorted(slots, key=_by_open_preference)
    taken_ids: set[str] = set()
    taken_starts: set[str] = set(blocked_starts or [])
    locked: set[int] = set()
    busy = {
        "salesA": set((sales_busy or {}).get("salesA") or []),
        "salesB": set((sales_busy or {}).get("salesB") or []),
    }

    def is_free(slot: dict) -> bool:
        return slot["id"] not in taken_ids and slot["start"] not in taken_starts

    def take(slot: dict, sales_id: str) -> None:
        taken_ids.add(slot["id"])
        taken_starts.add(slot["start"])
        busy[sales_id].add(slot["start"])

    for member in members:
        status = member.get("status")
        locked_status = status in ("confirmed", "change_requested")
        if locked_status and member.get("confirmedSlotId"):
            taken_ids.add(member["confirmedSlotId"])
            held = next((s for s in ordered if s["id"] == member["confirmedSlotId"]), None)
            if held:
                taken_starts.add(held["start"])
                sales_id = member.get("confirmedSalesId") or "salesA"
                busy[sales_id].add(held["start"])
            locked.add(int(member["id"]))

    open_members = [
        m for m in members if int(m["id"]) not in locked and m.get("status") != "unadjusted"
    ]
    submitted = sorted(
        [m for m in open_members if m.get("submittedAt")],
        key=lambda m: (m.get("submittedAt") or "", int(m["id"])),
    )

    assignments: list[dict] = []
    manual: list[dict] = []
    assigned: set[int] = set()

    def try_assign(member: dict, slot: dict, reason_base: str) -> bool:
        mid = int(member["id"])
        sales_id = _pick_sales(
            _offered_sales(sales_offers, mid, slot["id"]), slot["start"], busy
        )
        if not sales_id or not is_free(slot):
            return False
        take(slot, sales_id)
        assigned.add(mid)
        assignments.append(
            {
                "memberId": mid,
                "slotId": slot["id"],
                "salesId": sales_id,
                "reason": f"{reason_base}（{SALES_LABEL[sales_id]}担当）",
            }
        )
        return True

    for member in submitted:
        votes = member.get("votes") or {}
        first = next((s for s in ordered if votes.get(s["id"]) == "first"), None)
        if first:
            try_assign(member, first, "第一希望で確定")

    for member in submitted:
        mid = int(member["id"])
        if mid in assigned:
            continue
        votes = member.get("votes") or {}
        # 空白（未投票）は UI 上の「調整可能」扱い（〇 廃止）。× 以外を候補にする。
        fallback = next(
            (
                s
                for s in ordered
                if votes.get(s["id"]) != "ng"
                and is_free(s)
                and _pick_sales(_offered_sales(sales_offers, mid, s["id"]), s["start"], busy)
            ),
            None,
        )
        if fallback and try_assign(member, fallback, "調整可能枠へスライド（先着順）"):
            continue
        manual.append(
            {
                "memberId": mid,
                "reason": "空いている調整可能枠と担当可能な営業がいないため、手動割り当てが必要です",
            }
        )

    if assign_unanswered:
        waiting = [m for m in open_members if not m.get("submittedAt")]
        pool = [s for s in ordered if is_free(s)]
        random.shuffle(pool)
        for member in waiting:
            placed = False
            for i, slot in enumerate(list(pool)):
                if try_assign(member, slot, "未回答のため残枠からランダム割当"):
                    pool.pop(i)
                    placed = True
                    break
            if not placed:
                manual.append(
                    {
                        "memberId": int(member["id"]),
                        "reason": "残枠または担当可能な営業がないため、手動割り当てが必要です",
                    }
                )

    return {
        "assignments": assignments,
        "manual": manual,
        "takenStarts": list(taken_starts),
    }


def build_meeting_url(provider: str, member_id: int, start: str) -> str:
    stamp = datetime.fromisoformat(start).strftime("%Y%m%d%H%M") if start else "tbd"
    if provider == "zoom":
        return f"https://zoom.us/j/{100000000 + int(member_id)}?pwd=mock-{stamp}"
    return f"https://meet.google.com/mock-{member_id}-{stamp}"
