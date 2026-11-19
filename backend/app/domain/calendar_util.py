from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

try:
    JST = ZoneInfo("Asia/Tokyo")
except ZoneInfoNotFoundError:
    # Windows 等で tzdata 未導入のときのフォールバック（固定オフセット）
    JST = timezone(timedelta(hours=9), name="JST")


HOURS = [
    {"hour": 10, "avoided": True},
    {"hour": 11, "avoided": False},
    {"hour": 12, "avoided": False},
    {"hour": 14, "avoided": False},
    {"hour": 15, "avoided": False},
    {"hour": 16, "avoided": False},
    {"hour": 17, "avoided": False},
    {"hour": 18, "avoided": False},
]

HOUR_VALUES = [h["hour"] for h in HOURS]

DEFAULT_RANGE_START = "2026-12-01"
DEFAULT_RANGE_END = "2026-12-18"


def now_iso() -> str:
    return datetime.now(JST).isoformat(timespec="seconds")


def jst(y: int, m: int, d: int, hh: int, mm: int = 0) -> str:
    return f"{y:04d}-{m:02d}-{d:02d}T{hh:02d}:{mm:02d}:00+09:00"


def _nth_monday(year: int, month: int, n: int) -> int:
    first = date(year, month, 1)
    first_dow = (first.weekday() + 1) % 7  # Sun=0 … Sat=6 (JS getUTCDay)
    offset = (1 - first_dow + 7) % 7
    return 1 + offset + (n - 1) * 7


def _equinox_day(year: int, kind: str) -> int:
    if kind == "vernal":
        return int(20.8431 + 0.242194 * (year - 1980) - ((year - 1980) // 4))
    return int(23.2488 + 0.242194 * (year - 1980) - ((year - 1980) // 4))


def is_japanese_holiday(iso: str) -> bool:
    y, m, d = (int(x) for x in iso.split("-"))
    fixed = {
        f"{y:04d}-01-01",
        f"{y:04d}-01-{_nth_monday(y, 1, 2):02d}",
        f"{y:04d}-02-11",
        f"{y:04d}-02-23",
        f"{y:04d}-03-{_equinox_day(y, 'vernal'):02d}",
        f"{y:04d}-04-29",
        f"{y:04d}-05-03",
        f"{y:04d}-05-04",
        f"{y:04d}-05-05",
        f"{y:04d}-07-{_nth_monday(y, 7, 3):02d}",
        f"{y:04d}-08-11",
        f"{y:04d}-09-{_nth_monday(y, 9, 3):02d}",
        f"{y:04d}-09-{_equinox_day(y, 'autumnal'):02d}",
        f"{y:04d}-10-{_nth_monday(y, 10, 2):02d}",
        f"{y:04d}-11-03",
        f"{y:04d}-11-23",
    }
    if iso in fixed:
        return True
    prev = date(y, m, d) - timedelta(days=1)
    prev_iso = prev.isoformat()
    if prev.weekday() == 6 and prev_iso in fixed:  # Sunday
        return True
    nxt = date(y, m, d) + timedelta(days=1)
    cur = date(y, m, d)
    if cur.weekday() < 5 and prev_iso in fixed and nxt.isoformat() in fixed:
        return True
    return False


def business_days(range_start: str, range_end: str) -> list[dict]:
    try:
        start = date.fromisoformat(range_start)
        end = date.fromisoformat(range_end)
    except ValueError:
        return []
    days: list[dict] = []
    cursor = start
    while cursor <= end:
        iso = cursor.isoformat()
        # Match JS getUTCDay on YYYY-MM-DD as UTC midnight
        dow = cursor.weekday()  # Mon=0 … Sun=6
        js_dow = (dow + 1) % 7  # Sun=0 … Sat=6
        if js_dow not in (0, 6) and not is_japanese_holiday(iso):
            days.append({"iso": iso, "day": cursor.day, "dow": js_dow})
        cursor += timedelta(days=1)
    return days


def slot_bounds(iso: str, hour: int) -> dict:
    y, m, d = (int(x) for x in iso.split("-"))
    return {"start": jst(y, m, d, hour, 0), "end": jst(y, m, d, hour + 1, 0)}


def parse_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


def utc_now() -> datetime:
    return datetime.now(timezone.utc)
