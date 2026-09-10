"""Research-only extraction of stop geometry for explicitly observed trips.

Does not write the source ZIP, full tables, or the production static artifact.
"""
import csv
import io
import json
from pathlib import Path
import sys
import zipfile

BUS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BUS))
import validate_odpt as validation


def main():
    capture = Path(sys.argv[1]).resolve()
    if capture.parent != (BUS / 'generated').resolve():
        raise ValueError()
    evidence = json.loads(capture.read_text(encoding='utf-8'))
    observed = {v['tripId'] for s in evidence['samples'] for d in s['directions'] for v in d['vehicles']}
    selected = set(sys.argv[2].split(','))
    if not selected or len(selected) > 24 or not selected <= observed:
        raise ValueError()
    token = validation.read_token()
    validation.SECRET = token
    static_date = evidence['sourceVersion'].split('_')[-1]
    data, meta = validation.fetch('static', token, static_date)
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        if sum(i.file_size for i in archive.infolist()) > validation.MAX_EXPANDED_BYTES:
            raise ValueError()

        def rows(name, required=True):
            paths = [p for p in archive.namelist() if p.rsplit('/', 1)[-1] == name]
            if len(paths) != 1:
                if not required and not paths:
                    return
                raise ValueError()
            with archive.open(paths[0]) as entry:
                yield from csv.DictReader(io.TextIOWrapper(entry, encoding='utf-8-sig', newline=''))

        trips = {r['trip_id']: r for r in rows('trips.txt') if r['trip_id'] in selected}
        if set(trips) != selected:
            raise ValueError()
        chains = {tid: [] for tid in selected}
        for row in rows('stop_times.txt'):
            if row['trip_id'] in selected:
                chains[row['trip_id']].append(row)
        needed = {s['stop_id'] for chain in chains.values() for s in chain}
        stops = {r['stop_id']: r for r in rows('stops.txt') if r['stop_id'] in needed}
        shapes = {r['shape_id']: [] for r in trips.values() if r.get('shape_id')}
        for row in rows('shapes.txt', False):
            if row['shape_id'] in shapes:
                shapes[row['shape_id']].append({k: row[k] for k in ('shape_pt_lat', 'shape_pt_lon', 'shape_pt_sequence')})
        output = []
        for tid in sorted(selected):
            chain = sorted(chains[tid], key=lambda r: int(r['stop_sequence']))
            if not chain or len({r['stop_sequence'] for r in chain}) != len(chain):
                raise ValueError()
            output.append({'tripId': tid, 'routeId': trips[tid]['route_id'], 'headsign': trips[tid]['trip_headsign'],
                           'shapeId': trips[tid].get('shape_id') or None,
                           'stops': [{'sequence': int(r['stop_sequence']), 'stopId': r['stop_id'],
                                      'name': stops[r['stop_id']]['stop_name'],
                                      'lat': float(stops[r['stop_id']]['stop_lat']),
                                      'lon': float(stops[r['stop_id']]['stop_lon']),
                                      'departure': r['departure_time']} for r in chain]})
    target = capture.with_name(capture.stem + '-static.json')
    if target.exists():
        raise ValueError()
    encoded = json.dumps({'researchOnly': True, 'sourceVersion': evidence['sourceVersion'],
                          'fetchedAt': meta['fetchedAt'], 'sourceSha256': meta['sha256'],
                          'trips': output, 'shapes': shapes}, ensure_ascii=False, indent=2)
    if token in encoded:
        raise ValueError()
    temp = target.with_suffix('.json.tmp')
    temp.write_text(encoded + '\n', encoding='utf-8')
    temp.replace(target)
    validation.emit({'status': 'POSITION_STATIC_EXTRACTED', 'trips': len(output),
                     'stops': len(needed), 'withShape': len(shapes), 'summaryBytes': target.stat().st_size})


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('{"status":"POSITION_STATIC_EXTRACTION_FAILED"}')
        sys.exit(1)
