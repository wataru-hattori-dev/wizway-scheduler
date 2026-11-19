# DynamoDB 設計 — wizway-scheduler

`spec/openapi.yaml` の schemas / 各 API のアクセスパターンと、
モック実装（`frontend/src/model/`）のデータ操作を根拠にした永続化設計。

## 設計方針

| 方針 | 内容 |
|---|---|
| シングルテーブル | 1 キャンペーン分のエンティティを 1 テーブルに集約 |
| アクセスパターン駆動 | OpenAPI の Get/Query を PK/SK/GSI で直接満たす |
| 算出は非永続 | 候補枠（slots）は availability + カレンダーから都度算出（モックと同じ） |
| 小規模前提 | セクション 6 × 社員 ~数十名。スキャン回避を優先しつつ過度な正規化はしない |
| キャンペーン境界 | 当面は `CAMPAIGN#current`。将来の四半期切替は PK プレフィックス差し替えで拡張 |

テーブル名: `wizway-scheduler`

課金モード: **PAY_PER_REQUEST**（開発〜初期本番）

---

## キー設計

### 主キー

| 属性 | 型 | 説明 |
|---|---|---|
| `PK` | String | パーティションキー |
| `SK` | String | ソートキー |

### グローバルセカンダリインデックス

| GSI | PK | SK | 用途 |
|---|---|---|---|
| `GSI1` | `GSI1PK` | `GSI1SK` | セクション単位の社員・面談一覧 |
| `GSI2` | `GSI2PK` | `GSI2SK` | ステータス単位の面談一覧 |

全属性投影（`ALL`）。アイテム数が小さいためコストより実装単純さを優先。

### 共通属性

| 属性 | 説明 |
|---|---|
| `entityType` | `Meta` / `Section` / `Member` / `Interview` / `Availability` / `SalesAssignees` / `AssignmentOverride` / `Notification` / `Counter` |
| `campaignId` | 当面は `current` |
| `updatedAt` | ISO8601（書き込み時に更新） |

---

## エンティティ一覧

### 1. Campaign Meta（設定・期間・回答期限）

OpenAPI: `CampaignSettings` + `InterviewPeriod` + `ResponseDeadlines`

| PK | SK |
|---|---|
| `CAMPAIGN#current` | `META` |

属性例:

```json
{
  "entityType": "Meta",
  "quarterLabel": "2026年12月 三者面談",
  "hongoJoins": true,
  "provider": "meet",
  "interviewPeriod": { "startDate": "2026-12-01", "endDate": "2026-12-18" },
  "responseDeadlines": {
    "mgrSalesDeadline": "2026-11-20",
    "engineerDeadline": "2026-12-05"
  }
}
```

| API | 操作 |
|---|---|
| `GET/PATCH /settings` | GetItem / UpdateItem |
| `GET/PUT /interview-period` | GetItem / UpdateItem（`interviewPeriod`） |
| `GET/PUT /response-deadlines` | GetItem / UpdateItem（`responseDeadlines`） |

---

### 2. Section（マスタ + 期限）

OpenAPI: `Section` + `SectionDeadline`

| PK | SK |
|---|---|
| `CAMPAIGN#current` | `SECTION#{sectionId}` |

属性例:

```json
{
  "entityType": "Section",
  "sectionId": "meguro",
  "name": "Section A",
  "mgr": "目黒",
  "sales": "Sales A・Sales B",
  "deadline": "2026-11-27T18:00:00+09:00",
  "judgedAt": null
}
```

| API | 操作 |
|---|---|
| `GET /sections` | Query `PK=CAMPAIGN#current`, `SK begins_with SECTION#` |
| `GET/PUT /sections/{sectionId}/deadline` | GetItem / UpdateItem |
| `POST /assignments/judge` | UpdateItem（`judgedAt`） |

---

### 3. Member（社員マスタ）

OpenAPI: `Member` / `MemberMasterRecord`

| PK | SK | GSI1PK | GSI1SK |
|---|---|---|---|
| `MEMBER#{memberId}` | `PROFILE` | `SECTION#{sectionId}` または `SECTION#unset` | `MEMBER#{memberId}` |

属性例:

```json
{
  "entityType": "Member",
  "memberId": 2,
  "surname": "Person",
  "sectionId": "unset",
  "name": "Person",
  "role": "engineer",
  "isInterviewer": true,
  "isDeleted": false
}
```

- `role`: `engineer` | `mgr` | `sales` | `hongo` | `other`（社長・その他）
- `isInterviewer`: 面談メンバーに含めるか（boolean、デフォルト true）。日程調整・候補抽出は true のみ対象

| API | 操作 |
|---|---|
| `GET /members?sectionId=` | Query GSI1 `GSI1PK=SECTION#{id}` |
| `GET /members`（全件） | 各セクション + `unset` を Query 結合、または `entityType=Member` の小規模 Scan |
| `GET /members?includeDeleted=` | 上記結果をアプリ側フィルタ |
| `GET/PATCH/DELETE /members/{id}` | GetItem / UpdateItem（論理削除は `isDeleted=true`） |
| `POST /members` | TransactWrite: Counter 加算 + PutItem |

---

### 4. Member Counter（採番）

| PK | SK |
|---|---|
| `CAMPAIGN#current` | `COUNTER#MEMBER` |

属性: `nextValue`（整数。次に採番する ID）

社員 ID は欠番再利用禁止（OpenAPI / モック `nextEmployeeId` 準拠）。
削除後も Counter は戻さない。

---

### 5. Availability（空き日程）

OpenAPI: `Availability`

| PK | SK |
|---|---|
| `AVAIL#{voterId}` | `DATA` |

`voterId` ∈ `salesA` / `salesB` / `hongo` / `meguro`〜`hamada`

```json
{
  "entityType": "Availability",
  "voterId": "salesA",
  "dayMarks": { "2026-12-02": "ng" },
  "hourMarks": { "2026-12-04": [11, 14, 15] }
}
```

| API | 操作 |
|---|---|
| `GET/PUT /availability/{voterId}` | GetItem / PutItem |

候補枠 API（`/sections/{id}/slots`, `/members/{id}/slots`）は永続化せず、
本アイテム群 + 面談期間 + `hongoJoins` から算出する。

---

### 6. Sales Assignees（営業担当マトリクス）

OpenAPI: `SalesAssigneeMap`

一括 GET/PUT 契約のため、マップ全体を 1 アイテムで保持する。

| PK | SK |
|---|---|
| `CAMPAIGN#current` | `SALES_ASSIGNEES` |

```json
{
  "entityType": "SalesAssignees",
  "assignees": { "1": "salesA", "2": "salesB" }
}
```

キーは文字列化した `memberId`（OpenAPI の map キー仕様に合わせる）。

| API | 操作 |
|---|---|
| `GET/PUT /sales-assignees` | GetItem / PutItem |

---

### 7. Interview（面談状態）

OpenAPI: `Interview`（`votes` / `preferences` / `changeRequest` を含む）

| PK | SK | GSI1PK | GSI1SK | GSI2PK | GSI2SK |
|---|---|---|---|---|---|
| `MEMBER#{memberId}` | `INTERVIEW` | `SECTION#{sectionId}` | `INTERVIEW#{status}#{memberId}` | `STATUS#{status}` | `MEMBER#{memberId}` |

`sectionId` は社員の所属を冗長保持する（セクション移動時は Member と Interview の GSI1 を同時更新）。

属性例:

```json
{
  "entityType": "Interview",
  "memberId": 1,
  "sectionId": "meguro",
  "status": "adjusting",
  "submittedAt": null,
  "confirmedSlotId": null,
  "confirmedSalesId": null,
  "confirmedOverride": null,
  "assignReason": null,
  "meetingUrl": null,
  "pendingNote": null,
  "remindedAt": null,
  "changeRequest": null,
  "preferences": {
    "difficultDates": [],
    "preferredTimeNote": "",
    "note": ""
  },
  "votes": {}
}
```

| API | 操作 |
|---|---|
| `GET /interviews/{memberId}` | GetItem |
| `GET /interviews?sectionId=` | Query GSI1 `GSI1PK=SECTION#{id}`, `GSI1SK begins_with INTERVIEW#` |
| `GET /interviews?status=` | Query GSI2 `GSI2PK=STATUS#{status}` |
| `GET /interviews?sectionId=&status=` | Query GSI1 + `begins_with INTERVIEW#{status}#` |
| `PUT .../votes` 等 | UpdateItem（該当属性） |
| `POST .../change-requests` / `reminders` / `reopen` | UpdateItem |
| `PUT .../confirmed-time` | UpdateItem（status / confirmed* / meetingUrl） |
| `POST /sections/{id}/requests` | 対象 Member の Interview を Batch/Transact で `adjusting` へ |

`progressStatus` / `progressLabel` / `salesAssigneeId` は応答組み立て時の導出値とし、必須永続化しない
（OpenAPI 上も Interview 取得時に付与する表示用フィールド）。

---

### 8. Assignment Override（確定前の手動割当）

OpenAPI: `AssignmentOverride`

| PK | SK |
|---|---|
| `MEMBER#{memberId}` | `ASSIGN_OVERRIDE` |

```json
{
  "entityType": "AssignmentOverride",
  "memberId": 1,
  "slotId": "meguro-2026-12-04-11"
}
```

| API | 操作 |
|---|---|
| `PUT /assignments/overrides/{memberId}` | PutItem |
| `DELETE /assignments/overrides/{memberId}` | DeleteItem |
| `POST /assignments/confirm` 等 | 参照後に削除可 |

---

### 9. Notification

OpenAPI: `Notification`

| PK | SK |
|---|---|
| `CAMPAIGN#current` | `NOTIF#{at}#{id}` |

`at` は ISO8601（ソート可能なまま）。最新 40 件は:

```
Query PK=CAMPAIGN#current, SK begins_with NOTIF#, ScanIndexForward=false, Limit=40
```

| API | 操作 |
|---|---|
| `GET /notifications` | Query（上記） |
| 各種副作用（依頼送信・確定・リマインド等） | PutItem |

---

## アクセスパターン総表

| # | パターン | キー条件 |
|---|---|---|
| AP1 | キャンペーン設定取得/更新 | `GetItem/UpdateItem` `CAMPAIGN#current` / `META` |
| AP2 | セクション一覧 | `Query` `CAMPAIGN#current` / `SECTION#*` |
| AP3 | セクション期限 | `GetItem` `CAMPAIGN#current` / `SECTION#{id}` |
| AP4 | 社員をセクションで取得 | `Query GSI1` `SECTION#{id}` / `MEMBER#*` |
| AP5 | 社員を ID で取得 | `GetItem` `MEMBER#{id}` / `PROFILE` |
| AP6 | 社員採番付き作成 | `TransactWrite` Counter + Member(+Interview) |
| AP7 | 空き日程 | `GetItem/PutItem` `AVAIL#{voter}` / `DATA` |
| AP8 | 営業担当マップ | `GetItem/PutItem` `CAMPAIGN#current` / `SALES_ASSIGNEES` |
| AP9 | 面談を ID で取得/更新 | `GetItem/UpdateItem` `MEMBER#{id}` / `INTERVIEW` |
| AP10 | 面談をセクション(+status)で一覧 | `Query GSI1` |
| AP11 | 面談を status で一覧 | `Query GSI2` |
| AP12 | 割当オーバーライド | `Put/Delete` `MEMBER#{id}` / `ASSIGN_OVERRIDE` |
| AP13 | 通知最新 N 件 | `Query` `NOTIF#*` desc Limit N |
| AP14 | 候補枠算出 | 永続化なし（Availability + Meta + カレンダー） |
| AP15 | 自動判定/確定 | セクションの Interview + Availability を読み、メモリ上で割当（モック `assignSection` 相当）。確定は TransactWrite で複数 Interview 更新 |

---

## 非永続・導出データ

| データ | 理由 |
|---|---|
| `CandidateSlot` 一覧 | Mgr/本郷の空きと期間から算出。書き込み不要 |
| `progressStatus` / `progressLabel` | ステータス + 枠有無 + 営業オファーから導出 |
| `BusinessDay` / 休日カレンダー | コード定数 + 期間設定 |
| `SchedulingRules` | ドメイン定数（OpenAPI 参照用スキーマ） |

---

## 整合性・トランザクション

| 操作 | 方針 |
|---|---|
| 社員追加 | Counter 加算 + Member Put + Interview 初期 Put を TransactWrite |
| セクション移動 | Member.PROFILE と Interview の `sectionId` / GSI1 を同一トランザクションで更新 |
| 一括確定 | 対象 Interview の条件付き更新（`status` が confirmed でない等）を TransactWrite。競合時はリトライ/エラー返却 |
| 枠の二重確定 | 当面はセクション内 Interview を読んでアプリ側で `slotTakenBy` 相当を検査。必要になったら `SLOT#{slotId}` 占有アイテムを追加可能 |

---

## 容量感（目安）

| エンティティ | 想定件数 |
|---|---|
| Meta | 1 |
| Section | 6 |
| Availability | 9 |
| Member / Interview | 30（デモシード）〜数百 |
| Notification | 運用で増加（表示は最新 40） |
| SalesAssignees | 1 |

アイテムサイズは votes / dayMarks を含めても数十 KB 未満を想定。

---

## ローカル / 本番の対応

| 環境 | 定義場所 |
|---|---|
| 設計 SSOT（本ドキュメント） | `spec/dynamodb-design.md` |
| テーブル定義（CloudFormation 断片） | `infra/dynamodb/table.yaml` |
| ローカル起動 | `infra/local/docker-compose.yml` |
| テーブル作成・シード | `infra/local/init_db.py` |

エンドポイント:

- ローカル: `http://localhost:8000`（DynamoDB Local）
- 本番: リージョン標準エンドポイント（IAM 認証）

環境変数（バックエンド想定）:

```text
AWS_REGION=ap-northeast-1
DYNAMODB_ENDPOINT_URL=http://localhost:8000   # ローカルのみ
DYNAMODB_TABLE_NAME=wizway-scheduler
AWS_ACCESS_KEY_ID=local
AWS_SECRET_ACCESS_KEY=local
```

---

## 将来拡張（意図的に未実装）

1. **複数キャンペーン**: `CAMPAIGN#{yyyy}-Q{n}` に切り替え、一覧用 GSI を追加
2. **枠占有アイテム**: 同時確定の厳密排他が必要になったら導入
3. **通知 TTL**: `expiresAt` + DynamoDB TTL で古い通知を自動削除
4. **Point-in-time recovery / バックアップ**: 本番導入時に有効化
