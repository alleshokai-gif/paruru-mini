# Issue #240: six-screen contract and mobile acceptance

Scope: PALURU PWA consumers, bounded source diagnostics and mobile presentation.
Cloud Run, Windows Controller, Portal GAS and ingestion belong to kaz-context #382.
No credentials, private payloads or Saved bodies are included here.

## Independently observed before changes

- Main baseline: b9b606e. Isolated branch: codex/issue240-contract-ui.
- Authenticated production WORK failed with `V3_SNAPSHOT_CONTRACT_INVALID`, stage
  `DIRECT_CONTRACT_VALIDATION`. Authentication session resolution succeeded.
- The private canonical V3 snapshot generated 2026-11-21 22:00:25 UTC read as
  CURRENT at 23:36 UTC. Its Work/Projects/CAPA sources were current and contained
  66/15/9 rows. This does not itself prove that the production HTTP response is
  byte-identical, nor that the browser accepted it.
- The snapshot contained ten `GARDENER_IMPROVEMENT` confirmations. Main's shared
  client validator rejects that existing server kind before any of the three
  tabs render. Existing PR #217 already implements the bounded compatibility
  repair and positive/negative regression coverage. Reuse that dependency;
  do not create a competing producer, bypass validation, extend TTL, or use a
  legacy API as a workaround.
- Reused exactly the validator and positive/negative tests from PR #217 commit
  279a43ffc59d56c6440b6448ca8e33df25c881d1 on the current main baseline. Its old
  build, index and service worker were not copied. The #239 badge correction is
  retained. Do not merge the stale #217 branch separately without reconciliation.

## Saved and legacy Raw are separate populations

Read-only canonical checkout census on 2026-11-22 JST: 1788 Saved markdown
records; 583 have Classification metadata and 1205 do not. Recognized classes:
Decision216, Pain38, Preference67, Lesson25, Project147, OpenQuestion28,
Experience58. Other classes4, missing1205. Exact body duplicate excess0.
1632 have a recorded date, 156 lack one; a future-dated record exists and must
not be treated as a fresh ingestion success. These are repository observations,
not live coverage or search-utilization telemetry. Semantic duplicate detection,
latest successful live ingestion, resolver hits and misses remain unobserved.
Legacy Raw Decision/Pain/Lesson are not this Saved classification breakdown.
Production UI must never promote this fixed census into live metrics.

## Acceptance boundaries

Use only synthetic fixtures for shared browser tests and Claude sessions.
Check 360/390/430px, normal/loading/empty/partial/failed/stale states, disclosure
operation, text wrapping and bottom-navigation clearance. The local fixture
harness is supplementary; real navigation and authenticated production
acceptance are separate gates. No device-hardware acceptance is claimed.

Rollback: revert only this PWA commit through the normal protected PR path.
Keep source snapshots, reservations, auth, budget and server deployments intact.

## Implemented subset and evidence

- Unified decision/reason/evidence/next-owner summaries; missing evidence stays
  unobserved. CODEX_RUNNING alone never proves an actual executing task.
- Saved and legacy Raw are separated; missing Saved categories, growth,
  deduplication and search telemetry are displayed as unobserved.
- Partial denominators, inconsistent counts/values, and samples below five are
  held for evaluation. Five is an explicit conservative UI reporting threshold,
  not a producer or authorization gate. Period and trend controls are retained.
- Failure codes/timestamps cross the adapter through a bounded allowlist, with
  no copying of provider exception text. Mobile detail tables have vertical,
  labeled records. Existing write/approval routes are unchanged.
- PWA release: v20261122-kaz-six-screen-v1; build.js/index.html/sw.js agree.
- Actual Claude Pro UI session: 4fcd0fd3-77f0-4670-a6b3-0e32b8ad1952.
  Disjoint metrics UI session: af1c5ce9-a790-45d9-85b1-e9f77b4d97aa.
  Only sanitized code and synthetic fixtures were supplied.
- Independent Claude review: 69ebdd8f-a196-4aaa-97fc-ca06fd788223. Initial FAIL
  identified an unobserved night falsely displayed as all-clear. Corrected with
  explicit unknown decision/record-owner states and regression assertions;
  re-review PASS at patch fe47ea736a6304aaec2ba26d671fec3af56a401e99b71e0253589981bb057674.
  Its remaining nonblocking missing-confirmations note was also corrected using
  the reviewer's suggested explicit unobserved branch. Codex independently
  reviewed the UI and integration. Review did not execute tests or browsers.
- Local related Node verification: 33 test entries PASS, including required
  bus/family checks, transport, autonomous outcomes, view navigation, scoped
  diagnostics and PWA update/service-worker behavior. Syntax and diff checks PASS.
- kaz-v3-degraded-today's NOW/NEXT assertion fails with the baseline adapter too;
  the prior #217 record also identifies kaz-v3-inline-preview as baseline-failing.
  Neither is represented as passing or silently rewritten.
- Actual Chrome synthetic fixture checks: 6 screens x 5 states x 3 measured
  widths (360/390/430) = 90 cases; no horizontal page overflow or error text.
  All 18 loading cases observed. Expanded detail table with 11 labeled cells
  fits all three widths without internal horizontal scrolling. Screenshots of
  all six screens at all three widths were saved locally using synthetic data.
- Read-only Actions budget observation before PR: $8.71 / $15, displayed
  headroom $6.29. Shared-account usage is not attributable to this task. No
  billing/auth/permissions settings were changed and no paid API fallback used.

## Outstanding acceptance

No production deployment or mobile-hardware acceptance is established by the
local checks. Current production still displays the old build and rejects the
Gardener confirmation kind. Normal protected-branch integration, deploy
readback, authenticated production six-screen/API comparison, clean-profile
acceptance and installed-PWA update without cache clearing remain separate
gates. No GAS Web App deployment is performed by Codex.
