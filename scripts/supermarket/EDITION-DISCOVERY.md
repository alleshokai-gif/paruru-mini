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
Long-term full-paper retention and automatic whole-image analysis are still
unconnected work, not a daily automated product-extraction success.

Local real-source check on 21 November 2026: official IY canonical
`https://promo.hatobase.jp/flyers/00521/1313/51034`, paper 21–24 November,
two saved/read-back images (5,249,473 and 5,847,854 bytes). The official-route
and page probes used 8 source requests in total; same-day replay used zero.
This does not prove publication at 08:15, production execution or extraction.
No cloud operation or model call was performed for this check.
