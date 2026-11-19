# infra — AWS 基盤

| パス | 内容 |
|---|---|
| [`dynamodb/table.yaml`](./dynamodb/table.yaml) | 本番向け DynamoDB テーブル定義（CloudFormation 断片） |
| [`frontend/template.yaml`](./frontend/template.yaml) | フロント配信（S3 + CloudFront SPA、index.html フォールバック） |
| [`local/`](./local/) | DynamoDB Local（Docker）と初期化スクリプト |

設計ドキュメント: [`spec/dynamodb-design.md`](../spec/dynamodb-design.md)

ローカル起動手順: [`local/README.md`](./local/README.md)

フロントのみ再デプロイ: [`frontend/scripts/deploy-frontend.ps1`](../frontend/scripts/deploy-frontend.ps1)
