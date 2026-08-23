# ナースおかん統合設計

## 現行実装との整合補正（優先仕様）

この節は本文中の旧案より優先する。Healthのcanonical slotはwire値 `morning`、`lunch`、`post_training`、`dinner`、`condition` である。UI表示名と `Health_Daily` 列名は次の変換を使い、列名や日本語表示名をAPIのslotとして送らない。

| wire slot | UI表示名 | 値列 | request / 記録者 / 記録時刻列 |
|---|---|---|---|
| `morning` | 朝食 | `morningStaple`, `morningProteinSource` | `morningClientRequestId`, `morningRecordedBy`, `morningRecordedAt` |
| `lunch` | 昼食 | `lunchAmount`, `lunchProteinSource` | `lunchClientRequestId`, `lunchRecordedBy`, `lunchRecordedAt` |
| `post_training` | 部活後の補食 | `postTrainingStatus`, `postTrainingOnigiriCount`, `postTrainingProteinSource` | `postTrainingClientRequestId`, `postTrainingRecordedBy`, `postTrainingRecordedAt` |
| `dinner` | 夕食 | `dinnerRiceBowls`, `dinnerNattoPacks`, `dinnerExtraProteinSource` | `dinnerClientRequestId`, `dinnerRecordedBy`, `dinnerRecordedAt` |
| `condition` | 体調 | `conditionAppetite`, `conditionSymptomsJson`, `conditionNote` | `conditionClientRequestId`, `conditionRecordedBy`, `conditionRecordedAt` |

`Health_Daily` の共通列は `recordId`, `homeId`, `targetUserId`, `localDate`, `createdAt`, `updatedAt`。一括入力UIも各slotへ個別に `health.daily.recordSlot` を呼ぶ。`health.daily.recordAll` はMVP外である。

### タスク・表示履歴の別軸

- `taskStatus` は `scheduled` / `open` / `completed` / `overdue` のみを表す。
- `severity` は `normal` / `warning` / `scary` のみを表す。
- scary表示履歴はtaskStatusやseverityに混ぜず、`viewerUserId + taskId + localDate` を主キーにする。
- `health.task.list` はread-onlyであり、取得しただけでは履歴を作らない。実際にscary演出を表示した後に `health.task.ackScary` を呼び、server-resolved viewerとして記録する。
- scary演出は常にviewer単位で1日1回だけである。未解決の警告カードは、閲覧を許可された各viewerへ継続表示する。

### Health Spreadsheet内のタスク保存案

タスク・通知・scary履歴の正本はすべてHealth Spreadsheetに固定する。既存の `Health_Daily`、`Health_Weight`、`Health_Request_Log` を置換しない。

| シート | 主キー/冪等キー案 | 内容 |
|---|---|---|
| `Health_Tasks` | `taskId` | `taskStatus`, `severity`, `targetUserId`, `dueAt`, `sourceLocalDate`, `updatedAt` |
| `Health_Scary_History` | `viewerUserId + taskId + localDate` | `viewerUserId`, `taskId`, `localDate`, `scaryShownAt` |
| `Health_Notification_Log` | `notificationType + taskId + recipientUserId + localDate` | アプリ内ホームカードの通知済み状態 |

`taskId` は表示文言から作らない。日次は `daily:{homeId}:{targetUserId}:{localDate}`、体重は `weight:{homeId}:{targetUserId}:{dueLocalDate}`。`dueLocalDate` は対象週の火曜日とする。日次は22:00に父・次男のホームカードへ未完了表示し、00:00からoverdue。体重scaryは同じ週の土曜00:00（Asia/Tokyo）から対象とする。MVPの通知はアプリ内カードのみである。

## 目的と境界

ナースおかんは、家族の健康記録を支援する専用ビューである。認可、本人性、データの正本はクライアントでは決めない。PWAが送る `deviceId`、pairing credential、表示対象候補は入力であり、Mini Health Gatewayがdevice pairingとMembershipからactor、home、capabilitiesを解決する。

Healthデータの正本はHealth Spreadsheetである。Growth Dashboard/Growth APIとは連携、移行、逆同期しない。AIは説明や提案に利用できても、記録完了・期限・警告判定の正本にはならない。

## データ責務

| データ | 正本 | 書込主体 | 説明 |
|---|---|---|---|
| 家族会員・端末所属・capabilities | Mini GASのMembershipデータ | 管理運用 | actorと権限をサーバー解決するための境界。 |
| 日次5枠・体重・評価結果 | Health Spreadsheet | Health GAS | 健康記録と決定的なルール評価の正本。 |
| ナースおかんタスク・severity・scary表示履歴・父への監督通知状態 | Health Spreadsheet | Health GAS | 期限、通知、表示回数を冪等に管理する。Health Spreadsheet以外へ正本を分散しない。 |
| 本人メモ | PALURU Inbox | Mini GAS | 作成者をサーバー記録し、本人以外へ返さない。 |
| Familyカレンダー予定 | Google Calendar | Calendar連携GAS | 家族共用。ホーム表示の予定正本。 |
| 画面の一時状態 | PWA | PWA | 正本ではない。失敗時にサーバー値を補完しない。 |

## 日次記録

対象日はAsia/Tokyoの `localDate` とする。枠は `morning`、`lunch`、`post_training`、`dinner`、`condition` の5つである。

- 5枠は分散入力でも一括入力でもよい。一括入力は同じ日・対象者の複数枠を個別に検証して保存する。
- 締切は当日23:59（Asia/Tokyo）。各枠が回答済みであれば日次タスクは完了である。
- `post_training` の `rest_day`（画面表示は「部活なし」）は未回答ではなく回答済みとして扱う。
- 記録完了と内容評価は分離する。完了は5枠の回答有無だけで判定し、内容評価は保存済み値に対する決定的なルール評価として別に保存する。
- 内容が不足していても、回答済みなら記録タスク自体は完了である。評価結果は警告カードや助言に使う。

## 体重と監督

- 体重タスクは毎週火曜日に発生する。
- 火曜日の体重記録は、同じ週の土曜00:00（Asia/Tokyo）を過ぎても未完了ならscary対象とする。
- 日次記録が2日連続で未完了ならscary対象とする。
- scary演出は対象者・理由・localDateごとに1日1回だけ表示する。未解決の警告カードは表示を継続する。
- 未完了の監督通知は父へ送る。通知送信は対象タスク・日付・通知種別を冪等キーにして重複送信を防ぐ。

## タスク状態・severity・表示履歴

```text
taskStatus: scheduled -> open -> completed / overdue
severity:   normal / warning / scary
history:    viewerUserId + taskId + localDate + scaryShownAt
```

`taskStatus` は回答・締切の状態だけ、`severity` は連続未完了や期限超過による警告強度だけ、表示履歴は誰にいつ演出を見せたかだけを表す別軸である。`content_evaluated` と内容ルールの結果もtaskStatusとは別に保存する。

scary履歴の主キーには少なくとも `viewerUserId`、`taskId`、`localDate` を含める。同じviewerには1日1回だけ演出し、日付が変わっても未解決警告カードは継続する。

## 画面とdeep link

ナースおかんは専用ビューにだけ表示し、ホームへカード・画像・起動ボタンを置かない。ホームはFamilyカレンダー予定、本人メモ、各キャラの指示を統合する。

```text
ホームのタスク/通知
  -> deep link { view: "nurse-okan", taskType, localDate, slot? }
  -> ナースおかん専用ビュー
  -> 対象日の該当枠または体重入力へスクロール・フォーカス
  -> 保存
  -> タスク再評価、警告/通知状態更新
```

deep linkは表示位置を指定するだけで、対象者・home・権限を指定する根拠にはならない。対象者候補と操作可能範囲はサーバー解決結果に従う。

## Health API案

全リクエストはMini Health Gatewayでactorとcapabilitiesを解決してからHealth GASへ転送する。クライアント由来の `homeId`、`actorUserId`、`recordedBy` は信用しない。

| operation | 用途 | 主な認可 |
|---|---|---|
| `health.context.get` | actor、対象者候補、capabilities、未完了概要 | 本人は自己のみ、父は監督対象を取得可能 |
| `health.daily.get` | 1日の5枠と評価・タスク状態 | 表示対象へのread capability |
| `health.daily.list` | 指定期間の日次記録一覧 | `health.daily.get` と同じread capability |
| `health.daily.recordSlot` | 1枠を保存 | 自己記録、または父の監督記録 capability |
| `health.weight.record` | 体重を保存 | 自己記録、または父の監督記録 capability |
| `health.task.list` | ホーム/専用ビュー用のタスク一覧 | actorのread capabilityの範囲のみ |
| `health.task.resolveDeepLink` | タスクから安全な表示先を解決 | server-side task ownership確認必須 |
| `health.supervision.list` | 父向け未完了一覧 | supervision capability必須 |

書込は全てclientRequestIdで冪等化する。タスク判定・scary表示済み・通知送信も、同じくサーバー側の冪等キーで処理する。

MVPの一括入力UIは、canonical slot名である `morning`、`lunch`、`post_training`、`dinner`、`condition` ごとに `health.daily.recordSlot` を呼ぶ。一括専用の `health.daily.recordAll` はMVP外であり、API案に含めない。

### N2-B `health.daily.list` 契約

`fromLocalDate` と `toLocalDate` は `YYYY-MM-DD` で指定し、両端を含む最大31日とする。`fromLocalDate > toLocalDate`、実在しない日付、31日超過は `INVALID_INPUT`。responseの `items` は日付昇順で、Spreadsheet rowがない日も `{ localDate, slots: {}, ruleCodes }` を返す。

MiniはpairingとMembershipから `homeId`、actor、targetをserver-sideで解決し、client由来の `homeId`、`actorUserId`、`role`、`recordedBy` を認可根拠にしない。Read capabilityは `health.daily.get` と同一とする。

### N2-E おかんコメント境界

`nurseOkanComment` は、記録・ルール評価を変更しないbounded read generationである。次の3条件を固定する。

1. `health_comment` はCost Guard上の独立interaction classであり、Read only、Tool 0、Model call最大1とする。
2. Agentが事実として採用するのは、Miniが既存Health Readからserver-sideで組み立てたcompact DTOだけとする。PWAはHealthの内容を送らない。
3. 100文字超、schema不正、timeout、OpenAI失敗はすべてdeterministic fallbackにし、日次記録・訂正・体重・履歴の表示を失敗させない。

## 実装Phase

1. **Phase 0: 認可境界と記録** — pairing + Membership、既存5枠・体重保存、ヘッダー名ベースのHealthデータ。
2. **Phase 1: タスク化** — 日次23:59判定、火曜体重、完了と内容評価の分離、`health.task.list`。
3. **Phase 2: 監督とdeep link** — 父向け未完了通知、ホーム統合、該当入力へのdeep link。
4. **Phase 3: scary運用** — 連続未完了/3日超過、1日1回演出、警告カード継続、通知冪等性。
5. **Phase 4: 運用検証** — 家族端末での認可試験、日跨ぎ・火曜・通知失敗再試行・PWA更新の実機確認。

各Phaseは、UI非表示だけでは認可にならない。GAS側のcapability検査を先に実装・試験してからUIを公開する。
