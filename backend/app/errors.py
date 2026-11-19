from __future__ import annotations

from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse


class AppError(Exception):
    def __init__(self, status_code: int, message: str, code: str | None = None):
        self.status_code = status_code
        self.message = message
        self.code = code
        super().__init__(message)


def raise_bad_request(message: str, code: str | None = None) -> None:
    raise AppError(400, message, code)


def raise_unauthorized(message: str, code: str | None = None) -> None:
    raise AppError(401, message, code)


def raise_forbidden(message: str, code: str | None = None) -> None:
    raise AppError(403, message, code)


def raise_not_found(message: str, code: str | None = None) -> None:
    raise AppError(404, message, code)


def raise_conflict(message: str, code: str | None = None) -> None:
    raise AppError(409, message, code)


async def app_error_handler(_request: Request, exc: AppError) -> JSONResponse:
    body: dict = {"message": exc.message}
    if exc.code:
        body["code"] = exc.code
    return JSONResponse(status_code=exc.status_code, content=body)


async def http_error_handler(_request: Request, exc: HTTPException) -> JSONResponse:
    detail = exc.detail
    if isinstance(detail, dict) and "message" in detail:
        return JSONResponse(status_code=exc.status_code, content=detail)
    return JSONResponse(status_code=exc.status_code, content={"message": str(detail)})
