# ADR-001: Agent Tool Calling への段階移行

- 状態: 提案（未実装）
- 対象: PALURU Agent の相談・操作経路
- 決定日: 未定

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

既存の Aircon の `prepare / confirm / execute` は、この Write 安全境界の実装資産として再利用する。Aircon の既存契約を変更することは、この ADR の対象外とする。

## 段階移行計画

Phase 1 は次の順序で限定的に導入する。

1. Weather read
2. Calendar read
3. Home read
4. 複数 Read Tool の組み合わせ
5. Home prepare

Phase 1 の write 対象は Home prepare までとし、確認と execute は既存の Aircon `prepare / confirm / execute` の仕組みを再利用する前提で別途設計・検証する。

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
- 既存 Agent、OS、Tool、Domain Service の契約変更

本書は段階移行の設計方針を記録する提案であり、実装、デプロイ、受入試験の承認を与えるものではない。
