from __future__ import annotations

from fastapi import APIRouter

from app.config import get_settings
from app.errors import raise_bad_request
from app.services.dev_reseed import reseed_from_demo

router = APIRouter(tags=["dev"])


@router.post("/dev/reseed")
def reseed():
    """デモシード（infra/local/demo_seed.json）をローカル DynamoDB へ復元する。"""
    settings = get_settings()
    if not settings["allow_dev_reseed"]:
        raise_bad_request("開発用 reseed は無効です", "DEV_RESEED_DISABLED")
    if not settings["dynamodb_endpoint_url"]:
        raise_bad_request("本番 DynamoDB への reseed は拒否されました", "RESEED_BLOCKED")
    try:
        restored = reseed_from_demo()
    except FileNotFoundError as exc:
        raise_bad_request(str(exc), "DEMO_SEED_MISSING")
    except ValueError as exc:
        raise_bad_request(str(exc), "DEMO_SEED_INVALID")
    return {
        "success": True,
        "message": (
            f"デモデータを復元しました"
            f"（メンバー {restored.get('memberCount', 0)} 名 / "
            f"空き回答 {restored.get('availabilityWithMarks', 0)} / "
            f"エンジニア投票 {restored.get('interviewVoteCount', 0)}）"
        ),
        "restored": restored,
    }
