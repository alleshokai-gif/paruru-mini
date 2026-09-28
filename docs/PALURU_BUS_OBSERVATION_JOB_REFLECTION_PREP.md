# Observation Job reflection preparation (2026-09-28 JST)

This is a separate Acceptance track. No Cloud Build, Job update, Scheduler update, Sheet write, or force-run occurred in this phase. Read-only Cloud Run metadata in `paluru-bus / asia-northeast1` was compared with the local source.

| Job | Current digest (read-only) | Local change / next validation |
| --- | --- | --- |
| `paluru-bus-observer` | `sha256:3514b8b253d0dc1b59bb359c78fa520f088e3b8b4f0599368131d6f783ed44b9` | No collector change in the 15 commits; leave image and settings intact. |
| `paluru-bus-preorigin-observer` | `sha256:d00b095185a1cf22c56357b942cff8f3ecaaf8e693c734e26827b5f5f3af9ed6` | `preorigin-schema.js` observation-ID canonicalization changed. Existing `cloudbuild.preorigin.yaml` / Dockerfile include the file. New image smoke, digest pin, then natural-run duplicate check are needed before promotion. |
| `paluru-bus-preorigin-evaluator` | `sha256:4ba075d12ec97fbed5eb1408355da49b2cd3b35f01a19cf01e764a4bea27ef3f` | `preorigin-evaluator.js` separates zero-row samples from missing samples. Existing `cloudbuild.preorigin-evaluator.yaml` / Dockerfile include the changed source. Validate the source and evaluator images together against saved day evidence before updating either Job. |
| `paluru-bus-position-evaluator` | `sha256:37421075b1f59465865539e7097f441869c4a14ed4100c863d01bd645dd4830d` | Daily no longer claims multi-day insufficiency. `position-accumulated.js` is pure evaluation only and is not connected to the Job. This checkout has no Position evaluator Dockerfile/Cloud Build definition; deployment packaging and an accumulated output contract require a separate reviewed change. Do not deploy this source as if accumulated evaluation were already running. |

The observer/preorigin collector runtime SAs remain `paluru-bus-observer@paluru-bus.iam.gserviceaccount.com`; the evaluator SAs remain their dedicated existing accounts. Read-back checked image and environment-variable **names only**, never Secret values. The Preorigin/Position evaluators have no ODPT or HMAC environment variable names. No IAM or Sheet sharing was changed.

Reflection acceptance before a future Job update: preserve the existing service accounts, Secret references, sample window, scheduler cron, Sheet schema, and current image digest until a new pinned digest is built. Verify the observation ID collision cases, zero-row sample accounting, header exactness, duplicate suppression, and saved-day decision against a new evaluation artifact. Then update one Job at a time, read back its digest/config, and let its next natural schedule run. Keep collection and evaluation releases separate. Existing Raw rows must not be rewritten.

Position accumulated evaluation is **not Job-ready** in this checkout. Public geometry remains `approvedForPublic=false` and `geometryReady=false`. Level C remains manual-only; Public Position and departure prediction remain OFF.
