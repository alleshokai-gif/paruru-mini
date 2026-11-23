# Private match video read API (Draft, not deployed)

## Scope, impact and rollback

The collection must page through at least 51 videos, preserve unclassified entries
and provide authenticated thumbnails. No real catalog, school/team/LINE material,
video or production settings were inspected. The three Mini read actions reuse
current Firebase identity/membership plus `home.read` AND a dedicated exact
`homeId + memberUserId` reader allowlist. No family-wide role fallback exists.
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
then reads the current allowlist; only an exact allowed tuple can read Drive or
contact YouTube. GET/legacy pairing/Family Inbox service tokens cannot grant access.

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
a viewer explicitly clicks. Repeat full auth/current allowlist/home/opaque-ID
checks. A prior list is not a grant. Data `{id, url}`; strict HTTPS YouTube watch
URL or short URL in storage is canonicalized to `https://www.youtube.com/watch?v=...`.
Other hosts/schemes, redirectors, userinfo, ports, extra query and fragments fail.
This verifies syntax, not ownership/availability or YouTube viewing rights.
Mini cannot grant those rights or revoke a link already retained by a viewer.
Do not embed/prefetch/preload or make a GET redirect endpoint. User-opened links
use `noopener,noreferrer`; discard returned URL from application state afterwards.

### `getHandballMatchVideoThumbnail`

Request `{action: 'getHandballMatchVideoThumbnail', id}` plus transport auth.
Only after ALL auth/allowlist/home/video checks, request fixed HTTPS YouTube oEmbed
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

- `HANDBALL_VIDEO_READERS_JSON`: JSON `{schemaVersion:1, readers:[{homeId,
  memberUserId}]}`, 1..20 exact server actor tuples, <=8,500 characters within
  GAS property limits. No wildcard/default admin/client override.
- `HANDBALL_VIDEO_CATALOG_FILE_ID`: ONLY dedicated Drive file ID, no catalog JSON.
  The old `HANDBALL_VIDEO_CATALOG_JSON` property is NOT used and has no fallback.
- The file: `{schemaVersion:1, revision:'hc_<32 lowercase hex>', items:[...]}`,
  0..1000 rows, <=2 MiB UTF-8 JSON. Each row has `homeId`, list metadata fields
  except `thumbnail`, and `youtubeUrl`; `classificationStatus`/`publishedOn` can
  be omitted for older rows (derived status/unknown posted date). Opaque IDs use
  `hv_`, `ht_`, `hm_` plus 32 lowercase hex characters; never provider IDs.
  Every publication must use a new opaque `hc_` revision so pages detect changes.

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
paging/filter choices, revision changes, nullable match/classification, exact
reader tuple, cross-home denial, per-click reauthorization, URL/XSS/file validation,
no external calls before auth, metadata refusal, redirects, MIME/byte caps and
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
