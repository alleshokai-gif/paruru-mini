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

The Human-authorized non-production measurements passed the Phase 1 gate:

| Route | Samples | Browser median | Browser p95 | Failures |
|---|---:|---:|---:|---:|
| Projects | 30 warm | 683.9 ms | 965.2 ms | 0 |
| Work | 60 warm | 301.7 ms | 567.1 ms | 0 |

Both routes are `GO` against median <= 1.2 seconds, p95 <= 2.0 seconds, and
zero failures. This evidence is non-production and is not production browser
acceptance.

## Canary design

The owner canary used `mode=DIRECT_V2` and the dedicated direct-read base URL.
Direct transport was selected only when the active server-owned membership had
role `admin` and the existing owner-only `home.control` capability. A member ID
was neither committed nor logged. The first real-browser set failed closed with
`HTTP 401 / AUTH_TOKEN_INVALID` for both Projects and Work, with no silent GAS
fallback and no dual read. The PWA flag was therefore returned to explicit
`GAS` mode pending authentication-boundary RCA.

The backend release target is the dedicated Cloud Run service
`paluru-read-transport-v2`, not the measured PoC service and not the existing
`kaz-os-read-gateway`. Its deployment contract is
`tools/kaz-os/deploy/read-transport-v2-canary.json`. Direct-only mode exposes
health plus Projects/Work GET and CORS preflight only; legacy `/v1/*` and the
PoC route are unavailable. The manifest pins the immutable release image
digest. The actual revision remains empty until the Human deploy step; a tag
or old PoC image cannot be treated as the production candidate.

Canary acceptance matrix:

- valid, expired, revoked, disabled, wrong issuer/audience/provider;
- mapped active owner/admin, unmapped, inactive, and unauthorized actor;
- Projects and Work source completeness and existing DTO sanitizer behavior;
- exact-origin CORS and rate limit;
- cold and 30 warm timings per route;
- request correlation visible without token, identity, or private payload;
- TODAY, INBOX, and all writes still use their unchanged legacy route;
- Notion, Calendar, Context, Sheets, and Decision Ledger writes remain zero.

Run at least three real-browser sets in this order: auth, Projects, Work,
TODAY, INBOX, and Diagnostics. Projects and Work must report `DIRECT_V2`;
TODAY and INBOX must report `GAS`; writes remain `GAS`. Projects and Work each
require p95 below 2 seconds, zero failures, and zero timeouts.

## Fixed release order

1. Deploy the immutable image to the dedicated direct-read service.
2. Run backend health, authentication, authorization, CORS, and method smoke.
3. Deploy the PWA release while its committed/default mode is still `GAS`.
4. Run the default GAS regression smoke.
5. Assign the server-owned canary capability to the one approved Kaz owner and
   release the explicit `DIRECT_V2` configuration.
6. Run Projects and Work real-browser acceptance and performance measurement.
7. Continue the canary only while the acceptance gate stays green.

## Rollback

1. Stop new canary selection.
2. Select `GAS` for subsequent Projects and Work reads.
3. Verify auth, Projects, Work, TODAY, and INBOX on the previous route.
4. Do not replay a failed request automatically and do not touch write routes.
5. Disable the direct-read feature flag if the endpoint itself is unsafe.

Rollback is configuration/release selection only. It is not an in-request
fallback, credential change, or data mutation.

## Current release state

- Production deployment: not performed.
- Immutable backend image: built and pinned in the deployment manifest;
  dedicated service revision: not created because deploy has not occurred.
- Production route: unchanged.
- PWA rollback release: `GAS` for all members after the first owner-canary set
  failed closed at the direct backend authentication boundary.
- Dynamic Daily Planning V2: unchanged and
  `BLOCKED_BY_TRANSPORT_BASELINE`.
