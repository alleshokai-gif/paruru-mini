# Data Model

## Spreadsheet

- Spreadsheet名: `Paruru_DB`
- シート名: `01_Inbox`
- GASではアクティブSpreadsheetを使用します
- ヘッダー名ベースで読み書きします
- 不足ヘッダーは末尾へ追加します
- 既存列の並べ替えは行いません

## 主要ヘッダー

```text
id
createdAt
updatedAt
title
memo
category
type
status
priority
dueDate
dueTime
eventStart
eventStartTime
eventEnd
eventEndTime
remindAt
tags
needsFollowup
followupQuestion
followupInputType
aiSummary
aiComment
confidence
source
userId
userDisplayName
calendarSuffix
deviceId
visibility
calendarTitle
calendarSyncStatus
calendarId
calendarEventId
calendarName
calendarSyncedAt
calendarStart
calendarEnd
calendarAllDay
calendarLastError
```

## type

- `task`
- `event`
- `shopping`
- `note`
- `idea`
- `reminder`

## status

- `inbox`: 通常Inboxに表示
- `completed`: 処理済み
- `deleted`: 削除扱い

## calendarSyncStatus

- `not_required`: event以外など、登録不要
- `pending`: eventでカレンダー未登録
- `synced`: Googleカレンダー登録済み
- `failed`: 連携失敗
- `update_required`: 登録済み予定とPALURU側データに差分あり
- `deleted`: 将来用

## followupInputType

- `date`
- `datetime`
- `time`
- `text`
- `yesno`

質問文とAI結果からGAS側で補正します。

## notification reason

- `overdue`
- `due_today`
- `due_tomorrow`
- `followup_required`
- `urgent`
- `high_priority`

event、completed、deleted、shoppingはv1.0の通知候補から除外します。

## 利用者プロフィール

localStorageに保存します。

- `userId`
- `displayName`
- `calendarSuffix`
- `defaultCalendar`
- `deviceId`

現在の初期プロフィールは父です。`userId` と `deviceId` は別物として扱います。
