"""開発用 reseed: infra/local/demo_seed.json のデモ状態へテーブルを復元する。"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from app.db import repo, strip_none


def demo_seed_path() -> Path:
    """ローカルは demo_seed.local.json 優先、次に公開用 demo_seed.json。Lambda は /var/task。"""
    here = Path(__file__).resolve()
    local_dir = here.parents[3] / "infra" / "local"
    candidates = [
        local_dir / "demo_seed.local.json",
        local_dir / "demo_seed.json",
        here.parents[2] / "demo_seed.json",
    ]
    for path in candidates:
        if path.is_file():
            return path
    return candidates[1]


def load_demo_seed_items() -> list[dict[str, Any]]:
    path = demo_seed_path()
    if not path.is_file():
        raise FileNotFoundError(f"デモシードが見つかりません: {path}")
    with path.open(encoding="utf-8") as f:
        items = json.load(f)
    if not isinstance(items, list) or not items:
        raise ValueError(f"デモシードが空または不正です: {path}")
    return items


def _clear_all_items() -> int:
    r = repo()
    table = r.table
    deleted = 0
    kwargs: dict[str, Any] = {"ProjectionExpression": "PK, SK"}
    while True:
        resp = table.scan(**kwargs)
        items = resp.get("Items") or []
        if items:
            with table.batch_writer() as batch:
                for item in items:
                    batch.delete_item(Key={"PK": item["PK"], "SK": item["SK"]})
                    deleted += 1
        lek = resp.get("LastEvaluatedKey")
        if not lek:
            break
        kwargs["ExclusiveStartKey"] = lek
    return deleted


def _put_seed_items(items: list[dict[str, Any]]) -> None:
    table = repo().table
    with table.batch_writer() as batch:
        for item in items:
            batch.put_item(Item=strip_none(item))


def _summarize(items: list[dict[str, Any]]) -> dict[str, Any]:
    by_type: dict[str, int] = {}
    interview_vote_count = 0
    availability_with_marks = 0
    for item in items:
        et = item.get("entityType") or "?"
        by_type[et] = by_type.get(et, 0) + 1
        if et == "Interview" and (item.get("votes") or {}):
            interview_vote_count += 1
        if et == "Availability":
            if item.get("dayMarks") or item.get("hourMarks"):
                availability_with_marks += 1
    return {
        "itemCount": len(items),
        "memberCount": by_type.get("Member", 0),
        "interviewCount": by_type.get("Interview", 0),
        "availabilityCount": by_type.get("Availability", 0),
        "availabilityWithMarks": availability_with_marks,
        "interviewVoteCount": interview_vote_count,
        "sectionCount": by_type.get("Section", 0),
        "byEntityType": by_type,
    }


def reseed_from_demo() -> dict[str, Any]:
    """テーブルをクリアし、demo_seed.json を投入してデモ状態へ復元する。"""
    items = load_demo_seed_items()
    deleted = _clear_all_items()
    _put_seed_items(items)
    summary = _summarize(items)
    summary["deletedBeforeRestore"] = deleted
    return summary
