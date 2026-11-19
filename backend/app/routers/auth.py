from __future__ import annotations

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, Field

from app.config import get_settings
from app.deps import AuthSessionContext, get_current_session
from app.services import auth as auth_service

router = APIRouter(tags=["auth"])


class SlackCallbackBody(BaseModel):
    code: str
    redirectUri: str | None = None
    state: str | None = None


class DevLoginBody(BaseModel):
    role: str = Field(..., description="admin | mgr | engineer")


def _session_cookie_secure() -> bool:
    """本番相当（ALLOW_DEV_AUTH=false）は Secure。ローカル開発は http 向けに false。"""
    return not get_settings()["allow_dev_auth"]


def _attach_session_cookie(response: Response, token: str | None) -> None:
    if not token:
        return
    response.set_cookie(
        key=auth_service.SESSION_COOKIE,
        value=token,
        httponly=True,
        samesite="lax",
        secure=_session_cookie_secure(),
        max_age=60 * 60 * 24 * 7,
        path="/",
    )


def _clear_session_cookie(response: Response) -> None:
    response.delete_cookie(
        key=auth_service.SESSION_COOKIE,
        path="/",
        secure=_session_cookie_secure(),
        samesite="lax",
    )


@router.get("/auth/slack/authorize-url")
def get_slack_authorize_url(redirectUri: str | None = None):
    return auth_service.build_slack_authorize_url(redirectUri)


@router.post("/auth/slack/callback")
def slack_oauth_callback(body: SlackCallbackBody, response: Response):
    session = auth_service.exchange_slack_code(body.code, body.redirectUri)
    _attach_session_cookie(response, session.get("token"))
    return session


@router.get("/auth/me")
def get_auth_me(session: AuthSessionContext = Depends(get_current_session)):
    return auth_service.session_from_payload(session.payload, token=session.token)


@router.post("/auth/logout")
def logout(response: Response):
    _clear_session_cookie(response)
    return {"ok": True}


@router.post("/auth/dev/login")
def dev_login(body: DevLoginBody, response: Response):
    session = auth_service.issue_dev_login(body.role)
    _attach_session_cookie(response, session.get("token"))
    return session
