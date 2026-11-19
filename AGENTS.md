# AGENTS.md — wizway-scheduler

## プロジェクト概要

Prototypes-Driven / Spec-Driven Development による日程調整システム (**wizway-scheduler**) の開発。
マネージャー・営業・エンジニアによる三者面談の日程調整を扱う。

## アーキテクチャ

モノレポ構造:

| ディレクトリ | 役割 |
|---|---|
| `frontend/` | React フロントエンド |
| `backend/` | Python (AWS Lambda) API |
| `infra/` | インフラ定義 (IaC) |
| `spec/` | 仕様 (OpenSpec) |

## 技術スタック

- **フロントエンド**: React + TypeScript + Vite + Tailwind CSS
- **API / バックエンド**: Python (AWS Lambda) + API Gateway
- **データベース**: Amazon DynamoDB
- **インフラ / 配信**: S3 + CloudFront（IaC で管理）

## シングルソース・オブ・トランス (SSOT)

`spec/openapi.yaml`（OpenSpec）を**唯一の正解仕様**とする。

- フロントエンドとバックエンドの型定義・通信は OpenSpec から共通化する
- 実装の都合で仕様を勝手に変えない。変更が必要な場合は先に `spec/openapi.yaml` を更新する
- API 契約・リクエスト/レスポンス形状の根拠は常に OpenSpec を参照する

## 開発手法 — 縦切り開発（Vertical Slicing）

機能はスライス単位で、次の順序で進める:

1. **OpenSpec 策定** — `spec/openapi.yaml` に API 契約を定義・更新する
2. **AWS インフラ / Python Lambda 開発** — 仕様に沿ってバックエンドと必要なインフラを実装する
3. **フロントエンド通信結合** — OpenSpec に準拠した通信で UI を本番 API に接続する

横断的な大規模リライトより、縦切りで動く単位を積み上げる。

## モック資産の活用

既存のプロトタイプ資産を解析し、本番実装に順次置き換える。

- `frontend/src/model/` — ドメインモデル・状態・シードデータなどのモック実装
- `frontend/src/views/` — 画面プロトタイプ

方針:

- 既存 UI / ドメイン表現を尊重し、見た目や操作フローを不用意に壊さない
- モックのデータ供給・ローカル状態を、OpenSpec 準拠の API 通信へ段階的に置き換える
- 置き換え時は SSOT（`spec/openapi.yaml`）との整合を確認する
