export const POSITION_SHADOW_TARGETS = Object.freeze([
  Object.freeze({
    provider: 'kawasaki',
    directionId: 'home_to_noborito',
    routeId: '10044',
    targetStopId: '362_1'
  })
]);

export function validatePositionShadowTargets(targets = POSITION_SHADOW_TARGETS) {
  if (!Array.isArray(targets) || !targets.length) throw Error('POSITION_EVALUATOR_TARGETS_INVALID');
  const seen = new Set();
  for (const target of targets) {
    if (!target || !['provider', 'directionId', 'routeId', 'targetStopId'].every((name) =>
      typeof target[name] === 'string' && /^[A-Za-z0-9_.:-]{1,200}$/.test(target[name])))
      throw Error('POSITION_EVALUATOR_TARGETS_INVALID');
    const key = `${target.provider}:${target.directionId}:${target.routeId}:${target.targetStopId}`;
    if (seen.has(key)) throw Error('POSITION_EVALUATOR_TARGETS_INVALID');
    seen.add(key);
  }
  return targets;
}
