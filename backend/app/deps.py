"""FastAPI 依存関係（認証ガードなど）。"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from fastapi import Cookie, Header

from app.errors import raise_forbidden, raise_unauthorized
from app.services import auth as auth_service


@dataclass(frozen=True)
class AuthSessionContext:
    """検証済みセッション。ロール別 API 認可の将来拡張用にペイロードを保持する。"""

    payload: dict[str, Any]
    token: str


def get_current_session(
    authorization: str | None = Header(default=None),
    wizway_session: str | None = Cookie(
        default=None, alias=auth_service.SESSION_COOKIE
    ),
) -> AuthSessionContext:
    """Bearer または Cookie のセッション JWT を検証する。

    未認証・不正・期限切れは 401。accessRole が denied の場合は 403。
    """
    token = auth_service.extract_bearer_token(authorization) or wizway_session
    payload = auth_service.decode_session_token(token)
    if not payload or not token:
        raise_unauthorized("認証が必要です", "UNAUTHORIZED")
    if str(payload.get("role") or "") == "denied":
        raise_forbidden("アクセス権限がありません", "ACCESS_DENIED")
    return AuthSessionContext(payload=payload, token=token)
