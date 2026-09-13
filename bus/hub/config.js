const freezeList = (rows) => Object.freeze(rows.map((row) => Object.freeze({ ...row })));
const freezeDecisionGroups = (rows) => Object.freeze(rows.map((row) => Object.freeze({
  ...row,
  destinations: Object.freeze([...row.destinations]),
  providers: Object.freeze([...row.providers])
})));

export const KIBUKIHONCHO_HUB = Object.freeze({
  id: 'kibukihoncho',
  label: '神木本町',
  decisionGroups: freezeDecisionGroups([
    { id: 'kibukihoncho_north', hubId: 'kibukihoncho', label: '登戸・向ヶ丘遊園方面',
      destinations: ['登戸駅', '向ヶ丘遊園駅南口'], providers: ['kawasaki', 'tokyu'], displayLimit: 3 },
    { id: 'kibukihoncho_mizonokuchi', hubId: 'kibukihoncho', label: '溝の口方面',
      destinations: ['溝口駅南口'], providers: ['kawasaki'], displayLimit: 3 },
    { id: 'kibukihoncho_kajigaya', hubId: 'kibukihoncho', label: '梶が谷方面',
      destinations: ['梶が谷駅'], providers: ['tokyu'], displayLimit: 3 }
  ]),
  sources: freezeList([
    { provider: 'kawasaki', sourceId: 'home_to_noborito', decisionGroupId: 'kibukihoncho_north', walkMinutes: null },
    { provider: 'tokyu', sourceId: 'kibukihoncho_to_mukougaoka', decisionGroupId: 'kibukihoncho_north', walkMinutes: null },
    { provider: 'kawasaki', sourceId: 'home_to_mizonokuchi', decisionGroupId: 'kibukihoncho_mizonokuchi', walkMinutes: null },
    { provider: 'tokyu', sourceId: 'kibukihoncho_to_kajigaya', decisionGroupId: 'kibukihoncho_kajigaya', walkMinutes: null }
  ]),
  unresolved: freezeList([])
});
