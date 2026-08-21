# ADR-002: Hermes Evaluation and PALURU Bounded Runtime Freeze

- Status: ACCEPTED
- Decision date: 2026-08-21
- Scope: PALURU Agent runtime strategy; this ADR does not change deployed code,
  provider configuration, or domain contracts.
- Hermes audit target: v0.20.4, commit
  `c1e25cadffe539b058816be5fdfc9127d7199fa4`
- Existing Hermes provider-operation record: OpenAI Codex OAuth, ChatGPT/Codex
  subscription, and GPT-5.6 Sol. Those routes were outside the Direct OpenAI
  Bridge execution check.

## Context

PALURU should spend engineering effort on its family-specific value rather than
on generic agent infrastructure:

- PALURU UI / UX and character/personality
- Family UX, Popio, and Nurse Okan
- Home, Finance, and other domain capabilities

The guiding principle is:

> Keep PALURU-specific value in PALURU, and do not build generic Agent
> capabilities when a safe external boundary removes that responsibility.

Hermes adoption is not itself a goal. This record evaluates whether Hermes
could reduce PALURU-owned generic runtime work without weakening PALURU policy,
authorization, guard, or domain boundaries.

## Evidence status and limits

This is a decision record based on source audits and the isolated Bridge PoC.
It is not a deployment record.

- Hermes source was audited at the commit stated above.
- The Bridge PoC's credential-free mock contract suite passed. A real Direct
  OpenAI call and Docker build/run were not executed in that PoC.
- The Weather Read Phase 1 measurements below are retained as the existing
  acceptance record. They were not rerun while writing this document.
- No claim in this ADR substitutes for a production trace, deployment check,
  or user acceptance test.

### Source evidence anchors

The following source locations make the evaluation repeatable at the audited
Hermes revision:

- `providers/base.py::ProviderProfile` is a profile dataclass.
- `agent/transports/base.py::ProviderTransport` explicitly excludes client
  construction, credential refresh, and retry from transport ownership.
- `agent/transports/codex.py::ResponsesApiTransport.build_kwargs()` imports
  `run_agent` and sets `parallel_tool_calls=True` when response Tools exist.
- `agent/codex_responses_adapter.py` imports `agent.prompt_builder`.
- `run_agent.py` loads dotenv and imports `model_tools`, terminal, and browser
  modules.

These paths are evidence for the evaluation only. They are not imported by
PALURU production code.

## 1. Hermes architecture assessment

The audit identified these primary Hermes boundaries:

- `ProviderProfile`
- `ProviderTransport`
- `ToolEntry`, `ToolRegistry`, and `Toolset`
- `SessionDB`, `ContextEngine`, and `MemoryProvider`

The following are strongly coupled to the full runtime lifecycle:

- `AIAgent` and `conversation_loop`
- MCP runtime
- Cron scheduler
- Subagent worker
- Session lifecycle

The evaluation also identified constraints PALURU must not inherit as policy:

- possible privilege expansion when MCP trust is omitted
- a Skill write gate with fail-open cases
- possible Cron Toolset resolver privilege expansion on failure
- subagent isolation that is not a security sandbox
- no exactly-once guarantee for external side effects
- no runtime-wide monetary Cost Guard
- no tamper-evident single audit ledger
- provider/model setup consistency concerns

These findings are Hermes source-audit observations. They are not claims that
PALURU currently exposes any of these conditions.

## 2. PALURU current runtime assessment

PALURU Read domains use a bounded Tool Calling runtime:

- Weather
- Calendar
- Home Read
- General

Its relevant properties are bounded model, Tool, and service calls; no
unbounded loop; no retry; no verification model call; and no direct Write
execution.

Decision: keep the existing PALURU bounded runtime. Do not expand it into a
generic Agent, Provider, Session, Memory, Skills, MCP, Subagent, Cron, or
plugin framework.

## 3. Runtime boundary retained in PALURU

`AgentRuntimePort` remains the replacement seam for a runtime implementation.
PALURU is the source of truth for identity, authorization, and execution
policy.

```text
PWA
  ↓
PALURU Mini
  ↓
Identity / Membership / Role / Scope
  ↓
Cost / Burst / In-flight Guard
  ↓
PALURU Policy
  ↓ request-specific exact Tool allowlist
AgentRuntimePort
  ↓
Runtime
  ↓ Tool Invocation Request
PALURU Policy revalidation
  ↓
PALURU OS
  ↓
Domain Service
```

The boundary rules are non-negotiable:

- actor, role, scope, capability, confirmation, and all guards are PALURU
  authority; runtime-returned identity data is untrusted.
- only a request-specific exact Tool allowlist may be exposed to a runtime.
- a runtime must not call PALURU OS directly.
- Tool invocation must pass PALURU Policy again before OS/domain execution.

## 4. Weather Read Phase 1 acceptance record

Weather Read was selected because it is read-only, has a narrow Tool schema,
contains relatively little personal data, is easy to roll back, and can be
compared with the prior path.

`CurrentRuntimeAdapter` places the existing bounded runtime behind
`AgentRuntimePort`. The recorded acceptance values are:

| Field | Recorded value |
| --- | --- |
| Runtime variant | `current` |
| Model calls | 2 |
| Tool calls | 1 |
| OS calls | 1 |
| Selected Tool | `weather.getForecast` |
| Post-runtime Policy | passed |
| Trace | Tool argument hash and correlation recorded |
| External Weather behavior | unchanged |

Phase 1 decision: **ACCEPT**. The current bounded runtime remains the only
selected runtime variant for this path.

## 5. Hermes full-runtime assessment

Hermes `AIAgent` / `conversation_loop` is not adopted for PALURU because its
normal operating model is broader than PALURU's bounded safety model:

- iteration control is broader than PALURU's limits
- retry and fallback paths exist
- grace-call behavior exists
- the default Tool surface is broad
- strict `model <= 2`, `Tool <= 1`, and `OS <= 1` guarantees are not a
  natural full-runtime contract

Decision: **NO-GO** for the Hermes Agent runtime in PALURU production.

## 6. Hermes Provider-component Bridge assessment

An independent `hermes-runtime-bridge` PoC evaluated Hermes as a Provider
component library rather than as an Agent runtime.

```text
Test Client
  ↓ HTTP
HermesRuntimeBridge
  ↓
Hermes Responses conversion / normalization
  ↓
OpenAI Responses API
```

The PoC used `convert_messages`, `convert_tools`, and `normalize_response`.
It exposed only `weather_getForecast`, converted that to the canonical
`weather.getForecast` invocation, and never executed the Tool.

The mock contract suite demonstrated:

- exactly one model call per request
- `parallel_tool_calls=false`
- no retry, fallback, verification call, or Tool-result second call
- structured errors and rejection of multiple Tool calls
- provider/model configuration owned by the server
- no initialized default ToolRegistry, terminal, browser, or Agent loop

The following Provider-component limitations prevent adoption:

| Component | Finding |
| --- | --- |
| `ProviderProfile` | Declarative profile only; no client lifecycle, credentials, retry, or request dispatch. |
| `ProviderTransport` | Request conversion and response normalization only; client lifecycle remains external. |
| `ResponsesApiTransport.build_kwargs()` | Imports the Hermes Agent root and normally enables `parallel_tool_calls=True` when Tools exist. |
| Codex Responses adapter | Pulls prompt builder, message sanitization, utils, and PyYAML transitively. |

The Bridge therefore required its own HTTP endpoint, validation, budget
control, error mapping, OpenAI client construction, server-owned provider
configuration, exact Tool allowlist handling, retry prohibition, and parallel
Tool-call prohibition.

PoC size:

- Bridge: approximately 338 LOC
- Contract tests: approximately 170 LOC
- Direct Hermes dependency: 3 components, with prompt/sanitization/utils
  transitive dependencies

Decision: **NO-GO** for Hermes Provider components as PALURU's production
Provider foundation. The component reuse does not materially remove enough
PALURU-owned code or upgrade responsibility.

## 7. Architecture decision

PALURU bounded runtime is **KEEP & FREEZE**.

This means:

- do not integrate Hermes Agent or Hermes Provider components as PALURU
  runtime dependencies.
- do not build a generic Agent Framework, Provider Framework, Session
  Framework, Memory Framework, Skills Package Manager, MCP runtime, Subagent
  orchestration, generic Agent Cron, or plugin framework inside PALURU.
- preserve `AgentRuntimePort` only as a strict PALURU-owned boundary, not as a
  commitment to add another runtime.

When a new generic capability is proposed:

1. assess whether an OSS product or service can be used across a narrow
   boundary;
2. confirm PALURU Policy and authorization remain authoritative;
3. quantify whether PALURU-owned implementation and operations truly shrink;
4. otherwise implement only the minimum domain-specific capability required.

## 8. Stop-building principle

> The purpose of OSS is not adoption. It is to increase the responsibilities
> PALURU does not need to build.

If using OSS requires PALURU to build a new runtime, authentication system,
Bridge, monitoring system, or operations platform around it, that adoption
contradicts the purpose.

## 9. Product focus

Development focus returns from “Build Agent” to “Build PALURU”:

- PALURU UI / UX
- PALURU character and personality
- Family UX
- Popio and Nurse Okan
- Home and Finance
- family-facing domain capabilities

Generic Agent technology is not PALURU's competitive value; the family
experience and domain behavior are.

## 10. Retained reference material

`C:\Users\alles\hermes-runtime-bridge` remains an isolated, non-production
reference. It may be used for future Hermes upgrade checks or comparisons with
other Agent OSS products. Hermes itself is not a PALURU runtime dependency.

## Decision

**Hermes Agent and Hermes Provider components are not adopted for the PALURU
production runtime.**

**PALURU bounded runtime is KEEP & FREEZE, and generic Agent-platform work is
stopped.**

**Engineering effort returns to PALURU-specific family value.**
