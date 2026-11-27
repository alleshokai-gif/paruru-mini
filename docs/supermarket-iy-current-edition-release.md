# IY current-edition intake — 2026-11-27

The existing 08:15 JST Job still used the 11/20 source label. Its 11/27 natural
execution `paluru-supermarket-daily-z5vmc` completed at 08:15:24 JST, while the
generation-matched dedicated flyer DB recorded IY `needs_review` /
`OCR_TEMPLATE_REVIEW_REQUIRED`, no discovery tables, and 1,073 historical rows.
Job exit success does not establish store acquisition or product analysis.

Updating that image to main alone is insufficient. The official store's `/new`
link currently redirects to an undated tenant advertisement. The same official
store index contains dated current papers. The repair selects the latest-starting
active explicitly dated paper in that index (earliest end is the tie-breaker),
then rechecks its own store/canonical/period before reading every linked face.
There are no hard-coded current issue IDs or selected food items. An undated
advertisement, expired/future paper, foreign store or nofollow link cannot grant
acquisition. Existing robots, persistent HTTP denial and 12-request gates remain.

## Actual bounded local source check

One local, non-production probe used 9 public-source requests and selected
`https://promo.hatobase.jp/flyers/00521/1323/51325`, explicitly 2026-11-25–27.
It saved both linked faces, 5,712,074 and 5,938,916 bytes, outside Git. This is
source detection/acquisition evidence, not unattended product extraction or a
production import. No image/source body is committed or redistributed here.
That issue is expired on the next 11/28 natural tick; do not relabel it current.

## Remaining production constraints

- The named production DB was 5,722,112 bytes. Both source faces total
  11,650,990 bytes. Existing 12 MiB page-retention budget and 16 MiB GCS-body limit
  cannot hold this full paper alongside that DB. The regression uses synthetic
  bytes at these measured sizes and proves the old rows remain intact and the
  second face stays explicitly storage-limited. Do not enlarge limits, evict old
  data, or use daily claims as an image archive to manufacture success.
- Main's discovered-edition path intentionally reports analysis `not_connected`
  and product count unknown. The old single-card OCR cannot analyze a new whole
  paper. Offline OCR lines are candidates, not established products. No paid
  vision route, credential transfer or new unattended worker is enabled here.
- Keep the original #234 requirement against shipping an image-size-only slice
  as working unattended product intake. A connected permitted whole-paper
  analyzer and bounded retention are still required. Prefer processing full
  images ephemerally and storing structured rows/provenance, or an already
  authorized private archive; this document does not authorize new storage/IAM.
- This change alone does not update Cloud Run, rerun a claim, write a production
  row, or change the schedule. Releasing a later complete slice must retain the
  existing immutable rollback image, keyless account and all other Job settings.

The next scheduled observation is 2026-11-28 08:15 JST. Inspect its real execution,
generation-matched discovery pages, product rows and served DTO separately. If
the runtime is unchanged, its expected old-template stop remains unresolved.
No manual or duplicate collection is needed to create evidence.
