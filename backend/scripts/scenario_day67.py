"""Day 6-7 local end-to-end scenario (no AWS deploy, no real Slack HTTP).

Flow: admin settings → sales/engineer availability & votes → confirm → change request
"""

from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request
from datetime import date, timedelta

BASE = "http://127.0.0.1:3001/api/v1"


def req(method: str, path: str, body: dict | None = None):
    data = None if body is None else json.dumps(body).encode("utf-8")
    request = urllib.request.Request(
        f"{BASE}{path}",
        data=data,
        method=method,
        headers={"Content-Type": "application/json"} if body is not None else {},
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            raw = response.read().decode("utf-8")
            return response.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as err:
        raw = err.read().decode("utf-8")
        try:
            payload = json.loads(raw) if raw else {"message": str(err)}
        except json.JSONDecodeError:
            payload = {"message": raw or str(err)}
        return err.code, payload


def ok(step: str, status: int, expect: int | tuple[int, ...] = 200):
    expected = expect if isinstance(expect, tuple) else (expect,)
    mark = "PASS" if status in expected else "FAIL"
    print(f"[{mark}] {step} -> HTTP {status}")
    if status not in expected:
        raise SystemExit(1)


def main() -> None:
    print("=== Day 6-7 scenario ===")

    status, _ = req("POST", "/dev/reseed")
    ok("reseed", status, (200, 201, 204))

    start = date.today() + timedelta(days=14)
    # align to Monday-ish business window
    while start.weekday() >= 5:
        start += timedelta(days=1)
    end = start + timedelta(days=20)
    mgr_deadline = (start - timedelta(days=7)).isoformat()
    eng_deadline = (start - timedelta(days=3)).isoformat()

    status, body = req(
        "PUT",
        "/interview-period",
        {"startDate": start.isoformat(), "endDate": end.isoformat()},
    )
    ok("admin interview-period", status)
    print(f"  period={body}")

    status, body = req(
        "PUT",
        "/response-deadlines",
        {"mgrSalesDeadline": mgr_deadline, "engineerDeadline": eng_deadline},
    )
    ok("admin response-deadlines", status)
    print(f"  deadlines={body}")

    # Keep a few weekdays free for meguro Mgr / salesA / (optional) hongo
    day_marks = {}
    hour_marks = {}
    for offset in range(0, 10):
        day = start + timedelta(days=offset)
        if day.weekday() >= 5:
            continue
        iso = day.isoformat()
        day_marks[iso] = "ok"
        hour_marks[iso] = [11, 12, 13, 14, 15, 16]

    for voter in ("meguro", "salesA"):
        status, body = req(
            "PUT",
            f"/availability/{voter}",
            {"dayMarks": day_marks, "hourMarks": hour_marks},
        )
        ok(f"availability {voter}", status)

    status, members = req("GET", "/members")
    ok("list members", status)
    section_meguro = [
        m for m in members["members"] if m.get("sectionId") == "meguro" and not m.get("isDeleted")
    ]
    if not section_meguro:
        print("FAIL: no meguro section members")
        raise SystemExit(1)
    member = section_meguro[0]
    member_id = member["id"]
    print(f"  target member={member['name']} id={member_id}")

    assignees = {str(m["id"]): "salesA" for m in section_meguro}
    status, body = req("PUT", "/sales-assignees", assignees)
    ok("sales assignees", status)

    # Engineer votes: fetch interviews to learn candidate slots via availability side-effect
    # Prefer building slot ids from known section pattern used by backend.
    vote_days = [d for d in sorted(day_marks.keys())][:3]
    votes = {}
    for i, day in enumerate(vote_days):
        for hour in (11, 12, 13):
            slot_id = f"meguro-{day}-{hour:02d}"
            votes[slot_id] = "first" if i == 0 and hour == 11 else "ok"
    # Ensure at least one first-choice
    if not any(v == "first" for v in votes.values()):
        first_key = next(iter(votes))
        votes[first_key] = "first"

    status, body = req("PUT", f"/interviews/{member_id}/votes", {"votes": votes})
    ok("engineer votes", status)
    print(f"  submittedAt={body.get('submittedAt')} status={body.get('status')}")

    # Prefer auto-judge for meguro section if available; otherwise manual confirm with first vote slot
    status, judge = req(
        "POST", "/assignments/judge", {"sectionIds": ["meguro"], "assignUnanswered": False}
    )
    if status == 200:
        ok("assignments judge", status)
        print(f"  judge={judge.get('message')}")
        status, interviews = req("GET", f"/interviews/{member_id}")
        ok("get interview after judge", status)
        if interviews.get("status") not in ("confirmed", "change_requested"):
            # fall back: confirm first voted slot
            slot_id = next(k for k, v in votes.items() if v == "first")
            status, confirm = req(
                "POST",
                "/assignments/confirm",
                {"items": [{"memberId": member_id, "slotId": slot_id}]},
            )
            ok("assignments confirm (fallback)", status, (200, 201))
            print(f"  confirm={confirm.get('message')}")
    else:
        print(f"[WARN] judge failed HTTP {status}: {judge}; trying confirm")
        slot_id = next(k for k, v in votes.items() if v == "first")
        status, confirm = req(
            "POST",
            "/assignments/confirm",
            {"items": [{"memberId": member_id, "slotId": slot_id}]},
        )
        ok("assignments confirm", status, (200, 201))
        print(f"  confirm={confirm.get('message')}")

    status, interview = req("GET", f"/interviews/{member_id}")
    ok("interview confirmed", status)
    print(f"  status={interview.get('status')} slot={interview.get('confirmedSlotId')}")
    if interview.get("status") not in ("confirmed", "change_requested"):
        print("FAIL: expected confirmed interview")
        raise SystemExit(1)

    status, changed = req(
        "POST",
        f"/interviews/{member_id}/change-requests",
        {"reason": "客先都合で移動希望", "preferredDates": "翌週の午後"},
    )
    ok("change request", status, (200, 201))
    print(f"  change status={changed.get('status')}")

    status, notifs = req("GET", "/notifications")
    ok("list notifications", status)
    bodies = [n.get("body", "") for n in notifs.get("notifications", [])]
    has_confirmish = any("確定" in b for b in bodies)
    has_change = any("変更" in b for b in bodies)
    print(f"  notifications={len(bodies)} confirmish={has_confirmish} change={has_change}")
    if not has_change:
        print("FAIL: change-request notification missing")
        raise SystemExit(1)

    print("=== ALL PASS ===")


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as exc:  # noqa: BLE001
        print(f"FAIL: {exc}")
        sys.exit(1)
