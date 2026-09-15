export const PROVIDER_ID = 'seibu';
export const ARTIFACT_SCHEMA_VERSION = 1;
export const API_ROOT = 'https://api.odpt.org/api/v4/';
export const STATIC_PATH = 'files/SeibuBus/data/SeibuBus-GTFS.zip';
export const TRIP_UPDATE_PATH = 'gtfs/realtime/SeibuBus_trip_update';
export const VEHICLE_PATH = 'gtfs/realtime/SeibuBus_vehicle';
export const RT_CACHE_SEC = 25;

export const TACHIKAWA_TO_SCHOOL_SOURCE = 'tachikawa_to_showa_daiichi_gakuen';
export const SCHOOL_TO_TACHIKAWA_SOURCE = 'showa_daiichi_gakuen_to_tachikawa';

// Verified against Seibu Bus GTFS feed_version 20260824 (valid 2026-09-01..2026-10-31).
// A blank GTFS route_short_name is represented explicitly; no route number is inferred.
export const TARGET_ROUTES = Object.freeze([
  { routeId: '251001', routeLabel: '立３４', outboundFrom: '70131-03', outboundTo: '70191-01-03-05', inboundFrom: '70191-02' },
  { routeId: '251006', routeLabel: '系統番号なし', outboundFrom: '70131-08', outboundTo: '70191-01-03-05', inboundFrom: '70191-02' },
  { routeId: '251009', routeLabel: '立３４－１', outboundFrom: '70131-03', outboundTo: '70191-01-03-05', inboundFrom: '70191-02' },
  { routeId: '301002', routeLabel: '立３７', outboundFrom: '70131-05-09', outboundTo: '70191-01-03-05', inboundFrom: '70191-02' },
  { routeId: '301004', routeLabel: '立３５', outboundFrom: '70131-05-09', outboundTo: '70191-01-03-05', inboundFrom: '70191-02' },
  { routeId: '301008', routeLabel: '立３６', outboundFrom: '70131-05-09', outboundTo: '70191-01-03-05', inboundFrom: '70191-02' },
  { routeId: '302001', routeLabel: '立４０', outboundFrom: '70131-01', outboundTo: '70191-01-03-05', inboundFrom: '70191-02' },
  { routeId: '306001/309007', routeLabel: '立３９', outboundFrom: '70131-06', outboundTo: '70191-01-03-05', inboundFrom: '70191-02' },
  { routeId: '306002', routeLabel: '立３８', outboundFrom: '70131-06', outboundTo: '70191-01-03-05', inboundFrom: '70191-02' },
  { routeId: '306004-1', routeLabel: '深夜', outboundFrom: '70131-06', outboundTo: '70191-01-03-05', inboundFrom: null },
  { routeId: '306009/309008', routeLabel: '立４５', outboundFrom: '70131-06', outboundTo: '70191-01-03-05', inboundFrom: '70191-02' },
  { routeId: '306010', routeLabel: '立３３', outboundFrom: '70131-06', outboundTo: '70191-01-03-05', inboundFrom: '70191-02' },
  { routeId: '307003', routeLabel: '立３２', outboundFrom: '70131-01', outboundTo: '70181-01', inboundFrom: '70181-02-15' }
].map(Object.freeze));

export const STOPS = Object.freeze({
  tachikawaPlatform6: '70131-05-09',
  tachikawaPlatform7Primary: '70131-03',
  tachikawaPlatform7Secondary: '70131-08',
  tachikawaPlatform8: '70131-06',
  tachikawaPlatform9: '70131-01',
  tachikawaArrival: '70131-15',
  schoolOutbound: '70191-01-03-05',
  schoolInbound: '70191-02',
  schoolWestOutbound: '70181-01',
  schoolWestInbound: '70181-02-15'
});

export const DIRECTIONS = Object.freeze([
  Object.freeze({ id: TACHIKAWA_TO_SCHOOL_SOURCE, fromName: '立川駅北口',
    targetNames: Object.freeze(['昭和第一学園', '昭和第一学園西門']) }),
  Object.freeze({ id: SCHOOL_TO_TACHIKAWA_SOURCE, fromName: '昭和第一学園',
    targetNames: Object.freeze(['立川駅北口']) })
]);
