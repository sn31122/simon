# One-off (2026-09-25): builds ../prices_daily.csv from the raw Scalable MCP sources in this folder.
# All prices: Scalable mid, EUR, source CONSOLIDATED; one year_to_date point per trading day = daily close.
#   scalable_ytd_2026-09-22.csv    year_to_date closes 2026-01-02..2026-09-21 (fetched 2026-09-22)
#   scalable_fetch_2026-09-25.json closes 22.-24.09. + intraday 25.09. (30 positions), full year_to_date
#                                  for IE00BGBN6P67 / IE00B4ND3602
#   ytd_<ISIN>.csv                 benchmark year_to_date series (fetched 2026-09-25, raw timestamp_utc,mid_price)
# Later updates edit ../prices_daily.csv directly (see ../../AGENTS.md); do not rerun this script.
import csv, json, datetime, pathlib

S = pathlib.Path(__file__).resolve().parent
BENCH_ONLY = ['IE00B53SZB19', 'IE00B4L5Y983', 'DE0005933931', 'IE00BMC38736', 'IE00BK5BQT80']

def _last_sunday(y, m):
    d = datetime.date(y, m, 31)
    while d.weekday() != 6: d -= datetime.timedelta(1)
    return d

def berlin_date(ts):
    t = datetime.datetime.fromisoformat(ts.replace('Z', '+00:00'))
    start = datetime.datetime.combine(_last_sunday(t.year, 3), datetime.time(1), datetime.timezone.utc)
    end = datetime.datetime.combine(_last_sunday(t.year, 10), datetime.time(1), datetime.timezone.utc)
    return (t + datetime.timedelta(hours=2 if start <= t < end else 1)).date().isoformat()

pos = [r['isin'] for r in csv.DictReader(open(S.parent/'positions.csv', encoding='utf-8'))]
cols = pos + BENCH_ONLY
px = {i: {} for i in cols}
for r in csv.DictReader(open(S/'scalable_ytd_2026-09-22.csv', encoding='utf-8')):
    px[r['isin']][r['date']] = float(r['price'])
fetch = json.load(open(S/'scalable_fetch_2026-09-25.json'))
for i, series in (*fetch['closes'].items(), *fetch['ytd'].items()):
    for d, v in series.items(): px[i].setdefault(d, v)
mismatch = []
for i in BENCH_ONLY:
    f = S/f'ytd_{i}.csv'
    if not f.exists(): print('missing', f.name); continue
    last = {}
    for r in csv.DictReader(open(f, encoding='utf-8')):
        d = berlin_date(r['timestamp_utc'])
        if d not in last or r['timestamp_utc'] > last[d][0]: last[d] = (r['timestamp_utc'], float(r['mid_price']))
    for d, (_, v) in last.items():
        if d in px[i] and abs(px[i][d] - v) > 1e-9: mismatch.append((i, d, px[i][d], v))
        px[i].setdefault(d, v)
dates = sorted({d for s in px.values() for d in s})
intraday = fetch['intraday_date']
with open(S.parent/'prices_daily.csv', 'w', encoding='utf-8', newline='') as f:
    w = csv.writer(f)
    w.writerow(['date', 'status', 'asof_utc', *cols])
    for d in dates:
        live = d == intraday
        w.writerow([d, 'intraday' if live else 'final', fetch['intraday_asof_utc'] if live else '',
                    *('%.10g' % px[i][d] if d in px[i] else '' for i in cols)])
print(len(dates), 'dates', dates[0], '->', dates[-1])
print('missing cells:', {i: len(dates) - len(px[i]) for i in cols if len(px[i]) < len(dates)})
print('overlap mismatches (old 22.09 fetch vs new benchmark fetch):', len(mismatch))
for m in mismatch[:20]: print(' ', m)
