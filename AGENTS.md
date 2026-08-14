# PALURU 開発憲法

AIは設計者ではない。設計を変更する権限は持たない。AIの役割は設計を実装すること。

設計変更が必要なら、実装せず設計変更提案として停止すること。

実機確認前に「完成」「修正済み」「復旧」と報告してはならない。

推測で原因を書いてはならない。証拠があるものだけ「確定」と書く。

Unit Test PASS は完成ではない。実ブラウザ受入まで完了して初めて完成。

## 修正範囲

AIは修正対象以外を変更してはならない。修正範囲を広げる場合は、必ず理由を書き、ユーザー承認を得ること。「ついでに直した」は禁止。

---

# PALURU Mini Rules

## 禁止事項

- Agentの仕様を勝手に変更しない
- OSの契約を勝手に変更しない
- ADR-001およびArchitectureで定めた移行範囲外のTool Calling経路を導入しない
- 設計・計測なしに無制限のAgent Loop、Tool再投入、Responses APIループ、モデル／Tool呼出しを導入しない
- Agent URL / Script Propertiesを勝手に変更しない
- Apps Script Web Editorでコードを修正しない
- Codexはデプロイを実行しない。`clasp push`、Apps Scriptのデプロイ作成・更新、ライブラリ版の公開・更新、GitHub Pages等の公開操作はすべてユーザー本人が行う
- 実ブラウザ受入前に「完了」と報告しない
- PWAだけ直してMiniとの契約を変更しない
- 推測だけで実装修正しない
- 「ついでのリファクタ」を行わない

## 完了条件

実装
↓
テスト
↓
ユーザー本人によるdeploy
↓
実ブラウザ受入
↓
ユーザー確認

これを満たした時だけ完了。

---

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

---

# PALURU Development Principles (Mandatory)

以下はPALURU開発における絶対ルールである。既存の実装ルールと矛盾する場合も、この節を優先する。

## 1. 設計を勝手に変えない

PALURUは設計が正本であり、AIは設計者ではなく実装者である。ADR-001およびArchitectureに定めない次の変更を無断で導入・置換してはならない。

- Tool Calling経路
- 無制限のAgent Loop
- Tool Router
- 無制限のTool再投入
- 無制限のResponses APIループ
- Phaseごとの上限を設計・計測しないモデル／Tool呼出し回数の変更
- 処理順の変更
- 新しい責務の追加

設計変更が必要と考えた場合は、実装せず「設計変更提案」として停止する。

## 2. 完了の定義

次をすべて満たすまで「完了」「復旧」「修正完了」と報告してはならない。

1. コード実装
2. 構文チェックPASS
3. 既存テストPASS
4. 対象Repository全体テストPASS
5. ユーザー本人によるデプロイ
6. 接続済み実ブラウザ・実PWA・実デプロイでの確認
7. 受入試験PASS

一つでも欠ける場合は「途中」と報告し、コード確認・テスト・実機確認を必ず分離して記載する。

## 3. 実機確認と受入試験

ブラウザ操作が可能なら、モックのみで終了してはならない。実ブラウザ、実PWA、実デプロイで受入試験を実施する。実装前に受入試験一覧を作成し、通過するまで完成扱いしない。

## 4. 事実・推測・未確認を混同しない

証拠がない限り、以下の表現を使わない。

- 確定
- 復旧
- 修正完了
- 原因は○○
- 動作確認済み

証拠がないものは「推測」「仮説」「未確認」「調査不能」と明記する。調査不能な箇所を推測で穴埋めしない。

## 5. ログ

ログ実装を「追跡可能」と報告できるのは、次を実機で確認した後だけである。

- 運用者が確認できる保存先・画面がある
- 検索方法がある
- requestId（または設計で定めた安全な相関ID）で追跡できる
- 実際にログを取得できる

コードへ出力APIを書くことだけをログ実装完了と扱わない。

## 6. 性能

性能改善を報告する前に、最低限以下を実測する。

- OpenAI/model call count
- Tool call count
- OS/service call count
- totalMs
- 各主要stageのelapsed time

Tool Calling経路では、Phaseごとに許容する最大モデル呼出し回数および最大Tool呼出し回数を、実装前に設計し、成功時・失敗時ともに計測する。無制限のAgent Loop、Tool再投入、Responses APIループは導入しない。

「速くなった」とは書かず、測定値と測定条件だけを記載する。

## 7. PALURU Agent正本設計

PALURUはCanonical Intent Router中心の構造から、Agent Tool Calling方式へ段階移行する。移行先の通常相談・操作経路は次のとおりである。

PWA
→ Mini Gateway
→ PALURU Agent
→ Tool Calling
→ Domain Tool
→ PALURU_OS / Domain Service

Agentの責務は、自然言語理解、Tool選択、複数Toolの組み合わせ、Tool結果の統合、follow-upに限定する。Tool / PALURU_OS / Domain Serviceは決定論処理を担当する。

authorization、validation、business rule、cache、rate limit、idempotency、retry、audit、write safetyをAgentへ移してはならない。actor / auth / contextはMini Gatewayがサーバー側で解決し、Agentはクライアント由来のrole / userIdを認可根拠にしてはならない。

Read ToolはAgentから利用可能とする。Writeは必ず次の三段階とする。

```text
prepare → confirmation → execute
```

AgentのTool Callingだけで実機操作・保存などの副作用を完結させてはならない。`execute` 時はMini / OS側でactor / auth / contextを再検証する。既存Airconの `prepare / confirm / execute` は、このWrite安全境界の実装資産として再利用する。

legacy Intent Routerは、未移行domainの一時経路としてのみ維持する。Tool失敗時にlegacy Intent Routerへ自動fallbackしてはならず、同一requestで新旧経路を二重実行してはならない。Big Bangでの置換は禁止する。

Phase 1は、Weather read → Calendar read → Home read → multi-tool → Home prepare の順で導入する。

### OpenAI呼出し回数

現行の「1回固定」は旧Structured Intent方式の制約であり、無条件ルールにはしない。ただし、無制限のAgent Loopは禁止する。Phaseごとに許容する最大Tool / model呼出し回数を設計・計測する。

## 8. 作業単位と変更履歴

調査、実装修正、リファクタ、性能改善を同時に行わない。1テーマ1PRとする。

実装前に必ず次を記録する。

- 問題
- 原因（証拠がある場合のみ。なければ未確認）
- 修正方針
- 影響範囲
- 副作用
- ロールバック方法
- 実機試験項目

実装後は、実際に変わった内容だけを記録する。

## 9. 最重要ルール

動いている機能は壊さない。修正対象外の回帰は失敗である。変更前後で対象外を含む回帰試験を行う。

## 10. Codexの役割

Codexはコード作成者であり、設計者・レビュー担当・完成判定者ではない。設計判断または受入可否の判断が必要な場合は、証拠と未確認事項を示してユーザーの判断を待つ。

## Agent consultation acceptance contract

- Home card and Agent Today Paruru must use the same server-normalized input conditions: selected calendar members, unknown-event policy, cutover time, target dates, scope, Calendar, and Inbox.
- Do not write request text, replies, raw responses, Calendar, Inbox, health data, tokens, or secrets to diagnostics. Keep only safe event metadata, code, stage, reason, size, elapsed time, request-id suffix, and Build ID.
- Preserve known upstream error codes through Mini, Agent, and OS. Do not collapse them to `AGENT_ERROR`; only unknown failures may use the generic code.
- Every `agentChat` / Tool Calling change must retain the deterministic Tool / OS / Domain Service safety boundary and must measure OpenAI/model call count, Tool call count, OS/service call count, `totalMs`, and each major stage elapsed time on both success and failure.
# Agent Internal Context Contracts

- Agent-only internal APIs must explicitly validate required routing fields and
  pass them to the shared aggregate Service. Do not silently use a Home-card
  default when Agent supplied a validated value.
- The Home card may retain its own no-period behavior, including the existing
  18:00 rollover. An explicit Agent `period` selects its requested target day
  and must not change the Home-card rollover rule.
- For a day-targeted aggregate, test the returned Calendar and Inbox together
  for `today` and `tomorrow`, and test that a missing target field is rejected.
- Do not add a Calendar-only fallback: Today Paruru remains the single shared
  Calendar-plus-Inbox aggregation path.

## Agent Trace Log schema migration (mandatory)

`Agent_Trace_Log` is an append-only operational ledger with persisted rows.

- Treat the current persisted header order as immutable.
- New trace fields must be appended at the end of `PALURU_AGENT_TRACE_HEADERS`.
- Never insert, remove, rename, or reorder a header before an existing header.
- `ensureAgentTraceHeaders_()` must preserve its fail-closed behavior for a
  genuine historical-prefix mismatch; do not relax it to mask a migration bug.
- Before changing trace headers, create a test fixture using the immediately
  previous persisted header list and at least one existing row. Verify that:
  1. the previous headers are an unchanged prefix of the new headers;
  2. missing headers are appended only;
  3. existing row values retain their column meanings; and
  4. a new row has exactly the same width as the expanded header list.
- A caught trace-persistence error does not make the trace system healthy.
  Verify the actual `Agent_Trace_Log` receives a new row after deployment
  before reporting trace persistence as working.

### Build ID incident rule

`miniBuildId`, `agentBuildId`, and `osBuildId` are existing persisted columns
immediately after `preparedKeysHash`. Their persisted positions are immutable,
and their relative order must always be `miniBuildId` → `agentBuildId` →
`osBuildId`.

Existing columns, including OS response-shape diagnostics, may follow this
three-column group. Future Trace fields must always be appended to the current
schema end; do not move, reorder, or recreate the Build ID columns to make
them the final three headers.

Every Trace schema migration must use the current 84-column header list as a
complete historical-prefix fixture with at least one existing row. It must
assert that the Build ID group remains immediately after `preparedKeysHash`,
that its three-column order is unchanged, and that all new fields are appended
only after the current schema end.

## DTO boundary incident rule

When an observed state appears impossible, compare the DTO shape at each
boundary before changing business logic. For Mini, this means confirming that
the Agent response's allowlisted structural fields survive ingress,
`appendAgentTraceEntries_()`, and `normalizePersistableAgentTraceEntry_()`
unchanged. Do not diagnose an upstream service from a missing Mini trace field
until each of these preservation boundaries has been checked.
