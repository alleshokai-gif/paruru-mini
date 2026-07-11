# Architecture

## 全体構成

PALURU Miniは、GitHub Pagesで配信するPWA、GAS Web App、Spreadsheet、OpenAI API、Google Calendarで構成します。

```text
PWA / GitHub Pages
        ↓
GAS Web App
        ↓
Spreadsheet 01_Inbox
        ↓
OpenAI Responses API
        ↓
Google Calendar
```

SignageはPALURUのInboxではなくGoogleカレンダーを参照します。

## データ正本

- 未処理の作業: PALURU Inbox
- 確定した予定: Googleカレンダー
- 処理済み履歴: Spreadsheetのcompleted行
- Signage表示: Googleカレンダー

eventはGoogleカレンダー登録成功後のみcompletedへ移動します。登録失敗時はInboxに残します。

## 外部連携

### OpenAI

GASからOpenAI Responses APIを呼びます。APIキーはScript Propertiesの `OPENAI_API_KEY` に保存します。

### Google Calendar

GASからCalendarAppで登録します。ファミリーカレンダーIDはScript Propertiesの `PALURU_FAMILY_CALENDAR_ID` に保存します。Calendar IDはフロントへ返しません。

## 状態遷移

### Inbox item

```text
inbox → completed
inbox → deleted
```

eventはGoogleカレンダー登録成功時のみ `completed` へ移動します。

### calendarSyncStatus

```text
not_required
pending
synced
failed
update_required
deleted
```

v1.0では新規登録と登録済み表示を主導線とします。GoogleカレンダーからPALURUへの逆同期は未実装です。

## PWA更新方針

- navigation / HTML / JS / CSS / manifest: network first
- 画像・キャラクター素材: cache first
- `updateViaCache: "none"`
- 起動時に `registration.update()`
- install時に `skipWaiting()`
- activate時に `clients.claim()`
- 古いcacheはactivateで削除
- controllerchange時は一度だけreload
