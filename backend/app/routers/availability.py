from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel

from app.services import availability as availability_svc

router = APIRouter(tags=["availability"])


class AvailabilityUpdate(BaseModel):
    dayMarks: dict
    hourMarks: dict


@router.get("/availability/{voter_id}")
def get_availability(voter_id: str):
    return availability_svc.get_availability(voter_id)


@router.put("/availability/{voter_id}")
def put_availability(voter_id: str, body: AvailabilityUpdate):
    return availability_svc.put_availability(voter_id, body.dayMarks, body.hourMarks)
