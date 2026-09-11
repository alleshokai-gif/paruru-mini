export const PROVIDER_ID = 'kawasaki';
export const REALTIME_SCHEMA_VERSION = 2;
export const API_ROOT = 'https://api.odpt.org/api/v4/';
export const REALTIME_PATH = 'gtfs/realtime/odpt_TransportationBureau_CityOfKawasaki_AllLines_trip_update';
// Confirmed official platform labels. Never infer a platform number from the stop ID suffix.
export const PLATFORMS = Object.freeze({ '184_1': '1番', '184_2': '2番', '362_1': '登05のりば',
  '434_2': '2番', '434_3': '3番', '434_4': '4番' });
export const resolvePlatform = (stopId) => PLATFORMS[stopId] || null;
