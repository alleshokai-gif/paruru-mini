const freezeChildren = (rows) => Object.freeze(rows.map((row) => Object.freeze({ ...row })));

export const NOBORITO_MUKOUGAOKA_JOURNEY = Object.freeze({
  id: 'noborito-mukougaoka',
  label: '登戸・遊園',
  children: freezeChildren([
    { id: 'noborito', hubId: 'noborito-eki', decisionGroupId: 'noborito_kibukihoncho',
      label: '登戸駅', purposeLabel: '神木本町方面' },
    { id: 'mukougaoka', hubId: 'mukougaoka-yuen-minamiguchi', decisionGroupId: 'mukougaoka_kibukihoncho',
      label: '向ヶ丘遊園駅南口', purposeLabel: '神木本町方面' }
  ])
});

export const JOURNEYS = Object.freeze([NOBORITO_MUKOUGAOKA_JOURNEY]);
