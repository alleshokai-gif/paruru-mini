# PALURU Mini

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

家の温湿度など現在状態に関する入力は、PWAから`agentChat`へ送る。会話用`sessionId`はversion付きlocalStorageキーで端末ごとに保持し、新規送信ごとに`clientRequestId`を生成する。同一送信の再試行では同じ`clientRequestId`を再利用する。通常メモは従来どおり`createWithAI`へ送り、給食・予定など旧Home Agentの対象は既存`homeAgent`を維持する。

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
