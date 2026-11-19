from __future__ import annotations

from fastapi import APIRouter, Response
from pydantic import BaseModel, Field

from app.services import assignments as assignments_svc

router = APIRouter(tags=["assignments"])


class JudgeRequest(BaseModel):
    sectionIds: list[str]
    assignUnanswered: bool = False


class ManualAssignRequest(BaseModel):
    memberId: int
    slotId: str


class OverrideBody(BaseModel):
    slotId: str


class ConfirmItem(BaseModel):
    memberId: int
    slotId: str


class ConfirmRequest(BaseModel):
    items: list[ConfirmItem] = Field(min_length=1)


@router.post("/assignments/judge")
def apply_judge(body: JudgeRequest):
    return assignments_svc.apply_judge(body.sectionIds, body.assignUnanswered)


@router.post("/assignments/manual")
def manual_assign(body: ManualAssignRequest):
    return assignments_svc.manual_assign(body.memberId, body.slotId)


@router.put("/assignments/overrides/{member_id}")
def put_override(member_id: int, body: OverrideBody):
    return assignments_svc.put_override(member_id, body.slotId)


@router.delete("/assignments/overrides/{member_id}", status_code=204)
def delete_override(member_id: int):
    assignments_svc.delete_override(member_id)
    return Response(status_code=204)


@router.post("/assignments/confirm")
def confirm_assignments(body: ConfirmRequest):
    return assignments_svc.confirm_assignments([i.model_dump() for i in body.items])
