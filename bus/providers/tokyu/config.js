export const PROVIDER_ID = 'tokyu';
export const STATIC_SCHEMA_VERSION = 1;
export const API_ROOT = 'https://api.odpt.org/api/v4/';
export const STATIC_CACHE_SEC = 6 * 60 * 60;
export const STATIC_MAX_BYTES = 2 * 1024 * 1024;
export const STATIC_REQUEST_TIMEOUT_MS = 15000;

export const KIBUKIHONCHO_TO_KAJIGAYA = Object.freeze({
  sourceId: 'kibukihoncho_to_kajigaya',
  operatorId: 'odpt.Operator:TokyuBus',
  routeId: 'odpt.Busroute:TokyuBus.Kou01',
  routeLabel: '向０１',
  routePatternId: 'odpt.BusroutePattern:TokyuBus.Kou01.0004600073',
  directionId: 'odpt.BusDirection:TokyuBus.Kajigayaeki',
  fromStopId: 'odpt.BusstopPole:TokyuBus.Shibokuhonchou.00240751.a',
  fromStopName: '神木本町',
  fromStopIndex: 10,
  platform: 'a',
  destinationStopId: 'odpt.BusstopPole:TokyuBus.Kajigayaeki.00240688.',
  destinationName: '梶が谷駅'
});

export const KIBUKIHONCHO_TO_MUKOUGAOKA = Object.freeze({
  sourceId: 'kibukihoncho_to_mukougaoka',
  operatorId: 'odpt.Operator:TokyuBus',
  routeId: 'odpt.Busroute:TokyuBus.Kou01',
  routeLabel: '向０１',
  routePatternId: 'odpt.BusroutePattern:TokyuBus.Kou01.0004600232',
  directionId: 'odpt.BusDirection:TokyuBus.MukougaokayuuenEkiminamiguchi',
  fromStopId: 'odpt.BusstopPole:TokyuBus.Shibokuhonchou.00240751.b',
  fromStopName: '神木本町',
  fromStopIndex: 8,
  platform: 'b',
  destinationStopId: 'odpt.BusstopPole:TokyuBus.MukougaokayuuenEkiminamiguchi.00240650.',
  destinationName: '向ヶ丘遊園駅南口'
});

export const MUKOUGAOKA_TO_KIBUKIHONCHO = Object.freeze({
  sourceId: 'mukougaoka_to_kibukihoncho',
  operatorId: 'odpt.Operator:TokyuBus',
  routeId: 'odpt.Busroute:TokyuBus.Kou01',
  routeLabel: '向０１',
  routePatternId: 'odpt.BusroutePattern:TokyuBus.Kou01.0004600073',
  directionId: 'odpt.BusDirection:TokyuBus.Kajigayaeki',
  fromStopId: 'odpt.BusstopPole:TokyuBus.MukougaokayuuenEkiminamiguchi.00240650.6',
  fromStopName: '向ヶ丘遊園駅南口',
  fromStopIndex: 1,
  platform: '6',
  targetStopId: 'odpt.BusstopPole:TokyuBus.Shibokuhonchou.00240751.a',
  targetStopName: '神木本町',
  targetStopIndex: 10,
  destinationStopId: 'odpt.BusstopPole:TokyuBus.Kajigayaeki.00240688.',
  destinationName: '梶が谷駅'
});

export const TOKYU_HUB_DIRECTIONS = Object.freeze([
  KIBUKIHONCHO_TO_KAJIGAYA,
  KIBUKIHONCHO_TO_MUKOUGAOKA,
  MUKOUGAOKA_TO_KIBUKIHONCHO
]);

export const CALENDARS = Object.freeze({
  weekday: 'odpt.Calendar:Weekday',
  saturday: 'odpt.Calendar:Saturday',
  sunday: 'odpt.Calendar:Sunday'
});
