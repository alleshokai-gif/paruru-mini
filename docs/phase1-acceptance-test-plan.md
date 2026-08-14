# Phase 1 Acceptance Criteria / Test Plan

- 状態: 提案（未実装）
- 対象: ADR-001 の Phase 1 のみ
- 正本: [ADR-001](ADR-001-agent-tool-calling.md)、[Architecture](architecture.md)、[Tool Catalog / Contract v0.1](tool-contract-v0.1.md)、`AGENTS.md`
- 実機操作 acceptance: Phase 1 の対象外

本書は、Phase 1 の実装後に何をもって受入可能と判断できるかを定義する。現時点では実装、deploy、実データ変更、実機確認を行っていない。本書に書かれたテストは、実施済みを意味しない。

## 1. Acceptance Goal

Phase 1 の目的は「Tool Calling が動くこと」だけではない。次を実証する。

- Canonical Intent を新規追加せずに、Phase 1 の問い合わせを処理できる。
- domain ごとの Tool を Agent が選べる。
- multi-tool 質問を複合 Intent なしで処理できる。
- write は `prepare → confirmation → execute` のうち prepare までで停止する。
- actor / auth / business rule は Agent へ移動していない。
- 新経路と legacy 経路が同一 request で二重実行されない。

対象 Tool は `weather.getForecast`、`calendar.listEvents`、`home.climate.get`、`home.aircon.getState`、`home.aircon.prepareAction` の5件だけとする。Health、Finance、Energy、School / Lunch は Phase 1 の新経路対象に含めない。

## 2. Test Levels

同じケースを必要なレベルで分離して検証する。Unit PASS だけでは Phase 1 完了扱いにしない。

| Level | 対象 | 合格の意味 | 実データ・実機操作 |
| --- | --- | --- | --- |
| Contract / Unit | Tool input/output schema、error semantics、上限判定、business rule の決定論部分 | contract に反する引数・出力・副作用がない | mock のみ |
| Agent orchestration | Tool 選択、Tool 組合せ、構造化結果の統合、follow-up | 新規 Canonical Intent や複合 Intent を作らずに期待する Tool 名・回数になる | Tool mock |
| Mini → Agent → OS integration | Mini Gateway の TrustedContext 注入、Agent 呼出し、Tool / OS 応答、エラー伝搬 | client 由来 actor を使わず、業務エラーを安全に保持して返す | integration fixture |
| mock E2E | PWA 相当入力から会話出力・Trace までの一連 | UI、Mini、Agent、OS の接続契約が成立する | mock のみ |
| deployed read-only acceptance | deploy 済み PWA / Mini / Agent / OS で Weather / Calendar / Home read | 実環境の read-only 経路と Trace が確認できる | read-only の実データ参照のみ |
| Home prepare acceptance | deploy 済み経路で Aircon prepare candidate を作る | confirmation 候補だけを生成し、実機操作を起こさない | candidate の永続化有無は契約確定後に確認 |
| 実機操作 acceptance | confirmation 後の Aircon execute と実機状態 | Phase 1 外。別フェーズの受入対象 | Phase 1 では実施しない |

各ケースは、期待 Tool 名、Tool call 数、model call 数、OS/service call 数、結果 status、Trace 証跡を記録する。deployed acceptance は、接続済みの実ブラウザ・実PWA・実deploy で確認するまで PASS としない。

## 3. 共通 acceptance evidence

Phase 1 の各 acceptance ケースは、少なくとも次の証跡を残す。

| 証跡 | 要件 |
| --- | --- |
| 入力分類 | テストID、入力種別、期待 Tool。リクエスト本文・会話全文は Trace に保存しない。 |
| 経路選択 | 新経路または legacy 経路のどちらか一方だけ。 |
| Tool 結果 | Tool 名、`success`、`status`、安全な error / warning code。 |
| 相関ID | `requestId` / `clientRequestId` の安全な suffix。生の識別子は診断へ保存しない。 |
| Build ID | `miniBuildId`、`agentBuildId`、`osBuildId`。既存 Trace header の末尾順を維持する。 |
| 性能 | model / Tool / OS-service の call count、各主要 stage の elapsed、`totalMs`。 |
| 副作用 | read は0、prepare は実機操作0、`agent.chat` 内 execute は0。 |

`Agent_Trace_Log` の schema は append-only とし、既存 header を挿入・削除・改名・並替えしない。`miniBuildId`、`agentBuildId`、`osBuildId` は `preparedKeysHash` の直後にある既存3列であり、その相対順序を維持する。Build IDより後ろに既存列・将来追加列が存在してよく、追加fieldは常に現行schema末尾へappendする。Trace を「取得できる」と扱うには、deploy 後に実際の `Agent_Trace_Log` へ新しい行が保存され、相関ID suffix と Build ID で確認できる必要がある。

## 4. Weather Read acceptance

### Phase 1A fixed decision

- Tool inputは `period` のみで、許可値は `today` / `tomorrow`。`date` と任意日付はPhase 1A対象外である。
- locationは既存のhome固定location解決をTool / OS側で再利用する。Agentはlocation文字列、緯度経度、Weather API、取得元を指定しない。`homeId → location registry` は後続PhaseのTBDとする。
- Weather resultは、fresh構造化データを `SUCCESS`、stale値ありを `STALE`、項目欠損・文字列fallbackのみ・日付不一致を `PARTIAL`、データ源なしを `UNAVAILABLE`、upstream処理失敗を `UPSTREAM_ERROR` として区別する。`STALE` と `PARTIAL` は取得済みdataを返せる。
- Weatherは実行前に新Tool経路またはlegacy経路を排他的に選ぶ。Phase 1A対象のWeather相談は新Tool経路へ固定し、Tool失敗後のlegacy fallbackと同一requestの二重実行を禁止する。School / Lunch等の未移行domainには影響させない。

### 入力例

- 「明日の天気教えて」
- 「明日傘いる？」

### Test cases

| ID | 条件 | 合格条件 |
| --- | --- | --- |
| W-01 | 明日の天気 | `weather.getForecast` のみを選択し、Tool call は1回。新しい Canonical Intent を追加しない。 |
| W-02 | 明日傘いる | 同じ Tool の構造化予報から回答する。Agent は緯度経度・外部 API・weather source を選択しない。 |
| W-03 | home location 解決 | location は TrustedContext / home 設定から Tool / OS が決定した証跡を確認する。Agent 引数に location がない。 |
| W-04 | Tool unavailable | `UNAVAILABLE` または既知の安全な上流 error を返し、架空の天気を回答しない。legacy Router を自動実行しない。 |
| W-05 | stale forecast | freshness 要件を満たさないが値がある場合は、現在の予報として断定せず `success=true`、`status=STALE`、stale dataと安全なwarningを保持する。 |

### Phase 1A decision cases

| ID | 条件 | 合格条件 |
| --- | --- | --- |
| W-06 | 入力範囲 | `period=today` または `period=tomorrow` だけを受理する。`date`、任意日付、両方指定、定義外引数は `INVALID_INPUT` とし、Toolを実行しない。 |
| W-07 | fresh構造化データ | `success=true`、`status=SUCCESS`、`freshness.status=current` の構造化dataを返す。 |
| W-08 | staleだが値あり | `success=true`、`status=STALE`。stale値、`freshness.status=stale`、安全なwarningを返し、現在値として断定しない。 |
| W-09 | 部分データ | 項目欠損または文字列fallbackのみは `success=true`、`status=PARTIAL`。未報告値と取得失敗を混同しない。 |
| W-10 | 日付不一致 | 対象日の予報がなく別日dataのみなら `success=true`、`status=PARTIAL`、`weather_forecast_date_mismatch` warningを返す。 |
| W-11 | データ源なし / upstream失敗 | `success=false`、`status=ERROR`。データ源なしは `error.code=UNAVAILABLE`、upstream処理失敗は `error.code=UPSTREAM_ERROR` とし、どちらも `data=null`、架空値なし、legacy fallbackなし。 |
| W-12 | location | 既存home固定location解決がTool / OS側で選ばれ、AgentのTool引数にlocation、緯度経度、API選択が含まれない。 |
| W-13 | migration switch | Phase 1A対象のWeather相談は新Toolだけを1回実行する。新Tool失敗後にlegacy Routerを実行せず、同一requestで二重実行しない。School / Lunchのlegacy回帰は維持する。 |

## 5. Calendar Read acceptance

### Phase 1B fixed decision

- 新Toolへ移すのは `purpose=calendar` の相談だけである。`purpose=today-paruru` と、現在「今日の予定」がToday Paruruへ入る挙動は現行legacy経路のまま維持する。Today ParuruのCalendar + Inbox集約および18:00 rolloverは変更しない。
- Tool入力は `period: today | tomorrow` と `scope: mine | family` だけである。`memberUserId` はPhase 1Bでは受け付けない。`this_week`、`next_7_days`、任意日付、未定義引数は `INVALID_INPUT` とする。
- `mine` はMini GatewayがTrustedContextへ注入したactor本人、`family` は家族全体を意味する。Tool引数やclient payloadのrole、member、scopeは認可根拠にしない。
- `admin`、`guardian`、`self_record` は、TrustedContextに `calendar.family.read` capabilityがある場合、`mine` / `family` の両方を許可対象とする。OSは両scopeでこのcapabilityを必ず検証し、不足時は `FORBIDDEN` とする。
- `mine` はactor tag一致eventだけ、`family` はtagで絞り込まず未分類eventも含める。`family` / `unknown` はevent分類であってactor IDではない。
- Weather専用runtimeを複製せず、単一のbounded Tool Calling runnerを拡張する。`purpose=calendar` はmodel calls最大2、Tool calls最大1、OS/service call想定1とする。

### 入力例

- 「明日の予定教えて」
- 「明日の家族の予定ある？」

### Test cases

| ID | 条件 | 合格条件 |
| --- | --- | --- |
| C-01 | `purpose=calendar`、actor自身の明日予定 | `calendar.listEvents` だけを1回選択し、`period=tomorrow`、`scope=mine` をTool / OSがTrustedContext基準で処理する。新しいCanonical Intentを追加しない。 |
| C-02 | `purpose=calendar`、家族の明日予定 | `calendar.listEvents` だけを1回選択し、`scope=family` をOS側で判定する。Agentがauthorizationを決定しない。 |
| C-03 | actor / capability | `admin`、`guardian`、`self_record` の各TrustedContextについて、`calendar.family.read` がある場合は両scopeを許可する。capabilityがない場合は `FORBIDDEN` とし、eventを返さない。 |
| C-04 | `mine` filtering | actor tag一致eventだけを返す。client指定のmember、表示名、alias、event分類をactor照合へ使わない。 |
| C-05 | `family` filtering | tagで絞り込まず、未分類eventを含む家族全体を返す。`family` / `unknown` をactor IDやmemberUserIdとして扱わない。 |
| C-06 | input範囲 | `today` / `tomorrow` と `mine` / `family` だけを受理する。`memberUserId`、`this_week`、`next_7_days`、任意日付、未定義引数は `INVALID_INPUT` とし、OS/serviceを呼ばない。 |
| C-07 | 予定0件 | `SUCCESS` + `events: []` と件数0を返し、取得失敗と混同しない。 |
| C-08 | warning付き部分取得 | `PARTIAL` と取得できた範囲・安全なwarningを返す。成功/失敗の二値や空予定へ潰さない。 |
| C-09 | Calendarデータ源なし | `UNAVAILABLE` を返し、空予定（`events: []`）やgenericな `CALENDAR_UNAVAILABLE` へ変換しない。 |
| C-10 | upstream通信 / 処理障害 | `UPSTREAM_ERROR` を返す。認可系を一律 `UPSTREAM_ERROR` に潰さず、既知safe error codeをMini → OS → Agentで保持する。 |
| C-11 | migration switch | `purpose=calendar` はAgentService入口で新Tool経路だけを選ぶ。Tool失敗後にlegacy `calendar_read` / Routerを実行せず、同一requestで新旧Calendar経路を二重実行しない。 |
| C-12 | Today Paruru regression | `purpose=today-paruru` と現行の「今日の予定」はlegacy Today Paruru経路のままで、Calendar + Inbox集約と18:00 rolloverが変わらず、新Calendar Toolを呼ばない。 |
| C-13 | runtime上限 | model callsは2以下、Tool callsは1、OS/service callは想定1をTraceで確認する。上限逸脱、2本目のTool、無制限loopはFAILとする。 |

## 6. Home Read acceptance

### 入力例

- 「リビング何度？」
- 「家の中どう？」
- 「寝室のエアコンどうなっとる？」

### Test cases

| ID | 条件 | 合格条件 |
| --- | --- | --- |
| H-01 | room 指定の温湿度 | `home.climate.get` を選択し、roomId は Room Registry の canonical 値だけを Tool / OS で検証する。 |
| H-02 | room 未指定の home 概要 | `home.climate.get` の overview を正しく扱う。対象 room 範囲・並びは Tool / OS ルールによる。 |
| H-03 | Aircon 状態 | `home.aircon.getState` を選択し、`reportedState`、`confidence`、`observedAt`、freshness を構造化して扱う。 |
| H-04 | stale / unavailable / partial | `STALE`、`UNAVAILABLE`、`PARTIAL` を区別し、`null` や「問題なし」へ潰さない。 |
| H-05 | 推定状態の表現 | Aircon_State 等の報告済み・推定状態を、実機リアルタイム状態と断定しない。 |

## 7. Multi-tool acceptance

### 必須ケース

入力: 「明日の予定と天気教えて」

| ID | 条件 | 合格条件 |
| --- | --- | --- |
| M-01 | 両方のデータが利用可能 | `calendar.listEvents` と `weather.getForecast` の2 Tool が1回ずつ呼ばれる。`calendar_weather` 等の複合 Intent を新設しない。 |
| M-02 | 統合回答 | Agent が両 Tool の構造化結果を一つの自然文回答へ統合する。Tool 自身の自然文を正本にしない。 |
| M-03 | Calendar だけ失敗 | Weather 側の取得結果を回答し、Calendar 側が取得不能であることを明示する。失敗側を空配列や成功へ変換しない。 |
| M-04 | Weather だけ失敗 | Calendar 側の取得結果を回答し、Weather 側が取得不能であることを明示する。 |
| M-05 | partial 結果 | `PARTIAL` を成功 / 失敗の二値へ潰さず、取得できた範囲を区別する。 |
| M-06 | 上限 | Tool call 数は Phase 1 上限以内（最大3）であり、Tool 失敗時に legacy Router を追加実行しない。 |

## 8. Aircon Prepare acceptance

### 入力例

- 「寝室のエアコン25℃にして」
- 「リビングのエアコンつけて」
- すでに ON の状態で「つけて」
- 必須情報が不足・曖昧な操作

### Test cases

| ID | 条件 | 合格条件 |
| --- | --- | --- |
| A-01 | setpoint 希望 | `home.aircon.prepareAction` を1回だけ選択し、confirmation 候補を構造化して返す。 |
| A-02 | power 希望 | Tool / OS が機器 capability と入力 enum を検証する。Agent が power 値や許容範囲を補完しない。 |
| A-03 | すでに希望状態 | `NO_OP` を正常状態として返す。confirmation / execute を発生させない。 |
| A-04 | 情報不足・曖昧 | `FOLLOWUP_REQUIRED` を正常な会話状態として返し、必要入力だけを構造化して示す。 |
| A-05 | business rule | Last Known 復元、NO_OP 判定、許容温度、mode 補完、ManualOverride 時間は Tool / OS 側で処理され、Agent 指定値だけに依存しない。 |
| A-06 | 副作用禁止 | prepare により実機操作は0回、Aircon / Calendar / Inbox 等の外部対象データ保存は0回。`agent.chat` 内で execute Tool を呼ばない。confirmation record の永続化有無は TBD として別途確認する。 |
| A-07 | 回数上限 | prepare Tool は最大1回。Tool 失敗時に旧 Router や別 prepare Tool を自動追加しない。 |

既存 Aircon confirmation / execute path は回帰試験対象とするが、Tool Calling Phase 1 の execute acceptance ではない。実機操作は別フェーズで受入する。

## 9. Security / Actor acceptance

### 必須ケース

- `admin`
- `guardian`
- `self_record`
- revoked device
- actor payload tampering

| ID | 条件 | 合格条件 |
| --- | --- | --- |
| S-01 | `admin` | Mini Gateway が server-side で TrustedContext を解決し、Tool / OS が capability に基づいて可否を決定する。 |
| S-02 | `guardian` | guardian のサーバー定義 capability で同じ検証を行う。Calendar Phase 1Bでは `calendar.family.read` がある場合、`mine` / `family` の両scopeを許可する。 |
| S-03 | `self_record` | self_record のサーバー定義 capability を超える read / prepare を許可しない。Calendar Phase 1Bでは `calendar.family.read` がある場合、`mine` / `family` の両scopeを許可する。Agent が role を昇格させない。 |
| S-04 | revoked device | Mini Gateway が Agent 到達前に拒否する。Tool call、model call、legacy fallback は0回。 |
| S-05 | actor payload tampering | client が `role` / `userId` / `capabilities` を改ざんしても、server-side TrustedContext だけを使う。Agent が capability を追加・変更しない。 |
| S-06 | Tool 実行境界 | Tool / OS は各実行で TrustedContext を使い、prepare / execute の間に権限を持ち越さない。 |

## 10. Legacy coexistence and regression

### Legacy coexistence

Phase 1 対象 domain では、次を確認する。

| ID | 条件 | 合格条件 |
| --- | --- | --- |
| L-01 | 新経路対象の request | 新経路または旧経路の一方だけが動く。同一 request で両方動かない。 |
| L-02 | Tool failure | Tool error を返し、旧 Router を自動実行しない。 |
| L-03 | 未移行 domain | legacy Router / HomeAgent 経路を維持する。 |
| L-04 | School / Lunch 入力 | legacy 経路で従来どおり処理され、Phase 1 Tool が呼ばれない。 |
| L-05 | Calendar Phase 1B | `purpose=calendar` は新Tool経路だけ、`purpose=today-paruru` と現行の「今日の予定」はlegacy Today Paruru経路だけを実行する。両方を同一requestで実行しない。 |

### Regression suite

Phase 1 の対象外に変更・回帰があれば失敗扱いとする。少なくとも次を確認する。

- Inbox `createWithAI`
- Calendar sync
- existing Today Paruru
- legacy School / Lunch
- Aircon の既存 confirmation / execute path
- Device pairing / Membership

既存の Calendar context、Today Paruru、PWA Agent / pairing 関連のテスト資産は、この回帰確認に含める。既存 test が PASS しても、Phase 1 の deployed acceptance を代替しない。

## 11. Trace / Performance acceptance

各 acceptance ケースについて、成功、partial、failure、no-op の全状態を少なくとも1件ずつ記録する。

| Field | 要件 |
| --- | --- |
| Build IDs | `miniBuildId`、`agentBuildId`、`osBuildId` を記録する。 |
| Correlation | `requestId` / `clientRequestId` の安全な suffix を記録する。 |
| Model | model call count、model elapsedMs を記録する。 |
| Tool | selected Tool names、Tool call count、tool elapsedMs を記録する。 |
| OS / Service | OS/service call count、OS/service elapsed を記録する。 |
| Total | `totalMs` と最終 `success` / `partial` / `failure` / `no-op` 状態を記録する。 |

performance は「速くなった」とは評価しない。測定値、測定条件、call count を記録し、Phase 1 の上限が妥当かだけを判断材料として提出する。

## 12. Phase 1 limits

初期設計値は次のとおりとする。

| Limit | 値 | 検証 |
| --- | --- | --- |
| model calls | `≤ 2` | Tool 選択・結果統合を含め、成功・失敗ともに Trace で確認する。 |
| Tool calls | `≤ 3` | multi-tool を含む全 Phase 1 request で確認する。 |
| prepare Tool | `≤ 1` | Aircon prepare request で確認する。 |
| execute Tool | `0` in `agent.chat` | Agent chat 内に execute が存在しないことを確認する。 |

`purpose=calendar` のPhase 1B相談には、上表より狭い個別上限を適用する。model callsは `≤ 2`、Tool callsは `= 1`、OS/service callは想定 `1` とし、Calendar以外のToolを追加しない。

上限を超えた結果は acceptance failure とする。上限の緩和は、実測結果、影響範囲、更新する contract と test plan を示した別の設計判断なしに行わない。

## 13. Exit Criteria

Phase 1 の受入候補とするには、以下をすべて満たす必要がある。

- 5 Tool contract が実装されている。
- Weather / Calendar / Home read の acceptance が PASS している。
- Calendar + Weather multi-tool が PASS している。
- Aircon prepare が PASS している。
- write 実行が0回であることを確認している。
- actor / security acceptance が PASS している。
- legacy 二重実行がないことを確認している。
- Trace が実際に保存・取得でき、append-only schema を維持している。
- call count と elapsed の実測を記録している。
- deploy 済み環境で read-only acceptance が PASS している。
- regression suite が PASS している。

「Unit Test PASS」だけでは Phase 1 の完了・復旧・受入完了にしない。実機操作 acceptance は上記の Exit Criteria に含めないが、Phase 1 を超える write execute の完了判断には別途必要である。最終的な受入可否は、証跡と未確認事項を基にユーザーが判断する。

## 14. TBD

1. 後続Phaseで `memberUserId`、`this_week`、`next_7_days`、任意日付をCalendar Toolへ導入する場合のpolicyとcontract。Phase 1Bでは受け付けない。
2. deployed read-only acceptance を行う PWA / Mini / Agent / OS の対象環境と、許可された確認用 home / Calendar fixture。`mine` actor tag一致、`family` の未分類eventを安全に検証できるfixtureは実装前に選定する。
3. Calendar Phase 1B以外のdomainにおけるknown upstream error allowlistと、安全に再現する unavailable / stale / partial ケース。Calendar Phase 1Bは既知errorを保持し、認可系を `UPSTREAM_ERROR` に潰さないことまで確定している。
4. `home.aircon.prepareAction` の confirmation record 保存先と、prepare acceptance で許容される保存状態。
5. `power` / `fan` enum、Room Registry、home weather location、freshness 閾値など、Tool Catalog の未確定contract。
