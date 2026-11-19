from __future__ import annotations

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from mangum import Mangum

from app.config import get_settings
from app.deps import get_current_session
from app.errors import AppError, app_error_handler, http_error_handler
from app.routers import (
    assignments,
    auth,
    availability,
    dev,
    interviews,
    members,
    notifications,
    sales_assignees,
    sections,
    settings,
)

settings_cfg = get_settings()

# 本番相当は ENABLE_API_DOCS=false（既定）で Swagger / ReDoc / openapi.json を非公開
_docs = "/docs" if settings_cfg["enable_api_docs"] else None
_redoc = "/redoc" if settings_cfg["enable_api_docs"] else None
_openapi = "/openapi.json" if settings_cfg["enable_api_docs"] else None

app = FastAPI(
    title="wizway-scheduler API",
    version="1.0.0",
    description="OpenAPI SSOT (`spec/openapi.yaml`) に準拠した Python Lambda / ローカル API",
    docs_url=_docs,
    redoc_url=_redoc,
    openapi_url=_openapi,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings_cfg["cors_origins"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.add_exception_handler(AppError, app_error_handler)
app.add_exception_handler(HTTPException, http_error_handler)

API_PREFIX = "/api/v1"

# 認証不要（ルーター全体）: Slack OAuth 開始・コールバック、logout、dev login。
# /auth/me のみエンドポイント内で get_current_session を必須化。
app.include_router(auth.router, prefix=API_PREFIX)

# 業務 API: ルーター単位でセッション JWT を必須化（ロール細分化は将来拡張）
_protected_dependencies = [Depends(get_current_session)]
for router in (
    settings.router,
    sections.router,
    members.router,
    availability.router,
    sales_assignees.router,
    interviews.router,
    assignments.router,
    notifications.router,
    dev.router,
):
    app.include_router(
        router, prefix=API_PREFIX, dependencies=_protected_dependencies
    )


@app.get("/health")
def health():
    return {"ok": True, "table": settings_cfg["table_name"]}


# AWS Lambda entrypoint (API Gateway HTTP API / REST proxy)
handler = Mangum(app, lifespan="off")
