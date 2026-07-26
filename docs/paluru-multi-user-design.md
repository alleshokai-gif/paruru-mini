# PALURU Mini マルチユーザー統合設計

## 現行実装との整合補正（優先仕様）

### capabilityの導出元

capabilityはクライアント入力ではなく、device pairingで解決したactorと `Home_Members.role` をMini GASの固定policyへ渡して導出する。現行のHealth operation許可定義元は `HomeMembershipService.authorizeTargetOperation_` の固定 `allowedOperations` である。`admin` はactiveな `self_record` 対象を操作でき、`self_record` は自分だけを操作できる。UI、Agent Tool、Mini GASは同じ固定policyを使い、Tool定義やLLMの出力を認可根拠にしない。

### capability別メニュー

現行ビューは `home`、`inbox`、`nurse-okan`、`settings`。bottom navigationはホーム/Inbox/設定、ドロワーは4ビューである。将来のメニューは次のcapabilityで制御し、UI非表示とGAS拒否を同時に実装する。

| メニュー/機能 | father/admin | second_son/self_record | 必須capability |
|---|---:|---:|---|
| ホーム | 表示 | 表示 | `home.read` |
| Inbox（本人メモ） | 表示 | 表示 | `memo.self.read` |
| ナースおかん | 表示 | 表示 | `health.self.read` |
| 父向け健康監督 | 表示 | 非表示 | `health.supervision.read` |
| 家電操作 | 表示 | 非表示 | `home.control` |
| 設定 | 表示 | 表示 | actor本人の設定read/write |

### 本人メモの移行とCRUD

現行Inboxには `userId` 列があるが、現状の `createWithAI` はクライアントの `body.userId` を保存し、`list` は全件返却し、`update` と `delete` はidだけで対象を更新/削除する。これはmulti-userの認可済み実装ではない。

移行後は `ownerUserId`, `createdByUserId`, `createdAt`, `updatedAt` を正本列とする。Mini GASはactorからownerとcreatorを設定し、クライアント値を無視する。`memo.self.create`、`memo.self.read`、`memo.self.update`、`memo.self.delete` は全てactor本人のowner一致を必須にする。既存メモは明示的な移行で `father` 所有へ設定し、移行できない行を本人メモとして返さない。

PWAのlocalStorageは利用者別namespaceに分離する。pairing credentialの端末共通領域と、本人メモ下書き・健康下書き・プロフィール・表示状態の利用者別領域を混在させない。

### Health contextとホーム障害分離

`health.context.get` は既存のHealth namespaced operationである。Mini GASのトップレベルactionに `context.get` を新設して衝突させない。ホーム集約APIを追加する場合も、既存Health contextのactor/対象者解決を置換しない。

ホームはFamilyカレンダー、本人メモ、各キャラタスクを別々の情報源として読む。どれかが失敗しても成功した情報源を表示し、失敗領域だけに再試行可能なエラーを出す。障害を別サービスの通常経路へ無断フォールバックしない。

日次・体重の未完了は父と次男の両viewerへ22:00（Asia/Tokyo）にアプリ内ホームカードで示す。00:00からtaskStatusはoverdue。MVPではpush通知・メール・外部通知を送らない。scary表示は常にviewer単位で、`viewerUserId + taskId + localDate` の履歴が無い場合だけ実行する。

## 原則

1. **server-resolved identity** — device pairingは端末credential、Membershipは端末と会員の所属である。Mini GASが両者からactor、home、capabilitiesを解決する。
2. **fail closed** — pairing、Membership、capabilityのいずれかが欠ける場合はread/writeとも拒否する。通常機能へ無断フォールバックしない。
3. **UIとGASの二重境界** — UIは許可されない入口を表示しない。GASはUIを信用せず同じcapabilityを検査する。片方だけでは不十分である。
4. **本人データ最小化** — メモは本人分だけを保存・取得する。作成者・所有者はサーバーが記録し、クライアント指定値で上書きしない。
5. **家族共用と本人専用を分離** — Familyカレンダーは家族共用。本人メモと健康記録はactor/capability範囲で分離する。

## actor解決フロー

```text
PWA: deviceId + pairing credential + action + payload
  -> Mini GAS: pairing検証
  -> Mini GAS: Device_MembershipsからdeviceIdの所属を解決
  -> Mini GAS: Home_Membersから会員状態とroleを解決
  -> Mini GAS: action/targetに対するcapabilityを決定
  -> 許可済みの最小payloadだけを下流サービスへ転送
```

クライアントが送る `homeId`、`userId`、`actor`、`recordedBy`、roleは認可根拠にしない。pairing credentialの実値、Calendar ID、Health Spreadsheet IDはフロントや通常ログへ出さない。

## capability表

初期pilotのroleは `father/admin` と `second_son/self_record`。capability名は設計上の固定候補であり、role文字列そのものをクライアントへ委ねない。

| capability | father/admin | second_son/self_record | GASでの対象制約 |
|---|---:|---:|---|
| `home.read` | 可 | 可 | 家状態のreadのみ |
| `home.control` | 可 | 不可 | kill switch、allowlist、confirmationも必須 |
| `calendar.family.read` | 可 | 可 | Familyカレンダーのみ |
| `calendar.family.create` | 可 | 可 | Family予定の新規登録。タイトル末尾タグはMini GASが付与 |
| `calendar.family.edit_own` | 可 | 可 | server-recorded creatorがactor本人と確認できる予定だけ |
| `calendar.family.delete_own` | 可 | 可 | server-recorded creatorがactor本人と確認できる予定だけ |
| `memo.self.read` | 可 | 可 | actor本人のownerUserIdのみ |
| `memo.self.create` | 可 | 可 | ownerUserId/createdByはactorからサーバー設定 |
| `health.self.read` | 可 | 可 | actor本人、または下記監督範囲 |
| `health.self.record` | 可 | 可 | actor本人への記録 |
| `health.supervision.read` | 可 | 不可 | activeな監督対象のみ |
| `health.supervision.record` | 可 | 不可 | activeな監督対象のみ |

次男は `home.read` を持つが `home.control` を持たない。UIで操作ボタンを隠しても、`home.control` のGAS拒否は必須である。

メニューもcapabilityから組み立てる。PWAは未許可のメニュー項目・ボタン・deep linkを表示しない。一方、Agent ToolはPWA経由かどうかに関係なく同じcapabilityをMini GASで検査し、Tool定義やLLMの判断を認可根拠にしない。

## データモデル方針

| 領域 | 所有者/可視性 | サーバー記録項目 | 備考 |
|---|---|---|---|
| Inboxメモ | 本人のみ | `ownerUserId`, `createdByUserId`, `createdAt` | 作成・取得ともactorへ強制スコープ。既存メモは初期移行で `father` 所有へ明示移行し、未所有のまま公開しない。 |
| Familyカレンダー | 家族共用 | 既存Calendar正本 | Signageは既存方針どおりCalendar参照。 |
| 家状態 | 家族read共有 | read auditが必要ならサーバー側 | 次男はread可、control不可。 |
| Health | 本人 + 明示的監督範囲 | `actorUserId`, `targetUserId`, `recordedAt` | 監督権限は固定capabilityで判定。 |
| タスク/通知 | 対象本人 + 父監督 | task owner、dueAt、通知冪等キー | scary表示済みと警告継続を分離。 |

PWAのlocalStorageは利用者別namespaceに分離する。端末共通のpairing credentialと、利用者別の下書き・表示状態・プロフィールを同じキー空間に混在させない。利用者切替時に別利用者のメモ本文や健康下書きを表示してはならない。

## Familyカレンダーの登録・所有権

### 既存実装の読取監査

- 汎用の `calendarSuffix` は現存し、`buildCalendarTitle_` は同一suffixがタイトル末尾にあれば重複付与しない。
- suffixはクライアントの `body.calendarSuffix` を優先し、次に保存済み値、最後に `userDisplayName` から組み立てる。`（ふ）`をMini GASが固定で付ける実装ではない。
- `syncCalendar_` と `updateCalendar_` はこのsuffix入力を利用するため、クライアント指定を排除していない。
- 編集・削除にserver-recorded creatorを照合する処理は確認できない。既存のdeleteはInbox行の削除であり、Calendar eventの所有者判定ではない。

### 確定要件

- 次男はFamily予定を全件readでき、Family予定をcreateできる。
- 次男が作成するFamily予定では、Mini GASがタイトル末尾へ `（ふ）` を**1回だけ**付与する。クライアント指定のsuffixや表示名を根拠にしない。
- タイトル文字列・`（ふ）`・説明文は所有権判定に使わない。タイトルは表示用であり、編集・削除認可の証跡ではない。
- Calendar eventとPALURU側の予定レコードへ、server-recorded `creatorUserId`、`createdAt`、`calendarEventId` を保存する。
- 編集・削除は、対象予定の `creatorUserId` をサーバー記録から取得でき、actorと一致する場合だけ本人分を許可する。記録がない既存予定は本人編集・削除不可としてfail closedにする。
- Family readは所有者に関係なく許可するが、create/edit/deleteの認可をread権限から推論しない。

## ホーム統合と画面遷移

ホームは次の3種類を同一タイムライン/カード群に統合する。

- Familyカレンダー予定
- actor本人の未完了メモ
- 各キャラ由来の指示・タスク（ナースおかんを含む）

情報源の障害は分離する。Familyカレンダー、本人メモ、各キャラタスクのどれかが失敗しても、成功した情報源は表示し、失敗した領域だけに再試行可能なエラー状態を出す。障害を別サービスの通常経路へ無断フォールバックしない。

```text
アプリ起動
  -> server-resolved context
  -> ホーム（共用予定 + 本人メモ + actorに許可されたタスク）
  -> タスク選択
     -> ナースおかん: task deep linkをserverで検証し専用ビューの該当入力へ
     -> Inbox: actor本人の対象メモへ
     -> 設定/その他: capabilityに対応した画面へ
```

deep linkは `{ view, taskId }` を基本形とし、サーバーがtaskIdからactorに許可された `localDate`、slot、対象者を返す。PWAが任意のtargetUserIdをdeep linkに埋めても、それだけで他人のデータを開けてはならない。

## API境界案

### Mini GAS

| action群 | 責務 |
|---|---|
| `context.get` | actor、capabilities、ホーム表示可能な集約の入口を返す。 |
| `memo.*` | actor本人をownerとして作成・取得・更新する。owner指定は受けない。 |
| `home.*` | `home.read` と `home.control` を別々に検査する。 |
| `calendar.family.*` | Familyカレンダーの共用readと、既存のwrite認可を扱う。 |
| `health.*` | actor/target/capabilityを解決してHealth GASへ最小payloadを転送する。 |

### Health GAS

Health GASはMini GASから渡されたserver-resolved actor/targetだけを受ける。直接公開のクライアントAPIにはしない。Health GAS内でもtarget/operationを再検証し、日次、体重、タスク、評価、通知を冪等に更新する。

## 導入順序

1. Membershipの全API適用と本人メモowner強制。
2. `home.read` / `home.control` のcapability分離と次男拒否試験。
3. ホーム集約readモデルとFamilyカレンダー・本人メモの分離試験。
4. ナースおかんのタスク、deep link、監督通知、scaryの導入。
5. 実機で家族別端末、ペアリング失効、日跨ぎ、通知再試行を検証。

各段階で、未許可UIを隠すだけで完了とせず、対応するGASの拒否テストを追加する。
