# WI-60 Mini PR #98｜本番投入前の表示Acceptance

PR #98 はSnapshotの表示境界だけを扱う。WorkBusyのGAS取込とContext Snapshot生成は別branchで検証する。receipt、新規認証、Service Worker、Build IDは追加しない。mergeとPages公開はHuman Acceptanceまで行わない。

## 事前確認

- PR headとmainとの差分がKaz OS表示・対応test・本書だけであること。認証、transport、`sw.js`、`build.js`、`index.html`の差分は0。
- 同一mainを基点に全体testを比較し、既知6 FAILが同一で新規FAILが0。focused V3、auth gate、SW cache試験を別途PASSさせる。
- publish直前に前版のmain SHA、Pages Build ID、rollback対象commitを記録する。v2/GAS read routeは残す。

## 実Snapshot・ブラウザAcceptance

認証済みの同一端末・同一Firebase sessionで、実Snapshotの安全な観測値（status、source status、時刻、件数）のみ記録する。token、本文、個人名、Work/Project titleは診断ログへ出さない。

| 条件 | TODAYで期待する表示 | 他タブ / 記録 |
| --- | --- | --- |
| 当日Snapshot CURRENT、Work・Calendar・TODAYが有効 | 既存の空き時間・NOW・NEXT・SCHEDULEDを通常表示 | 通常UIとの差分なし |
| 当日SnapshotでWorkBusy `not_connected` / `failed` / `stale` / `valid_until`超過のみ | Snapshot内の空き時間・NOW・NEXT・SCHEDULEDを予定上の目安として表示。WorkBusyの状態と最終取得時刻を警告 | Work・Projectsも表示。Miniで空き時間の再計算はしない |
| Snapshot全体DEGRADEDでWork・Calendar・TODAYも異常、または前日Snapshot | 現在の空き時間・NOW・NEXT・SCHEDULED・確認操作を出さず「TODAY未確定」 | 信頼できるWork・Projectsの最終保存情報を時刻と警告付きで表示 |
| Work source `failed` / `not_connected` | Work履歴を表示しない | Projectsが信頼可能ならProjects履歴のみ表示 |
| Projects source `failed` / `not_connected` | Projects履歴を表示しない | Workが信頼可能ならWork履歴のみ表示 |
| Firebase/GAS認証失敗、認証解除、v3 GET失敗 | 前のユーザーのTODAY・履歴を残さない | 認証成功やHTTP 200を装わず、再ログイン経路を確認 |

履歴の許可フィールドはWorkのtitle/work_id/state/project_name、Projectsのtitle/statusだけ。履歴にはnext action、提案、回答ボタンを出さない。保存時刻が不明なら「時刻未確認」と表示し、現在データと断定しない。

## PWA・認証・端末

- 公開後のBuild IDとService Worker active版を確認。HTML/JS/CSSはnetwork first、オフライン時だけapp shell cacheへ戻ることを確認する。Cache Storageに認証付き`/v3/dashboard`応答が保存されないことを確認する。
- 通常PALURUログインとKaz OS再読込を確認。v3認証付きGETのstatusを記録し、401/失敗時に古い表示や個人データが残らないことを確認する。認証実装自体はPR #98で変更しない。
- 390px実ブラウザで通常CURRENTとDEGRADEDの両方を開き、`document.documentElement.scrollWidth <= window.innerWidth`、長い履歴タイトルの折返し、警告とJST時刻の可読性、操作対象の有無を確認する。実Androidは別のHuman Acceptanceとして区別する。
- PWA reloadによるrebuild 0、live Notion/Calendar read 0を確認する。NetworkとCloud Run safe metadataのみを用い、レスポンス本文をログに残さない。

## 05:48とWorkBusy取込

- 前日メールの翌日BUSY行は0時以降も当日の計画から除外する。行が無い対象日は0件として扱い、メール取得・解析失敗とは区別する。
- メールが全日0件でSheetがヘッダーだけになる場合、既存5列は維持し、A1のセルメモにGASの成功取込時刻を記録する。Contextは行が空のときだけそのメモを読み、0件成功と未到着・取得失敗を区別する。既存のA1メモがある場合は上書きせず失敗として扱う。本番ではA1メモの競合有無とAPI読取を受け入れる。
- 同一メール再取込、予定変更・削除、Sheet書込・read-back失敗、rebuild失敗を隔離テストする。成功した0件メールの結果はGAS応答で確認する。
- 05:48に前日生成のSnapshotしか無い場合、前日の空き時間を当日と偽らず、最終保存Work・Projectsを時刻付きで表示する。05:48までの当日Snapshot publishは現行07:00 reconciliationだけでは保証できないため、本番受入では別途確認する。
- 実Snapshotの当日CURRENT/DEGRADED、認証付きGET、390px、Build IDとSW active版を別々に記録する。隔離ローカル表示は認証付き本番受入の代用にしない。

## Rollback

通常ログイン、既存TODAY、認証境界、表示、SW更新に退行があれば先にPagesを直前の正常Buildへ戻す。mainの反映済み差分は履歴を保つrevert commitで戻し、force pushしない。v2/GAS routeを残しておき、rollback後に通常ログイン・4タブ・TODAY・Build ID・SW active版を再確認する。原因調査は復旧後に行う。

本書はAcceptance手順であり、本番ブラウザ確認や公開を実施した証拠ではない。
