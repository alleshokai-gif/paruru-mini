# PALURU Mini

## EVA-03G Automation confirmation UI

PALURU Mini keeps automation operations behind confirmation, a kill switch, and device-pairing checks.

| Control | Property / storage |
|---|---|
| Operation kill switch | `PALURU_HOME_AGENT_ACTIONS_ENABLED` |
| Device token hashes | `PALURU_HOME_AGENT_DEVICE_TOKEN_HASHES` |
| Allowed rooms | `PALURU_HOME_AGENT_ALLOWED_ROOM_IDS` |
| Mini-to-switchbot automation secret | `PALURU_HOME_AGENT_AUTOMATION_SECRET` |
| Browser token storage | localStorage pairing token |

The pairing token is a device bearer token, not personal identity authentication. XSS, shared devices, or device compromise can still expose it, so the kill switch, allowed-room list, server-bound confirmation, and idempotency remain required.

Agent responses may include a structured `actionConfirmation`. PWA shows “実行する” and “やめる”.

- “実行する” calls `agentActionConfirm`.
- “やめる” calls `agentActionCancel`.
- Both paths verify pairing in Mini GAS before calling PALURU Agent.
- Confirm/cancel do not send the pairing token to PALURU Agent, PALURU_OS, OpenAI, or switchbot-temp-log.
- Browser confirm/cancel requests do not include operation, room, duration, skill, or `confirmed: true`.

Legacy `homeAgentAction` remains protected for old PWA compatibility. Pause/resume write calls use `PALURU_HOME_AGENT_AUTOMATION_SECRET`; read/proposal calls continue to use `PALURU_HOME_AGENT_SECRET`.

> **EVA-03 MVP Completed — 2026-07-19**
> PALURU Mini PWAは三号機v1の会話入口です。完成状態の正本はPALURU Agent側の`docs/eva-03-completion.md`です。

## EVA-03 current routing

| 最上位意図 | 現在の経路 |
|---|---|
| 「💬 相談する」 | 読み取り、依頼、操作候補、一般会話を質問として送る。Climate・エアコン状態・Calendar読取は `agentChat` -> Agent Tool、給食・学校・天気・旧Home Agent専用対象は `homeAgent` |
| 「📝 登録する」 | 本文を既存`createWithAI`へ保存し、AI分類・Follow-upを使う。相談らしい内容では確認してから経路を選ぶ |

「💬 相談する」で明示的な保存依頼（「覚えといて」「メモして」「記録しといて」等）を送った場合だけは、既存の `agentChat` -> Agent `create_memo` 経路を維持します。Calendar書込み要求は読取Toolへ送らず、既存の安全な `homeAgent` 経路へ送ります。カテゴリと優先度の初期値は「AIにおまかせ」で、「📝 登録する」の保存成功時だけ初期状態へ戻ります。

Agent経由でClimate実測回答、Calendar実予定回答、Inbox保存、構造化Follow-up中継を利用できます。既存Inbox、通知、Calendar登録、`createWithAI`、`answerFollowup`、旧Home Agentは後方互換のため残しています。

Inbox一覧は作成日で絞らず、`Inbox`／`inbox`／空欄を未処理として正規化します。旧行の`userId`または`visibility`が空でも一覧から除外しません。完了系（`Done`／`completed`）と削除系だけを除外し、通知候補の日付filterは流用しません。API失敗は正常0件と分け、「Inboxを読み込めませんでした」と再試行を表示します。

エアコンの電源・mode・設定温度・風量・自動制御pauseを尋ねるread質問は新Agentへ送ります。「ついてる？」はread、「つけて」「冷房25℃にして」等はAgentがOSのpreviewを通した確認候補を作るcommand経路として分離します。確認カードの「実行する」／「やめる」は既存のpairing・kill switch・confirmation境界を再利用し、ブラウザから操作内容を再送しません。read失敗時に旧経路へフォールバックしません。一時的な接続不能だけ再試行を案内し、設定不足や処理不能では無意味な再試行ボタンを表示しません。

## 旧Home Agent操作入口のP0保護

`homeAgent`のread-only処理は従来どおり維持し、`homeAgentAction`のpause／resumeだけをkill switch、端末別pairing token、サーバー発行confirmation、room allowlist、冪等性、実行直前状態再検証で保護します。pairingは匿名PWA向けの端末credentialであり、利用者本人認証ではありません。未設定時はfail closedです。

設定名だけを記載し、値はリポジトリへ残しません。

- `PALURU_HOME_AGENT_ACTIONS_ENABLED`
- `PALURU_HOME_AGENT_DEVICE_TOKEN_HASHES`
- `PALURU_HOME_AGENT_ALLOWED_ROOM_IDS`

詳細は役割別に次を参照してください。

- デプロイ、有効化、ロールバック、pairing token、受入チェック：[Home Agent操作保護 運用手順](docs/home-agent-action-operations.md)
- セキュリティ構成、データフロー、判断理由：[Home Agent Climate Slice](docs/home-agent-climate-slice.md)

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

PALURU Miniは、雑なメモをAI秘書ぱるるへ記録するスマホ向けPWAです。
ぱるるがメモを解析し、分類、日時抽出、Follow-up質問、予定登録まで手伝います。

キャッチコピー:

「はいはい、僕が覚えとく。」

ブランド表記は `PALURU`、起動画面のタグラインは `AI for everyday life.` とする。名称のブランド上のアクロニム（裏設定）は `Personal AI for Life, Utility, Routine & Understanding` であり、起動画面には表示しない。

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

Inbox編集はtype別表示です。shoppingでは「今日／明日／1週間以内／日付指定／期限なし」を選び、既存の `dueDate` へ保存します。「1週間以内」はAsia/Tokyoの今日から7日後へ変換します。期限付きのactiveなshoppingはNormal優先度でも「今日のぱるる」候補になります。PWA buildは `v20260719-09` です。
## EVA-03E Calendar Context internal API（ローカル実装）

`POST action=calendarContextInternal` は、PALURU_OSだけが利用するCalendar読取専用の内部APIです。認証には専用Script Property `PALURU_CALENDAR_API_TOKEN` を使い、Inbox・Agent・OS caller・Climate用tokenとは共有しません。`period` は `today` / `tomorrow` / `this_week` / `next_7_days`、`scope` は `mine` / `family` の固定値だけを受け付けます。`actor.userId` は既存家族allowlistで解決し、不明な値はfamilyへフォールバックせず拒否します。

応答schemaは `calendar-context-internal-1.0`、timezoneは `Asia/Tokyo` です。予定は最大100件で、title・開始・終了・終日・対象者ラベルだけを返します。Calendar ID、生event ID、description、location、attendee、URLは返しません。`next_7_days` は現在から「今日の7日後の0:00」までの半開区間です。

`CalendarReadService` は既存の `notificationCandidates` と `getFamilyScheduleSkill_` にも利用されますが、両経路の既存レスポンス形は維持します。テスト用の現在時刻とCalendar mockを注入でき、実Calendarへ接続せず境界条件を確認できます。
