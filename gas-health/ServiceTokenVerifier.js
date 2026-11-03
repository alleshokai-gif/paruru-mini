// Receiver needs a verifier, never the plaintext service credential or Cloud access.
// The release builder resolves the pinned Secret Manager version in memory.
// No verifier or credential from production is committed to this repository.
const SERVICE_TOKEN_VERIFIER_CONFIG = Object.freeze({
  projectId: 'paluru-bus', secretName: 'HEALTH_SERVICE_TOKEN', version: '1',
  sha256: '__SERVICE_TOKEN_SHA256__'
});

function serviceTokenMatches_(provided) {
  const expected = SERVICE_TOKEN_VERIFIER_CONFIG.sha256;
  if (!/^[0-9a-f]{64}$/.test(expected)) throw serviceTokenVerifierError_();
  if (typeof provided !== 'string' || provided.length < 32 || provided.length > 256) return false;
  const actual = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, provided, Utilities.Charset.UTF_8)
    .map(function(byte) { return ('0' + (byte & 255).toString(16)).slice(-2); }).join('');
  let difference = actual.length ^ expected.length;
  for (let index = 0; index < expected.length; index++) difference |= actual.charCodeAt(index) ^ expected.charCodeAt(index);
  return difference === 0;
}

function retireLegacyServiceToken_() {
  const properties = PropertiesService.getScriptProperties();
  if (properties.getProperty(SERVICE_TOKEN_VERIFIER_CONFIG.secretName) !== null)
    properties.deleteProperty(SERVICE_TOKEN_VERIFIER_CONFIG.secretName);
}

function serviceTokenVerifierError_() {
  const error = new Error('CONFIGURATION_ERROR'); error.code = 'CONFIGURATION_ERROR'; return error;
}
