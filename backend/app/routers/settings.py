from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.services import meta as meta_svc

router = APIRouter(tags=["settings"])


class SettingsPatch(BaseModel):
    quarterLabel: str | None = None
    hongoJoins: bool | None = None
    provider: str | None = None


class InterviewPeriodBody(BaseModel):
    startDate: str
    endDate: str


class ResponseDeadlinesBody(BaseModel):
    mgrSalesDeadline: str
    engineerDeadline: str


@router.get("/settings")
def get_settings():
    return meta_svc.get_settings()


@router.patch("/settings")
def patch_settings(body: SettingsPatch):
    return meta_svc.patch_settings(body.model_dump(exclude_unset=True))


@router.get("/interview-period")
def get_interview_period():
    return meta_svc.get_interview_period()


@router.put("/interview-period")
def put_interview_period(body: InterviewPeriodBody):
    return meta_svc.put_interview_period(body.model_dump())


@router.get("/response-deadlines")
def get_response_deadlines():
    return meta_svc.get_response_deadlines()


@router.put("/response-deadlines")
def put_response_deadlines(body: ResponseDeadlinesBody):
    return meta_svc.put_response_deadlines(body.model_dump())
