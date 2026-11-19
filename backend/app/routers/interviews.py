from __future__ import annotations

from fastapi import APIRouter, Query
from pydantic import BaseModel

from app.services import interviews as interviews_svc

router = APIRouter(tags=["interviews"])


class ConfirmedTimeUpdate(BaseModel):
    slotId: str | None = None
    start: str | None = None
    end: str | None = None
    salesId: str | None = None
    source: str | None = "admin"


class VotesUpdate(BaseModel):
    votes: dict[str, str | None] = {}


class PreferencesUpdate(BaseModel):
    difficultDates: list[str] | None = None
    preferredTimeNote: str | None = None
    note: str | None = None


class ChangeRequestCreate(BaseModel):
    reason: str
    preferredDates: str


@router.get("/interviews")
def list_interviews(
    sectionId: str | None = Query(None),
    status: str | None = Query(None),
):
    return {
        "interviews": interviews_svc.list_interviews(
            section_id=sectionId, status=status
        )
    }


@router.get("/interviews/{member_id}")
def get_interview(member_id: int):
    return interviews_svc.get_interview(member_id)


@router.put("/interviews/{member_id}/votes")
def put_votes(member_id: int, body: VotesUpdate):
    return interviews_svc.put_interview_votes(member_id, body.votes)


@router.put("/interviews/{member_id}/preferences")
def put_preferences(member_id: int, body: PreferencesUpdate):
    return interviews_svc.put_interview_preferences(
        member_id, body.model_dump(exclude_unset=True)
    )


@router.post("/interviews/{member_id}/change-requests", status_code=201)
def create_change_request(member_id: int, body: ChangeRequestCreate):
    return interviews_svc.create_change_request(
        member_id, body.model_dump()
    )


@router.put("/interviews/{member_id}/confirmed-time")
def put_confirmed_time(member_id: int, body: ConfirmedTimeUpdate):
    return interviews_svc.put_confirmed_time(member_id, body.model_dump(exclude_unset=True))


@router.post("/interviews/{member_id}/reminders")
def send_reminder(member_id: int):
    return interviews_svc.send_reminder(member_id)


@router.post("/interviews/{member_id}/reopen")
def reopen(member_id: int):
    return interviews_svc.reopen_interview(member_id)
