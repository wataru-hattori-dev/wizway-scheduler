# backend — wizway-scheduler API

FastAPI + Mangum 構成の Python API。ローカルでは `uvicorn`、AWS では Lambda + API Gateway で動作する。

契約は [`spec/openapi.yaml`](../spec/openapi.yaml)、永続化は [`spec/dynamodb-design.md`](../spec/dynamodb-design.md)。

## 前提

1. DynamoDB Local が起動済み（[`infra/local/README.md`](../infra/local/README.md)）
2. テーブル作成・シード済み（`python init_db.py --reset --seed --check`）
3. Python 3.11+

## ローカル起動

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env

# API: http://localhost:3001
# OpenAPI UI（ENABLE_API_DOCS=true のときのみ）: http://localhost:3001/docs
uvicorn app.main:app --reload --host 127.0.0.1 --port 3001
```

環境変数（`.env.example` 参照）:

| 変数 | ローカル既定 | コード／AWS 既定 |
|---|---|---|
| `ALLOW_DEV_AUTH` | `true`（`.env`） | **`false`**（未設定時・SAM） |
| `ALLOW_DEV_RESEED` | `true`（`.env`） | **`false`** |
| `ENABLE_API_DOCS` | `true`（`.env`） | **`false`**（`/docs` 非公開） |
| `CORS_ORIGINS` | `http://localhost:5173,...` | ワイルドカード `*` 不可。AWS はデプロイ時に CloudFront URL を渡す |
| `AUTH_SESSION_SECRET` | ローカル用の例 | AWS は必須・MinLength 32。**本番値を Git に書かない** |
| `DYNAMODB_ENDPOINT_URL` | `http://localhost:8000` | （ローカル専用） |
| `DYNAMODB_TABLE_NAME` | `wizway-scheduler` | |
| `AWS_REGION` | `ap-northeast-1` | |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | `local` | |
| `SLACK_WEBHOOK_URL` / `SLACK_BOT_TOKEN` | 未設定。どちらかを入れると通知ペイロードを扱う（Bot Token 優先で `chat.postMessage`、なければ Incoming Webhook） | |
| `SLACK_TEST_MODE` | `true`（既定）。全通知を `SLACK_TEST_CHANNEL_ID` へ集約し、本文先頭に本来の送信先ラベルを付与 | |
| `SLACK_TEST_CHANNEL_ID` | テスト集約先チャンネル ID（例: `C0123456789`） | |
| `SLACK_DRY_RUN` | `true`（既定）で外部 HTTP 抑止（ログのみ）。`false` で実送信 | |
| `SLACK_CHANNEL_MEGURO` / `YAMAMOTO` / `ISHIBASHI` / `TANAKA` / `HAMADA` / `SLACK_CHANNEL_SALES` | ルート別の本番向けチャンネル ID（開発中はテストチャンネルで可） | |
| `SLACK_DESTINATION_LABELS` | `true`（既定）で本文先頭に宛先ラベルを付与。本番切替後は `false` で外す | |

## ベースパス

- アプリ: `/api/v1/...`（OpenSpec `servers.url` に準拠）
- ヘルスチェック: `GET /health`

## 開発用 reseed

```http
POST /api/v1/dev/reseed
```

`DYNAMODB_ENDPOINT_URL` が設定されているローカル環境でのみ有効。
テーブルをクリアし、`infra/local/demo_seed.json`（メンバー・セクション・営業割り当て・空き日程・エンジニア投票を含むデモ状態）を再投入する。

管理画面の「デモデータを元に戻す」も同じ API を呼ぶ。

## AWS デプロイ（SAM）

`template.yaml` の `ApiFunction` が Mangum ハンドラ `app.main.handler` を公開する。

デプロイ既定は `AllowDevAuth=false` / `AllowDevReseed=false` / `EnableApiDocs=false`。  
**`AuthSessionSecret` と `CorsOrigins` は必須パラメータ**で、実値は `samconfig.toml` に書かずデプロイ時に渡す（GitHub 公開を見据えた運用）。

```powershell
cd backend
sam build

# 1) 強いセッション署名鍵を生成（表示された値をそのまま使う。リポジトリにコミットしない）
$AuthSessionSecret = python -c "import secrets; print(secrets.token_urlsafe(48))"
# または: openssl rand -base64 48

# 2) フロントの CloudFront URL（末尾スラッシュなし）
$CorsOrigins = "https://dXXXXXXXX.cloudfront.net"

# 3) デプロイ（samconfig の安全側フラグ + 秘密・CORS を上書き）
sam deploy --parameter-overrides `
  "DynamoDBTableName=wizway-scheduler" `
  "AllowDevReseed=false" `
  "AllowDevAuth=false" `
  "EnableApiDocs=false" `
  "CorsOrigins=$CorsOrigins" `
  "AuthSessionSecret=$AuthSessionSecret" `
  "SlackTestMode=true" `
  "SlackDryRun=false"
  # 必要に応じて SlackClientId / SlackClientSecret / SlackRedirectUri / SlackBotToken も追加
```

秘密鍵をシェル履歴に残したくない場合は、Git 管理外のローカルファイルから読む例:

```powershell
# backend/.deploy-secrets.ps1 は .gitignore 推奨（コミット禁止）
#   $env:AUTH_SESSION_SECRET = "...."
#   $env:CORS_ORIGINS = "https://dXXXX.cloudfront.net"
. .\.deploy-secrets.ps1
sam deploy --parameter-overrides `
  "AllowDevAuth=false AllowDevReseed=false EnableApiDocs=false CorsOrigins=$env:CORS_ORIGINS AuthSessionSecret=$env:AUTH_SESSION_SECRET"
```

デプロイ後の確認例:

- `POST /api/v1/auth/dev/login` → `403`（`DEV_AUTH_DISABLED`）
- `GET /docs` / `/redoc` / `/openapi.json` → `404`
- ブラウザから CloudFront オリジンのみ API 呼び出し可
