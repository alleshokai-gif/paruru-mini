export const MUKOUGAOKA_TO_KIBUKIHONCHO = Object.freeze({
  id: 'mukougaoka_to_kibukihoncho',
  type: 'favorite',
  group: 'journey',
  provider: 'kawasaki',
  label: '向ヶ丘遊園駅南口 → 神木本町',
  from: '向ヶ丘遊園駅南口',
  to: '神木本町',
  fromStopIds: Object.freeze(['474_5']),
  toStopIds: Object.freeze(['184_1']),
  routeIds: Object.freeze(['10037'])
});

// 184_3 -> 469_2 is the verified common first segment for the westbound services.
// The actual destination remains the per-trip GTFS headsign; 10037 stays in the
// existing Mukougaoka decision group and is deliberately excluded here.
export const KIBUKIHONCHO_TO_MIYAMAE_WASHIGAMINE = Object.freeze({
  id: 'kibukihoncho_to_miyamae_washigamine',
  type: 'favorite',
  group: 'hub',
  provider: 'kawasaki',
  label: '神木本町 → 宮前平・鷲ヶ峰方面',
  from: '神木本町',
  to: '宮前平・鷲ヶ峰方面',
  fromStopIds: Object.freeze(['184_3']),
  toStopIds: Object.freeze(['469_2']),
  routeIds: Object.freeze(['10032', '10033', '10034', '10035', '10036', '10044', '10045'])
});

export const KAWASAKI_JOURNEY_QUERIES = Object.freeze([
  MUKOUGAOKA_TO_KIBUKIHONCHO,
  KIBUKIHONCHO_TO_MIYAMAE_WASHIGAMINE
]);
