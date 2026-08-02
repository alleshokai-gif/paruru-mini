const PALURU_WEATHER_INTERNAL_SCHEMA_VERSION = 'weather-context-internal-1.0';

// PALURU_OS uses the existing internal Calendar token as the authenticated
// Mini-to-OS context channel.  This endpoint is read-only and does not accept
// a device token or any client-provided identity.
function weatherContextInternal_(body, method) {
  try {
    if (method !== 'POST') throw internalWeatherError_('METHOD_NOT_ALLOWED');
    if (!body || body.action !== 'weatherContextInternal') throw internalWeatherError_('INVALID_INPUT');
    authenticateInternalCalendar_(body.internalToken);
    const input = validateInternalWeatherInput_(body);
    const result = getWeatherSummarySkill_({
      parameters: { date: input.date },
      useMocks: false,
      allowActiveSpreadsheetFallback: false,
    });
    if (!result || result.success !== true || !result.data || !hasInternalWeatherObservation_(result.data)) {
      throw internalWeatherError_('WEATHER_UNAVAILABLE');
    }
    return json_({
      success: true,
      schemaVersion: PALURU_WEATHER_INTERNAL_SCHEMA_VERSION,
      data: sanitizeInternalWeatherData_(result.data),
      warnings: sanitizeInternalWeatherWarnings_(result.warnings),
    });
  } catch (error) {
    const code = normalizeInternalWeatherError_(error && error.code);
    return json_({
      success: false,
      schemaVersion: PALURU_WEATHER_INTERNAL_SCHEMA_VERSION,
      error: { code: code, message: internalWeatherErrorMessage_(code) },
    });
  }
}

function hasInternalWeatherObservation_(source) {
  const data = source || {};
  return Boolean(String(data.weather || '').trim() || String(data.weatherText || '').trim()
    || Number.isFinite(internalWeatherNumberOrNull_(data.currentTemperature))
    || Number.isFinite(internalWeatherNumberOrNull_(data.maxTemperature))
    || Number.isFinite(internalWeatherNumberOrNull_(data.minTemperature)));
}

function validateInternalWeatherInput_(body) {
  const allowedKeys = ['action', 'internalToken', 'date'];
  if (Object.keys(body).some(function(key) { return allowedKeys.indexOf(key) < 0; })) throw internalWeatherError_('INVALID_INPUT');
  const date = String(body.date || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw internalWeatherError_('INVALID_INPUT');
  return { date: date };
}

function sanitizeInternalWeatherData_(source) {
  const input = source || {};
  return {
    date: String(input.date || '').trim(),
    weather: String(input.weather || '').trim().slice(0, 80),
    weatherText: String(input.weatherText || '').trim().slice(0, 300),
    currentTemperature: internalWeatherNumberOrNull_(input.currentTemperature),
    maxTemperature: internalWeatherNumberOrNull_(input.maxTemperature),
    minTemperature: internalWeatherNumberOrNull_(input.minTemperature),
    precipitationProbability: internalWeatherNumberOrNull_(input.precipitationProbability),
    umbrellaRecommended: input.umbrellaRecommended === true,
    forecastDate: String(input.forecastDate || '').trim(),
    updatedAt: String(input.updatedAt || '').trim(),
  };
}

function internalWeatherNumberOrNull_(value) {
  if (value === null || value === undefined || (typeof value !== 'number' && !String(value).trim())) return null;
  const number = typeof value === 'number' ? value : Number(String(value).trim());
  return Number.isFinite(number) ? number : null;
}

function sanitizeInternalWeatherWarnings_(values) {
  return (Array.isArray(values) ? values : []).map(function(value) {
    return String(value || '').replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase();
  }).filter(Boolean).slice(0, 20);
}

function internalWeatherError_(code) {
  const error = new Error(String(code || 'WEATHER_UNAVAILABLE'));
  error.code = String(code || 'WEATHER_UNAVAILABLE');
  return error;
}

function normalizeInternalWeatherError_(code) {
  const allowed = { METHOD_NOT_ALLOWED: true, INVALID_INPUT: true, UNAUTHORIZED: true, WEATHER_UNAVAILABLE: true };
  return allowed[code] ? code : 'WEATHER_UNAVAILABLE';
}

function internalWeatherErrorMessage_(code) {
  const messages = {
    METHOD_NOT_ALLOWED: 'POST is required.',
    INVALID_INPUT: 'Invalid input.',
    UNAUTHORIZED: 'Authentication failed.',
    WEATHER_UNAVAILABLE: 'Weather context is unavailable.',
  };
  return messages[code] || messages.WEATHER_UNAVAILABLE;
}
