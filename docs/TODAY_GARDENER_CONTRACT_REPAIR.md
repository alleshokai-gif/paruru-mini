# TODAY snapshot reader compatibility repair

## Scope and evidence before implementation

- At 2026-11-17 23:07 JST the browser showed TODAY retrieval FAILED. At 23:20 a fresh browser displayed the live daily plan while explicitly withholding progress controls because the V3 snapshot was unavailable.
- GCS current and last-good snapshots validate against the deployed gateway contract. Current source generation is 22:32 JST, and the relevant sources are unexpired at observation. WorkBusy expires at midnight; this repair must not extend that deadline.
- Replaying the current immutable snapshot through the exact deployed Mini reader (`e90db024`) rejects with `V3_SNAPSHOT_CONTRACT_INVALID` at `DIRECT_CONTRACT_VALIDATION`. It contains ten `GARDENER_IMPROVEMENT` confirmations, omitted from Mini's allowlist although gateway `28e21f37` already supports them.
- The original FAILED screen may also involve the independent live-plan request. Its historical failure code is not available; the deterministic snapshot rejection does not prove that request's cause.

## Repair and acceptance plan

Mirror only the four already accepted Gardener human-review kinds from the existing server contract. Preserve pending-only validation, unknown-kind rejection, source status and expiry, read budgets, authentication and write boundaries. No server/source/schedule changes. Bump the PWA build and changed reader asset URL through the existing network-first update path.

Regression checks cover dashboard and inbox, all four kinds, unknown kinds, non-pending rows, unchanged stale/degraded metadata, and existing transport/navigation/PWA suites. Replay the same private snapshot before and after without committing its contents. Production acceptance must confirm the deployed build and TODAY plan/progress presentation against the unchanged canonical snapshot; local replay alone is insufficient.

Rollback: revert only this frontend commit through normal protected-branch checks if acceptance fails. Retain current server revisions, #348, GCS snapshots, reservations and metrics. Do not restore old server images or alter expired source timestamps.

This is independent of the valid 23:00 night skip and WI-50 acceptance. Existing WI-60 Draft #98 addresses stale display and remains untouched; this repair concerns previously accepted current snapshot review kinds.

## Local verification

- Exact private current-snapshot replay: deployed reader rejects once with `V3_SNAPSHOT_CONTRACT_INVALID`; repaired reader accepts once with HTTP 200 / `DIRECT_COMPLETE`. No network, real auth or write occurs in the replay.
- Related transport, navigation, diagnostics, PWA update, service-worker, personal/progress/time-fit and required bus/family suites: 35 Node test entries pass (the transport entry includes the new positive and negative contract assertions).
- Two historical tests (`kaz-v3-degraded-today`, `kaz-v3-inline-preview`) fail identically in a clean archive of deployed `e90db024` and the repair tree. They are baseline display/fixture mismatches; their production files are unchanged. They are not represented as passing.
- JavaScript syntax and whitespace checks pass. Original CRLF files retain their line endings.
- Production deployment and real-browser acceptance remain pending at this record's creation.
