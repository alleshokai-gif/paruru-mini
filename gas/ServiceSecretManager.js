// Reuses the School Gemini / Signage TTS owner-OAuth Secret Manager pattern.
// Plaintext remains in Secret Manager and request memory only. No cache or property fallback.
const SERVICE_SECRET_MANAGER_CONFIG = Object.freeze({
  projectId: 'paluru-bus',
  version: '1',
  names: Object.freeze(["FAMILY_INBOX_SERVICE_TOKEN","HEALTH_SERVICE_TOKEN"])
});

function getServiceSecret_(name) {
  if (SERVICE_SECRET_MANAGER_CONFIG.names.indexOf(name) < 0) throw serviceSecretError_();
  const resource = 'https://secretmanager.googleapis.com/v1/projects/'
    + encodeURIComponent(SERVICE_SECRET_MANAGER_CONFIG.projectId) + '/secrets/'
    + encodeURIComponent(name) + '/versions/' + encodeURIComponent(SERVICE_SECRET_MANAGER_CONFIG.version) + ':access';
  let response;
  try {
    response = UrlFetchApp.fetch(resource, {
      method: 'get', headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true, followRedirects: false, validateHttpsCertificates: true
    });
  } catch (_) { throw serviceSecretError_(); }
  if (!response || response.getResponseCode() !== 200) throw serviceSecretError_();
  let token;
  try {
    const result = JSON.parse(response.getContentText());
    const data = result && result.payload && result.payload.data;
    if (typeof data !== 'string' || !data) throw serviceSecretError_();
    token = Utilities.newBlob(Utilities.base64Decode(data)).getDataAsString();
  } catch (_) { throw serviceSecretError_(); }
  if (!/^[A-Za-z0-9_-]{43,256}$/.test(token)) throw serviceSecretError_();
  return token;
}

// Called only after the cloud credential has authenticated the production request.
// Existing unrelated properties are untouched; no credential is copied to properties.
function retireLegacyServiceSecret_(name) {
  if (SERVICE_SECRET_MANAGER_CONFIG.names.indexOf(name) < 0) throw serviceSecretError_();
  const properties = PropertiesService.getScriptProperties();
  if (properties.getProperty(name) !== null) properties.deleteProperty(name);
}

// Owner/editor preflight only; deliberately absent from all HTTP operation routers.
function verifyServiceSecretManagerAccess() {
  SERVICE_SECRET_MANAGER_CONFIG.names.forEach(function(name) { getServiceSecret_(name); });
  console.log(JSON.stringify({ secretManagerReady: true, secretsChecked: SERVICE_SECRET_MANAGER_CONFIG.names.length }));
  return { secretManagerReady: true, secretsChecked: SERVICE_SECRET_MANAGER_CONFIG.names.length };
}

function serviceSecretError_() {
  const error = new Error('CONFIGURATION_ERROR');
  error.code = 'CONFIGURATION_ERROR';
  return error;
}
