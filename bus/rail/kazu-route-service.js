import { KAZU_MODES, minutes, validateKazuStatic } from './kazu-commute.js';

const JST = 9 * 3600;
const LABELS = Object.freeze({
  hibiya: '日比谷', yoyogiuehara: '代々木上原', seijogakuenmae: '成城学園前',
  noborito: '登戸', jimbocho: '神保町', shibuya: '渋谷', meguro: '目黒',
  ookayama: '大岡山', oimachi: '大井町', tamachi: '田町', mizonokuchi: '溝の口'
});
const DESTINATIONS = Object.freeze({ YoyogiUehara: '代々木上原', Karakida: '唐木田',
  MukogaokaYuen: '向ヶ丘遊園', SeijogakuenMae: '成城学園前', Isehara: '伊勢原',
  HonAtsugi: '本厚木', NishiTakashimadaira: '西高島平', Takashimadaira: '高島平',
  Ebina: '海老名', Hiyoshi: '日吉', MusashiKosugi: '武蔵小杉', ShinYokohama: '新横浜',
  Nishiya: '西谷', Shonandai: '湘南台', ChuoRinkan: '中央林間', Nagatsuta: '長津田',
  Ofuna: '大船', Isogo: '磯子', Kamata: '蒲田', Sakuragicho: '桜木町',
  Tsurumi: '鶴見', HigashiKanagawa: '東神奈川' });
const SEGMENT = Object.freeze({
  chiyoda: { line: '千代田線', from: 'hibiya', to: 'yoyogiuehara' },
  odakyu_uehara_noborito: { line: '小田急線', from: 'yoyogiuehara', to: 'noborito' },
  odakyu_uehara_seijo: { line: '小田急線', from: 'yoyogiuehara', to: 'seijogakuenmae' },
  odakyu_seijo_noborito: { line: '小田急線', from: 'seijogakuenmae', to: 'noborito' },
  mita_jimbocho: { line: '三田線', from: 'hibiya', to: 'jimbocho' },
  hanzomon: { line: '半蔵門線', from: 'jimbocho', to: 'shibuya' },
  denentoshi: { line: '田園都市線', from: 'shibuya', to: 'mizonokuchi' },
  mita_meguro: { line: '三田線', from: 'hibiya', to: 'meguro' },
  meguro: { line: '目黒線', from: 'meguro', to: 'ookayama' },
  oimachi_from_ookayama: { line: '大井町線', from: 'ookayama', to: 'mizonokuchi' },
  keihin_tohoku: { line: '京浜東北線', from: 'tamachi', to: 'oimachi' },
  oimachi_from_oimachi: { line: '大井町線', from: 'oimachi', to: 'mizonokuchi' }
});
const CORRIDORS = Object.freeze({
  chiyoda_odakyu: { firstAction: '千代田線へ', terminal: 'noborito',
    paths: [['chiyoda', 'odakyu_uehara_noborito'],
      ['chiyoda', 'odakyu_uehara_seijo', 'odakyu_seijo_noborito']] },
  jimbocho_denentoshi: { firstAction: '三田線へ', terminal: 'mizonokuchi',
    paths: [['mita_jimbocho', 'hanzomon', 'denentoshi']] },
  ookayama_oimachi: { firstAction: '三田線へ', terminal: 'mizonokuchi',
    paths: [['mita_meguro', 'meguro', 'oimachi_from_ookayama']] },
  tamachi_oimachi: { firstAction: '京浜東北線へ', terminal: 'mizonokuchi',
    paths: [['keihin_tohoku', 'oimachi_from_oimachi']] }
});
const MODES = Object.freeze({
  hibiya: ['chiyoda_odakyu', 'jimbocho_denentoshi', 'ookayama_oimachi'],
  tamachi: ['tamachi_oimachi'], pharmacy: ['chiyoda_odakyu']
});
// Conservative, explicit station access and transfer estimates; editable without changing rail data.
export const KAZU_TRANSFER_MINUTES = Object.freeze({ access: 5,
  yoyogiuehara: 4, seijogakuenmae: 3, jimbocho: 4, shibuya: 4,
  meguro: 4, ookayama: 4, oimachi: 6, noborito: 8,
  noborito_tamagawa: 11, mizonokuchi: 6 });

const localDate = (now) => new Date((now + JST) * 1000).toISOString().slice(0, 10);
const dateStart = (now) => Math.floor((now + JST) / 86400) * 86400 - JST;
const legTime = (day, value) => day + minutes(value) * 60;
const corridorStatus = (id) => ({ id, firstAction: CORRIDORS[id].firstAction,
  status: 'unavailable', rank: null, reason: 'RAIL_TIMETABLE_UNAVAILABLE',
  steps: [], homeArrivalAt: null, durationMinutes: null });

function findRailPath(artifact, calendarType, day, now, corridor) {
  const paths = [];
  for (const sequence of corridor.paths) {
    let states = [{ at: now + KAZU_TRANSFER_MINUTES.access * 60, steps: [], trainId: null }];
    for (const segmentId of sequence) {
      const config = SEGMENT[segmentId];
      const candidates = artifact.legs.filter((leg) => leg.segment === segmentId
        && leg.calendarType === calendarType);
      const next = [];
      for (const leg of candidates) {
        const departureAt = legTime(day, leg.departure);
        const stationTimeAt = legTime(day, leg.stationTime)
          + (minutes(leg.stationTime) < minutes(leg.departure) ? 86400 : 0);
        if (stationTimeAt <= departureAt || stationTimeAt > now + 5 * 3600) continue;
        const previous = states.find((state) => departureAt >= state.at
          + (state.steps.length && state.trainId !== leg.trainId
            ? (KAZU_TRANSFER_MINUTES[config.from] ?? 4) * 60 : 0));
        if (!previous) continue;
        const change = previous.steps.length && stateChange(previous, leg);
        const transfer = change ? { type: 'transfer', station: LABELS[config.from],
          nextLine: config.line, nextTrainType: leg.trainType,
          nextDestination: DESTINATIONS[leg.destination] || leg.destination } : null;
        next.push({ at: stationTimeAt, trainId: leg.trainId,
          steps: [...previous.steps, ...(transfer ? [transfer] : []), {
            type: 'train', line: config.line, from: LABELS[config.from], to: LABELS[config.to],
            departureAt, stationTimeAt, stationTimeSource: leg.stationTimeSource,
            trainType: leg.trainType, destination: DESTINATIONS[leg.destination] || leg.destination,
            quality: 'static' }] });
      }
      // One state per target train is sufficient: earlier arrival dominates later arrival.
      const byTrain = new Map();
      for (const state of next.sort((a, b) => a.at - b.at))
        if (!byTrain.has(state.trainId)) byTrain.set(state.trainId, state);
      states = [...byTrain.values()];
      if (!states.length) break;
    }
    paths.push(...states.filter((state) => state.steps.length));
  }
  return paths.sort((a, b) => a.at - b.at);
}
const stateChange = (state, leg) => state.trainId !== leg.trainId;

export function createKazuRouteService({ artifact, loadBuses, clock = () => Date.now() / 1000 } = {}) {
  validateKazuStatic(artifact);
  if (typeof loadBuses !== 'function' || typeof clock !== 'function')
    throw Error('KAZU_RUNTIME_INVALID');
  return Object.freeze({ async evaluate(mode) {
    if (!KAZU_MODES.includes(mode)) throw Error('KAZU_MODE_INVALID');
    const now = clock();
    if (!Number.isFinite(now)) throw Error('KAZU_CLOCK_INVALID');
    const serviceDate = localDate(now);
    const calendarType = artifact.calendarOverrides?.[serviceDate]
      || ([0, 6].includes(new Date(`${serviceDate}T00:00:00Z`).getUTCDay())
        ? 'weekend' : 'weekday');
    const day = dateStart(now);
    const routes = await Promise.all(MODES[mode].map(async (id) => {
      const corridor = CORRIDORS[id];
      const railPaths = findRailPath(artifact, calendarType, day, now, corridor);
      const rail = railPaths[0];
      if (!rail) return corridorStatus(id);
      const terminal = corridor.terminal;
      const result = { id, firstAction: corridor.firstAction, status: 'available', rank: null,
        station: LABELS[terminal], stationTimeAt: rail.at, steps: rail.steps,
        homeArrivalAt: null, durationMinutes: null, quality: 'rail_static' };
      if (mode === 'pharmacy') return { ...result, durationMinutes: Math.ceil((rail.at - now) / 60) };
      const boardingAt = Math.max(now, rail.at) + KAZU_TRANSFER_MINUTES[terminal] * 60;
      let buses;
      try { buses = await loadBuses({ terminal, boardingAt, now }); }
      catch { return { ...result, status: 'partial', reason: 'BUS_SOURCE_UNAVAILABLE' }; }
      const choices = [];
      for (const path of railPaths) for (const bus of Array.isArray(buses) ? buses : []) {
        const transferMinutes = bus.queryId === 'noborito_tamagawa_to_kibukihoncho'
          ? KAZU_TRANSFER_MINUTES.noborito_tamagawa : KAZU_TRANSFER_MINUTES[terminal];
        if (bus?.recommendable !== true || !Number.isFinite(bus.estimatedArrival)
          || !Number.isFinite(bus.departureAt)
          || bus.departureAt < path.at + transferMinutes * 60) continue;
        choices.push({ path, bus, transferMinutes });
      }
      choices.sort((a, b) => a.bus.estimatedArrival - b.bus.estimatedArrival
        || a.path.at - b.path.at || a.bus.departureAt - b.bus.departureAt);
      const choice = choices[0];
      if (!choice) return { ...result, status: 'partial', reason: 'BUS_ARRIVAL_UNAVAILABLE' };
      const { path, bus, transferMinutes } = choice;
      const boardingPlace = bus.queryId === 'noborito_tamagawa_to_kibukihoncho'
        ? '登戸駅多摩川口' : terminal === 'noborito' ? '登戸駅のりば' : '溝の口駅南口';
      return { ...result, stationTimeAt: path.at, homeArrivalAt: bus.estimatedArrival,
        durationMinutes: Math.ceil((bus.estimatedArrival - now) / 60),
        quality: bus.timingQuality === 'realtime_arrival' ? 'bus_realtime' : 'bus_static',
        steps: [...path.steps, { type: 'walk', from: LABELS[terminal], to: boardingPlace,
          minutes: transferMinutes }, { type: 'bus', provider: bus.provider,
          boardingPlace,
          routeLabel: bus.routeLabel, platform: bus.platform,
          departureAt: bus.departureAt, homeArrivalAt: bus.estimatedArrival,
          timingQuality: bus.timingQuality, delayMinutes: bus.delayMinutes }] };
    }));
    const available = routes.filter((route) => mode === 'pharmacy'
      ? Number.isFinite(route.stationTimeAt) : Number.isFinite(route.homeArrivalAt))
      .sort((a, b) => (mode === 'pharmacy'
        ? a.stationTimeAt - b.stationTimeAt : a.homeArrivalAt - b.homeArrivalAt));
    available.forEach((route, index) => { route.rank = index + 1; route.differenceMinutes = index
      ? Math.round(((mode === 'pharmacy' ? route.stationTimeAt : route.homeArrivalAt)
        - (mode === 'pharmacy' ? available[0].stationTimeAt : available[0].homeArrivalAt)) / 60) : 0; });
    return { mode, generatedAt: new Date(now * 1000).toISOString(), serviceDate,
      calendarType, status: available.length === routes.length ? 'available'
        : available.length ? 'partial' : 'insufficient_data',
      firstAction: available[0]?.firstAction ?? null,
      routes: [...available, ...routes.filter((route) => !available.includes(route))] };
  } });
}
