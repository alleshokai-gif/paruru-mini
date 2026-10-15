# WI-60 Mini PR #98｜本番投入前の表示Acceptance

PR #98 はSnapshotの表示境界だけを扱う。WorkBusyの供給・receipt・rebuild・GCS・認証・Service Worker・Build IDは変更しない。mergeとPages公開はHuman Acceptanceまで行わない。

## 事前確認

- PR headとmainとの差分がKaz OS表示・対応test・本書だけであること。認証、transport、`sw.js`、`build.js`、`index.html`の差分は0。
- 同一mainを基点に全体testを比較し、既知6 FAILが同一で新規FAILが0。focused V3、auth gate、SW cache試験を別途PASSさせる。
- publish直前に前版のmain SHA、Pages Build ID、rollback対象commitを記録する。v2/GAS read routeは残す。

## 実Snapshot・ブラウザAcceptance

認証済みの同一端末・同一Firebase sessionで、実Snapshotの安全な観測値（status、source status、時刻、件数）のみ記録する。token、本文、個人名、Work/Project titleは診断ログへ出さない。

| 条件 | TODAYで期待する表示 | 他タブ / 記録 |
| --- | --- | --- |
| 当日Snapshot CURRENT、critical source CURRENT、WorkBusy有効期限内 | 既存の空き時間・NOW・NEXT・SCHEDULEDを通常表示 | 通常UIとの差分なし |
| WorkBusy `not_connected` / `failed` / `stale` / `valid_until`超過 | 空き時間・NOW・NEXT・SCHEDULED・確認操作を出さず「TODAY未確定」 | 信頼できるWork・Projectsの保存情報をsource更新JST時刻と警告付きで表示 |
| Snapshot全体DEGRADED、または前日Snapshot | 上と同じ安全表示 | source statusを表示。古い時刻を現在時刻と誤認させない |
| Work source `failed` / `not_connected` | Work履歴を表示しない | Projectsが信頼可能ならProjects履歴のみ表示 |
| Projects source `failed` / `not_connected` | Projects履歴を表示しない | Workが信頼可能ならWork履歴のみ表示 |
| Firebase/GAS認証失敗、認証解除、v3 GET失敗 | 前のユーザーのTODAY・履歴を残さない | 認証成功やHTTP 200を装わず、再ログイン経路を確認 |

履歴の許可フィールドはWorkのtitle/work_id/state/project_name、Projectsのtitle/statusだけ。履歴にはnext action、提案、回答ボタンを出さない。保存時刻が不明なら「時刻未確認」と表示し、現在データと断定しない。

## PWA・認証・端末

- 公開後のBuild IDとService Worker active版を確認。HTML/JS/CSSはnetwork first、オフライン時だけapp shell cacheへ戻ることを確認する。Cache Storageに認証付き`/v3/dashboard`応答が保存されないことを確認する。
- 通常PALURUログインとKaz OS再読込を確認。v3認証付きGETのstatusを記録し、401/失敗時に古い表示や個人データが残らないことを確認する。認証実装自体はPR #98で変更しない。
- 390px実ブラウザで通常CURRENTとDEGRADEDの両方を開き、`document.documentElement.scrollWidth <= window.innerWidth`、長い履歴タイトルの折返し、警告とJST時刻の可読性、操作対象の有無を確認する。実Androidは別のHuman Acceptanceとして区別する。
- PWA reloadによるrebuild 0、live Notion/Calendar read 0を確認する。NetworkとCloud Run safe metadataのみを用い、レスポンス本文をログに残さない。

## Rollback

通常ログイン、既存TODAY、認証境界、表示、SW更新に退行があれば先にPagesを直前の正常Buildへ戻す。mainの反映済み差分は履歴を保つrevert commitで戻し、force pushしない。v2/GAS routeを残しておき、rollback後に通常ログイン・4タブ・TODAY・Build ID・SW active版を再確認する。原因調査は復旧後に行う。

本書はAcceptance手順であり、本番ブラウザ確認や公開を実施した証拠ではない。
