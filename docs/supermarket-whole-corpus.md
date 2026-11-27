# Whole-flyer observations (#219, incomplete acceptance)

## Rosen public whole-issue path (acceptance pending)

The public Taira store viewer exposes product cards for each date/category, including household items. The new adapter discovers every currently active issue from the normal store landing page and visits the complete date/category matrix. It does not select products or call a hidden API. Exact identical card text is deduplicated while every source date/category/ordinal remains in private evidence. Printed net and tax amounts are parsed independently; missing/unclear fields stay unresolved. All rows remain `needs_review`, outside confirmed offers and menus.

The existing Collector and private SQLite/GCS keys are reused. A separate create-only daily `-rosen` claim precedes source requests; existing failed claims are never replayed. Each completed view is saved privately before later views, and incomplete views do not become complete issue caches. A 180-second acquisition deadline leaves time within the existing 300-second Job to persist outcomes. Essential HTTP failures, unsettled product DOM and empty views without an explicit publisher empty-state stop acquisition. A new issue is discovered by its actual store link; the same issue/index fingerprint reuses saved complete views. Undetectable same-URL changes without index metadata changes remain a limitation.

REP is checked from a provenance-backed cached observation. Missing/expired observations stop with **zero requests**. Previously denied robots URLs are not retried by this adapter. A fresh unavailable robots response does not authorize private/protected content. This intentionally does not prove indefinite unattended daily operation when the observation expires; any policy refresh requires a separately permitted path.

Multiple issues use a bounded catalog bundle. Gateway/LINE consumer support must be deployed before this Collector flag is enabled. Source acquisition time remains unchanged on offline reanalysis; analysis time breaks freshness ties. Expired Rosen issues leave the current public projection but immutable history remains in SQLite. If the existing 480-KiB reader budget is approached, whole issues are omitted explicitly, keeping the existing OK issue preferentially; private evidence remains complete. No IAM, credentials, public access, cron or LINE-send behavior changes are required. Rollback is the previous pinned image plus the previous feature flag; claims/evidence are retained.

Acceptance requires exact private DB and latest-object readback, source/view counts, authenticated issue/category/row display and source-free same-day duplicate execution. Local tests or a merged PR alone do not establish those outcomes. Whole-paper image extraction for the other four stores and a daily image-model lane remain unfinished.

The previous three fixed OK crops were a connectivity test, not whole-paper extraction. Their production entry points and SKU/crop array are retired. Existing persisted confirmed offers, shopping, other store paths and create-only daily claims remain compatible. A new OK issue without a whole-image worker result is `needs_review / OCR_WHOLE_READER_NOT_CONNECTED`; it cannot silently fall back to three products. `identifyEdition.pages` enumerates official Kanto front/back assets instead of counting one PDF page as one printed face.

## Observation and recommendation are separate

`whole-corpus-store.mjs` appends typed immutable observations to the existing private SQLite, retaining nonfood, services, reservations, variants, unpriced products, examples and uncertain rows. All rows are `needs_review`. Neither confidence nor matching numbers promote a current sell price. Extra model fields, prompts and execution metadata stay outside the catalog DTO.

The optional snapshot `corpus` is shown after existing household authentication in a folded **全紙面のAI読取（条件未照合）** list. Reading values and proposed conditions stay visibly unverified, outside `offers` and menu selection. Original private evidence retains proposed coordinates, all raw observations, source hashes, executions and unresolved reasons. Original images are not redistributed; UI links to the publisher PDF.

## Reproducible host workers

Offline OCR uses ImageMagick, Tesseract and Node SQLite:

```sh
node scripts/supermarket/whole-flyer.mjs manifest.json private-new-run
node scripts/supermarket/whole-flyer.mjs --resume manifest.json old-run new-run
node scripts/supermarket/whole-flyer.mjs --reindex old-run new-run
```

Every face has full PSM11 and overlapping native 1600px tiles. Failed later passes retain earlier observations. Pixel coverage is not product recall.

`read-public-flyer-once.py` prepares every face from an already acquired, hashed official OK manifest. It requires existing local Pillow and an existing Windows ChatGPT-authenticated native Codex CLI; it creates no login, key or service.

Draft #254 adds a separate `prepare-iy` command for the saved official 00521
edition: read-only discovery metadata, two saved face records, existing image
SHA/size and canonical document checks are mandatory. The normal `prepare`
command remains OK-only. IY's explicit 48MP maximum does not raise OK's 24MP
limit; both retain the 50-attachment per-face bound. IY preparation pins all
model-input files (including prompt/schema/overview) for verification before
`run`. This extension is local preparation, not approval to transmit new source
scope and not an enabled unattended daily lane.

```sh
python scripts/supermarket/read-public-flyer-once.py prepare-iy saved-source.sqlite existing-images new-private-input
```

On November 27, saved 51325 prepared 25 images per face (50 total), with no
model invocation or source request. The installed native CLI was 0.149.0 and
reported an existing ChatGPT login; Pillow and the required CLI flags were
available. No credential/config values were inspected. Current model availability,
subscription quota, provider HTTP retry count, incremental USD and any hard USD
cap were not verified. Do not describe those unknowns as zero or bypass the
source gate. The earlier documented four model runs are historical OK evidence,
not IY or current daily acceptance.

```sh
python scripts/supermarket/read-public-flyer-once.py prepare manifest.json private-new-input
python scripts/supermarket/read-public-flyer-once.py run private-new-input/front
python scripts/supermarket/read-public-flyer-once.py run private-new-input/back
```

Each face starts one CLI process, with tools/apps/plugins/history disabled, allowlisted environment and a 900-second native process deadline. A durable started file prevents retry in the same directory. Timeout is unknown outcome, never automatic resend. Provider-internal HTTP retry count and incremental USD cost are not exposed. **This is a host worker, not an enabled Controller or Cloud Run daily image-model lane.** No credentials are copied to cloud. Existing 08:15 JST schedule/IAM are unchanged. Automatic next-issue extraction and the other five whole-paper adapters are unfinished.

## First whole-issue evidence (2026-11-20)

Official OK Kanto 11/16–22 issue: [PDF](https://ok-corporation.jp/media-download/1764/f75516cf12ff8d76/PDF/), [front](https://ok-corporation.jp/archives/001/202611/0bf5efc12c2c08a6.jpg), [back](https://ok-corporation.jp/archives/001/202611/5c12e59855dd6af0.jpg). One physical PDF page contains two logical faces. Both native 5264×3693 JPEGs were read without product selection or QA answers as input.

Four noninteractive existing Codex vision workers completed: primary faces (`gpt-5.6-terra`), whole-source review (`gpt-5.6-sol`, conditioned on machine predictions), and blind conditions (`gpt-5.6-terra`). Total 106 image attachments, 314,880 input / 46,678 output tokens. Earlier unsupported-model attempt returned `model_not_found` without a result. No new key or paid API call was used; attributable USD cost is **unknown**, not measured zero.

Source-only machine corrections yield 58 reading frames (29/29), including three nonproduct notices. Blind conditions retain 19 notes and three unresolved associations. These are not 58 confirmed products.

Independent original QA was fixed before results were inspected. Its separate denominator is 55 offer groups / 63 named entries, including variants, services and examples. Machine output covers 55/55 groups and contains 63/63 names somewhere, 62/63 as structured names (one service variant remains in conditions). All 128 normalized numeric facts match: 90 sale-price pairs, 18 reference prices, 20 discount facts. This is not 128 sale products. Known units match 47/47. Raw price-role classification matches 126/128.

Full information matches only 10/63 with explicit item dates, or 29/63 allowing document-period inheritance. Adding the QA geometry criterion reduces these to 5/63 and 9/63. Store footnote association, date semantics and geometry remain unverified. Full-price acceptance, daily next-issue acceptance, six-store coverage and real LINE input acceptance remain incomplete.

Private originals, receipts, SHA-frozen model output, blind QA and SQLite readback are retained outside Git. Deployment/readback status must be reported separately from these local results.
