"""認証ガードのスモークテスト（DynamoDB 不要な経路を中心に検証）。"""

from __future__ import annotations

import os
import sys
from pathlib import Path

# backend/ を import パスに追加
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

os.environ.setdefault("ALLOW_DEV_AUTH", "true")
os.environ.setdefault("AUTH_SESSION_SECRET", "test-auth-session-secret")

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402
from app.services import auth as auth_service  # noqa: E402

client = TestClient(app)


def test_health_is_public():
    res = client.get("/health")
    assert res.status_code == 200
    assert res.json().get("ok") is True


def test_auth_me_without_token_returns_401():
    res = client.get("/api/v1/auth/me")
    assert res.status_code == 401
    body = res.json()
    assert body.get("code") == "UNAUTHORIZED"
    assert "message" in body


def test_business_api_without_token_returns_401():
    for path in (
        "/api/v1/availability/meguro",
        "/api/v1/settings",
        "/api/v1/members",
        "/api/v1/sections",
        "/api/v1/notifications",
    ):
        res = client.get(path)
        assert res.status_code == 401, path
        assert res.json().get("code") == "UNAUTHORIZED"


def test_invalid_token_returns_401():
    res = client.get(
        "/api/v1/availability/meguro",
        headers={"Authorization": "Bearer not-a-valid-token"},
    )
    assert res.status_code == 401


def test_dev_login_and_auth_me_ok():
    login = client.post("/api/v1/auth/dev/login", json={"role": "admin"})
    assert login.status_code == 200
    session = login.json()
    assert session.get("authenticated") is True
    token = session["token"]
    assert session["user"]["accessRole"] == "admin"

    me = client.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert me.status_code == 200
    body = me.json()
    assert body["authenticated"] is True
    assert body["user"]["accessRole"] == "admin"


def test_denied_role_returns_403_on_business_api():
    token = auth_service.issue_session_token(
        slack_user_id="EXT_USER",
        slack_team_id="T_EXTERNAL",
        access_role="denied",
        display_name="外部",
    )
    res = client.get(
        "/api/v1/availability/meguro",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 403
    assert res.json().get("code") == "ACCESS_DENIED"


def test_auth_logout_and_dev_login_remain_public():
    assert client.post("/api/v1/auth/logout").status_code == 200
    # ALLOW_DEV_AUTH=true 前提
    res = client.post("/api/v1/auth/dev/login", json={"role": "mgr"})
    assert res.status_code == 200
    assert res.json()["user"]["accessRole"] == "mgr"


def test_authenticated_business_api_returns_200():
    """認証付きではガード通過後に業務ハンドラが 200 を返す。"""
    from unittest.mock import MagicMock, patch

    login = client.post("/api/v1/auth/dev/login", json={"role": "admin"})
    token = login.json()["token"]

    mock_repo = MagicMock()
    mock_repo.get.return_value = {
        "voterId": "meguro",
        "dayMarks": {"2026-12-01": "ok"},
        "hourMarks": {},
    }
    with patch("app.services.availability.repo", return_value=mock_repo):
        res = client.get(
            "/api/v1/availability/meguro",
            headers={"Authorization": f"Bearer {token}"},
        )
    assert res.status_code == 200
    body = res.json()
    assert body["voterId"] == "meguro"
    assert body["dayMarks"] == {"2026-12-01": "ok"}
