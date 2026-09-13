const freezeList = (rows) => Object.freeze(rows.map((row) => Object.freeze({ ...row })));

export const KIBUKIHONCHO_HUB = Object.freeze({
  id: 'kibukihoncho',
  label: '神木本町Hub',
  purposes: freezeList([
    { id: 'noborito', label: '登戸方面' },
    { id: 'mizonokuchi', label: '溝の口方面' },
    { id: 'kajigaya', label: '梶が谷方面' },
    { id: 'mukougaoka', label: '向ヶ丘遊園方面' }
  ]),
  sources: freezeList([
    { provider: 'kawasaki', sourceId: 'home_to_noborito', purposeId: 'noborito', walkMinutes: null },
    { provider: 'kawasaki', sourceId: 'home_to_mizonokuchi', purposeId: 'mizonokuchi', walkMinutes: null },
    { provider: 'tokyu', sourceId: 'kibukihoncho_to_kajigaya', purposeId: 'kajigaya', walkMinutes: null },
    { provider: 'tokyu', sourceId: 'kibukihoncho_to_mukougaoka', purposeId: 'mukougaoka', walkMinutes: null }
  ]),
  unresolved: freezeList([])
});
