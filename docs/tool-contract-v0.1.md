# Phase 1 Tool Catalog / Contract v0.1

- 状態: 提案（未実装）
- 対象: ADR-001 の Phase 1
- 正本: [ADR-001: Agent Tool Calling への段階移行](ADR-001-agent-tool-calling.md)、[Architecture](architecture.md)、`AGENTS.md`
- タイムゾーン: `Asia/Tokyo`

## 1. 目的と適用範囲

本書は、Agent Tool Calling 方式で導入する Phase 1 の Tool 名、境界、入出力、およびエラー意味論を定義する。対象 Tool は次の5件だけである。

| Tool | 区分 | side effect | legacy domain ownership |
| --- | --- | --- | --- |
| `weather.getForecast` | read | なし | HomeAgent の weather / `shimao` |
| `calendar.listEvents` | read | なし | Calendar read / HomeAgent の schedule |
| `home.climate.get` | read | なし | HomeAgent の room climate / `shimao` |
| `home.aircon.getState` | read | なし | HomeAgent の aircon state / `shimao` |
| `home.aircon.prepareAction` | prepare | 実機操作・対象データ保存はなし | HomeAgent の aircon proposal / `shimao` |

`home.aircon.prepareAction` は confirmation 用の候補を作るだけであり、エアコンの実操作を行わない。confirmation record を永続化するか、既存のどの保存先を使うかは未決定である。

4件の Read Tool は Agent から直接利用できる。prepare Tool も Agent が呼べるが、execute Tool は Phase 1 の `agent.chat` request から呼ばない。

Write の全体経路は `prepare → confirmation → execute` とする。本書で定義するのは prepare までであり、execute の実装契約は別途定義する。

本書は契約文書であり、コード変更、Tool 実装、deploy、実データ変更、Script Properties の変更を承認しない。Phase 1 外の Health、Finance、Energy、School / Lunch は対象外とする。

## 2. 共通境界

### 2.1 Agent が指定できる入力

各 Tool の Input contract は、Agent が指定する引数だけを定義する。次の値を Tool 引数へ含めてはならない。

- `actor`
- `auth`
- `deviceId`
- `capabilities`
- `role`
- `userId`
- `homeId`
- `sessionId`
- `clientRequestId`
- `requestId`

任意引数を省略した場合は、Agent がその希望を指定しなかったことを表す。`null` は省略と同義ではなく、各 Tool で明示的に許可しない限り `INVALID_INPUT` とする。Phase 1 の Agent 入力で `null` を許可する項目はない。定義外の引数も `INVALID_INPUT` とする。

日付は `YYYY-MM-DD`、日時は ISO 8601 形式で `Asia/Tokyo` の UTC オフセット（`+09:00`）を付ける。相対期間（`today`、`tomorrow` 等）は Tool / OS がサーバー時刻を基準に `Asia/Tokyo` で解決する。Agent は別のタイムゾーンで日付・時刻を補完しない。

### 2.2 TrustedContext contract

TrustedContext は Mini Gateway がサーバー側で解決し、Agent 引数とは別経路で Tool / PALURU_OS に注入する。以下の全項目を共通の最小契約とする。

| Field | 由来と用途 |
| --- | --- |
| `homeId` | サーバーで解決した home の識別子 |
| `memberUserId` | サーバーで解決した actor の canonical member ID |
| `displayName` | サーバーで解決した表示名 |
| `role` | サーバーで解決した role。Agent は認可根拠に使用しない |
| `capabilities` | サーバーで解決した capability 集合。Tool / OS が認可に使用する |
| `deviceId` | サーバーで検証した端末識別子 |
| `sessionId` | サーバーで検証した会話セッション識別子 |
| `clientRequestId` | サーバーで検証したクライアント要求識別子。冪等性・相関に使用する |
| `requestId` | サーバーが発行する要求相関識別子 |

Agent は TrustedContext を変更、推測、補完してはならない。クライアント由来の `role` / `userId` / capability は認可根拠にしない。Tool / OS は注入済み TrustedContext を受けても、authorization、validation、business rule、cache、rate limit、idempotency、retry、audit、write safety を決定論的に実施する。

### 2.3 共通 Output contract

Tool の正本出力は自然文ではなく構造化データとする。UI向け・会話向けの自然文は、構造化結果を根拠に原則 Agent が生成する。

```json
{
  "success": true,
  "status": "OK",
  "data": {},
  "warnings": [],
  "error": null,
  "generatedAt": "2026-08-14T10:00:00+09:00",
  "schemaVersion": "tool-contract-v0.1"
}
```

| Field | 必須 | 契約 |
| --- | --- | --- |
| `success` | 必須 | Tool の業務処理が成立したかを示す boolean。HTTP の成否とは別に判定する。 |
| `status` | 必須 | `SUCCESS` / `OK` / `PARTIAL` / `NO_OP` / `FOLLOWUP_REQUIRED` / `STALE` / `ERROR` のいずれか。`SUCCESS` はRead Toolの完全な構造化取得、`OK` はprepare完了等のTool固有成功に用いる。 |
| `data` | 必須 | 成功または部分成功時は Tool 固有の object。業務エラー時は `null` とし、必ず `error` を伴わせる。 |
| `warnings` | 必須 | 安全な固定コードの配列。原文、トークン、秘密情報、上流の生レスポンスを含めない。 |
| `error` | 必須 | 成功時は `null`。失敗時は安全な `{ code, retryable }` object。上流の生メッセージは含めない。 |
| `generatedAt` | 必須 | Tool / OS が発行した `Asia/Tokyo` の日時。 |
| `schemaVersion` | 必須 | 初期値は `tool-contract-v0.1`。互換性を壊す変更は別 version とする。 |

HTTP 成功は「Tool contract を返せた」ことだけを示し、業務成功を示さない。Agent は HTTP ステータスではなく `success`、`status`、`error.code` を使って結果を扱う。

取得できなかった個別値は、失敗全体を表す `data: null` で潰さない。個別値が不明・未報告の場合は、Tool 固有 data 内で `value: null` と `availability`（例: `not_reported` / `unknown`）を対にして表す。予定が0件のように値が存在しないことが正常な場合は、空配列または明示的な0件情報を返す。

### 2.4 Error semantics

| Code / status | 意味 | `data` の扱い |
| --- | --- | --- |
| `INVALID_INPUT` | Agent 引数が必須条件、型、enum、相互排他条件を満たさない | `null` |
| `FORBIDDEN` | TrustedContext に基づく authorization が拒否された | `null` |
| `NOT_FOUND` | canonical room / member / 対象リソースが存在しない | `null` |
| `UNAVAILABLE` | 正常な取得・準備に必要な依存先が利用不能、または設定されていない | `null` |
| `STALE` | freshness 要件を満たさないが、Tool固有契約で古い構造化値を安全に返せる | Tool固有の構造化dataを返せる。現在値として断定せず、freshnessとwarningを伴わせる。 |
| `PARTIAL` | 複数結果の一部だけを構造化して返せた | 取得できた部分だけを object で返す |
| `NO_OP` | prepare 結果として実行不要と決定された | 実行しない理由と比較対象を object で返す |
| `FOLLOWUP_REQUIRED` | prepare に必要なユーザー希望が不足・曖昧である | 必要な入力項目を object で返す |
| known upstream error | 既知で安全な上流エラー | 既知コードを保持する。`AGENT_ERROR` 等の汎用コードへ潰さない |
| `UPSTREAM_ERROR` | 安全に分類できない上流障害 | `null`。生の上流エラー本文は返さない |

`PARTIAL`、`NO_OP`、`FOLLOWUP_REQUIRED` は Tool が契約どおりに処理した結果であり、`success: true` を取り得る。`STALE` の `success` とdata有無はTool固有契約で明示する。既知の上流 `UNAUTHORIZED` 等を返す必要がある場合も、認可失敗や可用性失敗を汎用エラーへ変換しない。

Tool 失敗はこの contract で Agent へ返し、legacy Intent Router へ自動 fallback しない。

## 3. Phase 1 Tool contracts

### 3.1 `weather.getForecast`

#### Tool metadata

| Field | 値 |
| --- | --- |
| name | `weather.getForecast` |
| purpose | `period` で指定したPhase 1A対象日の、home に紐づく天気情報を構造化して取得する |
| 区分 | read |
| side effect | なし |
| legacy domain ownership | HomeAgent weather (`getWeatherSummary`、`shimao`) |

#### Input contract

| Field | Required | 型・enum | 契約 |
| --- | --- | --- | --- |
| `period` | 必須 | `today` / `tomorrow` | Tool / OS がサーバー時刻を基準に `Asia/Tokyo` で対象日へ解決する。 |

Phase 1Aでは `date` をTool入力として使用しない。任意日付は対象外であり、`date` を含む入力、`today` / `tomorrow` 以外の `period`、または定義外の引数は `INVALID_INPUT` とする。

`location` は Agent 入力に含めない。Phase 1Aでは既存のhome固定location解決をTool / OS側で再利用する。Agent はlocation文字列、緯度経度、外部 Weather API、取得元を選択しない。`homeId → location registry` は後続PhaseのTBDであり、Phase 1Aで新設しない。

#### Output data contract

`data` は少なくとも `targetDate`、`forecastDate`、`locationLabel`、`forecast`、`freshness` を返す。`forecast` は condition、降水確率、気温の構造化値を持つ。気温など個別の未報告値には前述の `availability` を付け、取得失敗とは区別する。

`freshness` には少なくとも status と sourceUpdatedAt / observedAt 相当の構造化日時を含める。天気文や傘の会話文は Output の正本にせず、必要なら Agent が構造化 data から生成する。

#### Phase 1A Weather decision（確定）

Phase 1AのWeather result / freshness / error semanticsは、次の表を正本とする。`success` はTool contractの業務処理の成立を表し、HTTP成否とは別である。

| 条件 | `success` | `status` | `data` / `freshness` / error |
| --- | --- | --- | --- |
| freshな構造化データを取得 | `true` | `SUCCESS` | 構造化予報と `freshness.status: current` を返す。 |
| staleだが値あり | `true` | `STALE` | stale値を返す。`freshness.status: stale` と安全なstale warningを伴わせ、現在値として断定しない。 |
| 一部項目が欠損 | `true` | `PARTIAL` | 取得済み値と、各未報告値の `availability` を返す。 |
| `Message!A2` 等の文字列fallbackのみ | `true` | `PARTIAL` | 文字列由来であることと `freshness.status: unknown` を構造化して返す。数値や降水確率がないことを取得失敗と混同しない。 |
| 対象日の予報がなく別日データのみ | `true` | `PARTIAL` | 利用可能な別日dataを返し、`weather_forecast_date_mismatch` warningを必須とする。 |
| 利用可能なデータ源なし | `false` | `ERROR` | `data: null`、`error.code: UNAVAILABLE`。 |
| upstream処理自体が失敗 | `false` | `ERROR` | `data: null`、`error.code: UPSTREAM_ERROR`。 |

`null`、空文字、個別項目の未報告、利用可能なデータ源なし、upstream失敗を同一扱いにしてはならない。Phase 1Aでは既存のfreshness判定を再利用し、新しい閾値は導入しない。

#### Phase 1A Weather migration switch（確定）

Weather domainは、実行前に新Tool経路またはlegacy経路のどちらか一方を決める。Phase 1A対象のWeather相談は新Tool経路へ固定し、新Tool失敗後にlegacy Intent Routerへfallbackしない。同一requestで新旧Weather経路を二重実行しない。School / Lunch等の未移行domainの経路には影響させない。

### 3.2 `calendar.listEvents`

#### Tool metadata

| Field | 値 |
| --- | --- |
| name | `calendar.listEvents` |
| purpose | 指定期間・scope の予定を、公開可能な構造化イベントとして取得する |
| 区分 | read |
| side effect | なし |
| legacy domain ownership | Calendar read / HomeAgent schedule (`getFamilySchedule`、`paruru`) |

#### Input contract

| Field | Required | 型・enum | 契約 |
| --- | --- | --- | --- |
| `period` | 必須 | `today` / `tomorrow` / `this_week` / `next_7_days` | `Asia/Tokyo` で期間を解決する。 |
| `scope` | 必須 | `mine` / `family` | `mine` は TrustedContext の actor を基準にする。`family` の可否は OS 側で決定する。 |
| `memberUserId` | 任意 | canonical member ID | 人を絞る必要がある場合だけ指定する。表示名・ニックネーム・client 由来 ID は不可。canonical 化と authorization は OS 側で実施する。 |

`memberUserId` を省略した場合は追加の member filter を指定しない。`scope=mine` で TrustedContext と異なる `memberUserId` を指定できるかは、OS 側で判定する。Agent はその可否を推測しない。

#### Output data contract

`data` は少なくとも `period`、`scope`、`from`、`to`、`events`、`summary` を返す。各 event は少なくとも title、startAt、endAt、allDay、personLabel を構造化して返す。Calendar ID、生 event ID、description、location、attendee、URL は返さない。

予定がない場合は `events: []` と `summary.totalEvents: 0` を返し、取得失敗として扱わない。イベントが上限で切られた場合は `status: PARTIAL` と安全な warning を返す。

### 3.3 `home.climate.get`

#### Tool metadata

| Field | 値 |
| --- | --- |
| name | `home.climate.get` |
| purpose | 指定 room または home overview の温湿度・評価・freshness を構造化して取得する |
| 区分 | read |
| side effect | なし |
| legacy domain ownership | HomeAgent room climate (`getRoomClimate` / `roomClimateOverview`、`shimao`) |

#### Input contract

| Field | Required | 型・enum | 契約 |
| --- | --- | --- | --- |
| `roomId` | 任意 | server Room Registry の canonical room ID | 指定時は当該 room を返す。省略時は overview として扱う。enum は Tool / OS の Room Registry が正本であり、Agent が作成・補完しない。 |

room 未指定の overview は Phase 1 で許可する設計とする。overview に含める room の範囲、並び順、上限は Tool / OS の決定論ルールとして別途確定する。

#### Output data contract

`data` は `scope`（`room` または `overview`）、`rooms`、`freshness` を返す。各 room は少なくとも canonical roomId、displayLabel、`measurement`、`evaluation`、`freshness` を構造化して返す。

- `measurement`: 温度、湿度、観測日時、各値の availability を含む。
- `evaluation`: severity / warning code 等の決定論的な評価を含む。自然文評価を正本にしない。
- `freshness`: current / stale / unknown 等の状態と、判断の基準日時を含む。

room がない場合は `NOT_FOUND`、測定値が古く freshness 要件を満たせない場合は `STALE` とし、`null` だけで曖昧にしない。

### 3.4 `home.aircon.getState`

#### Tool metadata

| Field | 値 |
| --- | --- |
| name | `home.aircon.getState` |
| purpose | 指定 room の Aircon_State 等の報告済み状態を構造化して取得する |
| 区分 | read |
| side effect | なし |
| legacy domain ownership | HomeAgent aircon state (`getAirconStatus`、`shimao`) |

#### Input contract

| Field | Required | 型・enum | 契約 |
| --- | --- | --- | --- |
| `roomId` | 必須 | server Room Registry の canonical room ID | Agent は登録済み canonical ID だけを指定する。存在確認と authorization は Tool / OS 側で実施する。 |

#### Output data contract

`data` は少なくとも `roomId`、`reportedState`、`confidence`、`observedAt`、`freshness` を返す。`reportedState` には、利用可能な power / mode / setpoint / fan 等の報告済み値だけを構造化して格納する。

Aircon_State 等の推定値・最終報告値を、実機のリアルタイム状態と表現してはならない。未報告の個別値は availability 付きで表し、`confidence` と `observedAt` を欠かさない。現在性が保証できない状態は `STALE` または `freshness: stale` として区別する。

### 3.5 `home.aircon.prepareAction`

#### Tool metadata

| Field | 値 |
| --- | --- |
| name | `home.aircon.prepareAction` |
| purpose | ユーザー希望を受け、確認前の正規化済み Aircon action と preview を生成する |
| 区分 | prepare |
| side effect | 実機操作・対象データ保存はなし。confirmation record の永続化方式は TBD。 |
| legacy domain ownership | HomeAgent aircon proposal (`buildAirconAdjustmentProposal` 等、`shimao`) |

#### Input contract

入力は「ユーザー希望」だけであり、現在状態や Last Known 値を Agent が渡してはならない。少なくとも1つの希望項目を指定しなければ `INVALID_INPUT` とする。

| Field | Required | 型・enum | 契約 |
| --- | --- | --- | --- |
| `roomId` | 必須 | server Room Registry の canonical room ID | 操作候補の対象 room。 |
| `power` | 任意 | enum: TBD | ユーザー希望の電源状態。具体的な値集合は機器 capability と合わせて未確定。 |
| `mode` | 任意 | `cool` / `heat` / `dry` | ユーザー希望のモード。現行 proposal が扱う値に限定する。 |
| `setpointC` | 任意 | finite number（摂氏） | ユーザー希望の設定温度。許容温度の判定は Tool / OS 側で行う。 |
| `fan` | 任意 | enum: TBD | ユーザー希望の風量。具体的な値集合は機器 capability と合わせて未確定。 |
| `durationMinutes` | 任意 | positive integer | ユーザー希望の一時設定時間。ManualOverride の有効時間・上限・復元は Tool / OS 側で決定する。 |

`power` / `fan` の enum が確定するまでは、それらを指定する Tool Calling は許可しない。mode と setpoint 等の組合せの可否、Last Known 復元、NO_OP 判定、許容温度、mode 補完、ManualOverride 時間、復元方針は、すべて Tool / OS 側の business rule として処理する。

#### Output data contract

これは直接実行結果ではない。`status` は最低でも `OK`、`NO_OP`、`FOLLOWUP_REQUIRED` を返し、`data` は status に応じて次を構造化して返す。

| Field | `OK` | `NO_OP` | `FOLLOWUP_REQUIRED` |
| --- | --- | --- | --- |
| `confirmationId` | 必須 | `null` | `null` |
| `normalizedAction` | 必須 | 比較に用いた正規化結果 | 不足項目以外があれば返す |
| `preview` | 必須 | 実行不要の根拠 | 実行不可の根拠 |
| `confirmationMessageData` | 必須 | `null` | `null` |
| `expiresAt` | 必須。`Asia/Tokyo` の ISO 8601 日時 | `null` | `null` |
| `requiredInputs` | `[]` | `[]` | 必須 |

`confirmationMessageData` は UI / Agent が確認文を組み立てるための構造化値であり、確認の自然文そのものを正本にしない。`OK` は confirmation を待つ準備済み状態を表すだけであり、execute の成功を意味しない。execute は確認済み candidate を受け、Mini / OS が actor / auth / context を再検証した別要求でのみ実行する。

## 4. Multi-tool contract example

利用者の質問: 「明日の予定と天気教えて」

```text
calendar.listEvents({ period: "tomorrow", scope: "mine" })
weather.getForecast({ period: "tomorrow" })
→ Agent が両方の構造化結果を統合して回答
```

このケースのために、新しい複合 Intent を定義しない。Agent は個別 Tool を選び、Tool / OS は各 Tool の authorization、validation、データ取得を決定論的に行う。片方だけ成功した場合は、Agent は `PARTIAL` の構造化結果を根拠に、取得できた範囲と取得不能な範囲を分けて回答する。

## 5. Phase 1 execution limits（案）

実装前の初期上限案は次のとおりとする。

| 項目 | 初期上限案 | 設計上の評価 |
| --- | --- | --- |
| model calls | 最大2 | Tool 選択と結果統合の二段階を許容する枠。モデル応答をどの単位で数えるかは TBD。 |
| Tool calls | 最大3 | Calendar + Weather の例は2件で収まる。Phase 1 の単一 read / 単一 prepare にも十分な枠だが、実測は未実施。 |
| prepare Tool | 最大1 | 1 request で複数の書込み候補を作らない安全境界として妥当。 |
| execute Tool | `agent.chat` と同一 request では0 | confirmation と actor/context 再検証を必須にするため。 |

これは性能測定結果ではなく、無制限 loop を防ぐための設計上の初期案である。実装前に model call / Tool call の数え方、Tool 内の OS/service call の扱い、成功時・失敗時の trace 項目を確定し、実装後に `OpenAI/model call count`、`Tool call count`、`OS/service call count`、`totalMs`、各主要 stage の elapsed を計測して評価する。

## 6. Legacy mapping

Phase 1 では既存経路を廃止しない。新 namespace は既存実装資産を直接公開せず、必要に応じて Domain Tool wrapper を介して利用する。

| 新 Tool | 現行名・近い実装資産 | 調査結果 | Phase 1 の扱い |
| --- | --- | --- | --- |
| `weather.getForecast` | `getWeatherSummary`、`weatherContextInternal_` | ローカルに存在。後者の `date` はOS内部で `period` から解決する実装詳細であり、Phase 1AのTool入力ではない。 | 再利用候補。新 contract 用 wrapper が必要。廃止候補ではない。 |
| `calendar.listEvents` | `get_calendar_context`、`getFamilySchedule`、`CalendarReadService.readContext`、`calendarContextInternal_` | `get_calendar_context` の同名ローカル実装は未検出。`CalendarReadService.readContext` は `period` / `scope` の構造化 read を提供する。 | Service 再利用候補。TrustedContext 注入と新 envelope 用 wrapper が必要。廃止候補ではない。 |
| `home.climate.get` | `get_home_climate_context`、`getRoomClimate`、`roomClimateOverview` | `get_home_climate_context` は README の経路記載のみで、同名ローカル実装は未検出。後二者はローカル legacy skill として存在する。 | 外部経路の所在は TBD。room / overview を統一する wrapper が必要。廃止候補ではない。 |
| `home.aircon.getState` | `getAirconStatus` | ローカル legacy skill として存在し、room climate 応答の `currentAirconState` を返す。 | `reportedState` / `confidence` / `observedAt` へ正規化する wrapper が必要。廃止候補ではない。 |
| `home.aircon.prepareAction` | `prepare_aircon_control`、`buildAirconAdjustmentProposal`、`buildManualComfortAdjustmentProposal`、`buildAdaptiveClimateProposal`、`setAirconOverride` | `prepare_aircon_control` の同名ローカル実装は未検出。proposal 系 skill はローカルに存在し、既存 action candidate は `setAirconOverride` を参照する。 | 外部経路の所在、confirmationId 発行、既存 execute との接続は TBD。新 contract 用 wrapper が必要。廃止候補ではない。 |

`get_calendar_context` はこのリポジトリに同名の symbol を検出できなかった。上表では、機能的に近い `CalendarReadService.readContext` と `calendarContextInternal_` を対応候補としている。`get_home_climate_context` と `prepare_aircon_control` についても、ローカルで確認できたのは上表の関連実装までであり、PALURU_OS 側など別リポジトリにある可能性は本書では推測しない。

## 7. TBD（未確定事項）

以下は実装や仕様を推測で埋めず、別途設計確認が必要である。

1. 後続Phaseの `homeId → location registry`、複数location時の選択規則、locationLabel の公開範囲。Phase 1Aは既存home固定location解決を再利用する。
2. `calendar.listEvents.memberUserId` の canonical 値集合、`scope=family` 時の member filter と authorization の詳細。
3. Room Registry の canonical `roomId` enum、overview に含める room の範囲・順序・上限。
4. Aircon の `power` と `fan` の enum、機器 capability による許容組合せ、出力 `reportedState` の固定 schema。
5. climate / aircon の freshness判定閾値と、`STALE` と stale data warning の使い分け。Weather Phase 1Aは既存freshness判定と本書3.1の対応表で固定する。
6. `home.aircon.prepareAction` の confirmation record 保存先、`confirmationId` の形式、expiresAt、有効期限切れ、既存 Aircon confirm / execute との正確な接続。
7. `confirmationMessageData` の固定 field、Agent・UI が確認文を生成する責務分担。
8. Weather以外のknown upstream error allowlistと、新 contract の `FORBIDDEN` / `UNAVAILABLE` / `UPSTREAM_ERROR` への対応表。
9. model call / Tool call / OS/service call の計数単位、trace の追加 field と append-only migration 手順。
10. `model calls 最大2` と `Tool calls 最大3` の実測に基づく妥当性評価。現時点で性能実測は行っていない。
