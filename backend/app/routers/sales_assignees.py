from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel, RootModel

from app.services import sales_assignees as sales_svc

router = APIRouter(tags=["sales-assignees"])


class SalesAssigneeMap(RootModel[dict[str, str | None]]):
    pass


class SalesAssigneeWrapper(BaseModel):
    assignees: dict[str, str | None]


@router.get("/sales-assignees")
def get_sales_assignees():
    return sales_svc.get_sales_assignees()


@router.put("/sales-assignees")
def put_sales_assignees(body: dict):
    return sales_svc.put_sales_assignees(body)
