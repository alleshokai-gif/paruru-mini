# PALURU Read Transport V2 — Phase 1 release plan

## Scope and invariant

Phase 1 prepares direct authenticated reads for KazOS Projects and Work only.
The target read flow is:

```text
PWA -> Cloud Run / approved Worker -> read sources
```

GAS is never a transit proxy in the target flow. It remains an endpoint for
Google-native integration, persistence, writes, and administration. TODAY,
INBOX, Answer, Calendar mutation, registration/link, Home mutation, Health
writes, and Dynamic Daily Planning V2 are outside this phase.

## Implemented local contracts

- `GET /v2/read/projects`
- `GET /v2/read/work`
- Firebase token verification on every request, including revoked/disabled
  checks, issuer, audience, expiry, auth time, and Google provider.
- Server-owned actor/membership mapping and Kaz owner/admin authorization.
- Successful actor resolution may use an instance-local positive cache with an
  8-second default TTL, 30-second hard maximum, identity-hashed keys, and 128
  entry bound. Failures are not cached; writes never use this cache.
- Exact-origin CORS, per-verified-subject rate limit, opaque request ID, safe
  timing headers, private-data-free logging, and zero writes.
- PWA modes `GAS` and `DIRECT_V2`; the committed default is `GAS`.
- `DIRECT_V2` has no same-request GAS fallback and no dual read.

## Performance gate

The earlier Projects PoC evidence is warm median 1030.7 ms, p95 1738.6 ms,
and 0/30 failures. It proves the architecture direction, not the Phase 1 Work
endpoint.

Before production canary approval, use one Human-authorized non-production
deployment and real Firebase sessions to record:

| Route | Samples | Median target | p95 target | Failure target |
|---|---:|---:|---:|---:|
| Projects | 30 warm | <= 1.2 s | <= 2.0 s | 0 |
| Work | 30 warm | <= 1.2 s | <= 2.0 s | 0 |

Actor/membership target: p95 below 750 ms and zero events above 3 seconds per
30 warm requests. Cold samples are recorded separately.

## Canary design

The production configuration must select a specific server-authorized canary
cohort without logging identity. Until that implementation and review exist,
the static PWA flag remains `GAS`; a global `DIRECT_V2` selection is not an
approved canary mechanism.

Canary acceptance matrix:

- valid, expired, revoked, disabled, wrong issuer/audience/provider;
- mapped active owner/admin, unmapped, inactive, and unauthorized actor;
- Projects and Work source completeness and existing DTO sanitizer behavior;
- exact-origin CORS and rate limit;
- cold and 30 warm timings per route;
- request correlation visible without token, identity, or private payload;
- TODAY, INBOX, and all writes still use their unchanged legacy route;
- Notion, Calendar, Context, Sheets, and Decision Ledger writes remain zero.

## Rollback

1. Stop new canary selection.
2. Select `GAS` for subsequent Projects and Work reads.
3. Verify auth, Projects, Work, TODAY, and INBOX on the previous route.
4. Do not replay a failed request automatically and do not touch write routes.
5. Disable the direct-read feature flag if the endpoint itself is unsafe.

Rollback is configuration/release selection only. It is not an in-request
fallback, credential change, or data mutation.

## Current release state

- Production deployment: not authorized and not performed.
- Production route: unchanged.
- Dynamic Daily Planning V2: unchanged and
  `BLOCKED_BY_TRANSPORT_BASELINE`.
- Real Work 30-sample performance gate: pending a separately authorized
  non-production deployment.
