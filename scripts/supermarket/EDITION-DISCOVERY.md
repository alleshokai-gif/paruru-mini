# Current edition discovery (acquisition only)

IY outside the archived 18–20 November SKU template now follows official store
521 → `/flyers/00521/new` → same-store canonical edition. It stores every full
image identified by that canonical page's current title/description, excluding
older/ad thumbnails. There is no daily edition-ID, image-hash or SKU update.
Paper dates without a printed year use the current-route observation year;
they are paper metadata, never evidence of individual offer validity.

Life outside its archived 20 November template follows official east648 to
the store-224224 widget. Widget links are descriptors only: the downstream
click/show endpoints are not requested, page grouping/periods are unknown,
and no products are invented. The live metadata probe stopped before the widget
at an unsupported robots extension; cached robots verifies the parser correction.
Previously unavailable downstream routes have not been retried.

`discoverySummary(db, store, day)` reads the private acquisition ledger:

- `phase=detected` means edition metadata was detected, not complete acquisition.
- Every discovered page has `saved`, `not_retrieved` or `storage_limited` state,
  source and (when saved) body SHA/size. Partial failure keeps all descriptors.
- `analysis_state=not_connected`; product and confirmed-price counts are `null`.
  Discovery creates no confirmed editions/offers and changes no public schema.
- Same-day claims precede network I/O. Saved edition pages are not fetched again;
  HTTP 401/403/429 blocks persist across days with no alternate route.
- At most 12 requests per store attempt, including robots, bounded HTML/images,
  manual redirects and source allowlists. Our own applicable crawl-delay closes
  acquisition; an extension only for a different bot does not change our REP.

Raw pages remain private SQLite BLOBs; they are not public snapshot/PR assets.
Acquisition reserves space under a conservative 12 MiB DB budget with 512 KiB
headroom. It never deletes existing rows. This is deliberately partial when the
existing DB plus a new paper will not fit; the existing GCS body limit is intact.
Long-term full-paper retention and scheduled whole-image analysis are still
unconnected work, not a daily automated product-extraction success.

Local real-source check on 21 November 2026: official IY canonical
`https://promo.hatobase.jp/flyers/00521/1313/51034`, paper 21–24 November,
two saved/read-back images (5,249,473 and 5,847,854 bytes). The official-route
and page probes used 8 source requests in total; same-day replay used zero.
This does not prove publication at 08:15, production execution or extraction.
No cloud operation or model call was performed for this check.

## Offline partial OCR observations

`discovered-observations.mjs SOURCE_DB OCR_DIR NEW_OUTPUT_DIR` consumes saved
`p1.json.gz` / `p2.json.gz` whole-flyer OCR evidence. It checks source page hashes,
ordinals, dimensions and successful-pass geometry against reported coverage,
retains per-face coverage/failures, and saves label candidates through existing
`ingestCorpus` into a **separate** `observations.sqlite`. Output directories are
exclusive; prior input, OCR and observation DBs are never overwritten.

The product DB has no mandatory image column. The local proof keeps originals
and SHA manifests outside that DB, with raw OCR gzip evidence separate too.
Any later private GCS archive resolver must preserve the same hash/ordinal
contract and use an already authorized object path. No archive exists or new
object permission is assumed here; no GCS key, IAM or upload was changed.

The existing whole-flyer OCR supports an explicit local `maxPixels` up to 48M;
its normal 24M default is unchanged. Both saved 7510×5374 IY originals were
processed without resizing the original tile coordinates, using full-page
PSM11 plus all 24 overlapping native-resolution `jpn_best` tiles per face.
An existing local OCR image ran with pull disabled, network none, 1 CPU/1 GiB.
All 50 passes succeeded, both pixel coverages were 1; elapsed 313,918 ms.

Actual local result: front 489 / back 870 potential label rows, stored/read-back
1,359 rows, with 56 / 100 same-label agreements across OCR passes. These include
prose, ads, units and fragments and **are not 1,359 distinct products**. Another
893 / 1,130 role/low-confidence label segments and all 441 / 582 numeric regions
remain in private raw evidence. Product-region denominator and recall are unknown.
Four post-freeze source checks matched product-name text; those checks were never
extraction inputs and do not establish overall precision or verified offers.

Every candidate has source face/coordinates/reads and `needs_review`; prices
are `[]` / `unreadable`, product dates are null. Paper dates never become product
validity. Product boundary and label-price/unit/date association remain missing;
this is a repeatable local OCR/DB experiment, not scheduled extraction or safe
production pricing. It must not be deployed merely to move the image size limit.

## Built-in vision association (local acceptance only)

`vision-observations.mjs SOURCE_DB MANIFEST READINGS OCR_DIR NEW_OUTPUT_DIR`
consumes explicit built-in-vision readings and the same saved image/whole-OCR
evidence. It does not invoke a model, fetch a source or publish. The image region
manifest, image hashes, attempted regions and OCR provenance are checked. Name,
spec and unit plus overlapping position deduplicate repeated crop observations;
conflicting duplicate values stop ingestion. Approximate card bounds and OCR
numeric-presence evidence stay private. Neither caller-supplied verification nor
matching OCR digits can authorize a confirmed offer. Unknown item periods stay
null; paper dates never fill them. The existing typed corpus and reference UI
are used unchanged.

Actual 51034 follow-up used Codex's built-in image understanding: two overviews
and 24 regular overlapping 2000×2000 crops covering both originals. Exact runtime
model identifier is unavailable. 29 image-view tool calls included three images
discarded by the tool-output limit and subsequently redisplayed; 26 distinct
images were read. This was interactive included execution, not a paid model API
or proof of scheduled, noninteractive image extraction.

The readback contains 173 name/spec/unit offering rows (front 67, back 106),
161 distinct printed-name groups, including two nonfood offers. These are
structured image-associated readings, separate from the 1,359 OCR text labels.
All 173 have reference price readings; **confirmed prices remain zero**.
58 rows also have both numbers present in OCR within the approximate card;
this is a numeric crosscheck, not semantic or store/period verification.
36 rows retain an explicitly read item-period bound; the other 137 retain null
periods. Nine source/ad notes and two unresolved scope/variant regions are
separate. Unnamed variants and the true product denominator/recall remain unknown.
Lucky-box contents, points-adjusted effective prices and mix-and-match bundles
are not expanded into individually priced products.

Private product DB: 610,304 bytes, no image column, immutable readback matched.
Existing DB→snapshot→reference-renderer local acceptance displayed 173 reference
articles including price/unit and nonfood, with 0 confirmed offers/badges and
0 menu plans. This was not a production browser acceptance or production write.
Original images, real readings and DBs stay outside Git. Scheduled extraction,
archive integration, production pricing and deployment remain unaccepted.

## Source-bound lot import and Gateway contract

The explicit image-region audit uses private `vision_region_coverage`.
The shared `coverage` field is reserved for Rosen DOM views: Gateway rejects
that field on image catalogs. Image audit must not silently remove the lot
from the consumer. Explicitly read paper headers can populate each page's
`document_period_raw`; this does not populate unknown item dates.

The existing `ingestCorpus` private-DB append path already supplies immutable
idempotency; no new import command, publisher or service is needed. Collector's
`verified-import` command is for confirmed OK offers and must **not** be used
for this reference lot. The compact private 51034 artifact is 225,224 bytes,
SHA256 `1daa807bf7a8ca97af17ab979a3b7a06a06490edda87fe0e86cda9964d5dd963`.
No image bytes are required. All 173 item objects and original source revision /
acquisition time are unchanged from the image readback; explicit paper headers
and private image audit are separate from item-period trust.

Local acceptance used a synthetic six-store 842-row DB and the real public lot:
842→1,015 private rows, duplicate import +0, all prior corpus/status/editions/
OCR tables preserved. Three synthetic confirmed offers and their menu results
were unchanged; added IY confirmed offers remained 0. The 173 target rows were
all projected (67/106), snapshot 332,135 bytes, prepared DB 1,130,496 bytes.
The existing `runDaily` publication-recovery path was tested with memory-only
GCS and an existing daily claim: first recovered publication, then unchanged
duplicate; no source requests or claim mutation. This is not a real Job run.

Gateway main `5560624e84094c7188184c21090b0e44bd3f9889` was tested locally;
its module matched the cached previously serving `d0f9734d` source (runtime
not re-read). Fresh exported snapshots on 21/22/24 November preserve all 173
references and 137 unknown item periods, without refreshing acquisition time
or creating confirmed IY offers. Paper expiry on 25 November removes the lot.
This is reference retention, not item-expiry filtering: within the paper period,
main can retain already-expired item readings with their original dates.
Wrong-store/host/query sources were rejected. Main still rejects an unchanged
previous-day snapshot. A separate local comparison with pending #372 produced
171 prior-day references, including 137 unknown-period rows, with expired rows
excluded and no legacy `corpus` / confirmed offers. That comparison requires
the unmerged UI/Gateway work; it is not current production behavior.

For a later authorized production import: respect owner-only merge and required
CI; pin this artifact; obtain a fresh authorized dedicated DB copy and both
object generations during a non-overlapping window; append via `ingestCorpus`,
read back and repeat-import locally; preserve all old tables/claims; publish DB
then a current-date export using the existing two object keys and CAS, with exact
readback after each. A conflict stops publication, never a blind retry. Do not
upload the synthetic fixture, execute the historical date-pinned release script,
delete claims, or start a manual collection to import references. The current
lot does not require a new model or a Collector image rollout. Observe the next
natural daily publication separately. No production step was executed here.

The documented Windows `read-public-flyer-once.py` worker supports only OK's
allowlisted manifest, one CLI process / face and a 900-second deadline; provider
HTTP retry count and USD cost are unknown. Documentation explicitly says it is
not an enabled Controller/Cloud Run daily vision lane. Current repository
Controller defaults keep the night worker off and mechanically disable image
tools. Installed credential/config values were not inspected. Therefore an
authorized unattended **IY** route with an enforced cost bound was not proven;
no route was wired, invoked or scheduled. This does not block the source-bound
reference artifact import above.
