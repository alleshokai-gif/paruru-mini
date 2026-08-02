# AGENTS.md

## PALURU Mini実装ルール

- 日本語で報告する
- 既存データを削除しない
- Spreadsheetはヘッダー名ベースで読み書きする
- 既存列を並べ替えない
- 不足ヘッダーは末尾追加する
- 日時はAsia/Tokyoを前提にする
- ユーザーが明示指定した値はAI解析結果より優先する
- APIキー、Calendar ID、個人メモ本文を通常ログへ出さない
- Android PWAのService Worker更新経路を壊さない

## v1.0のデータ方針

- PALURU Inboxは未処理項目の置き場
- Googleカレンダーは確定したeventの正本
- SignageはGoogleカレンダーを参照する
- GoogleカレンダーからPALURUへの逆同期は未実装
- eventはGoogleカレンダー登録成功後のみcompletedへ移動する
- カレンダー登録失敗時はInboxに残す

## カレンダー連携

- `PALURU_FAMILY_CALENDAR_ID` はScript Propertiesで管理する
- フロントへCalendar IDを返さない
- 成功判定は `success=true`、`calendarSyncStatus=synced`、`calendarEventIdあり`、新規eventでは `status=completed` を必須にする
- 成功確認前に登録パネルを閉じない

## PWA

- navigation / HTML / JS / CSS / manifestはnetwork first
- 画像・キャラクター素材はcache first
- `updateViaCache: "none"`、`registration.update()`、`skipWaiting()`、`clients.claim()` を維持する
- Build番号を更新し、設定画面で確認できる状態を維持する

## Agent consultation acceptance contract

- Home card and Agent Today Paruru must use the same server-normalized input conditions: selected calendar members, unknown-event policy, cutover time, target dates, scope, Calendar, and Inbox.
- Do not write request text, replies, raw responses, Calendar, Inbox, health data, tokens, or secrets to diagnostics. Keep only safe event metadata, code, stage, reason, size, elapsed time, request-id suffix, and Build ID.
- Preserve known upstream error codes through Mini, Agent, and OS. Do not collapse them to `AGENT_ERROR`; only unknown failures may use the generic code.
- Every `agentChat` change must retain the one-OpenAI-call plus deterministic GAS-service architecture and must measure `routerMs`, `serviceMs`, `totalMs`, `openAiCallCount`, and `serviceCallCount` on both success and failure.
