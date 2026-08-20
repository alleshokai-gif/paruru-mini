# ADR-001: Agent Tool Calling への段階移行

- 状態: 決定（Phase 2 は未実装）
- 対象: PALURU Agent の相談・操作経路
- 決定日: 2026-08-19

## 背景

現行の PALURU Agent は、以下の経路を正本とする。

```text
Canonical Intent → IntentContract → Router → ToolRegistry
```

自然言語の相談に対して、より柔軟に複数の read 操作を組み合わせ、結果を統合し、必要な follow-up を行えるようにするため、Agent による Tool Calling 方式へ段階的に移行する。

この移行は Agent の責務を拡張するものであり、PWA / Mini / GAS / PALURU_OS / Domain Service の責務や安全境界を置き換えるものではない。

## 決定

### 移行方針

- 現行の `Canonical Intent → IntentContract → Router → ToolRegistry` 方式から、Agent による Tool Calling 方式へ段階的に移行する。
- Big Bang での置換は禁止する。対象 domain と Tool を限定し、各 Phase で検証可能な範囲だけを追加する。
- PWA / Mini / GAS / PALURU_OS / Domain Service は原則として維持する。
- legacy Intent Router は domain 単位の fallback として一時的に維持する。
- Tool の失敗時に、Agent または実行基盤が自動で旧 Router へ fallback する方式は禁止する。旧 Router の利用は、対象 domain を明示した移行設計または呼出し経路の選択によってのみ行う。

### Agent の責務

Agent は以下だけを担う。

- 自然言語理解
- 利用可能な Tool の選択
- 複数 Tool の組み合わせ
- Tool 結果の統合
- follow-up の生成と会話文脈の維持

### Tool / OS 側に残す責務

以下は Agent に移さず、Tool / OS 側の決定論コードに残す。

- business rule
- validation
- authorization
- cache
- rate limit
- idempotency
- write safety
- audit

Agent は認可可否を判断しない。actor / auth は Mini 側で解決し、検証済みの主体情報だけを Agent および Tool 実行経路に渡す。

### Read / Write の安全境界

- Read Tool は、Agent から直接利用可能とする。
- Write 操作は必ず `prepare → confirmation → execute` の三段階とする。
- `execute` は、確認済みの prepare 結果と必要な安全検証を Tool / OS 側で照合してから行う。
- Write の business rule、validation、authorization、idempotency、監査記録は、すべて Tool / OS 側で決定論的に実施する。

既存の Aircon の `prepare / confirm / execute` は、この Write 安全境界の実装資産として再利用する。後続 domain の追加時も、Aircon の `home.control`、room validation、5分の confirmation TTL、actor / home / device 再検証を弱めない。

### Read runtime / Write prepare runtime

Migrated Tool Calling は、実行責務を次の2系統に分離する。

```text
Migrated Read Tool Calling
Migrated Write Prepare Tool Calling
```

- Read Tool は Read allowlist からだけ dispatch する。既存の4 Read Toolの契約と bounded multi-tool runtime は維持する。
- Write Tool は Write prepare allowlist からだけ dispatch し、`agent.chat` と同一 request 内では `execute` しない。
- Agent selection は、server-side registry に記録された Tool 区分（`read` / `write_prepare`）を根拠に実行先を分ける。PWA regex、hard-coded keyword、legacy Intent を新設して Write ownership を判定しない。
- migration ownership metadata は利用可能な catalog を有効化するためだけに使い、特定 Tool の強制選択、authorization、引数補完には使わない。
- Write prepare対象でも、必須情報不足、対象不明、未対応write、複数の独立writeを1件へ安全に分解できない場合は zero Tool とし、値を補完せず follow-up する。

Write prepare runtime の hard bound は、1 user request あたり `model calls <= 1`、`Tool calls <= 1`、`prepare calls <= 1`、`execute calls = 0` とする。1回の発話から複数の独立write候補を作らない。

### Command-aware confirmation

confirmation は Home 専用 DTO を一度に置換せず、次の command-aware envelope へ加算的に拡張する。

```json
{
  "required": true,
  "confirmationId": "uuid",
  "command": "pet.health.record",
  "subject": {
    "kind": "pet",
    "id": "popio",
    "label": "ぽぴお"
  },
  "summary": "朝ごはん20g・完食で記録する",
  "expiresAt": "2026-08-19T10:05:00+09:00"
}
```

- `command -> required capability` は server-side fixed registry で解決する。AIとclientは capabilityを指定しない。
- confirm request は `confirmationId` と同一write requestに結び付く `clientRequestId` だけを送り、business payloadや`command`を再送して正本にしない。
- server-side confirmation state は、少なくとも `homeId`、`memberUserId`、`deviceId`、`command`、正規化済みprepared payload、`createdAt`、`expiresAt`、idempotency情報を保持する。
- confirm時はactorを再resolveし、same home / same member / same device と、registryがcommandから解決したcapabilityを再検証する。
- TTLは既存Homeと同じ5分とし、期限切れは `CONFIRMATION_EXPIRED` でexecuteしない。
- confirmation orchestrationは同じconfirmationの再confirmで同じ結果を返し、Domain writeは同じ`clientRequestId`で重複writeを防ぐ。この2層のidempotencyを混同しない。

既存Home commandは `roomLabel` を含む現在のresponse shapeを維持し、`subject: { kind: "room", id, label }` を加算的に提供できる compatibility layerを置く。既存consumerが`roomLabel`を読む間は削除・renameしない。Pet commandは`subject`を必須とし、`roomLabel`へ偽装しない。

### Write request ID

- Manual UI は保存操作開始時にUUIDを生成し、同じnetwork/save retry中は保持する。成功後、またはユーザーが内容を編集して新しい保存を始める時に破棄して新規発行する。内容からUUIDを決定しない。
- Agent writeはserver / trusted boundaryでIDを確保し、Tool引数へ出さず、prepare、confirmation、executeを通して同じIDを保持する。modelに生成させない。

## 段階移行計画

Phase 1 は次の順序で限定的に導入する。

1. Weather read
2. Calendar read
3. Home read
4. 複数 Read Tool の組み合わせ
5. Home prepare

Phase 1 の write 対象は Home prepare までとし、確認と execute は既存の Aircon `prepare / confirm / execute` の仕組みを再利用する前提で別途設計・検証する。

Phase 2 の正式名称は **`Phase 2 — Pet Health Read / Write Prepare`** とする。Phase 1内の未使用subphase番号は、正本で定義されていないためPet Healthへ推測で割り当てない。

Phase 2 は次を対象とする。

1. `pet.health.getDailySummary` のRead Tool Calling
2. `pet.health.record` のWrite prepare Tool Calling
3. command-aware confirmation envelopeとcommand別capability再検証
4. confirmation後の別requestによるPet Health Domain execution

Pet Healthはlegacy Intent Contractへ追加せず、新しいTool Calling型domainとして導入する。Tool失敗時のlegacy fallback、同一requestでの新旧二重実行、同一`agent.chat` request内のexecuteは禁止する。Phase 1のmulti-tool selector coverage問題はPhase 2へ混ぜない。

### Pet Health のデータ配置

Human HealthとPet Healthはnamespace、schema、service、authorizationを論理分離する。MVPの物理保存先は既存Health Spreadsheet内の専用Sheet `Pet_Health_Events` と `Pet_Health_Request_Log` とする。Human Healthの既存SheetへPet用の列を追加せず、Human Health serviceのslot modelや`targetUserId`をPet Healthへ流用しない。

この配置は、追加Spreadsheet property、service secret、GAS deploymentを増やさずMVPの運用負荷を抑えるための決定である。同一Spreadsheet障害の影響をHuman/Petで分離できないこと、およびPet単独restoreが難しいことは受容する。将来の物理分離は、論理contractを維持したまま別migrationとして判断する。

### Observability

Phase 2の候補stageは `TOOL_SELECTION`、`WRITE_PREPARE`、`CONFIRMATION_READY`、`CONFIRMATION_RECEIVED`、`ACTOR_REVALIDATED`、`COMMAND_AUTHORIZED`、`WRITE_EXECUTE`、`WRITE_COMPLETED` とする。既存Traceの汎用 `event` / `stage`、call count、elapsed、`toolNames`、`executionPath`、`resultStatus` で表現し、Phase 2設計だけを理由にTrace headerを追加しない。

Traceには健康内容、note、raw request / response、prepared payloadを保存しない。safeなevent metadata、固定code、stage、reason、size、elapsed、request-id suffix、Build IDだけを許可する。

## 維持する制約

- PWA / Mini / GAS / PALURU_OS / Domain Service の境界を原則維持する。
- actor / auth の解決と認可判断を Agent に移さない。
- Tool 失敗を成功として扱わず、暗黙の fallback で隠さない。
- legacy Intent Router の撤去時期は、domain ごとの移行と受入結果を確認してから別 ADR または移行計画で決定する。

## この ADR の非対象

この ADR では、以下を行わない。

- コード変更
- deploy
- 実データ変更
- AGENTS.md の変更
- `.js` / `.html` / `.css`、manifest、`.clasp.json`、Script Properties、Spreadsheet の変更
- Tool、API、UI、Domain Service の実装
- 既存Read runtime、Home control behavior、Aircon実操作契約の変更

本書は段階移行のArchitecture Contractを記録する。Phase 2の実装、デプロイ、受入試験の完了を意味せず、それらの実施を承認するものでもない。
