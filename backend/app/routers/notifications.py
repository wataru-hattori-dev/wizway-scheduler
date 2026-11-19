from __future__ import annotations

from fastapi import APIRouter

from app.services import notifications as notif_svc

router = APIRouter(tags=["notifications"])


@router.get("/notifications")
def list_notifications():
    return {"notifications": notif_svc.list_notifications()}
