#!/usr/bin/env python3
"""Create wizway-scheduler table on DynamoDB Local and optionally seed demo data.

Design SSOT: spec/dynamodb-design.md
Schema mirror: infra/dynamodb/table.yaml
Seed source (priority):
  1. infra/local/demo_seed.local.json (gitignored — machine-local / real ops snapshot)
  2. infra/local/demo_seed.json (public fictional sample)
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

import boto3
from botocore.exceptions import ClientError

TABLE_NAME = os.environ.get("DYNAMODB_TABLE_NAME", "wizway-scheduler")
ENDPOINT_URL = os.environ.get("DYNAMODB_ENDPOINT_URL", "http://localhost:8000")
REGION = os.environ.get("AWS_REGION", "ap-northeast-1")
_LOCAL_DIR = Path(__file__).resolve().parent
DEMO_SEED_LOCAL_PATH = _LOCAL_DIR / "demo_seed.local.json"
DEMO_SEED_PATH = _LOCAL_DIR / "demo_seed.json"


def resolve_demo_seed_path() -> Path:
    if DEMO_SEED_LOCAL_PATH.is_file():
        return DEMO_SEED_LOCAL_PATH
    return DEMO_SEED_PATH


def client():
    return boto3.client(
        "dynamodb",
        endpoint_url=ENDPOINT_URL,
        region_name=REGION,
        aws_access_key_id=os.environ.get("AWS_ACCESS_KEY_ID", "local"),
        aws_secret_access_key=os.environ.get("AWS_SECRET_ACCESS_KEY", "local"),
    )


def resource():
    return boto3.resource(
        "dynamodb",
        endpoint_url=ENDPOINT_URL,
        region_name=REGION,
        aws_access_key_id=os.environ.get("AWS_ACCESS_KEY_ID", "local"),
        aws_secret_access_key=os.environ.get("AWS_SECRET_ACCESS_KEY", "local"),
    )


def wait_ready(ddb, retries: int = 30) -> None:
    for i in range(retries):
        try:
            ddb.list_tables()
            return
        except Exception as exc:  # noqa: BLE001
            if i == retries - 1:
                raise RuntimeError(
                    f"DynamoDB Local に接続できません: {ENDPOINT_URL}\n"
                    "先に `docker compose up -d` を実行してください。"
                ) from exc
            import time

            time.sleep(1)


def create_table(ddb) -> None:
    existing = ddb.list_tables().get("TableNames", [])
    if TABLE_NAME in existing:
        print(f"[skip] table already exists: {TABLE_NAME}")
        return

    print(f"[create] {TABLE_NAME}")
    ddb.create_table(
        TableName=TABLE_NAME,
        BillingMode="PAY_PER_REQUEST",
        AttributeDefinitions=[
            {"AttributeName": "PK", "AttributeType": "S"},
            {"AttributeName": "SK", "AttributeType": "S"},
            {"AttributeName": "GSI1PK", "AttributeType": "S"},
            {"AttributeName": "GSI1SK", "AttributeType": "S"},
            {"AttributeName": "GSI2PK", "AttributeType": "S"},
            {"AttributeName": "GSI2SK", "AttributeType": "S"},
        ],
        KeySchema=[
            {"AttributeName": "PK", "KeyType": "HASH"},
            {"AttributeName": "SK", "KeyType": "RANGE"},
        ],
        GlobalSecondaryIndexes=[
            {
                "IndexName": "GSI1",
                "KeySchema": [
                    {"AttributeName": "GSI1PK", "KeyType": "HASH"},
                    {"AttributeName": "GSI1SK", "KeyType": "RANGE"},
                ],
                "Projection": {"ProjectionType": "ALL"},
            },
            {
                "IndexName": "GSI2",
                "KeySchema": [
                    {"AttributeName": "GSI2PK", "KeyType": "HASH"},
                    {"AttributeName": "GSI2SK", "KeyType": "RANGE"},
                ],
                "Projection": {"ProjectionType": "ALL"},
            },
        ],
    )
    waiter = ddb.get_waiter("table_exists")
    waiter.wait(TableName=TABLE_NAME)
    print(f"[ok] table ready: {TABLE_NAME}")


def delete_table(ddb) -> None:
    existing = ddb.list_tables().get("TableNames", [])
    if TABLE_NAME not in existing:
        print(f"[skip] table not found: {TABLE_NAME}")
        return
    print(f"[delete] {TABLE_NAME}")
    ddb.delete_table(TableName=TABLE_NAME)
    waiter = ddb.get_waiter("table_not_exists")
    waiter.wait(TableName=TABLE_NAME)
    print("[ok] deleted")


def strip_none(value: Any) -> Any:
    """DynamoDB は NULL 属性を拒否するため None を除去する。"""
    if isinstance(value, dict):
        return {k: strip_none(v) for k, v in value.items() if v is not None}
    if isinstance(value, list):
        return [strip_none(v) for v in value if v is not None]
    return value


def put_batch(table, items: list[dict[str, Any]]) -> None:
    with table.batch_writer() as batch:
        for item in items:
            batch.put_item(Item=strip_none(item))


def load_demo_seed_items() -> list[dict[str, Any]]:
    path = resolve_demo_seed_path()
    if not path.is_file():
        raise FileNotFoundError(f"demo seed not found: {path}")
    with path.open(encoding="utf-8") as f:
        items = json.load(f)
    if not isinstance(items, list) or not items:
        raise ValueError(f"demo seed empty or invalid: {path}")
    return items


def seed(table) -> None:
    """デモシード（.local 優先、なければ公開用サンプル）を投入する。"""
    path = resolve_demo_seed_path()
    items = load_demo_seed_items()
    members = [i for i in items if i.get("entityType") == "Member"]
    interviews_with_votes = [
        i for i in items if i.get("entityType") == "Interview" and (i.get("votes") or {})
    ]
    availability_marked = [
        i
        for i in items
        if i.get("entityType") == "Availability"
        and (i.get("dayMarks") or i.get("hourMarks"))
    ]
    print(f"[seed] writing {len(items)} items from {path.name}…")
    put_batch(table, items)
    print(
        f"[ok] seed complete "
        f"(members={len(members)}, availabilityMarked={len(availability_marked)}, "
        f"interviewVotes={len(interviews_with_votes)})"
    )


def smoke_check(table) -> None:
    meta = table.get_item(Key={"PK": "CAMPAIGN#current", "SK": "META"}).get("Item")
    if not meta:
        raise RuntimeError("META item missing")
    member1 = table.get_item(Key={"PK": "MEMBER#1", "SK": "PROFILE"}).get("Item")
    member33 = table.get_item(Key={"PK": "MEMBER#33", "SK": "PROFILE"}).get("Item")
    members = table.scan(
        FilterExpression="entityType = :et",
        ExpressionAttributeValues={":et": "Member"},
    )
    count = members.get("Count") or 0
    while members.get("LastEvaluatedKey"):
        members = table.scan(
            FilterExpression="entityType = :et",
            ExpressionAttributeValues={":et": "Member"},
            ExclusiveStartKey=members["LastEvaluatedKey"],
        )
        count += members.get("Count") or 0

    print("[check] META.quarterLabel =", meta.get("quarterLabel"))
    print("[check] MEMBER count =", count)
    print(
        "[check] MEMBER#1 =",
        {
            "surname": (member1 or {}).get("surname"),
            "role": (member1 or {}).get("role"),
            "isInterviewer": (member1 or {}).get("isInterviewer"),
        },
    )
    print(
        "[check] MEMBER#33 =",
        {
            "surname": (member33 or {}).get("surname"),
            "role": (member33 or {}).get("role"),
            "isInterviewer": (member33 or {}).get("isInterviewer"),
        },
    )
    if count != 33:
        raise RuntimeError(f"expected 33 members, got {count}")
    # 構造チェックのみ（氏名はシードにより実名/.local または架空サンプル）
    if not member1 or member1.get("role") != "other" or member1.get("isInterviewer") is not False:
        raise RuntimeError("MEMBER#1 seed mismatch (expected role=other, isInterviewer=false)")
    if not member33 or member33.get("role") != "hongo":
        raise RuntimeError("MEMBER#33 seed mismatch (expected role=hongo)")
    print("[ok] smoke check passed")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Init DynamoDB Local for wizway-scheduler")
    parser.add_argument("--reset", action="store_true", help="Delete and recreate the table")
    parser.add_argument("--seed", action="store_true", help="Load demo seed data")
    parser.add_argument("--check", action="store_true", help="Run smoke queries after init")
    args = parser.parse_args(argv)

    ddb = client()
    wait_ready(ddb)

    if args.reset:
        delete_table(ddb)

    create_table(ddb)
    table = resource().Table(TABLE_NAME)

    if args.seed:
        seed(table)

    if args.check:
        if not args.seed and not args.reset:
            # allow check-only against existing data
            pass
        smoke_check(table)

    print(f"[done] endpoint={ENDPOINT_URL} table={TABLE_NAME}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except ClientError as exc:
        print(f"[error] AWS ClientError: {exc}", file=sys.stderr)
        raise SystemExit(1)
