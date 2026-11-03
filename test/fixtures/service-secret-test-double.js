'use strict';
// Domain contract tests inject a cloud/verifier dependency. Their existing
// synthetic property fixtures represent the configured test credential only.
// Real cloud reads, rejection, cleanup and failure behavior have separate tests.
module.exports = function install(context) {
  context.getServiceSecret_ = name => {
    const value = context.PropertiesService.getScriptProperties().getProperty(name);
    if (!value) { const error = new Error('CONFIGURATION_ERROR'); error.code = 'CONFIGURATION_ERROR'; throw error; }
    return value;
  };
  context.retireLegacyServiceSecret_ = () => {};
  context.serviceTokenMatches_ = provided => {
    const props = context.PropertiesService.getScriptProperties();
    const expected = props.getProperty('FAMILY_INBOX_SERVICE_TOKEN') || props.getProperty('HEALTH_SERVICE_TOKEN');
    if (!expected) { const error = new Error('CONFIGURATION_ERROR'); error.code = 'CONFIGURATION_ERROR'; throw error; }
    return provided === expected;
  };
  context.retireLegacyServiceToken_ = () => {};
};
