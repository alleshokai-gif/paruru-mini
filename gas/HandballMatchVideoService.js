// Read-only private family catalog. Never put real rows or thumbnails in Git.
const HANDBALL_VIDEO_MAX_ITEMS = 1000;
const HANDBALL_VIDEO_MAX_CATALOG_BYTES = 2 * 1024 * 1024;
const HANDBALL_VIDEO_MAX_THUMBNAIL_BYTES = 256 * 1024;
const HANDBALL_VIDEO_SCHEMA = 'handball-match-videos-1.0';
const HANDBALL_VIDEO_ACTIONS = Object.freeze({
  listHandballMatchVideos: true,
  getHandballMatchVideoLink: true,
  getHandballMatchVideoThumbnail: true,
});

function handballMatchVideos_(body) {
  try {
    const actor = resolveHandballVideoReadActor_(body);
    const properties = PropertiesService.getScriptProperties();
    const homeId = handballVideoHome_(actor, properties);
    const input = handballVideoInput_(body);
    // Same existing family/Home boundary as shopping; never a per-member video grant.
    const catalog = handballVideoLoadCatalog_(properties, homeId);
    if (input.catalogRevision && input.catalogRevision !== catalog.revision) throw handballVideoError_('REVISION_CONFLICT');
    const rows = catalog.items.filter(function(row) { return row.homeId === actor.homeId; });
    let data;
    if (input.action === 'listHandballMatchVideos') {
      const filtered = rows.filter(function(row) {
        return (input.tournamentId === undefined || row.tournamentId === input.tournamentId)
          && (input.matchId === undefined || row.matchId === input.matchId);
      });
      data = {
        items: filtered.slice(input.offset, input.offset + input.limit).map(handballVideoMetadata_),
        total: filtered.length, offset: input.offset, limit: input.limit,
        hasMore: input.offset + input.limit < filtered.length,
        catalogRevision: catalog.revision, filters: handballVideoFilters_(rows),
      };
    } else {
      const row = rows.find(function(candidate) { return candidate.id === input.id; });
      if (!row) throw handballVideoError_('NOT_FOUND');
      // Only this authenticated thumbnail operation may contact the official source.
      data = input.action === 'getHandballMatchVideoLink'
        ? { id: row.id, url: row.youtubeUrl }
        : handballVideoThumbnail_(row);
    }
    return json_({ success: true, schemaVersion: HANDBALL_VIDEO_SCHEMA, data: data, error: null, message: 'ok' });
  } catch (error) {
    // Never echo exceptions, property values, URLs, actor IDs or request data.
    const safe = ['FORBIDDEN', 'INVALID_INPUT', 'NOT_FOUND', 'CONFIGURATION_ERROR', 'SERVICE_UNAVAILABLE', 'REVISION_CONFLICT'];
    const code = safe.indexOf(error && error.code) >= 0 ? error.code : 'FORBIDDEN';
    return json_({ success: false, schemaVersion: HANDBALL_VIDEO_SCHEMA, data: {}, error: { code: code }, message: 'video request failed' });
  }
}

function handballVideoError_(code) { const error = new Error(code); error.code = code; return error; }
function handballVideoObject_(value) { return !!value && typeof value === 'object' && !Array.isArray(value); }
function handballVideoKeys_(value, keys) {
  return handballVideoObject_(value) && Object.keys(value).every(function(key) { return keys.indexOf(key) >= 0; });
}
function handballVideoIdentifier_(value, prefix) {
  return typeof value === 'string' && value.length === prefix.length + 33 && new RegExp('^' + prefix + '_[0-9a-f]{32}$').test(value);
}
function handballVideoHome_(actor, properties) {
  if (!actor || typeof actor.homeId !== 'string' || !actor.homeId
      || typeof actor.memberUserId !== 'string' || !actor.memberUserId) throw handballVideoError_('FORBIDDEN');
  let homeId;
  try { homeId = properties.getProperty('PALURU_HOME_ID'); }
  catch (_) { throw handballVideoError_('SERVICE_UNAVAILABLE'); }
  if (typeof homeId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(homeId.trim()) || homeId.trim().length > 200) throw handballVideoError_('CONFIGURATION_ERROR');
  homeId = homeId.trim();
  // Reuse the deployment's existing canonical Home, not a request, first caller,
  // display name, first admin row or new gallery-only member allowlist.
  if (actor.homeId !== homeId) throw handballVideoError_('FORBIDDEN');
  return homeId;
}
function handballVideoInput_(body) {
  if (!handballVideoObject_(body) || !Object.prototype.hasOwnProperty.call(HANDBALL_VIDEO_ACTIONS, body.action)) throw handballVideoError_('INVALID_INPUT');
  if (body.action !== 'listHandballMatchVideos') {
    if (!handballVideoKeys_(body, ['action', 'auth', 'id']) || !handballVideoIdentifier_(body.id, 'hv')) throw handballVideoError_('INVALID_INPUT');
    return { action: body.action, id: body.id };
  }
  if (!handballVideoKeys_(body, ['action', 'auth', 'tournamentId', 'matchId', 'offset', 'limit', 'catalogRevision'])) throw handballVideoError_('INVALID_INPUT');
  ['tournamentId', 'matchId'].forEach(function(key) {
    if (body[key] !== undefined && body[key] !== null && !handballVideoIdentifier_(body[key], key === 'matchId' ? 'hm' : 'ht')) throw handballVideoError_('INVALID_INPUT');
  });
  const offset = body.offset === undefined ? 0 : body.offset;
  const limit = body.limit === undefined ? 20 : body.limit;
  if (!Number.isInteger(offset) || offset < 0 || offset > HANDBALL_VIDEO_MAX_ITEMS || !Number.isInteger(limit) || limit < 1 || limit > 20) throw handballVideoError_('INVALID_INPUT');
  if (body.catalogRevision !== undefined && !handballVideoIdentifier_(body.catalogRevision, 'hc')) throw handballVideoError_('INVALID_INPUT');
  return { action: body.action, tournamentId: body.tournamentId, matchId: body.matchId, offset: offset, limit: limit, catalogRevision: body.catalogRevision };
}
function handballVideoText_(value, maxLength) {
  // Plain text only. The UI still MUST use textContent, never innerHTML.
  if (typeof value !== 'string' || !value.trim() || Array.from(value).length > maxLength
      || /[<>&\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/.test(value)
      || /(?:https?:|www\.|youtu\.be|youtube\.)/i.test(value)) throw handballVideoError_('CONFIGURATION_ERROR');
  return value;
}
function handballVideoUrl_(value) {
  if (typeof value !== 'string' || /\s/.test(value)) throw handballVideoError_('CONFIGURATION_ERROR');
  const match = /^https:\/\/(?:www\.)?youtube\.com\/watch\?v=([A-Za-z0-9_-]{11})$/.exec(value)
    || /^https:\/\/youtu\.be\/([A-Za-z0-9_-]{11})$/.exec(value);
  if (!match) throw handballVideoError_('CONFIGURATION_ERROR');
  return 'https://www.youtube.com/watch?v=' + match[1];
}
function handballVideoCatalog_(config, homeId) {
  if (!handballVideoKeys_(config, ['schemaVersion', 'revision', 'homeBinding', 'items']) || config.schemaVersion !== 1
      || typeof homeId !== 'string' || !homeId
      || (config.homeBinding !== undefined && config.homeBinding !== 'configured_home')
      || !handballVideoIdentifier_(config.revision, 'hc')
      || !Array.isArray(config.items) || config.items.length > HANDBALL_VIDEO_MAX_ITEMS) throw handballVideoError_('CONFIGURATION_ERROR');
  const ids = Object.create(null);
  const tournaments = Object.create(null);
  const matches = Object.create(null);
  return config.items.map(function(row) {
    if (!handballVideoKeys_(row, ['homeId', 'id', 'tournamentId', 'tournamentLabel', 'matchId', 'matchLabel', 'title', 'playedOn', 'publishedOn', 'classificationStatus', 'youtubeUrl'])
        || (row.homeId === undefined ? config.homeBinding !== 'configured_home' : row.homeId !== homeId)
        || !handballVideoIdentifier_(row.id, 'hv')
        || (row.tournamentId !== null && !handballVideoIdentifier_(row.tournamentId, 'ht'))
        || (row.matchId !== null && !handballVideoIdentifier_(row.matchId, 'hm')) || ids[row.id]) throw handballVideoError_('CONFIGURATION_ERROR');
    ids[row.id] = true;
    const tournamentLabel = row.tournamentId === null ? null : handballVideoText_(row.tournamentLabel, 80);
    const matchLabel = row.matchId === null ? null : handballVideoText_(row.matchLabel, 100);
    if ((row.tournamentId === null && row.tournamentLabel !== null) || (row.matchId === null && row.matchLabel !== null)
        || (row.tournamentId === null && row.matchId !== null)) throw handballVideoError_('CONFIGURATION_ERROR');
    const classificationStatus = row.matchId !== null ? 'match_identified' : row.tournamentId !== null ? 'tournament_only' : 'unclassified';
    if (row.classificationStatus !== undefined && row.classificationStatus !== classificationStatus) throw handballVideoError_('CONFIGURATION_ERROR');
    const title = handballVideoText_(row.title, 120);
    // IDs must not ambiguously name another household, tournament or display label.
    const tournamentKey = JSON.stringify([homeId, tournamentLabel]);
    const matchKey = JSON.stringify([homeId, row.tournamentId, matchLabel]);
    if ((row.tournamentId !== null && tournaments[row.tournamentId] && tournaments[row.tournamentId] !== tournamentKey)
        || (row.matchId !== null && matches[row.matchId] && matches[row.matchId] !== matchKey)) throw handballVideoError_('CONFIGURATION_ERROR');
    if (row.tournamentId !== null) tournaments[row.tournamentId] = tournamentKey;
    if (row.matchId !== null) matches[row.matchId] = matchKey;
    const date = handballVideoDate_(row.playedOn);
    const publishedOn = handballVideoDate_(row.publishedOn === undefined ? '' : row.publishedOn);
    return { homeId: homeId, id: row.id, tournamentId: row.tournamentId, tournamentLabel: tournamentLabel,
      matchId: row.matchId, matchLabel: matchLabel, title: title, playedOn: date,
      publishedOn: publishedOn, classificationStatus: classificationStatus, youtubeUrl: handballVideoUrl_(row.youtubeUrl) };
  });
}
function handballVideoMetadata_(row) {
  return { id: row.id, tournamentId: row.tournamentId, tournamentLabel: row.tournamentLabel,
    matchId: row.matchId, matchLabel: row.matchLabel, title: row.title, playedOn: row.playedOn,
    publishedOn: row.publishedOn, classificationStatus: row.classificationStatus,
    thumbnail: { status: 'not_requested' } };
}

function handballVideoDate_(date) {
  if (typeof date !== 'string' || (date !== '' && (date.length !== 10 || !/^\d{4}-\d{2}-\d{2}$/.test(date)
      || !Number.isFinite(Date.parse(date + 'T00:00:00Z')) || new Date(date + 'T00:00:00Z').toISOString().slice(0, 10) !== date))) throw handballVideoError_('CONFIGURATION_ERROR');
  return date;
}
function handballVideoLoadCatalog_(properties, homeId) {
  let fileId;
  try { fileId = properties.getProperty('HANDBALL_VIDEO_CATALOG_FILE_ID'); }
  catch (_) { throw handballVideoError_('SERVICE_UNAVAILABLE'); }
  if (typeof fileId !== 'string' || fileId.length > 128 || /\s/.test(fileId) || !/^[A-Za-z0-9_-]{10,128}$/.test(fileId)) throw handballVideoError_('CONFIGURATION_ERROR');
  let config;
  try {
    // No folder scan, file search, shortcut resolution, public URL or ACL writes.
    const file = DriveApp.getFileById(fileId);
    const size = file.getSize();
    if (file.isTrashed() || file.getSharingAccess() !== DriveApp.Access.PRIVATE
        || ['application/json', 'text/plain'].indexOf(file.getMimeType()) < 0
        || !Number.isInteger(size) || size <= 0 || size > HANDBALL_VIDEO_MAX_CATALOG_BYTES) throw handballVideoError_('CONFIGURATION_ERROR');
    const blob = file.getBlob();
    if (blob.getBytes().length !== size || file.getSharingAccess() !== DriveApp.Access.PRIVATE) throw handballVideoError_('CONFIGURATION_ERROR');
    config = JSON.parse(blob.getDataAsString('UTF-8'));
  } catch (error) {
    if (error && error.code === 'CONFIGURATION_ERROR') throw error;
    throw handballVideoError_('SERVICE_UNAVAILABLE');
  }
  return { revision: config && config.revision, items: handballVideoCatalog_(config, homeId) };
}
function handballVideoFilters_(rows) {
  const tournaments = Object.create(null), matches = Object.create(null);
  let unclassifiedTournamentCount = 0, unassignedMatchCount = 0;
  rows.forEach(function(row) {
    if (row.tournamentId === null) unclassifiedTournamentCount++;
    else {
      if (!tournaments[row.tournamentId]) tournaments[row.tournamentId] = { id: row.tournamentId, label: row.tournamentLabel, count: 0 };
      tournaments[row.tournamentId].count++;
    }
    if (row.matchId === null) unassignedMatchCount++;
    else {
      if (!matches[row.matchId]) matches[row.matchId] = { id: row.matchId, label: row.matchLabel, tournamentId: row.tournamentId, count: 0 };
      matches[row.matchId].count++;
    }
  });
  return { tournaments: Object.keys(tournaments).map(function(key) { return tournaments[key]; }),
    matches: Object.keys(matches).map(function(key) { return matches[key]; }),
    unclassifiedTournamentCount: unclassifiedTournamentCount, unassignedMatchCount: unassignedMatchCount };
}
function handballVideoPlaceholder_(id) { return { id: id, status: 'placeholder', reason: 'THUMBNAIL_UNAVAILABLE' }; }
function handballVideoHeader_(response, name) {
  const headers = response.getAllHeaders();
  const keys = Object.keys(headers).filter(function(key) { return key.toLowerCase() === name; });
  if (keys.length !== 1 || typeof headers[keys[0]] !== 'string') return '';
  return headers[keys[0]];
}
function handballVideoFetch_(url, mimeType, maxBytes) {
  const response = UrlFetchApp.fetch(url, { method: 'get', followRedirects: false, validateHttpsCertificates: true,
    muteHttpExceptions: true, timeoutSeconds: 8, headers: { Accept: mimeType } });
  if (response.getResponseCode() !== 200 || handballVideoHeader_(response, 'content-type').split(';')[0].trim().toLowerCase() !== mimeType) return null;
  const length = handballVideoHeader_(response, 'content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > maxBytes)) return null;
  const bytes = response.getBlob().getBytes();
  return bytes.length > 0 && bytes.length <= maxBytes ? {response:response, bytes:bytes} : null;
}
function handballVideoThumbnail_(row) {
  try {
    // Metadata refusal/hidden video ends the operation; never guess a CDN URL.
    const canonical = handballVideoUrl_(row.youtubeUrl);
    const providerId = canonical.slice(canonical.indexOf('?v=') + 3);
    const metaResponse = handballVideoFetch_('https://www.youtube.com/oembed?url=' + encodeURIComponent(canonical) + '&format=json', 'application/json', 32768);
    if (!metaResponse) return handballVideoPlaceholder_(row.id);
    const meta = JSON.parse(metaResponse.response.getContentText());
    if (!meta || meta.type !== 'video' || meta.provider_name !== 'YouTube' || meta.provider_url !== 'https://www.youtube.com/') return handballVideoPlaceholder_(row.id);
    // Exact official host + this video's path. No redirects, query or fragments.
    const allowed = new RegExp('^https://i\\.ytimg\\.com/vi/' + providerId + '/(?:default|mqdefault|hqdefault|sddefault|maxresdefault)\\.jpg$');
    if (typeof meta.thumbnail_url !== 'string' || meta.thumbnail_url.length > 160 || /\s/.test(meta.thumbnail_url) || !allowed.test(meta.thumbnail_url)) return handballVideoPlaceholder_(row.id);
    const image = handballVideoFetch_(meta.thumbnail_url, 'image/jpeg', HANDBALL_VIDEO_MAX_THUMBNAIL_BYTES);
    if (!image) return handballVideoPlaceholder_(row.id);
    const bytes = image.bytes.map(function(value) { return value & 255; });
    if (bytes.length < 5 || bytes[0] !== 255 || bytes[1] !== 216 || bytes[2] !== 255 || bytes[bytes.length-2] !== 255 || bytes[bytes.length-1] !== 217) return handballVideoPlaceholder_(row.id);
    return { id: row.id, status: 'available', mimeType: 'image/jpeg', base64: Utilities.base64Encode(image.bytes) };
  } catch (_) { return handballVideoPlaceholder_(row.id); }
}
