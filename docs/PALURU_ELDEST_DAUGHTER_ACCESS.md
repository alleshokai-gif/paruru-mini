# PALURU 長女ユーザー機能許可

> 2026-09-15: 本書のユーザー別access制限と承認テンプレート設計は
> [Issue #1 simple user registration](./ISSUE_1_SIMPLE_USER_REGISTRATION.md)
> により廃止された。以下は変更前の履歴であり、現行契約では固定rosterを
> identity validationのみに使い、長女を含むrole未付与memberへ共通baseline
> accessを返す。

更新日: 2026-09-14
状態: ローカル実装・自動テストPASS、deploy／Android実機Acceptance待ち

## 問題

固定家族名簿には `eldest_daughter`（長女、`self_record`）が存在するが、端末登録は許可されていない。また、現行の `self_record` は全員同じ capability と画面一覧を受け取るため、長女だけを Bus・本人メモ・ぽぴおに限定できない。

## 修正方針

- 既存の `self_record` role と固定家族名簿を維持する。
- `eldest_daughter_initial` を固定承認テンプレートとして追加し、父/adminが既存の端末承認経路で長女端末を登録できるようにする。
- role別許可を基底値として残し、`eldest_daughter` にだけサーバー固定のユーザー別許可を適用する。
- 長女の capability は本人メモCRUDとぽぴおread/writeだけに限定する。Busは公開Bus APIを既存Bus viewから利用する。
- 長女の許可viewは `home`、`inbox`、`popio-health`、`bus` とする。`home` と `inbox` は合わせて「メモ」機能を構成する。
- 長女のHome内では、未許可の今日の予定、相談Agent、Calendar連携を表示・実行しない。Inbox内の家族書類入口も非表示にする。
- ナースおかん、設定、Kaz OSは許可viewへ含めない。
- GASはクライアントのrole/capability指定を信用せず、server-resolved `memberUserId` から有効capabilityを決定する。

## 影響範囲

- 固定家族登録policyと父端末の承認テンプレート選択肢
- Membership ContextとGAS capability認可
- PWAの許可viewおよびHome/Inbox内のcapability別表示
- 長女専用および既存家族の回帰テスト

父、母、次男を含む長女以外のrole別許可は変更しない。Bus API、Cloud Run、ナースおかん本体、ぽぴお本体、Spreadsheet列構成は変更しない。

## 副作用とロールバック

長女は `home.read`、Calendar、Health、Family Inbox、`home.control` を持たないため、それらのGAS直呼出しも `FORBIDDEN` となる。本人メモを予定として保存してもCalendar登録候補は表示しない。

問題時は、長女の承認テンプレート、ユーザー別許可定義、PWA内表示gate、追加テストを同じ変更単位で戻す。既存のHome/Device Membership行は自動削除しない。

## Acceptance

1. 長女端末を固定テンプレートで新規登録でき、roleは `self_record` のまま。
2. Membership Contextが長女本人を返し、クライアント指定のrole/capabilityを無視する。
3. 利用可能な製品機能はメモ（`home` + `inbox`）、ぽぴお、Bus。
4. ナースおかん、設定、Kaz OS、家族書類、今日の予定、相談Agentを表示しない。
5. 本人メモの作成・一覧・更新・削除を許可する。
6. ぽぴおのread/writeを許可する。
7. 家電操作、Home read、Health、Calendar、Family InboxをGASで拒否する。
8. 父・母・次男の既存許可が変わらない。
9. Repository全体テストとSecret scanがPASSする。
10. ユーザー本人のdeploy後、Android実機で長女としてログインし、メモ・ぽぴお・Busだけが利用可能で、ナースおかんと家電操作が見えないことを確認する。

## ローカル検証結果

- JavaScript構文確認: PASS
- 長女server-side認可テスト: PASS
- 長女PWA表示gateテスト: PASS
- Repository全体: 108/108 PASS
- Bus: 161/161 PASS
- PWA Build ID change check: PASS
- component Build ID guard: PASS
- Secret scan: 502 files、matches 0
- PWA Build ID: `v20260914-eldest-daughter-access-v1`
- Mini Build ID: `mini-20260914-eldest-daughter-access-v1`

ユーザー本人によるMini/PWA deploy、接続済み実ブラウザ、Android実機Acceptanceは未実施。このため本番完了判定はまだ行わない。

## 限定release方針

作業ツリーには別テーマの未反映差分が共存するため、現在のworking tree全体を`clasp push`または`git add -A`しない。Gitの`HEAD`を基準に、長女対応だけを次の2 patchへ分離する。

- Mini: `bus/.local/eldest-daughter-mini-release.patch`
- PWA・テスト・本書: `bus/.local/eldest-daughter-pwa-release.patch`

Git/PWA用patchはGit管理外のclean release cloneへ適用する。Miniは別の一時directoryへ現在のApps Script sourceを`clasp pull`し、Mini patchの`gas/**`だけを適用して、変更が`AgentGateway.js`、`HomeMemberPolicy.js`、`HomeMembershipService.js`の3ファイルに限定されることを確認してからユーザー本人が`clasp push`する。これにより、Git baselineより新しい稼働中Mini sourceを古い内容で上書きしない。既存Web App deploymentを新versionへ更新してMiniを先に反映し、read-onlyのmembership contextを確認した後、clean Git cloneのcommitをGitHubへpushしてPWAを更新する。新規Web App deploymentは作らない。

rollbackは、Miniを更新前の既存versionへ戻し、PWAは長女release commitの親commitへrevertする。既存のHome/Device Membership行は自動削除しない。
