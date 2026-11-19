from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel

from app.services import interviews as interviews_svc
from app.services import sections as sections_svc

router = APIRouter(tags=["sections"])


class DeadlineBody(BaseModel):
    deadline: str


@router.get("/sections")
def list_sections():
    return {"sections": sections_svc.list_sections()}


@router.get("/sections/{section_id}/deadline")
def get_deadline(section_id: str):
    return sections_svc.get_section_deadline(section_id)


@router.put("/sections/{section_id}/deadline")
def put_deadline(section_id: str, body: DeadlineBody):
    return sections_svc.put_section_deadline(section_id, body.deadline)


@router.get("/sections/{section_id}/slots")
def list_slots(section_id: str):
    sections_svc.get_section_item(section_id)
    return {"slots": interviews_svc.section_slots(section_id)}


@router.post("/sections/{section_id}/requests")
def send_requests(section_id: str):
    return interviews_svc.send_section_requests(section_id)
