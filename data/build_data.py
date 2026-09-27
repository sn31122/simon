# Builds portfolio-data.js (window.PORTFOLIO_DATA) for dashboard.html from the CSVs in this folder.
# Run after every data change:  python build_data.py   (exit code 1 = data error, nothing written)
import csv, json, datetime, pathlib, sys, urllib.parse

D = pathlib.Path(__file__).resolve().parent
LOGO_DIR = 'company-logos'   # Scalable logos (128x128 PNG, file = <ISIN>.png), copied 1:1 from Downloads/scalable-company-pictures/images
NOTES = [
    'Rückrechnung mit den Stückzahlen vom 02.09.2026 (keine Transaktionshistorie): Werte vor dem Kaufdatum sind hypothetisch.',
    'Kurse: Scalable-Tagesschluss (year_to_date, Mid, EUR, CONSOLIDATED). Tageskurse gibt es erst ab 02.01.2026.',
    'Vor dem ersten Kurs eines Titels (z. B. SpaceX ab 12.06.2026) zählt er mit dem ersten Kurs, also ohne Wertänderung.',
    'Reine Kursentwicklung in EUR: Dividenden ausschüttender Aktien sind nicht enthalten, Währungseffekte stecken in den EUR-Kursen.',
]

SPLIT_RATIOS = (2, 3, 4, 5, 8, 10, 20, 25, 50, 100, 200)   # day-to-day price ratios that usually mean a split

def num(s):
    return float(s) if s.strip() else None

pos = list(csv.DictReader(open(D/'positions.csv', encoding='utf-8')))
bench = list(csv.DictReader(open(D/'benchmarks.csv', encoding='utf-8')))   # presets (today only "Mein Depot")
inst = {r['isin']: r for r in csv.DictReader(open(D/'instruments.csv', encoding='utf-8'))}   # names for the benchmark search
with open(D/'prices_daily.csv', encoding='utf-8') as f:
    rd = csv.reader(f)
    head = next(rd)
    rows = [r for r in rd if r]
isins = head[3:]
dates, status = [r[0] for r in rows], [r[1] for r in rows]
errors, warns = [], []
for a, b in zip(dates, dates[1:]):
    if b <= a: errors.append(f'dates not ascending/unique: {a} -> {b}')
for k, d in enumerate(dates):
    if datetime.date.fromisoformat(d).weekday() > 4: errors.append(f'weekend date {d}')
    if status[k] not in ('final', 'intraday'): errors.append(f'bad status {status[k]!r} on {d}')
    if status[k] == 'intraday' and k != len(rows) - 1: errors.append(f'intraday row {d} is not the last row')
prices = {}
for j, i in enumerate(isins):
    s = [num(r[3 + j]) if 3 + j < len(r) else None for r in rows]
    prices[i] = s
    last = None
    for d, v in zip(dates, s):
        if v is None: continue
        if v <= 0: errors.append(f'{i} {d}: non-positive price {v}')
        elif last:
            q = max(v / last, last / v)
            split = next((k for k in SPLIT_RATIOS if abs(q / k - 1) < 0.03), None)
            if split or q > 1.3:
                warns.append(f'{i} {d}: {last:g} -> {v:g} ({(v / last - 1) * 100:+.1f} %)'
                             + (f' SPLIT 1:{split}? divide the history before {d} if confirmed' if split else ' check value'))
        last = v
    if last is None: errors.append(f'{i}: column has no prices')
benchmarks = []
for b in bench:
    h = {x.split(':')[0]: float(x.split(':')[1]) for x in b['holdings'].split('|')}
    benchmarks.append({'id': b['id'], 'name': b['name'], 'description': b['description'], 'holdings': h})
needed = [p['isin'] for p in pos] + [i for b in benchmarks for i in b['holdings']]
for i in dict.fromkeys(needed):
    if i not in prices: errors.append(f'missing price column {i}')
needed += isins                          # every price column is an instrument the benchmark cards can pick
for i in isins:
    if i not in inst: warns.append(f'{i}: no row in instruments.csv (isin,name,short,type) - the benchmark search shows the ISIN only')
if errors:
    print('ERRORS (nothing written):', *errors, sep='\n  ')
    sys.exit(1)

def first_date(i):
    return next(d for d, v in zip(dates, prices[i]) if v is not None)

def logo_for(p):
    # logos live in ../company-logos, named "<ISIN>.png"; an optional `logo` column overrides the file name
    f = (p.get('logo') or '').strip() or p['isin'] + '.png'
    if (D.parent / LOGO_DIR / f).is_file():
        return LOGO_DIR + '/' + urllib.parse.quote(f)
    warns.append(f"{p['isin']} {p['name']}: no logo {LOGO_DIR}/{f} (initials are shown instead)")
    return None

# ---- intraday grid for the 1T chart: 30-min slots 07:30 .. 23:00 Europe/Berlin (Scalable trading hours), last 2 sessions
INTRADAY_DAYS, SLOT_MIN, FIRST_MIN, LAST_MIN = 2, 30, 7 * 60 + 30, 23 * 60
TIMES = ['%02d:%02d' % divmod(m, 60) for m in range(FIRST_MIN, LAST_MIN + 1, SLOT_MIN)]

def _last_sunday(y, m):
    d = datetime.date(y, m, 31)
    while d.weekday() != 6: d -= datetime.timedelta(1)
    return d

def to_berlin(t):
    start = datetime.datetime.combine(_last_sunday(t.year, 3), datetime.time(1), datetime.timezone.utc)
    end = datetime.datetime.combine(_last_sunday(t.year, 10), datetime.time(1), datetime.timezone.utc)
    return (t + datetime.timedelta(hours=2 if start <= t < end else 1)).replace(tzinfo=None)

def build_intraday(needed):
    f = D/'intraday.csv'
    if not f.exists(): return None
    grid, asof, outside = {}, None, 0          # (isin, day) -> {slot: (ts, price)}
    for r in csv.DictReader(open(f, encoding='utf-8')):
        ts = datetime.datetime.fromisoformat(r['timestamp_utc'].replace('Z', '+00:00')).astimezone(datetime.timezone.utc)
        b = to_berlin(ts)
        slot = round((b.hour * 60 + b.minute + b.second / 60 - FIRST_MIN) / SLOT_MIN)   # 05:59:39 UTC -> 08:00 Berlin
        if not 0 <= slot < len(TIMES): outside += 1; continue
        cell = grid.setdefault((r['isin'], b.date().isoformat()), {})
        if slot not in cell or ts > cell[slot][0]: cell[slot] = (ts, float(r['price']))
        asof = max(asof or ts, ts)
    days = [d for d in sorted({d for _, d in grid}) if d in dates][-INTRADAY_DAYS:]
    if len(days) < 2: warns.append('intraday.csv: fewer than 2 sessions - 1T uses daily prices'); return None
    if days[-1] != dates[-1] or dates.index(days[-1]) - dates.index(days[0]) != len(days) - 1:
        warns.append(f'intraday.csv sessions {days} do not match the last daily dates {dates[-2:]} - 1T uses daily prices')
    px, missing = {}, []
    for i in needed:
        arr = [None] * (len(days) * len(TIMES))
        for k, d in enumerate(days):
            for s, (_, p) in grid.get((i, d), {}).items(): arr[k * len(TIMES) + s] = p
        if all(v is None for v in arr): missing.append(i); continue
        px[i] = arr
        last = next((v for v in reversed(arr) if v is not None), None)
        daily = prices[i][dates.index(days[-1])] if days[-1] in dates else None
        if last and daily and abs(last / daily - 1) > 0.005:
            warns.append(f'{i}: last intraday price {last:g} differs from the daily price {daily:g} on {days[-1]} by {(last / daily - 1) * 100:+.2f} %')
    if missing: warns.append('no intraday prices (flat at the daily price in 1T): ' + ', '.join(missing))
    if outside: warns.append(f'intraday.csv: {outside} points outside 07:30-23:00 Berlin ignored')
    return {'dates': days, 'times': TIMES, 'asof_utc': asof.strftime('%Y-%m-%dT%H:%MZ'), 'px': px}

positions = [{'isin': p['isin'], 'name': p['name'], 'short': p['short'], 'group': p['group'], 'shares': float(p['shares']),
              'ref_date': p['ref_date'], 'ref_price': float(p['ref_price']), 'gv_ref': float(p['gv_ref']),
              'cost_basis': float(p['cost_basis']), 'note': p['note'], 'first_date': first_date(p['isin']),
              'logo': logo_for(p)} for p in pos]
data = {
    'meta': {'title': 'Yacht-Portfolio', 'currency': 'EUR',
             'source': 'Scalable MCP get_security_chart year_to_date (Tagesschluss, Mid, EUR)',
             'generated_at': datetime.datetime.now().astimezone().isoformat(timespec='seconds'),
             'first_date': dates[0], 'last_date': dates[-1], 'last_status': status[-1],
             'last_asof_utc': rows[-1][2], 'positions_ref_date': pos[0]['ref_date'], 'notes': NOTES},
    'dates': dates,
    'status': status,
    'groups': list(dict.fromkeys(p['group'] for p in pos)),
    'positions': positions,
    'benchmarks': benchmarks,
    # instruments for the benchmark cards: every price column, sorted by short name
    'instruments': sorted(({'isin': i, 'name': (inst.get(i) or {}).get('name') or i, 'short': (inst.get(i) or {}).get('short') or i,
                            'type': (inst.get(i) or {}).get('type') or '', 'position': i in {p['isin'] for p in pos}}
                           for i in isins), key=lambda x: x['short'].casefold()),
    'prices': {i: prices[i] for i in dict.fromkeys(needed)},
    'intraday': build_intraday(list(dict.fromkeys(needed))),
}
js = ('// Generated by build_data.py from positions.csv, benchmarks.csv, instruments.csv, prices_daily.csv, intraday.csv. Do not edit by hand.\n'
      '(typeof window !== "undefined" ? window : globalThis).PORTFOLIO_DATA = '
      + json.dumps(data, ensure_ascii=False, separators=(',', ':')) + ';\n')
(D/'portfolio-data.js').write_text(js, encoding='utf-8')
print(f'portfolio-data.js: {len(dates)} dates {dates[0]} -> {dates[-1]} ({status[-1]}), '
      f'{len(positions)} positions, {len(benchmarks)} benchmarks, {len(data["instruments"])} instruments, {len(data["prices"])} price series'
      + (f', intraday {data["intraday"]["dates"]} ({len(data["intraday"]["px"])} series, asof {data["intraday"]["asof_utc"]})'
         if data['intraday'] else ', no intraday'))
gaps = {i: sum(v is None for v in prices[i]) for i in data['prices'] if any(v is None for v in prices[i])}
if gaps: print('empty cells per ISIN:', gaps)
if warns: print('WARNINGS:', *warns, sep='\n  ')
