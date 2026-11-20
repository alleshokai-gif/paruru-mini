# Remaining stores: measured progress, 2026-11-20

This change extends the existing Collector, not the Gateway/LINE/Pages contracts.
No Controller configuration, IAM, credentials, original day claim or OK model is changed.

## Ito Yokado Mizonokuchi: current-edition template

Official store: https://stores.itoyokado.co.jp/detail/521/

The store's normal flyer link opens https://promo.hatobase.jp/flyers/00521/1298/50089 .
The normal SSR page preloads the 7510×5374 public image. It has no nofollow meta;
its separate `/images` page is not traversed. Both publisher/image-host robots
returned 404 during this check. The template must still stop on an unexpected
robots document, a rejected source request, changed metadata or uncertain OCR.

The saved real image was processed locally, without a model API. One item matched:
salted silver salmon, farmed/mild, half side, one pack, net 1,000 yen and listed
tax-inclusive 1,080 yen. Its printed sale dates are **November 18–20**, despite
the flyer heading ending November 22. The same price must be read by two OCR
segmentation passes; product/specification, pack, half side and date anchors must
also match. Milk is not adopted: the unit reading remains uncertain.
The independently reviewed original's SHA-256 is pinned so its store-exclusion
conditions cannot silently be transferred to changed bytes at the same URL.

`iy-ocr.mjs` deliberately supports only this identified edition. It does **not**
claim unattended coverage of future editions. On November 21 onward it emits
needs_review and excludes the expired offer. The old OK `jpn` model stays intact;
the checksum-pinned official best Japanese weights use a separate `jpn_best` name.

The existing daily runner enables IY only with `PALURU_SUPERMARKET_IY=1`. A first
daily execution processes OK normally and then IY. If today's durable DB already
contains an unattempted IY held row, activation obtains a separate create-only
`claims/YYYY-MM-DD-iy.json` before any IY source request. The original day claim
is preserved, OK is not called, and SQLite/latest replacements remain generation
matched. An ambiguous activation retains its claim, cannot repeat source I/O,
and cannot republish a stale snapshot over another activation. This is within
the existing create-only claims prefix; no additional permission is needed.

## Other four: stages remain separate

| Store | Independently observed public route | Current verified stage |
| --- | --- | --- |
| Rosen Taira | https://rosen.mikke-sales.com/stores/taira → `/flyers/5252` | Ordinary browser displayed the 2026-11-18–20 edition, selected Nov 20. Visible DOM contains product, origin, unit, net/tax prices and item notices. Produce 16 and meat 10 cards observed; not yet persisted or unattended. Main-site 403 is not assigned to this independent portal. Its robots 403 is unavailable, not an explicit global Disallow; no retry was made. |
| Yaoko Kawasaki Masugata | https://www.yaoko-net.com/store/store07/221.html → https://yap-pd.yaoko-net.com/app/flyer/1221/ | Official viewer displayed Nov 18–24 and a 3898×2792 image. Saved-image extraction validates one chicken-steak item, net 99 yen / 100g, listed tax-inclusive 106.92 yen, Nov 20 only. Original SHA, two day/net/tax reads and unit bind it to this current paper. Salmon is not adopted because the three-cut unit remains uncertain. Live run still needs separate evidence. Viewer-host robots returned SPA HTML, not an Allow policy. Official-site rules exclude other named directories, not the store route. |
| Maruetsu Kawasaki Sakado | https://www.maruetsu.co.jp/store/9245/ → official maintenance flyer directory → Tokubai store 3541 → leaflet 108663201 | Ordinary browser displayed the correct store's Nov 17–23 leaflet and a formal `/3541/leaflets/108663201/print` link. No registration; no validated extraction yet. |
| Life Mizoguchi | https://store.lifecorp.jp/detail/east648/ → official Tokubai widget → leaflet 108692763 | Correct store and normal flyer route displayed. The supplied `lifecorp.co.jp` host did not resolve; the existing official `lifecorp.jp` route works. No validated extraction yet. Nov 21 leaflets are future data on Nov 20. |

Tokubai's https://kufu.jp/terms/tokubai articles 13–14 forbid infringement,
unusual load, function analysis, unauthorized commercial use and unauthorized
access. The observed noncommercial, low-load public browsing of factual prices
is not named as a blanket prohibition. Do not redistribute original images,
analyze private endpoints or bypass controls. Its wildcard robots rule disallows
`/2026/random_product`, not these store/leaflet/print routes. Claude-specific
Disallow rules are not used as a reason to spoof a different agent.

Shufoo is excluded because its own prescribed-use restrictions differ. No denied
main-site URL, CAPTCHA, account, proxy, hidden API or new paid service was used.

## Acceptance boundary

Local regression tests and saved-image OCR are evidence of extraction, not proof
of a production Job, GCS publication, daily natural trigger or authenticated UI.
Those must be recorded separately after a reviewed, CI-verified deployment.
Remaining-five completion and a real owner-originated LINE response remain open.

The IY rollout was independently accepted in execution `paluru-supermarket-daily-px5sk`
(24.48s; source requests 4; one new offer; old OK three unchanged). Latest generation
`1795138540198688` and SQLite provenance read back. A separate same-day execution
`paluru-supermarket-daily-2bx9g` (6.53s) made zero source requests and preserved
all generations. Main #222 / `974136253441f26eb67941b3cbc6030a7bf8286c`; necessary
CI `44653494276` passed at head `6377d3a80a29db9577f8097d8d05efcf25e44fa7`.
The authenticated screen showed IY and OK checked, while its three menu cards
still selected OK. The additional-store catalogue disclosure separates acquired
offers from menu selection so their actual price, unit and item expiry can also
be inspected without changing the existing recommendation or shopping list.

Yaoko uses the same dedicated Job with opt-in `PALURU_SUPERMARKET_YAOKO=1`.
The fixed create-only claim is `claims/YYYY-MM-DD-yaoko.json` inside the existing
claim prefix. Activation chooses at most one previously unattempted held store
per invocation and never calls an already checked IY/OK adapter. The current
Yaoko template expires on Nov 20; Nov 21+ is needs_review with no source requests.
Neither adapter claims generic future-edition recognition.
