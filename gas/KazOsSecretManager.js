// Centralized secret access for Kaz OS GAS consumers.
// Secret values are never stored in Script Properties, logged, hashed, or returned.
var KAZ_OS_SECRET_MANAGER_CONFIG_ = Object.freeze({
  gcpProjectId: 'paluru-bus',
  progressReadSecretName: 'KAZ_OS_GATEWAY_READ_TOKEN'
});

function getKazOsProgressReadToken_() {
  return readKazOsSecretManagerValue_(
    KAZ_OS_SECRET_MANAGER_CONFIG_.gcpProjectId,
    KAZ_OS_SECRET_MANAGER_CONFIG_.progressReadSecretName,
    'KAZ_PROGRESS_SECRET'
  );
}

function readKazOsSecretManagerValue_(projectId, secretName, errorPrefix) {
  const project = String(projectId || '').trim();
  const secret = String(secretName || '').trim();
  const prefix = String(errorPrefix || 'KAZ_SECRET').trim();
  if (!project || !secret) throw homeMembershipError_('KAZ_NOT_CONNECTED');

  const resource = 'https://secretmanager.googleapis.com/v1/projects/' + encodeURIComponent(project)
    + '/secrets/' + encodeURIComponent(secret) + '/versions/latest:access';

  let response;
  try {
    response = UrlFetchApp.fetch(resource, {
      method: 'get',
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true,
      followRedirects: false,
      validateHttpsCertificates: true
    });
  } catch (_) {
    throw homeMembershipError_('KAZ_SOURCE_FAILED');
  }

  const code = response.getResponseCode();
  if (code === 401 || code === 403 || code === 404) throw homeMembershipError_('KAZ_NOT_CONNECTED');
  if (code !== 200) throw homeMembershipError_('KAZ_SOURCE_FAILED');

  let value;
  try {
    value = JSON.parse(response.getContentText());
  } catch (_) {
    throw homeMembershipError_('KAZ_SOURCE_FAILED');
  }
  const data = String(value && value.payload && value.payload.data || '');
  if (!data) throw homeMembershipError_('KAZ_NOT_CONNECTED');

  let token;
  try {
    token = Utilities.newBlob(Utilities.base64Decode(data)).getDataAsString().trim();
  } catch (_) {
    throw homeMembershipError_('KAZ_SOURCE_FAILED');
  }
  if (token.length < 32) throw homeMembershipError_('KAZ_NOT_CONNECTED');
  return token;
}
