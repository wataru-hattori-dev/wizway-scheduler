from __future__ import annotations

from fastapi import APIRouter, Query
from pydantic import BaseModel

from app.services import interviews as interviews_svc
from app.services import members as members_svc
from app.services import sales_assignees as sales_svc
from app.domain.slots import sales_can_take_slot

router = APIRouter(tags=["members"])


class MemberCreate(BaseModel):
    surname: str
    sectionId: str | None = "unset"
    role: str | None = "engineer"
    isInterviewer: bool | None = True


class MemberPatch(BaseModel):
    surname: str | None = None
    sectionId: str | None = None
    role: str | None = None
    isInterviewer: bool | None = None


@router.get("/members")
def list_members(
    includeDeleted: bool = Query(False),
    sectionId: str | None = Query(None),
):
    return {
        "members": members_svc.list_members(
            include_deleted=includeDeleted, section_id=sectionId
        )
    }


@router.post("/members", status_code=201)
def create_member(body: MemberCreate):
    return members_svc.create_member(
        body.surname,
        body.sectionId,
        role=body.role,
        is_interviewer=body.isInterviewer,
    )


@router.get("/members/{member_id}")
def get_member(member_id: int):
    return members_svc.get_member(member_id)


@router.patch("/members/{member_id}")
def patch_member(member_id: int, body: MemberPatch):
    return members_svc.patch_member(member_id, body.model_dump(exclude_unset=True))


@router.delete("/members/{member_id}")
def delete_member(member_id: int):
    return members_svc.delete_member(member_id)


@router.get("/members/{member_id}/slots")
def list_member_slots(member_id: int):
    member = members_svc.get_member(member_id)
    slots = interviews_svc.section_slots(member["sectionId"])
    _, _, day_marks, hour_marks = interviews_svc._load_slot_context()
    assignees = sales_svc.get_sales_assignees()
    sales_id = assignees.get(str(member_id))
    if not sales_id:
        return {"slots": []}
    filtered = [
        s for s in slots if sales_can_take_slot(day_marks, hour_marks, sales_id, s)
    ]
    return {"slots": filtered}
