# Acquired flyer: bounded offline OCR continuation

The live daily Collector detects editions but does not have unattended semantic
product analysis connected. The previous two-face local OCR took 320.94 seconds;
the existing production Job has a 300-second limit. This change adds a separate
explicit **offline** entry point, leaving the live Job, discovery/storage caps,
daily claims, source policies and publication unchanged.

```text
node scripts/supermarket/saved-edition-worker.mjs SOURCE.sqlite EXISTING_IMAGES_DIR NEW_LEDGER.sqlite [MAX_NEW_PASSES]
```

Use only an already-authorized local acquired-page database and existing
`p1.jpg` / `p2.jpg` originals. The worker verifies page hashes and metadata and
never copies those original images or fetches a URL. ImageMagick's transient OCR
tiles use the existing temporary cleanup mechanism. Run once for the next
pending face; repeat the same explicit command to continue. A processed face
does zero OCR on replay. Failed or incomplete runs do not replace the source DB.

The source, code and OCR plan are pinned. A changed input/code is rejected by the
existing ledger rather than silently reusing another analysis. Every successful
pass checkpoints its words, pass configuration and TSV hash, plus structured
observations in a separate SQLite transaction. A write lease prevents another
worker from starting OCR against the same ledger concurrently. Completed
observations use the existing corpus ingestion contract with exact row readback.
The default OCR has not changed for existing callers.

The worker budget is at most 280 seconds, reserving 20 seconds in a 300-second
process window. Each child timeout is capped by remaining monotonic time; pending
passes and failed passes remain distinct. This is cooperative in-process
limiting, not an OS kill guarantee. The local experiment additionally uses the
existing fixed Docker image, network disabled, read-only originals and a named
container-specific outer timeout. Measured total process times, including
startup/cleanup, must be reported separately from worker time.

## Product observations and limits

The generic parser scans all OCR lines without a selected product list. A
commercial label needs a printed parenthesized specification and matching
normalized text at overlapping positions in distinct OCR passes. Different
digits, decimals, units and Japanese letters are not erased to create agreement.
Unmatched commercial labels and all raw OCR remain in private local evidence.

The result is an uncertain **commercial name/spec group**, not a verified SKU.
Repeated OCR can repeat the same misspelling. A sale unit needs the same OCR
line; a neighbouring line/column never supplies it. Price numbers require both
explicit tax labels and currency on that product line and agreement across
reads. All prices remain reference-only. Missing prices, sale units and item
dates stay unknown; the edition interval never fills item dates. This parser
does not resolve per-day panels, member conditions, store exceptions or semantic
layout. Those gaps prevent production adoption of an unreviewed output.

The saved 51325 issue is a local test specimen (printed November 25–27), not a
new/current production collection. The earlier interactive 151-row lot is only
an evaluation reference and is never passed to this extractor. A structural
audit of all 151 rows is not independent original-product accuracy validation.

## Acceptance and rollback

Synthetic tests cover timeout/pass-limit continuation, distinct read agreement,
wrong neighbouring unit refusal, changed digits, atomic checkpoint recovery,
evidence corruption, invalid plans, exact final readback and zero OCR on replay.
Real cold timing and extracted counts are separate experiment receipts; no
product recall or price accuracy is implied by image-region coverage.

The November 27 local cold experiment used one fixed pre-final-parser snapshot:
2 passes, then the remaining 23 on the front, then 25 on the back, then replay.
Measured whole-process times were 40.960 / 130.978 / 156.451 / 2.454 seconds;
replay performed zero OCR and inserted zero rows. Both faces had full native
region coverage. It yielded only seven uncertain commercial label/spec groups,
with zero sale-unit or price associations, not seven verified products. The
final parser additionally preserves a leading Japanese letter; it was applied
to that saved cold OCR without another image/OCR call. Keep the two parser
versions and their fingerprints distinct. Source-bound names included incomplete
labels and an apparent misread, so this output is not production accepted.

No production deployment is authorized by this PR. Before proposing one, prove
the real Collector entry connection, durable continuation in its existing
authorized runtime/storage boundary, useful source-bound product/price output,
individual-day suppression and preservation of prior DB history. Keep current
storage/retention limits and original-image requirements. If these cannot fit,
report the precise missing capability rather than increasing permissions,
discarding images or treating interactive vision as unattended execution.

OCR improvement is paused after that result. The existing ChatGPT-authenticated
host vision worker is the next candidate, using its public-only input boundary.
See `supermarket-whole-corpus.md`: Draft #254 prepares IY's source-bound inputs
without starting a model. Existing per-face CLI/time limits are not USD limits
or Cloud Run 300-second acceptance. The 151 interactive rows remain a separate
local reference artifact, never unattended output or an expired production lot.

Rollback of this local experiment means stopping its own process and retaining
the isolated evidence; the source and live DBs, images, schedules and settings
were never changed. Repository content includes code, fictional tests and this
document only, never originals, OCR or real product rows.
