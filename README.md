# wizway-scheduler

マネージャー・営業・エンジニアによる三者面談日程調整ツール。

## ドキュメント

| 文書 | 内容 |
|---|---|
| [`AGENTS.md`](./AGENTS.md) | 開発方針・SSOT・縦切りルール |
| [`spec/openapi.yaml`](./spec/openapi.yaml) | API 契約（SSOT） |
| [`spec/dynamodb-design.md`](./spec/dynamodb-design.md) | DynamoDB シングルテーブル設計 |
| [`infra/local/README.md`](./infra/local/README.md) | DynamoDB Local の起動手順 |

## ローカル起動（最短）

### 1. DynamoDB Local

初回のみ（テーブル作成 + デモシード）:

```powershell
cd infra/local
docker compose up -d
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python init_db.py --reset --seed --check
```

2回目以降（PC 再起動後など）は **データ保持のため** これだけで十分です:

```powershell
cd infra/local
docker compose up -d
```

`--reset --seed` を再実行すると Admin で設定したセクション所属なども初期化されます。

- DynamoDB: http://localhost:8000  
- Admin UI: http://localhost:8001  

詳細: [`infra/local/README.md`](./infra/local/README.md)

### 2. Backend API（FastAPI + Mangum）

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
uvicorn app.main:app --reload --host 127.0.0.1 --port 3001
```

- API: http://localhost:3001/api/v1  
- Docs: http://localhost:3001/docs  
- Health: http://localhost:3001/health  
- Slack 通知: `SLACK_BOT_TOKEN`（または Webhook）を設定。`SLACK_CHANNEL_MEGURO` 等 / `SLACK_CHANNEL_SALES` で振り分け。開発中は `SLACK_TEST_MODE=true` でテストチャンネルへ集約、`SLACK_DESTINATION_LABELS` で宛先ラベルのオン/オフ

詳細: [`backend/README.md`](./backend/README.md)

ローカル一連シナリオ（管理者設定 → 空き/投票 → 確定 → 変更希望）:

```powershell
cd backend
.\.venv\Scripts\python.exe scripts\scenario_day67.py
```

### 3. Frontend

```powershell
cd frontend
npm install
npm run dev
```

- App: http://localhost:5173  
- Vite が `/api` を `http://127.0.0.1:3001` へプロキシします  

