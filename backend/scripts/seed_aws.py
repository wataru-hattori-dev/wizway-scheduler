"""One-shot seed against AWS DynamoDB (uses default credential chain)."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Any

import boto3

SEED = Path(__file__).resolve().parents[2] / "infra" / "local" / "demo_seed.json"
TABLE_NAME = os.environ.get("DYNAMODB_TABLE_NAME", "wizway-scheduler")
REGION = os.environ.get("AWS_REGION", "ap-northeast-1")


def strip_none(value: Any) -> Any:
    if isinstance(value, dict):
        return {k: strip_none(v) for k, v in value.items() if v is not None}
    if isinstance(value, list):
        return [strip_none(v) for v in value if v is not None]
    return value


def main() -> int:
    items = json.loads(SEED.read_text(encoding="utf-8"))
    table = boto3.resource("dynamodb", region_name=REGION).Table(TABLE_NAME)

    deleted = 0
    kwargs: dict[str, Any] = {"ProjectionExpression": "PK, SK"}
    while True:
        resp = table.scan(**kwargs)
        batch_items = resp.get("Items") or []
        if batch_items:
            with table.batch_writer() as batch:
                for item in batch_items:
                    batch.delete_item(Key={"PK": item["PK"], "SK": item["SK"]})
                    deleted += 1
        lek = resp.get("LastEvaluatedKey")
        if not lek:
            break
        kwargs["ExclusiveStartKey"] = lek
    print(f"deleted={deleted}")

    with table.batch_writer() as batch:
        for item in items:
            batch.put_item(Item=strip_none(item))
    print(f"seeded={len(items)}")

    meta = table.get_item(Key={"PK": "CAMPAIGN#current", "SK": "META"}).get("Item")
    print("meta_quarter=", (meta or {}).get("quarterLabel"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
