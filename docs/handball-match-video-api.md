# Private match video read API (Draft, not deployed)

## Scope, impact and rollback

The collection must page through at least 51 videos, preserve unclassified entries
and provide authenticated thumbnails. No real catalog, school/team/LINE material,
video or production settings were inspected. The three Mini read actions reuse
current Firebase identity/membership, existing `home.read`, the same family roles
as shopping, and the deployment's existing canonical family Home. Every
active authenticated member of that Home can read; no gallery-only member grants
or manual roster/owner-session matching are required.
Family Inbox's receiver, protocol, capabilities and credentials remain unchanged.

The catalog is now a dedicated restricted Drive JSON file referenced by one
private Script Property, not JSON squeezed into a property. Only that exact file
is read; no folder search/scan/shortcut resolution. Existing `drive` and
`script.external_request` scopes suffice; manifests/scopes are unchanged.
No writes, imports, ACL changes, caches or model calls. The only provider request
is an authenticated thumbnail action: one official metadata request, then at most
one official image request. Revert this feature to roll back; no property/file
changes are performed by this code. Merge, provisioning and deployment are outside
this Draft task. Future live acceptance must verify actual Firebase/Drive access,
private UI rendering, denial cases and no browser persistence.

## UI transport and response envelope

Use existing `callHomeControlApi(payload)` / `postAuthenticatedApi_`:
authenticated POST with `cache: 'no-store'`. Never send client home/member/role.
The helper strips client identity fields and attaches the current Firebase token.
Each action freshly resolves the server actor (not cached Home authentication),
verifies active identity/member and existing `home.read`, accepts only the same
`admin` / `guardian` / `self_record` roles as shopping, and compares its Home to
existing server configuration before any Drive or YouTube read. No client Home,
first-caller binding or display-name inference is used. GET/legacy pairing/Family Inbox service tokens cannot grant access.

The production v205 shopping client calls Gateway `/v2/family/shopping` directly.
Gateway resolves fresh active Firebase/Home membership and compares Home against
its fixed `KAZ_OS_PROGRESS_OWNER_HOME_ID`, injected from the same-named existing
Secret Manager source (`kaz-context/tools/kaz-os/deploy/read-transport-v2-canary.json`).
Mini v205 already has `loadInternalCalendarSecret_(PALURU_CALENDAR_SERVICE_HOME_SECRET)`
for that same canonical source. Gallery reuses this existing loader and existing
permissions; it does not read a new `PALURU_HOME_ID` Script Property. No family
roster selection, first-admin lookup or new Home/reader configuration is needed.
Unavailable or invalid canonical configuration fails closed before Drive access.

All responses retain `schemaVersion: 'handball-match-videos-1.0'` and the existing
`{success, data, error, message}` envelope. Failed data is `{}`, message is fixed;
error.code is `FORBIDDEN`, `INVALID_INPUT`, `NOT_FOUND`, `CONFIGURATION_ERROR`,
`SERVICE_UNAVAILABLE` or `REVISION_CONFLICT`. Auth failures are `FORBIDDEN` here.
No errors/logs expose request/response bodies, private URLs, file IDs or actor IDs.

### `listHandballMatchVideos`

Request: `action`, optional `tournamentId`, `matchId`, `offset` (default 0, 0..1000),
`limit` (default 20, 1..20), `catalogRevision`. Transport adds `auth`; unknown
fields are rejected. Omit a filter for all; explicit `null` selects unclassified
rows in that dimension. Non-null filters are opaque IDs, never names or URLs.
No match filter is applied by default: tournament-only videos remain visible.

Data: `{items, total, offset, limit, hasMore, catalogRevision, filters}`.
`filters` always covers ALL rows in this actor's home, independent of page/filter:

- `tournaments: [{id, label, count}]`
- `matches: [{id, label, tournamentId, count}]`
- `unclassifiedTournamentCount`, `unassignedMatchCount`

Build dropdowns from `filters`, NOT the first 20 returned items. Client can narrow
match options by `tournamentId`. Preserve an explicit unclassified option and an
all option. Traverse offsets until `hasMore` is false. Send the first response's
`catalogRevision` on subsequent pages; `REVISION_CONFLICT` requires discarding the
old paging session and starting again, not concatenating different revisions.

Each item contains only:

```js
{
  id: 'hv_' + '1'.repeat(32),
  tournamentId: 'ht_' + '2'.repeat(32), tournamentLabel: 'Synthetic tournament',
  matchId: null, matchLabel: null,
  title: 'Synthetic recording', playedOn: '', publishedOn: '2026-01-10',
  classificationStatus: 'tournament_only', thumbnail: {status: 'not_requested'}
}
```

`playedOn` is a validated match date and `publishedOn` a validated posting date;
neither is inferred from the other. Empty means unknown. `matchId/matchLabel`
must be both null or both valid; tournament pair is also nullable. Status is
`match_identified`, `tournament_only`, or `unclassified`, derived from those pairs.
If explicitly supplied in private data, it must agree. No provider video ID,
playback URL, thumbnail URL, storage locator or home/member IDs appear in lists.
Order is private catalog order; all rows validate before any data is returned.

### `getHandballMatchVideoLink`

Request `{action: 'getHandballMatchVideoLink', id}` plus transport auth, only after
a viewer explicitly clicks. Repeat full auth/current membership/canonical-Home/opaque-ID
checks. A prior list is not a grant. Data `{id, url}`; strict HTTPS YouTube watch
URL or short URL in storage is canonicalized to `https://www.youtube.com/watch?v=...`.
Other hosts/schemes, redirectors, userinfo, ports, extra query and fragments fail.
This verifies syntax, not ownership/availability or YouTube viewing rights.
Mini cannot grant those rights or revoke a link already retained by a viewer.
Do not embed/prefetch/preload or make a GET redirect endpoint. User-opened links
use `noopener,noreferrer`; discard returned URL from application state afterwards.

### `getHandballMatchVideoThumbnail`

Request `{action: 'getHandballMatchVideoThumbnail', id}` plus transport auth.
Only after ALL auth/existing-family/canonical-Home/video checks, request fixed HTTPS YouTube oEmbed
with that catalog video's canonical URL. Require 200, JSON MIME, <=32 KiB,
provider `YouTube`, provider URL `https://www.youtube.com/` and video metadata.
Use ONLY the metadata-supplied thumbnail URL, validated against exact
`https://i.ytimg.com/vi/<same-video-id>/<known-size>.jpg`. No guessed image URL,
query/fragment, other host/path/video, cookies or forwarded user credentials.

At most one image request: require 200, `image/jpeg`, <=256 KiB, JPEG start/end
signature. Both requests use TLS certificate validation, no redirects/retries,
8-second per-request timeout. Refusal/hidden/invalid/redirect/error returns
`{id, status:'placeholder', reason:'THUMBNAIL_UNAVAILABLE'}` without alternate
paths. Success is `{id, status:'available', mimeType:'image/jpeg', base64}`.
No original thumbnail URL is returned, and no image is persisted or cached.

UI: request only visible/explicitly needed rows, render a memory-only Blob/object
URL (revoke on removal/account switch) or validated JPEG data URL. Never fetch
YouTube/CDN directly or persist bytes/URLs. Render local generic icon on fallback.
The byte cap is enforced before return and after fetch; GAS buffers the upstream
HTTP response, so this is not a streaming download bandwidth cap.

## Private provisioning (not performed in this task)

- Reuse v205's `loadInternalCalendarSecret_(PALURU_CALENDAR_SERVICE_HOME_SECRET)`
  internally for `KAZ_OS_PROGRESS_OWNER_HOME_ID`, the same existing canonical
  source used by Gateway's shopping boundary. It must load and match the verified
  actor's Home; no new Script Property is required for Home. Do not
  create a new authentication mode, gallery role, roster or member allowlist.
  No Home/member values need to be copied to the catalog or UI. Missing/invalid
  existing Home configuration fails closed, with no first-caller fallback.
- `HANDBALL_VIDEO_CATALOG_FILE_ID`: ONLY the dedicated private Drive file ID.
  This remains the one gallery-specific data-source setting; authentication and
  Home setup are the existing application's. The legacy readers property is not
  consulted, changed or deleted (preserve it if present for rollback).
- Preferred file: `{schemaVersion:1, revision:'hc_<32 lowercase hex>',
  homeBinding:'configured_home', items:[...]}`, 0..1000 rows, <=2 MiB UTF-8 JSON.
  Each row has list metadata except `thumbnail`, and `youtubeUrl`; no private
  home/member ID is required. The service binds every row to the verified existing
  configured Home internally. A legacy explicit `homeId` is allowed only when it
  matches that configured Home; any foreign or mixed Home is rejected wholesale.
  Without `homeBinding:'configured_home'`, every row must explicitly name the
  configured Home. Unknown binding markers fail closed.
  `classificationStatus` / `publishedOn` can be omitted for older rows (derived
  status / unknown posted date). Opaque IDs use `hv_`, `ht_`, `hm_` plus 32 lowercase
  hex characters, never provider IDs. Each publication needs a new `hc_` revision.

No change to Google/Firestore/Firebase roles, member statuses, Drive sharing or
family permissions is part of this change. The private file remains owner-only;
family readers receive only authenticated API projections, not Drive access.
The regular server resolver rechecks mapping/active member on each list, link
and thumbnail request. Removing/disabling membership takes effect without editing
a second gallery roster. A synthetic `self_record` profile tests the same existing
permission class as younger family members; it is not a real-account acceptance.

The exact file must be nontrashed, application/json or text/plain, and Drive
`Access.PRIVATE`. Broad/domain/link-sharing classes, shortcuts, size mismatch,
malformed JSON or conflicting IDs fail closed. This runtime check does NOT audit
explicit individual ACL grants; approved restricted provisioning must establish
those separately. No real file/ACL/property was accessed in this task. Do not
put private names, links, IDs, source messages or thumbnails into this public repo.

## Browser/XSS/diagnostics

Labels use `textContent`, never innerHTML. Backend rejects markup/control/bidi,
URL-shaped labels and oversized fields, and allowlists output columns. Do not
retain responses in localStorage, IndexedDB, CacheStorage, service-worker messages,
query strings, crash reports or console. Clear memory on logout/account switch.
SW ignores POST; do not add API/image GETs to cache-first/app-shell assets.
ContentService cannot set arbitrary Cache-Control headers: current boundary is
POST + existing no-store fetch + no SW persistence. Values delivered to an
allowed browser cannot be guaranteed erased from that viewer's possession.

## Verification and limits

Synthetic tests execute actual GAS routing/auth wrapper with invented verified
identity/Drive/provider adapters. They cover Japanese 51 and 317 rows, complete
paging/filter choices, revision changes, nullable match/classification, existing
family roles/canonical Home, cross-home denial, per-click reauthorization, URL/XSS/file validation,
no Drive/provider reads for unauthenticated or other-Home actors, metadata refusal, redirects, MIME/byte caps and
placeholder behavior. Relevant existing auth/Inbox/required PR suites also run.

A separate local-only real HTTP POST probe used the public sample video from
[YouTube's official IFrame API documentation](https://developers.google.com/youtube/iframe_api_reference).
At 2026-11-23 15:45 UTC, actual oEmbed and its thumbnail both returned 200 (2
requests); the unchanged handler returned `available`, image/jpeg, 22,712 bytes.
Independent Pillow decode: 480x360 JPEG; SHA256
`056129e50d3b499e3a6b2056bd73adcc97fe3f8365e34e91175ddc6ccf4314ac`.
Auth and Drive were synthetic local fixtures, NOT production Firebase/Drive/GAS.
No image or real target data was saved/committed; the probe output contained only
aggregate status/size/hash. Live restricted-file access, production authentication,
real target thumbnails and integrated UI acceptance remain untested.

Official API references: [Drive File](https://developers.google.com/apps-script/reference/drive/file),
[UrlFetchApp](https://developers.google.com/apps-script/reference/url-fetch/url-fetch-app).

## Family access follow-up and release boundary

The owner explicitly replaced the earlier per-member proposal with the existing
family shopping authentication model. Source references: Mini
`AuthenticatedActorService.js` / `HomeMembershipService.js`;
`kaz-context/tools/kaz-os/family_shopping_route.py` / `read_transport_v2.py`
verify active mapped membership, allowed family role and a configured Home.
Public v205's shopping transport and Gateway's deployment mapping use
`KAZ_OS_PROGRESS_OWNER_HOME_ID`. The old follow-up's assumption that
`PALURU_HOME_ID` was a configured production property was incorrect; v205's
existing canonical Secret Manager loader is reused instead. No runtime credential
or central Home value is fetched by the development/tests or copied to this repo.
No live property value, roster, credential or private catalog was read for this
implementation. The earlier Sheets 403 is not retried or worked around.

UI #246 stays unchanged: its authenticated POST adapter/menu inherits Home and
the same existing roles as shopping, not the public bus data route. It remains a
separate Draft until the agreed release order/production API acceptance. Tests
combine the exact UI head with this backend using only fictional family profiles
and 51 rows; real family/younger-member and actual catalog acceptance remain open.
Apps Script Web App version updates remain owner-only; ordinary source preparation
is distinct from public deployment. There is no new sign-in, PC-front operation,
manual roster check or secret-copying step in the family data setup contract.
