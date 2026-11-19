# ローカル DynamoDB 環境

本番同等のシングルテーブル（`wizway-scheduler`）を Docker 上の DynamoDB Local で動かします。

設計詳細: [`spec/dynamodb-design.md`](../../spec/dynamodb-design.md)

## 前提

- Docker Desktop
- Python 3.11+
- （任意）AWS CLI v2 — 手動確認用

## 起動手順

### 1. DynamoDB Local を起動

```powershell
cd infra/local
docker compose up -d
```

| サービス | URL |
|---|---|
| DynamoDB Local | http://localhost:8000 |
| dynamodb-admin（GUI） | http://localhost:8001 |

### 2. 依存関係とテーブル初期化

```powershell
cd infra/local
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt

# テーブル作成 + デモシード + スモーク確認
python init_db.py --reset --seed --check
```

環境変数は未設定でもローカル既定値が使われます（`.env.example` 参照）。

### 3. 動作確認（AWS CLI）

```powershell
$env:AWS_ACCESS_KEY_ID = "local"
$env:AWS_SECRET_ACCESS_KEY = "local"
$env:AWS_DEFAULT_REGION = "ap-northeast-1"

aws dynamodb list-tables --endpoint-url http://localhost:8000
aws dynamodb get-item `
  --endpoint-url http://localhost:8000 `
  --table-name wizway-scheduler `
  --key '{"PK":{"S":"CAMPAIGN#current"},"SK":{"S":"META"}}'
```

## よく使うコマンド

| 目的 | コマンド |
|---|---|
| 起動（データ保持） | `docker compose up -d` |
| 停止（データ保持） | `docker compose down` |
| データごと破棄 | `docker compose down -v` のあと `python init_db.py --reset --seed --check` |
| テーブルのみ再作成（所属設定も消える） | `python init_db.py --reset --seed --check` |
| シードだけ流し直し（デモ状態へ復元） | `python init_db.py --reset --seed` |

シードの優先順位:

1. `demo_seed.local.json`（gitignore・手元の運用スナップショット。あればこれを使う）
2. `demo_seed.json`（公開用の架空サンプル）

手元の表示を維持したい場合は、既存の実データシードを `demo_seed.local.json` として置いてください（初回クリーンアップ時にコピー済みならそのまま）。
PC 再起動後は `docker compose up -d` だけで既存データは残ります。毎日 `--reset --seed` する必要はありません。

## バックエンド接続想定

```text
AWS_REGION=ap-northeast-1
AWS_ACCESS_KEY_ID=local
AWS_SECRET_ACCESS_KEY=local
DYNAMODB_ENDPOINT_URL=http://localhost:8000
DYNAMODB_TABLE_NAME=wizway-scheduler
```

## トラブルシュート

- **接続できない**: `docker compose ps` で `wizway-dynamodb-local` が Up か確認
- **テーブルが空**: `--seed` を付けて再実行
- **ポート競合**: 8000 / 8001 を他プロセスが使っていないか確認
