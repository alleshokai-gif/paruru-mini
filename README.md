# PALURU Mini

> **EVA-03 MVP Completed — 2026-07-19**
> PALURU Mini PWAは三号機v1の会話入口です。完成状態の正本はPALURU Agent側の`docs/eva-03-completion.md`です。

## EVA-03 current routing

| 入力 | 現在の経路 |
|---|---|
| Climate質問 | `agentChat` -> Agent Climate Tool |
| Calendar読取質問 | `agentChat` -> Agent Calendar Tool |
| 明示的な保存依頼 | `agentChat` -> Agent `create_memo` |
| 通常メモ | 既存`createWithAI` |
| 給食・学校固有情報 | 既存`homeAgent` |
| 家電操作・自動制御要求 | 既存`homeAgent` |
| Calendar書込み要求 | 読取Toolへ送らず既存の安全な経路 |

Agent経由でClimate実測回答、Calendar実予定回答、Inbox保存、構造化Follow-up中継を利用できます。既存Inbox、通知、Calendar登録、`createWithAI`、`answerFollowup`、旧Home Agentは後方互換のため残しています。

## 旧Home Agent操作入口のP0保護

`homeAgent`の読み取り処理は従来どおり利用できます。`homeAgentAction`の`pauseRoomAutomation`／`resumeRoomAutomation`だけは、次の3条件をすべて満たす場合に限って実行します。

1. `PALURU_HOME_AGENT_ACTIONS_ENABLED` が明示的に `true`
2. 端末別pairing tokenが `PALURU_HOME_AGENT_DEVICE_TOKEN_HASHES` のSHA-256ハッシュと一致
3. サーバー発行・5分有効・一回限りの`confirmationId`が有効

追加Script Properties（値はリポジトリへ記録しない）：

| Property | 形式 | 用途 |
|---|---|---|
| `PALURU_HOME_AGENT_ACTIONS_ENABLED` | `true`のときだけ有効 | 操作kill switch。未設定・その他の値はfail closed |
| `PALURU_HOME_AGENT_DEVICE_TOKEN_HASHES` | `deviceId`をキー、端末tokenのSHA-256 lowercase hexを値にしたJSON object | 匿名PWA端末のpairing確認 |
| `PALURU_HOME_AGENT_ALLOWED_ROOM_IDS` | 許可する論理roomIdのJSON array | クライアントからの任意room指定を拒否 |

pairing tokenは端末ごとに十分長いランダム値（32文字以上）を所有者が生成し、PWA設定画面へ一度入力します。生tokenはその端末の`localStorage`だけに保存し、コードやScript Propertiesには置きません。サーバーにはSHA-256ハッシュだけを設定します。rotation時は先にkill switchを無効化し、新tokenを端末へ設定してから対応するハッシュを置換し、確認後にkill switchを有効化します。端末紛失時は該当`deviceId`のハッシュを削除します。

PWAはMini GAS Web App URLをフロントの定数として保持しており、Web Appは`ANYONE_ANONYMOUS`です。そのためpairing tokenは「Googleアカウント本人認証」ではなく、端末に配布したbearer credentialによる当面の呼び出し元保護です。端末localStorageの窃取、同一originのXSS、端末共有、token転送は防げません。真の利用者認証が必要なら、Google Identity／Firebase Auth等で検証可能なID tokenをMini GAS手前または専用Gatewayで検証する必要があります。

`confirmationId`はskill、roomId、pause期限またはresume対象、actor、`clientRequestId`、確認失効時刻へサーバー側で結び付けます。PWAは操作内容を再送せず、`confirmationId`と`clientRequestId`、呼び出し元確認用pairing tokenだけを送ります。`LockService`内でpendingを消費し、内部prefix `PALURU_HA_ACTION_STATE_` のScript Propertiesへ期限付き状態とsanitize済み結果を保存するため、同じ確認または同じ`clientRequestId`の再送で上流操作を繰り返しません。pendingは5分、再送結果とrequest indexは6時間保持し、期限切れ状態は次の確認発行時に削除します。上限到達時はfail closedです。この内部状態にpairing token、共有Secret、メッセージ本文は保存しません。

nonceだけで防げるのは、操作内容の改ざん、期限後実行、単純な二重送信です。nonceを取得した本人の識別、端末乗っ取り、XSS、pairing token漏えいは防げないため、nonceを認証とは扱いません。`setAirconOverride`など未接続操作は引き続き拒否します。

## Deployment operation

コデオはコード変更、テスト、Git、必要なGASの`clasp push`までを担当します。GAS Web App deploymentは所有者がApps Scriptエディタでソース反映を確認後、既存deploymentを手動更新します。通常運用で`clasp deploy`は使用しません。新規deploymentの重複、Library deploymentとの取り違えを避け、Web App URLは末尾`/exec`を使います。Property値だけの変更は通常、再deployment不要です。PWAは既存のGitHub Pages公開とService Worker更新手順に従います。

## Home Agent Platform

Home Agent Platform全体の正本文書は `../HomeSignage/docs/` に置く。PALURU Mini側ではv1.0の既存Inbox / AI解析 / Follow-upを維持し、GASの `action=homeAgent` でHome Agent層だけを追加する。

- `../HomeSignage/docs/home-agent-architecture.md`
- `../HomeSignage/docs/home-agent-first-slice.md`
- `../HomeSignage/docs/home-agent-data-inventory.md`
- `../HomeSignage/docs/home-agent-skill-catalog.md`
- `../HomeSignage/docs/home-agent-agent-map.md`
- `../HomeSignage/docs/home-agent-roadmap.md`

## 概要

PALURU Miniは、雑なメモをAI秘書ぱるるへ預けるスマホ向けPWAです。
ぱるるがメモを解析し、分類、日時抽出、Follow-up質問、予定登録まで手伝います。

キャッチコピー:

「はいはい、僕が覚えとく。」

表示用画像は余白トリミング済みです。

## 主な機能

- PWA / GitHub Pages配信
- OpenAI APIによるメモ解析
- Inbox管理
- Follow-up質問と回答反映
- タスク期限管理
- ホーム画面の「今日のぱるる」
- Notification Candidate Engine
- Googleファミリーカレンダー登録
- 端末プロフィール
- 家族利用への拡張余地

## システム構成

```text
PWA / GitHub Pages
        ↓
GAS Web App
        ↓
Spreadsheet
        ↓
OpenAI API
        ↓
Google Calendar

Signage
        ↓
Google Calendar参照
```

## データの役割

- PALURU Inbox: 未処理のtask / shopping / reminder / noteを保持する
- Googleカレンダー: 確定したeventの正本
- completed: 処理済み履歴
- Signage: Googleカレンダーの予定を表示・読み上げる

## 主要フロー

### task

1. ユーザーが「部長に資料を送る」などを入力する
2. AIが `type=task`、カテゴリ、優先度などを解析する
3. 期限が重要で不足している場合はFollow-upを表示する
4. 回答は元アイテムへ反映し、新規メモにはしない
5. task / reminder / 確認待ちは通知候補の対象になる

### event

1. ユーザーが「7月20日13時半に授業参観」などを入力する
2. AIが `type=event`、`eventStart`、`eventStartTime` を解析する
3. ユーザー確認後にGoogleファミリーカレンダーへ登録する
4. 父プロフィールではカレンダー登録タイトル末尾に「（父）」を付与する
5. カレンダー登録成功後のみ `status=completed` にする
6. completedになったeventは通常Inboxから消える

### shopping

1. ユーザーが「牛乳買う」などを入力する
2. AIが `type=shopping` として保存する
3. shoppingは今回の通知候補対象外
4. 必要に応じてInboxから手動完了する

### Follow-up

1. AIが情報不足を検出すると `needsFollowup=true` と質問を保存する
2. ホームまたはInbox詳細にFollow-up回答UIを表示する
3. 回答は元アイテムの文脈と一緒に再解析する
4. 成功時のみFollow-up UIを閉じる

## Googleカレンダー連携

Script Property:

- `PALURU_FAMILY_CALENDAR_ID`

仕様:

- typeがeventでも自動登録しない
- 登録前に必ずユーザー確認を表示する
- カレンダーIDはフロントへ露出しない
- 父プロフィールでは「（父）」を付与する
- 成功後のみ `calendarSyncStatus=synced`、`calendarEventId` 保存、`status=completed`
- GoogleカレンダーからPALURUへの逆同期は未実装
- 登録後の変更はGoogleカレンダー側で行う

## OpenAI API

Script Property:

- `OPENAI_API_KEY`

仕様:

- OpenAI Responses APIを使用
- 現在のモデル設定: `gpt-5.5`
- JSON Schemaによる構造化出力
- ユーザーが明示指定したカテゴリ・優先度はAI結果より優先する

## PALURU Agent Gateway

PALURU Mini GASは、POST `action=agentChat`をPALURU Agentへサーバー間転送する。PWAはAgent URLや認証tokenを保持せず、Mini GASがScript Propertiesから取得する。

Script Properties:

- `PALURU_AGENT_URL`
- `PALURU_AGENT_TOKEN`

`agentChat`は`message`、UUID形式の`sessionId`と`clientRequestId`を必須とする。`userId`、`userDisplayName`、`deviceId`は会話contextであり認証には使用しない。Agentの内部requestId、生エラー、Tool生データ、URL、tokenはPWAへ返さない。

家の温湿度など現在状態に関する入力は、PWAから`agentChat`へ送る。会話用`sessionId`はversion付きlocalStorageキーで端末ごとに保持し、新規送信ごとに`clientRequestId`を生成する。同一送信の再試行では同じ`clientRequestId`を再利用する。通常メモは従来どおり`createWithAI`へ送り、給食・学校固有情報・家電操作など旧Home Agent専用対象は既存`homeAgent`を維持する。Calendar読取質問はEVA-03Fから`agentChat`へ送る。

`sessionId`、`clientRequestId`、プロフィール情報は認証情報ではない。PWA UIはAgent URLやtokenを保持しない。永続会話Memoryは未実装。

## Spreadsheet

- Spreadsheet名: `Paruru_DB`
- シート名: `01_Inbox`
- GASはアクティブSpreadsheetを使用する
- ヘッダー名ベースで読み書きする
- 不足ヘッダーは末尾へ安全に追加する
- 既存列を勝手に並べ替えない

主要列:

- `id`
- `createdAt`
- `updatedAt`
- `title`
- `memo`
- `category`
- `type`
- `status`
- `priority`
- `dueDate`
- `dueTime`
- `eventStart`
- `eventStartTime`
- `eventEnd`
- `eventEndTime`
- `tags`
- `needsFollowup`
- `followupQuestion`
- `followupInputType`
- `aiSummary`
- `confidence`
- `userId`
- `userDisplayName`
- `calendarSuffix`
- `deviceId`
- `calendarSyncStatus`
- `calendarEventId`
- `calendarTitle`

## 利用者プロフィール

プロフィールは端末ごとにlocalStorageへ保存します。

- `userId`
- `displayName`
- `calendarSuffix`
- `defaultCalendar`
- `deviceId`

現在は認証なしの家族内利用前提です。将来Googleログインなどへ差し替え可能な構造にしています。

## セットアップ

1. Spreadsheet `Paruru_DB` を用意する
2. GASプロジェクトへ `gas/Code.js` を配置する
3. Script Propertiesへ `OPENAI_API_KEY` を設定する
4. Script Propertiesへ `PALURU_FAMILY_CALENDAR_ID` を設定する
5. GAS Web Appとしてデプロイする
6. `app.js` の `GAS_WEB_APP_URL` をWeb App URLへ設定する
7. GitHub Pagesへフロントを配信する
8. Android ChromeまたはPWAで動作確認する

## デプロイ手順

1. `clasp push` でGASを反映する
2. GASの新バージョンをデプロイする
3. Gitへフロント変更をcommit / pushする
4. GitHub Pagesの反映を待つ
5. 設定画面で `PALURU Mini 1.0.0 / Build ...` を確認する
6. Android PWAでService Worker更新後の画面を確認する

## 現在の制約

- Googleログイン認証なし
- GoogleカレンダーからPALURUへの逆同期なし
- Push通知未実装
- 位置情報通知未実装
- 複数カレンダーは将来対応
- 家族ユーザー管理は端末プロフィール方式

## 今後の候補

- PWA Push通知
- 位置情報通知
- Googleカレンダー読取・自然言語操作
- 家族アカウント
- Context Engine
- Signageとのタスク連携
- 通知済み履歴

## 詳細設計

- [Architecture](docs/architecture.md)
- [Data Model](docs/data-model.md)
- [Deployment](docs/deployment.md)
- [Roadmap](docs/roadmap.md)

## ぱるる

種族: 猫
役割: AI秘書
一人称: 僕

性格:

- ツンデレ
- やきもち焼き
- 世話焼き
- オカン属性

口癖:

- 「……メモしとく？」
- 「はいはい。僕が覚えとく。」
- 「別に心配してるわけじゃないし。」
- 「また忘れてる。」

## EVA-03C 内部メモAPI（ローカル実装）

PALURU_OS専用のPOST action `createWithAIInternal` を追加しました。公開 `createWithAI` の入出力は変更せず、AI解析・決定的Follow-up補正・保存処理は同じ共通関数を利用します。認証にはScript Property `PALURU_INBOX_API_TOKEN` を使い、ブラウザ入力、応答、ログへ値を出しません。

冪等性のため、`01_Inbox` のヘッダー行末尾へ `clientRequestId` 列を手動で追加する必要があります。コードは列を自動追加しません。既存17件のセルは空欄のままでよく、同じUUIDが存在する場合はAI解析と保存を再実行せず `duplicate=true` で既存itemを返します。ヘッダー未追加時は `CONFIGURATION_ERROR` で安全に拒否します。

Miniの `agentChat` Gatewayは、既存のuser contextを省略可能な `actor` としてPALURU Agentへ転送します。成功応答の公開契約は従来どおりで、actor、Secret、Agent内部情報は返しません。PWAのルーティングと `createWithAI` は今回変更していません。

## EVA-03D Follow-up Bridge（ローカル実装）

Mini GatewayはPALURU Agentのoptional `followup` を `required`、`itemId`、`question`、`inputType` のallowlistへ整形してPWAへ返します。PWAは新しいUIを作らず、既存の `renderFollowupPanel` と `answerFollowup` を再利用して同じInbox行を更新します。回答時に `createWithAI` や `agentChat` を再実行しません。

明示的な文末保存依頼（「覚えといて」「メモして」「記録しといて」等）は `agentChat` へ送り、通常の短いメモは従来どおり `createWithAI` へ送ります。Climateは `agentChat`、給食・家電操作等は既存Home Agentを優先します。PWA buildは `v20260718-03` です。

### Follow-up回答後の表示整合性

Inboxカードの説明文は `aiSummary` を表示します。`answerFollowup` でtask期限、event開始日時、reminder通知日時が確定した場合は、追加AIを呼ばず、保存後itemのtype・title/memo・確定日時から `aiSummary` を再構築します。`aiComment` はカード表示元ではないため変更しません。

Agent由来Follow-upの回答成功時は、既存 `hideFollowupPanel` と `hideHomeAgentCard` を使って入力、pending itemId、Follow-upパネル、Agentメッセージを終了します。失敗時はどれも残します。既存createWithAI Follow-upはパネルを閉じますが、無関係なHome Agent通常回答は閉じません。

## EVA-03F PWA Calendar Routing（ローカル実装）

Calendarの読取質問だけを `agentChat` へ送ります。給食・学校固有情報・家電操作・自動制御は既存 `homeAgent` を優先し、Calendarの登録・追加・変更・削除等も読取Agentへ送りません。文末の明示メモ保存は既存 `agentChat / create_memo`、Climate質問は既存 `agentChat / get_home_climate_context`、通常メモは `createWithAI` のままです。

Calendar照会中は既存Agentカードへ「ぱるるが予定を確認中…」と表示します。失敗時は入力と同じ `clientRequestId` を保持して再試行し、別経路へ自動フォールバックしません。

Inbox編集はtype別表示です。shoppingでは「今日／明日／1週間以内／日付指定／期限なし」を選び、既存の `dueDate` へ保存します。「1週間以内」はAsia/Tokyoの今日から7日後へ変換します。期限付きのactiveなshoppingはNormal優先度でも「今日のぱるる」候補になります。PWA buildは `v20260719-02` です。
## EVA-03E Calendar Context internal API（ローカル実装）

`POST action=calendarContextInternal` は、PALURU_OSだけが利用するCalendar読取専用の内部APIです。認証には専用Script Property `PALURU_CALENDAR_API_TOKEN` を使い、Inbox・Agent・OS caller・Climate用tokenとは共有しません。`period` は `today` / `tomorrow` / `this_week` / `next_7_days`、`scope` は `mine` / `family` の固定値だけを受け付けます。`actor.userId` は既存家族allowlistで解決し、不明な値はfamilyへフォールバックせず拒否します。

応答schemaは `calendar-context-internal-1.0`、timezoneは `Asia/Tokyo` です。予定は最大100件で、title・開始・終了・終日・対象者ラベルだけを返します。Calendar ID、生event ID、description、location、attendee、URLは返しません。`next_7_days` は現在から「今日の7日後の0:00」までの半開区間です。

`CalendarReadService` は既存の `notificationCandidates` と `getFamilyScheduleSkill_` にも利用されますが、両経路の既存レスポンス形は維持します。テスト用の現在時刻とCalendar mockを注入でき、実Calendarへ接続せず境界条件を確認できます。
