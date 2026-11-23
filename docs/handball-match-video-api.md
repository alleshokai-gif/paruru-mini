# Private match video read API (implementation contract, not deployed)

## Scope and release boundary

Problem: the requested tournament/match link collection needs a private server
source and an explicit viewer boundary. No production defect or real catalog was
inspected. This change adds only three read-only Mini actions, using the existing
Firebase authentication and private Script Properties pattern. It adds no model
calls, external fetches, scopes, credentials, service hops, writes or public data.
Family Inbox's household review capability is deliberately not sufficient and its
receiver/protocol is unchanged. UI implementation is a separate worktree/task.

Side effects: each request freshly verifies Firebase identity/membership and
`home.read`, reads the current dedicated allowlist and then the private catalog.
There is no actor/catalog/link/thumbnail cache. Invalid or missing configuration
fails closed. Rollback: revert this feature commit; private properties are not
created/changed by the code. No deployment, real data import or merge is part of
this task. Future live acceptance must verify allowed and denied actors and that
neither browser storage nor diagnostics retain responses.

## UI transport (contract frozen for parallel implementation)

Use the existing `callHomeControlApi(payload)` / `postAuthenticatedApi_` flow:
authenticated POST with `cache: 'no-store'`. Do not supply home/member/role from UI.
The helper removes client identity fields and attaches the current Firebase token.
GET, legacy pairing and Family Inbox service tokens cannot access these actions.

All responses use `schemaVersion: 'handball-match-videos-1.0'` and the existing
`{success, data, error, message}` envelope. On failure data is `{}`, message is
fixed, and error.code is one of `FORBIDDEN`, `INVALID_INPUT`, `NOT_FOUND`,
`CONFIGURATION_ERROR`, `SERVICE_UNAVAILABLE`. Authentication failures are
intentionally reduced to `FORBIDDEN` on this sensitive endpoint.

### `listHandballMatchVideos`

Request fields: `action`, optional `tournamentId`, `matchId`, `offset` (default 0,
0..50), `limit` (default 20, 1..20). The transport adds `auth`. Unknown fields are
rejected. Filtering IDs are opaque, not names or URLs. Empty filters are omitted.

Data: `{items, total, offset, limit, hasMore}`. Each item has only:

```js
{
  id: 'hv_' + '1'.repeat(32),
  tournamentId: 'ht_' + '2'.repeat(32), tournamentLabel: '架空大会A',
  matchId: 'hm_' + '3'.repeat(32), matchLabel: '架空第1試合',
  title: '架空動画A', playedOn: '2026-01-10',
  thumbnail: {status: 'placeholder'}
}
```

`playedOn` is a validated calendar date, or empty when unknown. The list contains
no provider video ID, playback URL, thumbnail URL, storage locator or owner IDs.
Order is private catalog order. Validate all catalog rows before returning any;
duplicate/conflicting IDs or malformed fields fail the request, not a partial leak.

### `getHandballMatchVideoLink`

Request: `{action: 'getHandballMatchVideoLink', id}` plus transport auth. Invoke
only after the viewer explicitly clicks. This request repeats full authentication,
current allowlist and household/catalog checks, so a previous list is no grant.
Data: `{id, url}`. Only strict HTTPS `youtube.com/watch?v=<11-character-id>`
(optional `www`) or `youtu.be/<11-character-id>` is accepted in private storage;
response is canonical `https://www.youtube.com/watch?v=...`. No redirectors,
credentials, ports, other hosts/schemes, playlists, fragments or extra parameters.
This validates syntax/host only, never existence, ownership or YouTube access.
Opening the link uses YouTube's own access rules; Mini cannot grant/revoke YouTube
rights or prevent a viewer retaining an already issued link. Do not embed,
prefetch, preload or use a redirect GET. Set `noopener,noreferrer` on user-opened
navigation and discard the result from application state immediately afterwards.

### `getHandballMatchVideoThumbnail`

Request: `{action: 'getHandballMatchVideoThumbnail', id}` plus transport auth.
Same reauthorization as link action. Data: `{id, status: 'placeholder',
reason: 'THUMBNAIL_UNAVAILABLE'}`. Render a local generic icon, not a remote image.
No thumbnail metadata/URL/bytes are stored, returned or fetched in this stage.
A real image proxy would need separately verified YouTube legality/access and
bounded authenticated byte delivery with no persistent caching. Those conditions
are unverified, so this implementation does not contact a third party.

## Private provisioning contract (do not populate in this task)

Two private Mini Script Properties; both JSON schemaVersion 1, each limited to
8,500 characters (must also respect GAS's 9 KB property byte limit):

- `HANDBALL_VIDEO_READERS_JSON`: `{schemaVersion:1, readers:[{homeId,memberUserId}]}`.
  1..20 exact verified server actor tuples. No role wildcard, family-wide grant,
  default admin or client override. Re-read on every request. Missing is denied.
- `HANDBALL_VIDEO_CATALOG_JSON`: `{schemaVersion:1, items:[...]}`; 0..50 rows,
  each with `homeId`, all the list metadata fields except `thumbnail`, and
  `youtubeUrl`. Each video's opaque ID is globally unique; tournament and match
  IDs must not conflict across households/labels/parent tournaments. Never derive
  an opaque ID from a provider video ID or another private identifier.

This bounded pilot uses existing private Script Properties, not an importer.
No property values, actual school/team names, links, thumbnails or LINE source
material belong in this public repository, public assets, fixtures, PRs or logs.
Larger catalogs require the already restricted-store pattern, not public JSON.

## XSS, storage and diagnostics boundary

Use `textContent` for all labels. Backend rejects markup/control/bidi characters,
URL-shaped labels and oversize fields; it never returns raw unexpected columns.
No endpoint logs content or exceptions. Existing transport trace may record only
its allowlisted stage/code/timing metadata, never request/response bodies.
Never put responses/links in localStorage, IndexedDB, CacheStorage, service-worker
messages, query strings, crash reports or console logs. Clear UI memory on logout
and account switch. SW ignores POST; do not turn this API into an image GET or
append returned references to app-shell/cache-first assets. Apps Script
ContentService cannot set arbitrary Cache-Control headers: the current boundary
relies on authenticated POST + the existing no-store fetch + no SW persistence;
this is not a claim that downloaded values can be erased from a viewer's browser.

## Verification

`node --test test/handball-match-video-backend.test.js` uses only invented data,
no provider calls. It covers exact tuple membership, unauthenticated/other member/
other home, client actor spoofing, per-action reauthorization/revocation, XSS,
URL and ID validation, filtering/paging, cross-home not-found, generic errors,
thumbnail fallback and existing POST/SW non-persistence boundaries. Relevant
existing authentication, Inbox gateway and required PR suites are run alongside.
Real authentication, YouTube playback and mobile UI acceptance remain untested.
