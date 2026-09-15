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
      destinations: ['梶が谷駅'], providers: ['tokyu'], displayLimit: 3 },
    { id: 'kibukihoncho_miyamae_washigamine', hubId: 'kibukihoncho', label: '宮前平・鷲ヶ峰方面',
      destinations: ['宮前平駅', '宮前区役所前', '鷲ヶ峰営業所前', '新百合丘駅前',
        '聖マリアンナ医科大学', '菅生車庫', '向丘出張所'],
      providers: ['kawasaki'], displayLimit: 3 }
  ]),
  sources: freezeList([
    { provider: 'kawasaki', sourceId: 'home_to_noborito', decisionGroupId: 'kibukihoncho_north', walkMinutes: null },
    { provider: 'tokyu', sourceId: 'kibukihoncho_to_mukougaoka', decisionGroupId: 'kibukihoncho_north', walkMinutes: null },
    { provider: 'kawasaki', sourceId: 'home_to_mizonokuchi', decisionGroupId: 'kibukihoncho_mizonokuchi', walkMinutes: null },
    { provider: 'tokyu', sourceId: 'kibukihoncho_to_kajigaya', decisionGroupId: 'kibukihoncho_kajigaya', walkMinutes: null },
    { provider: 'kawasaki', sourceId: 'kibukihoncho_to_miyamae_washigamine',
      decisionGroupId: 'kibukihoncho_miyamae_washigamine', walkMinutes: null }
  ]),
  unresolved: freezeList([])
});

export const MIZONOKUCHI_MINAMIGUCHI_HUB = Object.freeze({
  id: 'mizonokuchi-minamiguchi',
  label: '溝の口駅南口',
  decisionGroups: freezeDecisionGroups([
    { id: 'mizonokuchi_minamiguchi_home', hubId: 'mizonokuchi-minamiguchi', label: '神木本町方面',
      destinations: ['神木本町'], providers: ['kawasaki'], displayLimit: 3 }
  ]),
  sources: freezeList([
    { provider: 'kawasaki', sourceId: 'mizonokuchi_to_home',
      decisionGroupId: 'mizonokuchi_minamiguchi_home', walkMinutes: null }
  ]),
  unresolved: freezeList([])
});

export const TACHIKAWA_EKIKITAGUCHI_HUB = Object.freeze({
  id: 'tachikawa-ekikitaguchi',
  label: '立川駅北口',
  decisionGroups: freezeDecisionGroups([
    { id: 'tachikawa_showa_daiichi_gakuen', hubId: 'tachikawa-ekikitaguchi', label: '昭和第一学園方面',
      destinations: ['昭和第一学園', '昭和第一学園西門'], providers: ['seibu'], displayLimit: 3 }
  ]),
  sources: freezeList([
    { provider: 'seibu', sourceId: 'tachikawa_to_showa_daiichi_gakuen',
      decisionGroupId: 'tachikawa_showa_daiichi_gakuen', walkMinutes: null }
  ]),
  unresolved: freezeList([])
});

export const SHOWA_DAIICHI_GAKUEN_HUB = Object.freeze({
  id: 'showa-daiichi-gakuen',
  label: '昭和第一学園',
  decisionGroups: freezeDecisionGroups([
    { id: 'showa_daiichi_gakuen_tachikawa', hubId: 'showa-daiichi-gakuen', label: '立川駅方面',
      destinations: ['立川駅北口'], providers: ['seibu'], displayLimit: 3 }
  ]),
  sources: freezeList([
    { provider: 'seibu', sourceId: 'showa_daiichi_gakuen_to_tachikawa',
      decisionGroupId: 'showa_daiichi_gakuen_tachikawa', walkMinutes: null }
  ]),
  unresolved: freezeList([])
});

export const NOBORITO_EKI_HUB = Object.freeze({
  id: 'noborito-eki',
  label: '登戸駅',
  decisionGroups: freezeDecisionGroups([
    { id: 'noborito_kibukihoncho', hubId: 'noborito-eki', label: '神木本町方面',
      destinations: ['神木本町経由'], providers: ['kawasaki'], displayLimit: 3 }
  ]),
  sources: freezeList([
    { provider: 'kawasaki', sourceId: 'noborito_to_home',
      decisionGroupId: 'noborito_kibukihoncho', walkMinutes: null }
  ]),
  unresolved: freezeList([])
});

export const MUKOUGAOKA_YUEN_MINAMIGUCHI_HUB = Object.freeze({
  id: 'mukougaoka-yuen-minamiguchi',
  label: '向ヶ丘遊園駅南口',
  decisionGroups: freezeDecisionGroups([
    { id: 'mukougaoka_kibukihoncho', hubId: 'mukougaoka-yuen-minamiguchi', label: '神木本町方面',
      destinations: ['神木本町経由'], providers: ['kawasaki', 'tokyu'], displayLimit: 3 }
  ]),
  sources: freezeList([
    { provider: 'kawasaki', sourceId: 'mukougaoka_to_kibukihoncho',
      decisionGroupId: 'mukougaoka_kibukihoncho', walkMinutes: null },
    { provider: 'tokyu', sourceId: 'mukougaoka_to_kibukihoncho',
      decisionGroupId: 'mukougaoka_kibukihoncho', walkMinutes: null }
  ]),
  unresolved: freezeList([])
});

export const HUBS = Object.freeze([KIBUKIHONCHO_HUB, MIZONOKUCHI_MINAMIGUCHI_HUB,
  TACHIKAWA_EKIKITAGUCHI_HUB, SHOWA_DAIICHI_GAKUEN_HUB, NOBORITO_EKI_HUB,
  MUKOUGAOKA_YUEN_MINAMIGUCHI_HUB]);
