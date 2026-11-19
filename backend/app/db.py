from __future__ import annotations

from decimal import Decimal
from functools import lru_cache
from typing import Any

import boto3
from boto3.dynamodb.conditions import Attr, Key
from botocore.exceptions import ClientError

from app.config import get_settings


def _to_dynamo(value: Any) -> Any:
    if isinstance(value, float):
        return Decimal(str(value))
    if isinstance(value, dict):
        return {k: _to_dynamo(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_to_dynamo(v) for v in value]
    return value


def from_dynamo(value: Any) -> Any:
    if isinstance(value, Decimal):
        if value % 1 == 0:
            return int(value)
        return float(value)
    if isinstance(value, dict):
        return {k: from_dynamo(v) for k, v in value.items()}
    if isinstance(value, list):
        return [from_dynamo(v) for v in value]
    return value


def strip_none(value: Any) -> Any:
    if isinstance(value, dict):
        return {k: strip_none(v) for k, v in value.items() if v is not None}
    if isinstance(value, list):
        return [strip_none(v) for v in value if v is not None]
    return value


@lru_cache
def get_table():
    settings = get_settings()
    kwargs: dict[str, Any] = {"region_name": settings["aws_region"]}
    if settings["dynamodb_endpoint_url"]:
        kwargs["endpoint_url"] = settings["dynamodb_endpoint_url"]
        kwargs["aws_access_key_id"] = settings["aws_access_key_id"]
        kwargs["aws_secret_access_key"] = settings["aws_secret_access_key"]
    resource = boto3.resource("dynamodb", **kwargs)
    return resource.Table(settings["table_name"])


@lru_cache
def get_dynamodb_resource():
    settings = get_settings()
    kwargs: dict[str, Any] = {"region_name": settings["aws_region"]}
    if settings["dynamodb_endpoint_url"]:
        kwargs["endpoint_url"] = settings["dynamodb_endpoint_url"]
        kwargs["aws_access_key_id"] = settings["aws_access_key_id"]
        kwargs["aws_secret_access_key"] = settings["aws_secret_access_key"]
    return boto3.resource("dynamodb", **kwargs)


class TableRepo:
    def __init__(self, table=None):
        self.table = table or get_table()

    def get(self, pk: str, sk: str) -> dict | None:
        item = self.table.get_item(Key={"PK": pk, "SK": sk}).get("Item")
        return from_dynamo(item) if item else None

    def put(self, item: dict) -> dict:
        cleaned = strip_none(_to_dynamo(item))
        self.table.put_item(Item=cleaned)
        return from_dynamo(cleaned)

    def delete(self, pk: str, sk: str) -> None:
        self.table.delete_item(Key={"PK": pk, "SK": sk})

    def update(self, pk: str, sk: str, updates: dict) -> dict:
        names: dict[str, str] = {}
        values: dict[str, Any] = {}
        parts: list[str] = []
        for i, (key, value) in enumerate(updates.items()):
            nk = f"#k{i}"
            vk = f":v{i}"
            names[nk] = key
            values[vk] = _to_dynamo(value)
            parts.append(f"{nk} = {vk}")
        result = self.table.update_item(
            Key={"PK": pk, "SK": sk},
            UpdateExpression="SET " + ", ".join(parts),
            ExpressionAttributeNames=names,
            ExpressionAttributeValues=values,
            ReturnValues="ALL_NEW",
        )
        return from_dynamo(result["Attributes"])

    def query_pk(self, pk: str, sk_prefix: str | None = None) -> list[dict]:
        kwargs: dict[str, Any] = {
            "KeyConditionExpression": Key("PK").eq(pk)
            if not sk_prefix
            else Key("PK").eq(pk) & Key("SK").begins_with(sk_prefix)
        }
        items: list[dict] = []
        while True:
            resp = self.table.query(**kwargs)
            items.extend(from_dynamo(resp.get("Items", [])))
            lek = resp.get("LastEvaluatedKey")
            if not lek:
                break
            kwargs["ExclusiveStartKey"] = lek
        return items

    def query_gsi1(self, gsi1pk: str, sk_prefix: str | None = None) -> list[dict]:
        cond = Key("GSI1PK").eq(gsi1pk)
        if sk_prefix:
            cond = cond & Key("GSI1SK").begins_with(sk_prefix)
        kwargs: dict[str, Any] = {
            "IndexName": "GSI1",
            "KeyConditionExpression": cond,
        }
        items: list[dict] = []
        while True:
            resp = self.table.query(**kwargs)
            items.extend(from_dynamo(resp.get("Items", [])))
            lek = resp.get("LastEvaluatedKey")
            if not lek:
                break
            kwargs["ExclusiveStartKey"] = lek
        return items

    def query_gsi2(self, gsi2pk: str) -> list[dict]:
        kwargs: dict[str, Any] = {
            "IndexName": "GSI2",
            "KeyConditionExpression": Key("GSI2PK").eq(gsi2pk),
        }
        items: list[dict] = []
        while True:
            resp = self.table.query(**kwargs)
            items.extend(from_dynamo(resp.get("Items", [])))
            lek = resp.get("LastEvaluatedKey")
            if not lek:
                break
            kwargs["ExclusiveStartKey"] = lek
        return items

    def scan_entity(self, entity_type: str) -> list[dict]:
        kwargs: dict[str, Any] = {
            "FilterExpression": Attr("entityType").eq(entity_type),
        }
        items: list[dict] = []
        while True:
            resp = self.table.scan(**kwargs)
            items.extend(from_dynamo(resp.get("Items", [])))
            lek = resp.get("LastEvaluatedKey")
            if not lek:
                break
            kwargs["ExclusiveStartKey"] = lek
        return items

    def transact_write(self, items: list[dict]) -> None:
        client = self.table.meta.client
        try:
            client.transact_write_items(TransactItems=_to_dynamo(items))
        except ClientError as exc:
            raise RuntimeError(str(exc)) from exc


def repo() -> TableRepo:
    return TableRepo()
