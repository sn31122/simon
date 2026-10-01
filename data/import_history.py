# Daily closes before 2026 from finanzen.net (fixed, fetched once) -> prices_history_daily.csv, merged into prices_history.csv.
# Scalable keeps handling everything from 2026 on (update_prices.py). User 02.10.2026: Xetra, closes only, as far back as
# possible (asked for 1995; finanzen.net serves only the last 20 years, so the import of 02.10.2026 starts 04.10.2006).
#
#   python data/import_history.py --fetch                 every stock (type Aktie in instruments.csv) not fetched yet
#   python data/import_history.py --fetch ISIN[,ISIN]     these ISINs (again)
#   python data/import_history.py --import FILE --isin ISIN   a CSV the user exported by hand (ETFs/ETPs): columns
#                                                         Datum/Date + Schluss/Schlusskurs/Close (German or English numbers)
#   python data/import_history.py --merge                 only re-merge prices_history_daily.csv into prices_history.csv
#   add --dry-run to only report.
# Fetch: finanzen.net's ISIN search gives the stock page (/aktien/<slug>-aktie); the history page
# /historische-kurse/<slug>?from=<20 years back>&to=2025-12-31&exchange=XETRA holds every day in one HTML table (close = "Schluss").
# Days Xetra lacks are filled from Frankfurt (FSE), then gettex (BMN), then Tradegate (TGT); data/history_sources.csv
# records slug, days per exchange and coverage. One request per second; nothing else is fetched.
# Checks before an ISIN is written: the page names the ISIN; the closes agree with the Scalable history archived in
# data/source/prices_history_scalable_2026-10-02.csv (median deviation <= 1.5 %, else the ISIN is refused and reported).
# Merge (idempotent): every date of prices_history_daily.csv becomes a row of prices_history.csv with res "dh" (daily
# history) and that ISIN's close; other cells (ETFs still monthly / every 2nd day from Scalable) stay as they are.
import csv, datetime, html, pathlib, re, statistics, subprocess, sys, time, urllib.error, urllib.request

if hasattr(sys.stdout, 'reconfigure'): sys.stdout.reconfigure(encoding='utf-8', errors='replace')
D = pathlib.Path(__file__).resolve().parent
DAILY_H = D / 'prices_history_daily.csv'
SOURCES = D / 'history_sources.csv'
HIST = D / 'prices_history.csv'
BACKUP = D / 'source' / 'prices_history_scalable_2026-10-02.csv'   # the Scalable-only history before the first merge
# user 02.10.2026: from 1995 (dot-com, GFC) - but finanzen.net answers HTTP 500 for any start more than 20 years back
# (tested 02.10.2026: 03.10.2006 works, 25.09.2006 fails), so the earliest possible start is today minus 20 years
_lim = datetime.date.today().replace(year=datetime.date.today().year - 20) + datetime.timedelta(days=2)
FROM, TO = max('1995-01-01', _lim.isoformat()), '2025-12-31'
EXCHANGES = ['XETRA', 'FSE', 'BMN', 'TGT']                        # Xetra first (user), then fill missing days
UA = {'User-Agent': 'Mozilla/5.0 (personal portfolio dashboard; one-time history import)'}
MAX_MEDIAN_DEV = 1.5                                               # % vs. the Scalable history on common dates
args = sys.argv[1:]
dry = '--dry-run' in args


def num(s):
    s = s.strip().replace('EUR', '').strip()
    if not s or s in ('-', '–'): return None
    if ',' in s: s = s.replace('.', '').replace(',', '.')
    return float(s)


def read_wide(f, key_cols=1):
    if not f.exists(): return [], {}
    with open(f, encoding='utf-8') as fh:
        rd = csv.reader(fh); h = next(rd)
        return h, {r[0]: {h[k]: r[k] for k in range(key_cols, len(r)) if r[k]} for r in rd if r}


def write_daily(table):
    cols = sorted({i for v in table.values() for i in v})
    with open(DAILY_H, 'w', encoding='utf-8', newline='') as f:
        w = csv.writer(f, lineterminator='\n'); w.writerow(['date'] + cols)
        for d in sorted(table): w.writerow([d] + [table[d].get(i, '') for i in cols])


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k): return None


def get(url, follow=True):
    time.sleep(1.0)
    op = urllib.request.build_opener() if follow else urllib.request.build_opener(NoRedirect)
    try:
        r = op.open(urllib.request.Request(url, headers=UA), timeout=90)
        return r.status, r.read().decode('utf-8', 'replace'), r.headers.get('Location')
    except urllib.error.HTTPError as e:
        return e.code, '', e.headers.get('Location')


def slug_for(isin, cache):
    if cache.get(isin): return cache[isin]
    code, _, loc = get(f'https://www.finanzen.net/suchergebnis.asp?_search={isin}', follow=False)
    m = re.search(r'/aktien/([^/?#]+)-aktie', loc or '')
    if not m: raise ValueError(f'search gave no stock page (HTTP {code}, {loc or "no redirect"})')
    return m.group(1)


def history(slug, isin, ex):
    code, s, _ = get(f'https://www.finanzen.net/historische-kurse/{slug}?from={FROM}&to={TO}&exchange={ex}')
    if code != 200: return None
    if isin not in s: raise ValueError(f'the history page of {slug} does not name {isin}')
    out = {}
    for row in re.findall(r'<tr[^>]*>(.*?)</tr>', s, re.S):
        c = [html.unescape(re.sub(r'<[^>]+>', '', x)).strip() for x in re.findall(r'<td[^>]*>(.*?)</td>', row, re.S)]
        if len(c) == 6 and re.fullmatch(r'\d\d\.\d\d\.\d{4}', c[0]):
            d = f'{c[0][6:]}-{c[0][3:5]}-{c[0][:2]}'
            v = num(c[2])
            if v and v > 0 and FROM <= d <= TO and datetime.date.fromisoformat(d).weekday() < 5: out[d] = v
    return out


def check(isin, closes, backup):
    """-> (ok, text): compare with the archived Scalable history on common dates."""
    common = [(d, closes[d], float(backup[d][isin])) for d in closes if d in backup and isin in backup[d]]
    if len(common) < 5: return True, f'{len(common)} common dates with the Scalable history (too few to compare)'
    devs = [abs(a / b - 1) * 100 for _, a, b in common]
    med, big = statistics.median(devs), sum(x > 5 for x in devs)
    worst = max(common, key=lambda x: abs(x[1] / x[2] - 1))
    txt = (f'{len(common)} common dates, median deviation {med:.2f} %, {big} > 5 %, worst {worst[0]} '
           f'{worst[1]:g} vs Scalable {worst[2]:g}')
    return med <= MAX_MEDIAN_DEV, txt


def merge():
    """prices_history_daily.csv -> prices_history.csv (res dh). -> summary line"""
    _, daily = read_wide(DAILY_H)
    if not daily: return 'nothing to merge'
    with open(D / 'prices_daily.csv', encoding='utf-8') as f: cols = next(csv.reader(f))[3:]
    first_daily = next(r for r in csv.reader(open(D / 'prices_daily.csv', encoding='utf-8')) if r and r[0][:1].isdigit())[0]
    table = {}
    with open(HIST, encoding='utf-8') as f:
        rd = csv.reader(f); hh = next(rd)
        for r in rd:
            if r: table[r[0]] = dict({'res': r[1]}, **{hh[k]: r[k] for k in range(2, len(r)) if r[k]})
    n = 0
    for d, v in daily.items():
        if d >= first_daily: continue
        row = table.setdefault(d, {})
        row['res'] = 'dh'
        for i, p in v.items():
            if i in cols and row.get(i) != p: row[i] = p; n += 1
    if not dry:
        with open(HIST, 'w', encoding='utf-8', newline='') as f:
            w = csv.writer(f, lineterminator='\n'); w.writerow(['date', 'res'] + cols)
            for d in sorted(table): w.writerow([d, table[d]['res']] + [table[d].get(i, '') for i in cols])
    nd = sum(1 for v in table.values() if v['res'] == 'dh')
    return (f'prices_history.csv: {len(table)} rows {min(table)} .. {max(table)}, {nd} daily-history rows, {n} cells set '
            f'from prices_history_daily.csv ({len({i for v in daily.values() for i in v})} ISINs)')


def rebuild_and_test():
    def run(c):
        p = subprocess.run(c, cwd=D.parent, capture_output=True, text=True, encoding='utf-8', errors='replace')
        return p.returncode, (p.stdout or '') + (p.stderr or '')
    code, o = run([sys.executable, str(D / 'build_data.py')])
    if code: print(o); print('STOP: build_data.py failed'); return 1
    for ln in o.splitlines():
        if 'history' in ln and ('SPLIT' in ln or 'check' in ln): print('  build: ' + ln.strip())
    c1, o1 = run(['node', 'tests/engine.test.cjs'])
    c2, _ = run([sys.executable, 'tests/crosscheck.py'])
    c3, o3 = run(['node', 'tests/crosscheck.cjs'])
    t1 = next((ln for ln in o1.splitlines() if ln.startswith('engine tests')), 'engine tests: no result')
    t3 = next((ln for ln in o3.splitlines() if ln.startswith('crosscheck')), 'crosscheck: no result')
    print('Tests: ' + ('OK - ' if not (c1 or c2 or c3) else 'FAILED - ') + t1 + '; ' + t3)
    return 1 if c1 or c2 or c3 else 0


if '--merge' in args:
    print(merge()); sys.exit(0 if dry else rebuild_and_test() if '--no-build' not in args else 0)

if not BACKUP.exists() and not dry:                   # keep the Scalable-only history once, as the reference for checks
    BACKUP.parent.mkdir(exist_ok=True); BACKUP.write_bytes(HIST.read_bytes())
_, backup = read_wide(BACKUP if BACKUP.exists() else HIST, key_cols=2)
_, daily = read_wide(DAILY_H)
src_rows = {r['isin']: r for r in csv.DictReader(open(SOURCES, encoding='utf-8'))} if SOURCES.exists() else {}
inst = {r['isin']: r for r in csv.DictReader(open(D / 'instruments.csv', encoding='utf-8'))}
results, refused = {}, []

if '--import' in args:
    f, isin = pathlib.Path(args[args.index('--import') + 1]).expanduser(), args[args.index('--isin') + 1].upper()
    if isin not in inst: sys.exit(f'STOP: {isin} is not in instruments.csv')
    text = f.read_text(encoding='utf-8-sig', errors='replace')
    delim = ';' if text.count(';') > text.count(',') else ','
    rows = [r for r in csv.reader(text.splitlines(), delimiter=delim) if r]
    h = [x.strip().casefold() for x in rows[0]]
    di = next((k for k, x in enumerate(h) if x in ('datum', 'date')), None)
    ci = next((k for k, x in enumerate(h) if x in ('schluss', 'schlusskurs', 'close', 'schlusspreis')), None)
    if di is None or ci is None: sys.exit(f'STOP: {f.name}: need a Datum/Date and a Schluss/Close column, found {rows[0]}')
    closes = {}
    for r in rows[1:]:
        ds = r[di].strip()
        m = re.fullmatch(r'(\d\d)\.(\d\d)\.(\d{4})', ds) or re.fullmatch(r'(\d{4})-(\d\d)-(\d\d)', ds)
        if not m: continue
        d = ds if '-' in ds else f'{m.group(3)}-{m.group(2)}-{m.group(1)}'
        v = num(r[ci])
        if v and v > 0 and d <= TO and datetime.date.fromisoformat(d).weekday() < 5: closes[d] = v
    results[isin] = (closes, {'manual': len(closes)}, f'file {f.name}')
else:
    if '--fetch' not in args: sys.exit(__doc__ or 'usage: --fetch [ISIN,…] | --import FILE --isin ISIN | --merge')
    k = args.index('--fetch')
    want = [x.strip().upper() for x in args[k + 1].split(',')] if k + 1 < len(args) and not args[k + 1].startswith('--') else \
        [i for i, r in inst.items() if r['type'] == 'Aktie' and i not in src_rows]
    print(f'fetching {len(want)} ISIN(s) from finanzen.net ({FROM} .. {TO}, {" > ".join(EXCHANGES)}) ...')
    for n, isin in enumerate(want, 1):
        try:
            slug = slug_for(isin, {i: r['slug'] for i, r in src_rows.items()})
            got, closes, per = {}, {}, {}
            for ex in EXCHANGES:
                h = history(slug, isin, ex)
                if h: got[ex] = h
                if ex == 'FSE' and got:                # stop after Xetra + Frankfurt unless they leave gaps
                    ds = set().union(*(set(v) for v in got.values()))
                    span = list(ds)
                    wd = sum(1 for x in range((datetime.date.fromisoformat(max(span)) - datetime.date.fromisoformat(min(span))).days + 1)
                             if (datetime.date.fromisoformat(min(span)) + datetime.timedelta(x)).weekday() < 5)
                    if len(ds) >= 0.96 * wd: break
            for ex in EXCHANGES:
                for d, v in got.get(ex, {}).items():
                    if d not in closes: closes[d] = v; per[ex] = per.get(ex, 0) + 1
            if not closes: raise ValueError('no prices on ' + ', '.join(EXCHANGES))
            results[isin] = (closes, per, slug)
            print(f'  {n:>2}/{len(want)} {isin} {inst[isin]["short"]:<22} {len(closes):>5} days {min(closes)} .. {max(closes)} '
                  + ' '.join(f'{e}:{c}' for e, c in per.items()))
        except Exception as e:                         # network or page problem: report, go on
            refused.append(f'{isin} {inst.get(isin, {}).get("short", "")}: {e}')
            print(f'  {n:>2}/{len(want)} {isin} FAILED: {e}')

print('\n== checks against the Scalable history ==')
for isin, (closes, per, slug) in results.items():
    ok, txt = check(isin, closes, backup)
    print(f'  {"OK     " if ok else "REFUSED"} {isin} {inst[isin]["short"]:<22} {txt}')
    if not ok: refused.append(f'{isin} {inst[isin]["short"]}: {txt}'); continue
    for d in [d for d, v in daily.items() if isin in v]: del daily[d][isin]
    for d, v in closes.items(): daily.setdefault(d, {})[isin] = '%.10g' % v
    src_rows[isin] = {'isin': isin, 'short': inst[isin]['short'], 'slug': slug, 'first': min(closes), 'last': max(closes),
                      'days': len(closes), 'per_exchange': ' '.join(f'{e}:{c}' for e, c in per.items()),
                      'fetched': datetime.date.today().isoformat()}
daily = {d: v for d, v in daily.items() if v}
if refused: print('\nNOT WRITTEN (show the user):', *refused, sep='\n  ')
if dry: print('dry run: nothing written.'); sys.exit(1 if refused else 0)
write_daily(daily)
with open(SOURCES, 'w', encoding='utf-8', newline='') as f:
    w = csv.DictWriter(f, ['isin', 'short', 'slug', 'first', 'last', 'days', 'per_exchange', 'fetched'], lineterminator='\n')
    w.writeheader(); w.writerows(src_rows[i] for i in sorted(src_rows))
print(f'\nwritten: prices_history_daily.csv ({len(daily)} dates, {len(src_rows)} ISINs), history_sources.csv')
print(merge())
code = rebuild_and_test()
sys.exit(1 if refused or code else 0)
