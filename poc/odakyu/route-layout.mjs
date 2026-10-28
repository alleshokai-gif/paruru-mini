// Display coordinates only. The timetable index and routing engine stay unchanged.
export function stationLayout(stations, important, transfers, compact = false, top = 145, metricsFor = null) {
  const ordered = [...stations].sort((a, b) => a.index - b.index);
  if (!ordered.length || ordered.some((s, i) => !Number.isFinite(s.index) || (i && s.index <= ordered[i - 1].index))) throw Error('STATION_ORDER_INVALID');
  let bottom = top;
  const rows = ordered.map(station => {
    const major = important.has(station.id), transfer = transfers.has(station.id);
    const defaults = { height: transfer ? (compact ? 132 : 112) : major ? (compact ? 82 : 76) : (compact ? 15 : 21) };
    const metrics = metricsFor?.(station, { major, transfer }) || defaults;
    const { height } = metrics, offset = metrics.centerOffset ?? height / 2;
    if (!(height > 0) || !(offset > 0 && offset < height)) throw Error('STATION_METRICS_INVALID');
    const row = { station, major, height, top: bottom, center: bottom + offset };
    bottom += height;
    return row;
  });
  function y(index) {
    if (!Number.isFinite(index)) throw Error('POSITION_INVALID');
    if (index <= rows[0].station.index) return rows[0].center;
    for (let i = 1; i < rows.length; i++) {
      const a = rows[i - 1], b = rows[i];
      if (index <= b.station.index) return a.center + (b.center - a.center) * (index - a.station.index) / (b.station.index - a.station.index);
    }
    return rows.at(-1).center;
  }
  return { rows, y, height: bottom };
}
