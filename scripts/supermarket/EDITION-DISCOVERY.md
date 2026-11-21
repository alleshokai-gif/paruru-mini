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
