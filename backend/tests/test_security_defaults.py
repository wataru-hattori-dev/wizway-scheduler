"""セキュリティ最低セット（既定値・dev auth 無効・CORS）の回帰テスト。"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def test_allow_dev_auth_defaults_to_false(monkeypatch):
    monkeypatch.delenv("ALLOW_DEV_AUTH", raising=False)
    monkeypatch.setenv("AUTH_SESSION_SECRET", "unit-test-secret-at-least-32-chars-long")
    from app.config import get_settings

    get_settings.cache_clear()
    assert get_settings()["allow_dev_auth"] is False
    get_settings.cache_clear()


def test_allow_dev_reseed_and_docs_default_false(monkeypatch):
    monkeypatch.delenv("ALLOW_DEV_RESEED", raising=False)
    monkeypatch.delenv("ENABLE_API_DOCS", raising=False)
    monkeypatch.setenv("ALLOW_DEV_AUTH", "true")  # 弱い secret フォールバック許可
    monkeypatch.delenv("AUTH_SESSION_SECRET", raising=False)
    from app.config import get_settings

    get_settings.cache_clear()
    settings = get_settings()
    assert settings["allow_dev_reseed"] is False
    assert settings["enable_api_docs"] is False
    get_settings.cache_clear()


def test_weak_auth_secret_rejected_when_dev_auth_disabled(monkeypatch):
    monkeypatch.setenv("ALLOW_DEV_AUTH", "false")
    monkeypatch.setenv("AUTH_SESSION_SECRET", "dev-auth-session-secret-change-me")
    from app.config import get_settings

    get_settings.cache_clear()
    with pytest.raises(RuntimeError, match="AUTH_SESSION_SECRET"):
        get_settings()
    get_settings.cache_clear()


def test_cors_origins_drop_wildcard(monkeypatch):
    monkeypatch.setenv("ALLOW_DEV_AUTH", "true")
    monkeypatch.setenv(
        "CORS_ORIGINS",
        "https://d123.cloudfront.net,*,http://localhost:5173",
    )
    from app.config import get_settings

    get_settings.cache_clear()
    origins = get_settings()["cors_origins"]
    assert "*" not in origins
    assert "https://d123.cloudfront.net" in origins
    assert "http://localhost:5173" in origins
    get_settings.cache_clear()


def test_dev_login_forbidden_when_allow_dev_auth_false(monkeypatch):
    """既存の auth ルーター枠組みは残し、フラグ false で 403 になることだけ検証。"""
    monkeypatch.setenv("ALLOW_DEV_AUTH", "false")
    monkeypatch.setenv("AUTH_SESSION_SECRET", "unit-test-secret-at-least-32-chars-long")
    from app.config import get_settings
    from app.errors import AppError
    from app.services import auth as auth_service

    get_settings.cache_clear()
    with pytest.raises(AppError) as exc:
        auth_service.issue_dev_login("admin")
    assert exc.value.status_code == 403
    assert exc.value.code == "DEV_AUTH_DISABLED"
    get_settings.cache_clear()


def test_redirect_uri_allowlist_accepts_cors_origin(monkeypatch):
    monkeypatch.setenv("ALLOW_DEV_AUTH", "true")
    monkeypatch.setenv(
        "CORS_ORIGINS",
        "https://d123.cloudfront.net,http://localhost:5173",
    )
    monkeypatch.setenv(
        "SLACK_REDIRECT_URI",
        "http://localhost:5173/auth/slack/callback",
    )
    from app.config import get_settings
    from app.services import auth as auth_service

    get_settings.cache_clear()
    assert (
        auth_service.assert_redirect_uri_allowed(
            "https://d123.cloudfront.net/auth/slack/callback"
        )
        == "https://d123.cloudfront.net/auth/slack/callback"
    )
    assert (
        auth_service.assert_redirect_uri_allowed(
            "http://localhost:5173/auth/slack/callback"
        )
        == "http://localhost:5173/auth/slack/callback"
    )
    get_settings.cache_clear()


def test_redirect_uri_allowlist_rejects_unknown(monkeypatch):
    monkeypatch.setenv("ALLOW_DEV_AUTH", "true")
    monkeypatch.setenv("CORS_ORIGINS", "http://localhost:5173")
    monkeypatch.setenv(
        "SLACK_REDIRECT_URI",
        "http://localhost:5173/auth/slack/callback",
    )
    from app.config import get_settings
    from app.errors import AppError
    from app.services import auth as auth_service

    get_settings.cache_clear()
    with pytest.raises(AppError) as exc:
        auth_service.assert_redirect_uri_allowed(
            "https://evil.example/auth/slack/callback"
        )
    assert exc.value.status_code == 400
    assert exc.value.code == "SLACK_REDIRECT_URI_NOT_ALLOWED"
    get_settings.cache_clear()


def test_session_cookie_secure_follows_allow_dev_auth(monkeypatch):
    monkeypatch.setenv("ALLOW_DEV_AUTH", "false")
    monkeypatch.setenv("AUTH_SESSION_SECRET", "unit-test-secret-at-least-32-chars-long")
    from app.config import get_settings
    from app.routers import auth as auth_router

    get_settings.cache_clear()
    assert auth_router._session_cookie_secure() is True

    monkeypatch.setenv("ALLOW_DEV_AUTH", "true")
    get_settings.cache_clear()
    assert auth_router._session_cookie_secure() is False
    get_settings.cache_clear()
