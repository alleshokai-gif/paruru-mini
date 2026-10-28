import { TYPES, clock } from './core.mjs';
import { scheduledPosition, arrivalOrderReversals } from './navigation.mjs';
import { stationLayout } from './route-layout.mjs';

const TARGETS = ['Noborito', 'MukogaokaYuen'];
const MAJOR = ['YoyogiUehara', 'ShimoKitazawa', 'Kyodo', 'SeijogakuenMae', ...TARGETS];
// A compact route junction, never a cross-operator train identity or position.
const APPROACH_HEIGHT = 64;
const departure = t => t.stops[0].departure ?? t.stops[0].arrival;
const type = t => t.type === 'Local' ? '各停' : TYPES[t.type];
const arrival = (t, id) => t.stops.find(s => s.station === id && s.stop)?.arrival;
const order = (a, b) => departure(a) - departure(b) || a.id.localeCompare(b.id);
const MARKER = Object.freeze({ height:48, glyphHalf:13, eventOffset:49, infoHeight:40 });
function el(tag, text, cls, parent) {
  const n = document.createElement(tag);
  if (text !== undefined) n.textContent = text;
  if (cls) n.className = cls;
  parent?.append(n);
  return n;
}
function at(n, top, left) { n.style.top = `${top}px`; if (left !== undefined) n.style.left = `${left}px`; return n; }

function svgElement(tag, attributes, parent) {
  const n = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attributes)) n.setAttribute(key, String(value));
  parent?.append(n); return n;
}

function drawApproaches(map, layout, top, width, junctionX) {
  const ue = layout.rows.find(r => r.station.id === 'YoyogiUehara');
  const leftX = junctionX - 32, rightX = junctionX + 32;
  const startY = top + 26, bendY = startY + 12, mergeY = ue.center - 24;
  const svg = svgElement('svg', { class:'m-route-structure', viewBox:`0 0 ${width} ${layout.height}`, 'aria-hidden':'true' }, map);
  svg.style.height = `${layout.height}px`;
  svgElement('path', { class:'m-inbound-line m-shinjuku', d:`M ${leftX} ${startY} V ${bendY} L ${junctionX} ${mergeY}` }, svg);
  svgElement('path', { class:'m-inbound-line m-chiyoda', d:`M ${rightX} ${startY} V ${bendY} L ${junctionX} ${mergeY}` }, svg);
  svgElement('path', { class:'m-corridor-line', d:`M ${junctionX} ${mergeY} V ${layout.rows.at(-1).center}` }, svg);
  for (const row of layout.rows.filter(r => r.major && r.station.index >= ue.station.index)) {
    svgElement('circle', { class:'m-corridor-node', cx:junctionX, cy:row.center, r:row === ue ? 6 : 4 }, svg);
  }
  at(el('strong', '新宿', 'm-inbound-title m-shinjuku-label', map), top, leftX - 24);
  at(el('strong', '千代田線', 'm-inbound-title m-chiyoda-label', map), top, rightX + 14);
}

// Position resolution is separate from interaction/placement. A missing position
// stays a published departure event; no time-based extrapolation or observation.
export function trainMarker(train, now, layout) {
  const point = scheduledPosition(train, now);
  if (point) return { kind:'scheduled', observed:false, point, top:layout.y(point.index) - MARKER.glyphHalf };
  const origin = layout.rows.find(r => r.station.id === train.stops[0].station);
  return { kind:'departure', observed:false, point:null, top:origin.top + MARKER.eventOffset };
}

function freeInfoTop(preferred, blocked, layout) {
  const candidates = [preferred, preferred - MARKER.height - MARKER.infoHeight,
    ...layout.rows.map(r => r.top + 50), ...blocked.map(b => b.bottom + 6)];
  return candidates.filter(top => top >= 0 && top + MARKER.infoHeight <= layout.height
    && blocked.every(b => top + MARKER.infoHeight <= b.top || top >= b.bottom))
    .sort((a, b) => Math.abs(a - preferred) - Math.abs(b - preferred))[0] ?? layout.height;
}

// A departure-order neighbor is never labelled as a known physical position.
export function mobileNeighbors(pool, selected, now) {
  const point = scheduledPosition(selected, now);
  const queue = pool.filter(t => t.stops[0].station === selected.stops[0].station).sort(order);
  const i = queue.findIndex(t => t.id === selected.id);
  if (point) {
    const others = pool.filter(t => t.id !== selected.id).map(train => ({ train, point: scheduledPosition(train, now) })).filter(t => t.point);
    const closest = side => others.filter(t => side * (t.point.index - point.index) > 0)
      .sort((a, b) => Math.abs(a.point.index - point.index) - Math.abs(b.point.index - point.index) || order(a.train, b.train))[0]?.train;
    const front = closest(1), rear = closest(-1);
    const before = front || (queue[i - 1]?.id !== rear?.id ? queue[i - 1] : undefined);
    const after = rear || (queue[i + 1]?.id !== before?.id ? queue[i + 1] : undefined);
    return { before, after, beforeKind:front ? 'position' : 'departure', afterKind:rear ? 'position' : 'departure' };
  }
  return { before:queue[i - 1], after:queue[i + 1], beforeKind:'departure', afterKind:'departure' };
}

// Both widths use the same diagram and interaction. Only density changes.
export function renderRouteMap({ root, model, pool, selected, now, plans, onSelect, compact }) {
  const name = id => model.stations.find(s => s.id === id)?.name || id;
  const legs = new Map();
  for (const plan of plans.filter(p => p.recommendation?.transfers && p.recommendation.saving > 0 && p.recommendation.connection === 'likely')) {
    for (const leg of plan.recommendation.legs) {
      const key = `${leg.fromTrainId}:${leg.trainId}:${leg.station}`;
      if (!legs.has(key)) legs.set(key, { leg, plan });
    }
  }
  const partnerIds = [...new Set([...legs.values()].map(({ leg }) => leg.trainId))];
  const partners = partnerIds.map(id => pool.find(t => t.id === id)).filter(Boolean);
  const nearby = pool.filter(t => scheduledPosition(t, now) || (departure(t) >= now && departure(t) <= now + 15))
    .sort((a, b) => Math.abs(departure(a) - now) - Math.abs(departure(b) - now) || order(a, b));
  let slots;
  if (selected) {
    const neighbors = mobileNeighbors(pool, selected, now);
    const left = partners[1] || (neighbors.before?.id !== partners[0]?.id ? neighbors.before : neighbors.after);
    const right = partners[0] || (neighbors.after?.id !== left?.id ? neighbors.after : null);
    slots = [left || null, selected, right || null];
    if (!compact) {
      const extras = nearby.filter(t => !slots.some(s => s?.id === t.id)).slice(0, 4).sort(order);
      slots = [extras[0] || null, extras[1] || null, ...slots, extras[2] || null, extras[3] || null];
    }
  } else slots = nearby.slice(0, compact ? 3 : 7).sort(order);

  const transferStations = new Set([...legs.values()].map(({ leg }) => leg.station));
  const majors = new Set([...MAJOR, ...transferStations]);
  const ordered = [...model.stations].sort((a, b) => a.index - b.index), runs = [], runSizes = new Map();
  let run = [];
  for (const s of [...ordered, null]) {
    if (s && !majors.has(s.id)) run.push(s);
    else if (run.length) { runs.push(run); for (const item of run) runSizes.set(item.id, run.length); run = []; }
  }
  const eventStations = new Set(slots.filter(t => t && !scheduledPosition(t, now)).map(t => t.stops[0].station));
  const selectedEventStation = selected && !scheduledPosition(selected, now) ? selected.stops[0].station : null;
  const approachTop = 14;
  const ueIndex = ordered.find(s => s.id === 'YoyogiUehara').index;
  const upstreamCount = ordered.filter(s => s.index < ueIndex).length;
  const layout = stationLayout(model.stations, majors, transferStations, compact, approachTop, (s, { major, transfer }) => {
    if (s.index < ueIndex) return { height:s.id === 'Shinjuku' ? APPROACH_HEIGHT - (upstreamCount - 1) * 10 : 10, centerOffset:s.id === 'Shinjuku' ? 18 : 5 };
    let height = transfer ? 156 : TARGETS.includes(s.id) ? 148 : major ? 88 : 38 / runSizes.get(s.id);
    if (eventStations.has(s.id)) height = Math.max(height, transfer ? 224 : selectedEventStation === s.id ? 152 : 112);
    return { height, centerOffset:major ? 32 : undefined };
  });
  const map = el('div', undefined, 'm-map'); map.style.height = `${layout.height + 12}px`;
  map.setAttribute('aria-label', '電車を直接選択する縦型路線図');
  const labelWidth = compact ? 100 : 150, laneWidth = (root.clientWidth - labelWidth) / Math.max(slots.length, 1);
  const x = i => labelWidth + laneWidth * (i + .5);
  drawApproaches(map, layout, approachTop, root.clientWidth, labelWidth + 8);
  for (const item of layout.rows) {
    const { station:s, top, height, center, major } = item;
    const row = at(el('div', undefined, `m-row${s.index < ueIndex ? ' m-approach-row' : ''}${major ? ' m-major' : ' m-minor'}${TARGETS.includes(s.id) ? ' m-target' : ''}`, map), top);
    row.dataset.station = s.id; row.style.height = `${height}px`;
    if (major) at(el('strong', s.name, 'm-station', row), center - top - 11, 8);
    else row.setAttribute('aria-label', s.name);
    if (eventStations.has(s.id)) at(el('small', '発時刻', 'm-event-label', row), MARKER.eventOffset + 8, 8);
  }
  for (const group of runs) {
    if (group[0].index < ueIndex) continue; // Already labelled on the Shinjuku branch.
    const first = layout.rows.find(r => r.station.id === group[0].id);
    const text = group.length === 1 ? group[0].name : `${group[0].name} … ${group.at(-1).name}`;
    at(el('span', text, 'm-compressed', map), first.top + 8, 8).title = group.map(s => s.name).join(' → ');
  }
  const markers = new Map(slots.filter(Boolean).map(train => [train.id, trainMarker(train, now, layout)]));
  const selectedPoint = markers.get(selected?.id)?.point;
  slots.forEach((train, i) => {
    if (!train) return;
    const marker = markers.get(train.id), point = marker.point;
    const own = train.id === selected?.id, target = partnerIds.includes(train.id);
    const role = own ? '選択' : target ? '乗換先' : selectedPoint && point ? (point.index > selectedPoint.index ? '前方' : '後方') : '列車';
    const lane = at(el('div', undefined, `m-lane ${train.type}${own ? ' m-own' : ''}${target ? ' m-partner' : ''}`, map), 0, x(i));
    lane.dataset.train = train.id;
    const indices = train.stops.filter(s => s.stop).map(s => s.index);
    if (indices.length) {
      const line = at(el('div', undefined, 'm-track', lane), layout.y(Math.min(...indices)));
      line.style.height = `${layout.y(Math.max(...indices)) - layout.y(Math.min(...indices))}px`;
    }
    for (const stop of train.stops.filter(s => s.stop)) at(el('span', '●', 'm-stop', lane), layout.y(stop.index)).title = `${name(stop.station)} 停車`;
    for (const id of train.knownPasses.filter(id => !train.stops.some(s => s.station === id && s.stop))) {
      const s = ordered.find(s => s.id === id); if (s) at(el('span', '×', 'm-pass', lane), layout.y(s.index)).title = `${s.name} 通過`;
    }
    const icon = at(el('button', undefined, `m-train${marker.kind === 'departure' ? ' m-event' : ''}`, lane), marker.top);
    icon.type = 'button'; icon.onclick = () => onSelect(train.id); icon.setAttribute('aria-pressed', String(own));
    icon.setAttribute('aria-label', `${clock(departure(train))} ${type(train)} ${train.destination}行を選択`);
    icon.dataset.positionKind = marker.kind; icon.dataset.observed = String(marker.observed);
    icon.title = `${role} / ${point ? '定刻推定' : '発時刻マーク・現在位置未取得'}`;
    el('span', '🚆', 'm-icon', icon);
    el('strong', `${own ? '★' : target ? '↔' : ''}${clock(departure(train))}${marker.kind === 'departure' ? '発' : ''}`, undefined, icon);
    for (const d of TARGETS) {
      const time = arrival(train, d), s = ordered.find(s => s.id === d), p = plans.find(p => p.destination === d);
      const cell = at(el('span', Number.isInteger(time) ? clock(time) : train.knownPasses.includes(d) ? '通過' : '未取得', `m-arrival${Number.isInteger(time) ? '' : ' m-missing'}`, lane), layout.y(s.index) + 13);
      cell.dataset.destination = d;
      el('small', `${own ? '★' : target ? '↔' : ''}${clock(departure(train))}発`, undefined, cell);
      if (own && p?.recommendation?.transfers === 0) el('b', 'そのまま', 'm-verdict', cell);
      if (target && p?.recommendation?.legs.at(-1)?.trainId === train.id) el('b', `先着${p.recommendation.saving > 0 ? ` −${p.recommendation.saving}分` : ''}`, 'm-verdict', cell);
      if (own && !Number.isInteger(time)) {
        const ref = model.tCodeReferences?.find(r => r.tripId === train.id && r.status === 'unique_reference');
        const a = el('a', '公式 ↗', 'm-official', cell);
        a.href = ref?.url || 'https://www.odakyu.jp'; a.target = '_blank'; a.rel = 'noreferrer';
        a.title = ref ? `${ref.serviceDate}の参照` : '小田急公式';
      }
    }
  });
  for (const { leg, plan } of legs.values()) {
    const from = pool.find(t => t.id === leg.fromTrainId), to = pool.find(t => t.id === leg.trainId);
    const row = layout.rows.find(r => r.station.id === leg.station);
    const note = at(el('div', undefined, 'm-transfer', map), row.top + (eventStations.has(leg.station) ? 152 : 64), 104);
    note.dataset.from = from.id; note.dataset.to = to.id; note.dataset.station = leg.station;
    el('strong', `↔ ${type(from)} → ${type(to)}`, undefined, note);
    el('span', `${clock(leg.departure)}発 · ${name(plan.destination)} ${clock(plan.recommendation.arrival)}着${plan.recommendation.saving > 0 ? ` −${plan.recommendation.saving}分` : ''}`, undefined, note);
    el('small', '接続見込み・未保証', undefined, note);
  }
  if (selected) {
    const marker = markers.get(selected.id);
    const blocked = [...markers.values()].map(m => ({ top:m.top - 4, bottom:m.top + MARKER.height + 4 }));
    for (const row of layout.rows.filter(r => r.major)) blocked.push({ top:row.center - 10, bottom:row.center + 10 });
    for (const row of layout.rows.filter(r => TARGETS.includes(r.station.id))) blocked.push({ top:row.center + 10, bottom:row.top + row.height });
    for (const { leg } of legs.values()) {
      const row = layout.rows.find(r => r.station.id === leg.station), top = row.top + (eventStations.has(leg.station) ? 152 : 64);
      blocked.push({ top:top - 4, bottom:top + 68 });
    }
    const row = selectedEventStation && layout.rows.find(r => r.station.id === selectedEventStation);
    const top = row ? row.top + 104 : freeInfoTop(marker.top + MARKER.height + 6, blocked, layout);
    const info = at(el('div', undefined, 'm-train-info', map), top, labelWidth + 4);
    info.setAttribute('role', 'status'); info.dataset.train = selected.id;
    el('strong', `${type(selected)} ${selected.destination}行${marker.kind === 'departure' ? ' · 位置未取得' : ''}`, undefined, info);
    const time = id => Number.isInteger(arrival(selected, id)) ? clock(arrival(selected, id)) : selected.knownPasses.includes(id) ? '通過' : '未取得';
    el('span', `登戸 ${time('Noborito')} / 遊園 ${time('MukogaokaYuen')}`, undefined, info);
    map.style.height = `${Math.max(layout.height + 12, top + MARKER.infoHeight + 12)}px`;
  }
  if (selected) {
    const reversals = slots.filter(t => t && t.id !== selected.id).flatMap(other => arrivalOrderReversals(selected, other));
    for (const id of new Set(reversals.map(r => r.to))) {
      const row = layout.rows.find(r => r.station.id === id);
      const n = at(el('small', '先着順逆転', 'm-reversal', map), row.top + 61, 8);
      n.title = '区間の着発順序が逆転。追越し地点は未確認';
    }
  }
  if (!slots.length) at(el('span', '未取得', 'm-dock-label', map), 24, 110);
  root.replaceChildren(map);
}
