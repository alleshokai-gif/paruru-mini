function doPost(e) {
  let body = null;
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    healthToken_(body);
    if (typeof PET_HEALTH_OPERATIONS_ !== 'undefined' && PET_HEALTH_OPERATIONS_[body.operation]) return healthJson_(petHealthDispatch_(body));
    if (!HEALTH_OPERATIONS_[body.operation]) throw healthErr_('UNSUPPORTED_ACTION');
    let data;
    if (body.operation === 'health.context.get') data = healthContext_(body);
    else if (body.operation === 'health.daily.get') data = dailyGet_(body);
    else if (body.operation === 'health.daily.list') data = dailyList_(body);
    else if (body.operation === 'health.weight.list') data = weightList_(body);
    else if (body.operation === 'health.profile.get') data = healthProfileGet_(body);
    else data = executeIdempotentWrite_(body).data;
    return healthJson_({ success: true, data: data });
  } catch (error) {
    if (body && typeof PET_HEALTH_OPERATIONS_ !== 'undefined' && PET_HEALTH_OPERATIONS_[body.operation]) return healthJson_(petHealthErrorResponse_(body.operation, error));
    const code = error && error.code;
    return healthJson_({ success: false, error: { code: ['UNAUTHORIZED', 'CONFIGURATION_ERROR', 'INVALID_INPUT', 'UNSUPPORTED_ACTION', 'IDEMPOTENCY_CONFLICT', 'DATA_INTEGRITY_ERROR'].indexOf(code) >= 0 ? code : 'INTERNAL_ERROR' } });
  }
}
const HEALTH_OPERATIONS_ = Object.freeze({'health.context.get':true,'health.daily.get':true,'health.daily.list':true,'health.daily.recordSlot':true,'health.weight.list':true,'health.weight.record':true,'health.weight.correct':true,'health.profile.get':true,'health.profile.update':true});
