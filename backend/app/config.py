from __future__ import annotations

import os
from functools import lru_cache

from dotenv import load_dotenv

load_dotenv()

# 本番で絶対に使ってはいけない既知の弱い署名鍵（未設定時のローカル用フォールバック含む）
_INSECURE_AUTH_SESSION_SECRETS = frozenset(
    {
        "",
        "change-me-feedback-secret",
        "dev-auth-session-secret-change-me",
    }
)


def _csv_ids(value: str | None) -> list[str]:
    if not value:
        return []
    return [part.strip() for part in value.split(",") if part.strip()]


def _env_bool(name: str, default: str = "false") -> bool:
    return os.environ.get(name, default).lower() in ("1", "true", "yes")


@lru_cache
def get_settings() -> dict:
    allow_dev_auth = _env_bool("ALLOW_DEV_AUTH", "false")
    allow_dev_reseed = _env_bool("ALLOW_DEV_RESEED", "false")
    # ローカル開発のみ明示 true。未設定・本番は docs 非公開
    enable_api_docs = _env_bool("ENABLE_API_DOCS", "false")
    # ローカル未設定時のみ弱いフォールバック。本番（dev auth 無効）では拒否する
    auth_session_secret = os.environ.get(
        "AUTH_SESSION_SECRET", "dev-auth-session-secret-change-me"
    )
    if not allow_dev_auth and auth_session_secret in _INSECURE_AUTH_SESSION_SECRETS:
        raise RuntimeError(
            "AUTH_SESSION_SECRET が未設定または既知の弱い値です。"
            "本番相当環境では十分長いランダム文字列を環境変数で渡してください。"
        )

    return {
        "aws_region": os.environ.get("AWS_REGION", "ap-northeast-1"),
        "dynamodb_endpoint_url": os.environ.get("DYNAMODB_ENDPOINT_URL") or None,
        "table_name": os.environ.get("DYNAMODB_TABLE_NAME", "wizway-scheduler"),
        "aws_access_key_id": os.environ.get("AWS_ACCESS_KEY_ID", "local"),
        "aws_secret_access_key": os.environ.get("AWS_SECRET_ACCESS_KEY", "local"),
        "campaign_id": os.environ.get("CAMPAIGN_ID", "current"),
        "allow_dev_reseed": allow_dev_reseed,
        "cors_origins": [
            o.strip()
            for o in os.environ.get(
                "CORS_ORIGINS",
                "http://localhost:5173,http://127.0.0.1:5173",
            ).split(",")
            if o.strip() and o.strip() != "*"
        ],
        # Slack 通知
        "slack_webhook_url": os.environ.get("SLACK_WEBHOOK_URL", ""),
        "slack_bot_token": os.environ.get("SLACK_BOT_TOKEN", ""),
        # true のとき全通知をテスト用チャンネルへ集約
        "slack_test_mode": os.environ.get("SLACK_TEST_MODE", "true").lower()
        in ("1", "true", "yes"),
        "slack_test_channel_id": os.environ.get("SLACK_TEST_CHANNEL_ID", ""),
        # true（既定）: 外部 HTTP 抑止（ログのみ）。false: Webhook / Bot Token で実送信
        "slack_dry_run": os.environ.get("SLACK_DRY_RUN", "true").lower()
        in ("1", "true", "yes"),
        # ルート別送信先（各セクション / 営業）
        "slack_channel_routes": {
            "meguro": os.environ.get("SLACK_CHANNEL_MEGURO", ""),
            "yamamoto": os.environ.get("SLACK_CHANNEL_YAMAMOTO", ""),
            "ishibashi": os.environ.get("SLACK_CHANNEL_ISHIBASHI", ""),
            "tanaka": os.environ.get("SLACK_CHANNEL_TANAKA", ""),
            "hamada": os.environ.get("SLACK_CHANNEL_HAMADA", ""),
            "sales": os.environ.get("SLACK_CHANNEL_SALES", ""),
        },
        # true のとき本文先頭に宛先ラベルを付与（本番切替後は false で外す）
        "slack_destination_labels": os.environ.get(
            "SLACK_DESTINATION_LABELS", "true"
        ).lower()
        in ("1", "true", "yes"),
        # Slack OAuth（Sign in with Slack）
        "slack_client_id": os.environ.get("SLACK_CLIENT_ID", ""),
        "slack_client_secret": os.environ.get("SLACK_CLIENT_SECRET", ""),
        "slack_redirect_uri": os.environ.get(
            "SLACK_REDIRECT_URI", "http://localhost:5173/auth/slack/callback"
        ),
        # 追加許可（カンマ区切り）。未設定時は SLACK_REDIRECT_URI + CORS_ORIGINS 由来のみ
        "slack_redirect_uri_allowlist": _csv_ids(
            os.environ.get("SLACK_REDIRECT_URI_ALLOWLIST")
        ),
        # 実ワークスペース ID は環境変数で渡す（コードに実 ID を書かない）
        "slack_team_id": os.environ.get("SLACK_TEAM_ID", ""),
        # 社内テスト公開中は team_id 一致で全員 admin のため未使用（将来の絞り込み用に残置）
        "slack_admin_user_ids": _csv_ids(os.environ.get("SLACK_ADMIN_USER_IDS")),
        "slack_mgr_user_ids": _csv_ids(os.environ.get("SLACK_MGR_USER_IDS")),
        "auth_session_secret": auth_session_secret,
        "auth_session_ttl_seconds": int(
            os.environ.get("AUTH_SESSION_TTL_SECONDS", str(60 * 60 * 24 * 7))
        ),
        "allow_dev_auth": allow_dev_auth,
        "enable_api_docs": enable_api_docs,
    }


def campaign_pk(campaign_id: str | None = None) -> str:
    cid = campaign_id or get_settings()["campaign_id"]
    return f"CAMPAIGN#{cid}"
