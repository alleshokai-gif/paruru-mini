// Read-only private catalog. Never put real rows, thumbnails or reader IDs in Git.
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
    handballVideoAuthorize_(actor, handballVideoProperty_(properties, 'HANDBALL_VIDEO_READERS_JSON'));
    const input = handballVideoInput_(body);
    // Read only after current authentication AND the explicit reader tuple check.
    const catalog = handballVideoCatalog_(handballVideoProperty_(properties, 'HANDBALL_VIDEO_CATALOG_JSON'));
    const rows = catalog.filter(function(row) { return row.homeId === actor.homeId; });
    let data;
    if (input.action === 'listHandballMatchVideos') {
      const filtered = rows.filter(function(row) {
        return (!input.tournamentId || row.tournamentId === input.tournamentId)
          && (!input.matchId || row.matchId === input.matchId);
      });
      data = {
        items: filtered.slice(input.offset, input.offset + input.limit).map(handballVideoMetadata_),
        total: filtered.length, offset: input.offset, limit: input.limit,
        hasMore: input.offset + input.limit < filtered.length,
      };
    } else {
      const row = rows.find(function(candidate) { return candidate.id === input.id; });
      if (!row) throw handballVideoError_('NOT_FOUND');
      // No external request, redirect, image URL or browser-side YouTube preload.
      data = input.action === 'getHandballMatchVideoLink'
        ? { id: row.id, url: row.youtubeUrl }
        : { id: row.id, status: 'placeholder', reason: 'THUMBNAIL_UNAVAILABLE' };
    }
    return json_({ success: true, schemaVersion: HANDBALL_VIDEO_SCHEMA, data: data, error: null, message: 'ok' });
  } catch (error) {
    // Never echo exceptions, property values, URLs, actor IDs or request data.
    const safe = ['FORBIDDEN', 'INVALID_INPUT', 'NOT_FOUND', 'CONFIGURATION_ERROR', 'SERVICE_UNAVAILABLE'];
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
function handballVideoProperty_(properties, key) {
  let raw;
  try { raw = properties.getProperty(key); } catch (_) { throw handballVideoError_('SERVICE_UNAVAILABLE'); }
  if (typeof raw !== 'string' || !raw || raw.length > 8500) throw handballVideoError_('CONFIGURATION_ERROR');
  try { return JSON.parse(raw); } catch (_) { throw handballVideoError_('CONFIGURATION_ERROR'); }
}
function handballVideoAuthorize_(actor, config) {
  if (!actor || typeof actor.homeId !== 'string' || !actor.homeId || typeof actor.memberUserId !== 'string' || !actor.memberUserId
      || !handballVideoKeys_(config, ['schemaVersion', 'readers']) || config.schemaVersion !== 1
      || !Array.isArray(config.readers) || !config.readers.length || config.readers.length > 20) throw handballVideoError_('FORBIDDEN');
  const valid = config.readers.every(function(reader) {
    return handballVideoKeys_(reader, ['homeId', 'memberUserId'])
      && typeof reader.homeId === 'string' && !!reader.homeId
      && typeof reader.memberUserId === 'string' && !!reader.memberUserId;
  });
  if (!valid || !config.readers.some(function(reader) {
    return reader.homeId === actor.homeId && reader.memberUserId === actor.memberUserId;
  })) throw handballVideoError_('FORBIDDEN');
}
function handballVideoInput_(body) {
  if (!handballVideoObject_(body) || !Object.prototype.hasOwnProperty.call(HANDBALL_VIDEO_ACTIONS, body.action)) throw handballVideoError_('INVALID_INPUT');
  if (body.action !== 'listHandballMatchVideos') {
    if (!handballVideoKeys_(body, ['action', 'auth', 'id']) || !handballVideoIdentifier_(body.id, 'hv')) throw handballVideoError_('INVALID_INPUT');
    return { action: body.action, id: body.id };
  }
  if (!handballVideoKeys_(body, ['action', 'auth', 'tournamentId', 'matchId', 'offset', 'limit'])) throw handballVideoError_('INVALID_INPUT');
  ['tournamentId', 'matchId'].forEach(function(key) {
    if (body[key] !== undefined && !handballVideoIdentifier_(body[key], key === 'matchId' ? 'hm' : 'ht')) throw handballVideoError_('INVALID_INPUT');
  });
  const offset = body.offset === undefined ? 0 : body.offset;
  const limit = body.limit === undefined ? 20 : body.limit;
  if (!Number.isInteger(offset) || offset < 0 || offset > 50 || !Number.isInteger(limit) || limit < 1 || limit > 20) throw handballVideoError_('INVALID_INPUT');
  return { action: body.action, tournamentId: body.tournamentId, matchId: body.matchId, offset: offset, limit: limit };
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
function handballVideoCatalog_(config) {
  if (!handballVideoKeys_(config, ['schemaVersion', 'items']) || config.schemaVersion !== 1
      || !Array.isArray(config.items) || config.items.length > 50) throw handballVideoError_('CONFIGURATION_ERROR');
  const ids = Object.create(null);
  const tournaments = Object.create(null);
  const matches = Object.create(null);
  return config.items.map(function(row) {
    if (!handballVideoKeys_(row, ['homeId', 'id', 'tournamentId', 'tournamentLabel', 'matchId', 'matchLabel', 'title', 'playedOn', 'youtubeUrl'])
        || typeof row.homeId !== 'string' || !row.homeId || !handballVideoIdentifier_(row.id, 'hv')
        || !handballVideoIdentifier_(row.tournamentId, 'ht') || !handballVideoIdentifier_(row.matchId, 'hm') || ids[row.id]) throw handballVideoError_('CONFIGURATION_ERROR');
    ids[row.id] = true;
    const tournamentLabel = handballVideoText_(row.tournamentLabel, 80);
    const matchLabel = handballVideoText_(row.matchLabel, 100);
    const title = handballVideoText_(row.title, 120);
    // IDs must not ambiguously name another household, tournament or display label.
    const tournamentKey = JSON.stringify([row.homeId, tournamentLabel]);
    const matchKey = JSON.stringify([row.homeId, row.tournamentId, matchLabel]);
    if ((tournaments[row.tournamentId] && tournaments[row.tournamentId] !== tournamentKey)
        || (matches[row.matchId] && matches[row.matchId] !== matchKey)) throw handballVideoError_('CONFIGURATION_ERROR');
    tournaments[row.tournamentId] = tournamentKey; matches[row.matchId] = matchKey;
    const date = row.playedOn;
    if (typeof date !== 'string' || (date !== '' && (!/^\d{4}-\d{2}-\d{2}$/.test(date)
        || !Number.isFinite(Date.parse(date + 'T00:00:00Z')) || new Date(date + 'T00:00:00Z').toISOString().slice(0, 10) !== date))) throw handballVideoError_('CONFIGURATION_ERROR');
    return { homeId: row.homeId, id: row.id, tournamentId: row.tournamentId, tournamentLabel: tournamentLabel,
      matchId: row.matchId, matchLabel: matchLabel, title: title, playedOn: date, youtubeUrl: handballVideoUrl_(row.youtubeUrl) };
  });
}
function handballVideoMetadata_(row) {
  return { id: row.id, tournamentId: row.tournamentId, tournamentLabel: row.tournamentLabel,
    matchId: row.matchId, matchLabel: row.matchLabel, title: row.title, playedOn: row.playedOn,
    thumbnail: { status: 'placeholder' } };
}
