# Merges fetched Scalable quotes into prices_daily.csv (daily closes), intraday.csv (30-min points) and intraday_2h.csv
# (2-hour points), then rebuilds portfolio-data.js via build_data.py.  The runbook for the fetch is UPDATE_PRICES.md.
#
# Input: files written by the PostToolUse hook .claude/hooks/save-chart.cjs, which saves every get_security_chart result
# (header timestamp_utc,price; values verbatim, ascending; nobody copies numbers by hand):
#   incoming/<ISIN>.csv     seven_days   30-min points of ~6 sessions: the last point per Europe/Berlin date is that day's
#                                        close / today's latest price (closes of NEW days only) + intraday.csv
#   incoming/2h/<ISIN>.csv  one_month    2-hour points of ~1 month (the last point of a day, ~19:30 UTC, is NOT the close)
#                                        -> intraday_2h.csv only
#   incoming/3m/<ISIN>.csv  three_months daily closes; only fetched after a break of > 5 weekdays (--plan says so) and
#                                        only used for new days that seven_days no longer covers
#   incoming/ytd/<ISIN>.csv year_to_date daily closes since 1 January: new-instrument backfill (--plan-add/--finish-add)
#   incoming.csv            legacy (isin,timestamp_utc,price; e.g. a hand-made year_to_date fill); may also fill final rows
# intraday.csv / intraday_2h.csv keep every collected point (user, 27.09.): per ISIN and Berlin date the newest fetch
# replaces the stored points of that date (a shorter, cut-off first session of a later fetch never replaces a full one).
#
# Usage (normal update = --plan, fetch agents, --finish; see UPDATE_PRICES.md or the update-quotes skill):
#         python update_prices.py --plan      empties incoming/, prints one ready agent prompt per batch
#         python update_prices.py --finish    check -> merge -> rebuild -> tests -> HANDOFF status block -> short report
#   new instrument (only on user instruction; row in instruments.csv first):
#         python update_prices.py --plan-add ISIN[,ISIN]    prints the backfill prompts (year_to_date + seven_days + one_month
#                                                           + one_year + max: the history before 2026, prices_history.csv)
#         python update_prices.py --finish-add ISIN[,ISIN]  checks the backfill files, adds the columns, merges, rebuilds, tests
#   single steps (debugging):
#         python update_prices.py --check     validates incoming/*.csv, lists the ISINs to fetch again (exit 1 if any)
#         python update_prices.py --dry-run   prints what would change, writes nothing
#         python update_prices.py             writes prices_daily.csv + intraday*.csv, rebuilds, deletes the incoming files
#         python update_prices.py --add-column ISIN[,ISIN]  (legacy) adds empty price columns before a plain run
import csv, datetime, math, pathlib, re, subprocess, sys

D = pathlib.Path(__file__).resolve().parent
INC = D / 'incoming'
INC2H, INC3M = INC / '2h', INC / '3m'
STORE_30M, STORE_2H = D / 'intraday.csv', D / 'intraday_2h.csv'
INC1Y, INCMAX = INC / '1y', INC / 'max'           # one_year / max fetches: history before 2026 (prices_history.csv)
HIST = D / 'prices_history.csv'
CLOSE_HOUR_BERLIN = 23   # a day's last point counts as the close once Berlin time is past 23:00
BATCH = 50               # max ISINs per fetch agent (2 or 3 chart calls per ISIN in a routine update)
GAP_DAYS = 5             # more weekdays since the last final close: also fetch three_months (seven_days covers ~5 sessions)
MAX_GAP_DAYS = 60        # three_months covers ~63 sessions; beyond that ask the user (year_to_date by hand, AGENTS.md)
LINE_RE = re.compile(r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z,\d+(\.\d+)?$')


def _last_sunday(y, m):
    d = datetime.date(y, m, 31)
    while d.weekday() != 6: d -= datetime.timedelta(1)
    return d

def to_berlin(t):
    start = datetime.datetime.combine(_last_sunday(t.year, 3), datetime.time(1), datetime.timezone.utc)
    end = datetime.datetime.combine(_last_sunday(t.year, 10), datetime.time(1), datetime.timezone.utc)
    return (t + datetime.timedelta(hours=2 if start <= t < end else 1)).replace(tzinfo=None)

def parse_ts(s):
    return datetime.datetime.fromisoformat(s.strip().replace('Z', '+00:00')).astimezone(datetime.timezone.utc)

def fmt_ts(t):
    return t.strftime('%Y-%m-%dT%H:%M:%S.') + '%03dZ' % (t.microsecond // 1000)


with open(D/'prices_daily.csv', encoding='utf-8') as f:
    rd = csv.reader(f); head = next(rd); rows = [r + [''] * (len(head) - len(r)) for r in rd if r]
if '--add-column' in sys.argv:
    for isin in sys.argv[sys.argv.index('--add-column') + 1].split(','):
        if isin and isin not in head:
            head.append(isin)
            for r in rows: r.append('')
            print('added column', isin)
col = {isin: 3 + j for j, isin in enumerate(head[3:])}
by_date = {r[0]: r for r in rows}
last_final = max((r[0] for r in rows if r[1] == 'final'), default=None)
now_berlin = to_berlin(datetime.datetime.now(datetime.timezone.utc))
today = now_berlin.date().isoformat()


def instruments():
    """instruments.csv (isin,name,short,type): the name of every price column (benchmark search, fetch plans)."""
    f = D/'instruments.csv'
    return {r['isin']: r for r in csv.DictReader(open(f, encoding='utf-8'))} if f.exists() else {}

def names():
    out = {i: r['name'] for i, r in instruments().items()}
    for p in csv.DictReader(open(D/'positions.csv', encoding='utf-8')): out.setdefault(p['isin'], p['name'])
    return out

def last_price(isin):
    for r in reversed(rows):
        if r[col[isin]]: return float(r[col[isin]])
    return None

THINK = 'Thinking ON: think step by step before each tool call and before writing each file.'
def agent_prompt(tfs, isins):
    """The exact prompt for one price-fetcher agent (Claude Sonnet 5.5)."""
    return (f'{THINK}\nRead `UPDATE_PRICES.md` (section "Steps for a fetch agent") in `{D.parent}` and follow it exactly. '
            f'TIMEFRAMES: `{" ".join(tfs)}`. Your ISINs: `{" ".join(isins)}`.')

def planned_timeframes():
    """Timeframes of the current plan (line 'TIMEFRAMES:' in incoming/_plan.txt); default seven_days + one_month."""
    f = INC / '_plan.txt'
    if f.exists():
        m = re.search(r'^TIMEFRAMES: (.+)$', f.read_text(encoding='utf-8'), re.M)
        if m: return m.group(1).split()
    return ['seven_days', 'one_month']

def clear_incoming():
    """Removes the fetch files of the normal update (never incoming/ytd/: pending new-instrument backfills live there)."""
    n = 0
    for d in (INC, INC2H, INC3M):
        for p in list(d.glob('*.csv')) + list(d.glob('*.tmp')) if d.exists() else []:
            p.unlink(); n += p.suffix == '.csv'
    return n

def weekdays_between(a, b):   # weekdays after a up to and including b
    d, n = datetime.date.fromisoformat(a), 0
    while d < datetime.date.fromisoformat(b):
        d += datetime.timedelta(1)
        n += d.weekday() < 5
    return n


# ------------------------------------------------------------------ --plan
if '--plan' in sys.argv:
    INC.mkdir(exist_ok=True)
    left = clear_incoming()            # leftovers of an earlier, unmerged fetch: fetched again
    isins, nm = head[3:], names()
    k = math.ceil(len(isins) / BATCH)
    size = math.ceil(len(isins) / k)
    batches = [isins[j:j + size] for j in range(0, len(isins), size)]
    gap = weekdays_between(last_final, today) if last_final else 99
    tfs = ['seven_days', 'one_month'] + (['three_months'] if gap > GAP_DAYS else [])
    lines = [f'FETCH PLAN  (Berlin {now_berlin:%Y-%m-%d %H:%M}, last final close in prices_daily.csv: {last_final})',
             f'TIMEFRAMES: {" ".join(tfs)}',
             'TOOL: get_security_chart(isin=<ISIN>, timeframe=<each timeframe>)   (read-only; no portfolioId)',
             'FILES: written by the hook .claude/hooks/save-chart.cjs (data/incoming/<ISIN>.csv, 2h/, 3m/); the result is one line "SAVED ..."',
             f'{len(isins)} ISINs in {len(batches)} batches (one fetch agent per batch):']
    for j, b in enumerate(batches, 1):
        lines.append(f'BATCH {j}: ' + ' '.join(b))
        for i in b: lines.append(f'    {i}  {nm.get(i, "")}')
    if gap > GAP_DAYS:
        lines.append(f'NOTE: {gap} weekdays since {last_final} - seven_days covers only ~5 sessions, so three_months fills the closes in between.')
    if gap > MAX_GAP_DAYS:
        lines.append(f'WARNING: {gap} weekdays since {last_final} - more than three_months covers. Ask the user before fetching '
                     '(the older closes need year_to_date into the legacy data/incoming.csv, AGENTS.md).')
    if left:
        lines.append(f'NOTE: removed {left} files of an earlier, unmerged fetch from data/incoming/ (they are fetched again).')
    lines.append('')
    lines.append(f'AGENT PROMPTS - start {len(batches)} agents at once: agent type price-fetcher, model claude-sonnet-5-5, one prompt each '
                 '(copy each block exactly):')
    for j, b in enumerate(batches, 1):
        lines += [f'--- prompt {j}/{len(batches)} ---', agent_prompt(tfs, b)]
    lines.append('--- end of prompts --- then: python data/update_prices.py --finish')
    (INC/'_plan.txt').write_text('\n'.join(lines) + '\n', encoding='utf-8')
    print('\n'.join(lines))
    print('(also written to data/incoming/_plan.txt)')
    sys.exit(0)


def run_cmd(cmd, show=True):
    r = subprocess.run(cmd, cwd=D.parent, capture_output=True, text=True, encoding='utf-8', errors='replace')
    out = (r.stdout or '') + (r.stderr or '')
    if show and out.strip(): print(out.rstrip())
    return r.returncode, out


def tests_status_report(alerts, step=''):
    """Runs the tests, rewrites the data-status block in HANDOFF.md, prints the report. -> exit code (0 = tests OK)."""
    root = D.parent
    print(f'\n== {step}tests ==')
    c1, o1 = run_cmd(['node', 'tests/engine.test.cjs'], show=False)
    c2, _ = run_cmd([sys.executable, 'tests/crosscheck.py'], show=False)
    c3, o3 = run_cmd(['node', 'tests/crosscheck.cjs'], show=False)
    t1 = next((ln for ln in o1.splitlines() if ln.startswith('engine tests')), 'engine tests: no result')
    t3 = next((ln for ln in o3.splitlines() if ln.startswith('crosscheck')), 'crosscheck: no result')
    print(t1); print(t3)
    # HANDOFF.md: machine-maintained status block
    with open(D/'prices_daily.csv', encoding='utf-8') as f:
        allrows = [r for r in csv.reader(f) if r]
    hd, rr = allrows[0], allrows[1:]
    last = rr[-1]
    def sessions(f):
        return sorted({to_berlin(parse_ts(r['timestamp_utc'])).date().isoformat()
                       for r in csv.DictReader(open(f, encoding='utf-8'))}) if f.exists() else []
    def span(ds): return f'{len(ds)} sessions {ds[0]} … {ds[-1]}' if ds else 'none'
    idays, hdays = sessions(STORE_30M), sessions(STORE_2H)
    asof = f', asof {last[2]}' if last[2] else ''
    hist = ''
    if HIST.exists():
        hr = [r for r in csv.reader(open(HIST, encoding='utf-8')) if r][1:]
        if hr: hist = f'history (prices_history.csv): {len(hr)} rows {hr[0][0]} … {hr[-1][0]} (month-end + every 2nd trading day); '
    status = (f'<!-- data-status:start (written by update_prices.py --finish) -->\n'
              f'- Data status (update {now_berlin:%d.%m.%Y %H:%M} Berlin): {len(rr)} trading days {rr[0][0]} … {last[0]}; '
              f'last row {last[0]} = {last[1]}{asof}; {hist}30-min (intraday.csv): {span(idays)}; 2-h (intraday_2h.csv): {span(hdays)}; '
              f'{t1}; {t3}.\n<!-- data-status:end -->')
    hf = root/'HANDOFF.md'
    h = hf.read_text(encoding='utf-8')
    if '<!-- data-status:start' in h:
        h = re.sub(r'<!-- data-status:start.*?<!-- data-status:end -->', lambda m: status, h, flags=re.S)
    else:
        h = h.replace('## State\n', '## State\n' + status + '\n', 1)
    hf.write_text(h, encoding='utf-8', newline='')
    ok = c1 == 0 and c3 == 0 and c2 == 0
    print('\n== REPORT (give this to the user) ==')
    print(f'Prices up to {last[0]} ({last[1]}{asof}); {len(hd) - 3} ISINs; 30-min data: {span(idays)}; 2-h data: {span(hdays)}.')
    print('Tests: ' + ('OK - ' if ok else 'FAILED - ') + t1 + '; ' + t3)
    for a in alerts: print('CHECK WITH USER: ' + a)
    print('HANDOFF.md status updated. Hard-reload the dashboard (Ctrl+F5).')
    return 0 if ok else 1


# ------------------------------------------------------------------ --finish: check -> merge -> tests -> HANDOFF -> report
if '--finish' in sys.argv:
    me = [sys.executable, str(pathlib.Path(__file__).resolve())]
    print('== 1/3 check ==')
    code, out = run_cmd(me + ['--check'])
    if code:
        redo = [ln.split(':')[0].strip() for ln in out.splitlines() if re.match(r'^\s+[A-Z]{2}[A-Z0-9]{9}\d:', ln)]
        parts = [redo[j:j + BATCH] for j in range(0, len(redo), BATCH)] or [[]]
        print(f'\nFETCH AGAIN: start {len(parts)} agent(s) at once (price-fetcher, claude-sonnet-5-5), one prompt each:')
        for j, b in enumerate(parts, 1): print(f'--- prompt {j}/{len(parts)} ---\n' + agent_prompt(planned_timeframes(), b))
        print('--- end of prompts --- then run: python data/update_prices.py --finish   '
              '(after 2 failed rounds for the same ISIN: ask the user)')
        sys.exit(1)
    print('\n== 2/3 merge + rebuild ==')
    code, out = run_cmd(me)
    if code:
        print('\nSTOP: merge refused (nothing written). Show these ERRORS to the user.'); sys.exit(1)
    alerts = [ln.strip() for ln in out.splitlines() if 'SPLIT' in ln or 'final close' in ln]
    sys.exit(tests_status_report(alerts, '3/3 '))


# ------------------------------------------------------------------ new instruments: --plan-add / --finish-add (backfill)
ISIN_RE = re.compile(r'^[A-Z]{2}[A-Z0-9]{9}\d$')
YTD = INC / 'ytd'
ADD_BATCH = BATCH        # new-instrument backfill and history agents also handle up to 50 ISINs

def add_prompt(isins):
    """The exact prompt for one backfill agent (price-fetcher, Claude Sonnet 5.5)."""
    return (f'{THINK}\nRead `UPDATE_PRICES.md` (section "Steps for a backfill agent (new ISIN)") in `{D.parent}` and follow it '
            f'exactly. Your ISINs: `{" ".join(isins)}`.')

def arg_isins(flag):
    i = sys.argv.index(flag)
    out = [x.strip().upper() for x in (sys.argv[i + 1] if i + 1 < len(sys.argv) else '').split(',') if x.strip()]
    bad = [x for x in out if not ISIN_RE.match(x)]
    if not out or bad:
        print(f'usage: python data/update_prices.py {flag} ISIN[,ISIN]' + (f'   (not an ISIN: {", ".join(bad)})' if bad else ''))
        sys.exit(2)
    return list(dict.fromkeys(out))

def read_points(path):
    """File 'timestamp_utc,price' with points of any date -> (points [(ts, price)] ascending, problems [text])."""
    if not path.exists(): return [], ['file missing']
    lines = [x.strip() for x in path.read_text(encoding='utf-8-sig').splitlines() if x.strip()]
    if not lines or lines[0].replace(' ', '') != 'timestamp_utc,price': return [], ['first line must be: timestamp_utc,price']
    out, bad, prev = [], [], None
    for n, x in enumerate(lines[1:], 2):
        if not LINE_RE.match(x): bad.append(f'line {n} not "<timestampUtc>,<midPrice>": {x[:60]}'); continue
        ts, price = parse_ts(x.split(',')[0]), float(x.split(',')[1])
        if price <= 0: bad.append(f'line {n}: price <= 0'); continue
        if prev and ts <= prev: bad.append(f'line {n}: timestamps not ascending'); continue
        prev = ts
        out.append((ts, price))
    if not out: bad.append('no data points')
    return out, bad

def last_per_day(points):
    """-> {Berlin date: price of the day's last point} for weekdays (points are ascending, so the last one wins)."""
    out = {}
    for ts, p in points:
        d = to_berlin(ts).date()
        if d.weekday() < 5: out[d.isoformat()] = p
    return out

def read_store(f):
    """intraday.csv / intraday_2h.csv (isin,timestamp_utc,price) -> {(isin, Berlin date): [(timestamp text, price)]}"""
    out = {}
    if f.exists():
        for r in csv.DictReader(open(f, encoding='utf-8')):
            day = to_berlin(parse_ts(r['timestamp_utc'])).date().isoformat()
            out.setdefault((r['isin'], day), []).append((r['timestamp_utc'], float(r['price'])))
    return out

def merge_store(store, isin, points):
    """The newest fetch replaces the stored points of each (isin, Berlin weekday); for a past day a shorter set is ignored
    (the cut-off first session of a later fetch never replaces a full one). -> number of new/changed days"""
    by_day, n = {}, 0
    for ts, p in points:
        d = to_berlin(ts).date()
        if d.weekday() < 5: by_day.setdefault(d.isoformat(), []).append((fmt_ts(ts), p))
    for d, lst in by_day.items():
        old = store.get((isin, d))
        if old is None or d >= today or len(lst) >= len(old):
            n += old != lst
            store[isin, d] = lst
    return n

def write_store(f, store):
    with open(f, 'w', encoding='utf-8', newline='') as fh:
        w = csv.writer(fh); w.writerow(['isin', 'timestamp_utc', 'price'])
        for k in sorted(store):
            for ts, p in sorted(store[k]): w.writerow([k[0], ts, '%.10g' % p])

def store_info(store):
    days = sorted({d for _, d in store})
    return f'{sum(len(v) for v in store.values())} points, {len(days)} sessions' + (f' {days[0]} .. {days[-1]}' if days else '')


def add_history(new):
    """new {isin: (one_year points, max points)} -> merged into prices_history.csv: one_year points before the daily data go
    to their date (a "2d" row), max points before the first "2d" date into the row of their month ("m"; new rows as needed).
    Columns follow prices_daily.csv. -> one summary line"""
    first_daily = rows[0][0]
    table = {}
    if HIST.exists():
        with open(HIST, encoding='utf-8') as f:
            rd = csv.reader(f); hh = next(rd)
            for r in rd:
                if r: table[r[0]] = dict({'res': r[1]}, **{hh[k]: r[k] for k in range(2, len(r)) if r[k]})
    month_row = {d[:7]: d for d, v in table.items() if v['res'] == 'm'}
    two = [d for d, v in table.items() if v['res'] == '2d']
    starts = [to_berlin(y[0][0]).date().isoformat() for y, _ in new.values() if y]
    y_start = min(two) if two else (min(starts) if starts else first_daily)
    n = 0
    for i, (y, m) in new.items():
        for ts, p in y:
            d = to_berlin(ts).date()
            if d.isoformat() < first_daily and d.weekday() < 5:
                table.setdefault(d.isoformat(), {'res': '2d'})[i] = '%.10g' % p; n += 1
        for ts, p in m:
            d = to_berlin(ts).date()
            if d.isoformat() >= y_start: continue
            while d.weekday() > 4: d -= datetime.timedelta(1)
            key = d.isoformat()[:7]
            rd = month_row.setdefault(key, d.isoformat())
            table.setdefault(rd, {'res': 'm'})[i] = '%.10g' % p; n += 1
    with open(HIST, 'w', encoding='utf-8', newline='') as f:
        w = csv.writer(f); w.writerow(['date', 'res'] + head[3:])
        for d in sorted(table): w.writerow([d, table[d]['res']] + [table[d].get(i, '') for i in head[3:]])
    return f'prices_history.csv: {n} history points of {len(new)} new ISIN(s) merged ({len(table)} rows)'


if '--plan-add' in sys.argv:
    new, ins = arg_isins('--plan-add'), instruments()
    have = [i for i in new if i in col]
    if have: print('already price columns (they are fetched by the normal update):', ', '.join(have)); sys.exit(1)
    YTD.mkdir(parents=True, exist_ok=True)
    for i in new:                           # leftovers of an earlier attempt are fetched again
        for p in (YTD/f'{i}.csv', INC/f'{i}.csv', INC2H/f'{i}.csv', INC/'1y'/f'{i}.csv', INC/'max'/f'{i}.csv'):
            if p.exists(): p.unlink()
    k = math.ceil(len(new) / ADD_BATCH)
    size = math.ceil(len(new) / k)
    batches = [new[j:j + size] for j in range(0, len(new), size)]
    print(f'BACKFILL PLAN for {len(new)} new ISIN(s) (Berlin {now_berlin:%Y-%m-%d %H:%M}):')
    for i in new: print(f'    {i}  {(ins.get(i) or {}).get("name", "- no row in instruments.csv yet -")}')
    missing = [i for i in new if i not in ins]
    if missing:
        print('TODO before --finish-add: add a row to data/instruments.csv (isin,name,short,type) for: ' + ', '.join(missing))
    print(f'\nAGENT PROMPTS - start {len(batches)} agent(s) at once: agent type price-fetcher, model claude-sonnet-5-5, one prompt each:')
    for j, b in enumerate(batches, 1): print(f'--- prompt {j}/{len(batches)} ---\n' + add_prompt(b))
    print('--- end of prompts --- then: python data/update_prices.py --finish-add ' + ','.join(new))
    sys.exit(0)


if '--finish-add' in sys.argv:
    new, ins = arg_isins('--finish-add'), instruments()
    errs, redo, got = [], [], {}
    for i in new:
        if i in col: errs.append(f'{i}: already a price column (nothing to add)'); continue
        if i not in ins: errs.append(f'{i}: no row in data/instruments.csv (isin,name,short,type) - add it first')
        y, py = read_points(YTD/f'{i}.csv')
        s7, p7 = read_points(INC/f'{i}.csv')
        s2, p2 = read_points(INC2H/f'{i}.csv')
        h1, p1y = read_points(INC/'1y'/f'{i}.csv')
        hm, pmx = read_points(INC/'max'/f'{i}.csv')
        prob = ([f'incoming/ytd/{i}.csv: {x}' for x in py] + [f'incoming/{i}.csv: {x}' for x in p7]
                + [f'incoming/2h/{i}.csv: {x}' for x in p2] + [f'incoming/1y/{i}.csv: {x}' for x in p1y]
                + [f'incoming/max/{i}.csv: {x}' for x in pmx])
        if prob: redo.append(i); errs.append(f'{i}: ' + '; '.join(prob[:3])); continue
        close, last7 = last_per_day(y), last_per_day(s7)
        # a thinly traded title's close can come from a trade after the last 30-min point: then the year_to_date close stays
        ts_y = {to_berlin(t).date().isoformat(): t for t, _ in y}
        ts_7 = {to_berlin(t).date().isoformat(): t for t, _ in s7}
        later = {d for d in last7 if d in ts_y and ts_y[d] > ts_7[d] and d < today}
        for d in later: del last7[d]
        for d, p in sorted(last7.items()):   # both calls come from the same source: the closes must agree
            if d in close and abs(p / close[d] - 1) > 0.005:
                errs.append(f'{i} {d}: seven_days close {p:g} differs from year_to_date {close[d]:g} (copy error?)')
                if i not in redo: redo.append(i)
        for src, P in (('one_year', h1), ('max', hm)):   # history calls: their 2026 points are closes of year_to_date too
            bad = [d for d, p in last_per_day(P).items() if d in close and d < today and abs(p / close[d] - 1) > 0.005]
            if bad:
                errs.append(f'{i}: {src} differs from year_to_date on {len(bad)} days, e.g. {bad[0]}')
                if i not in redo: redo.append(i)
        ref = sorted(d for d in by_date if d >= min(close))
        gaps = [d for d in ref if d not in close and d not in last7]
        if len(gaps) > 5: errs.append(f'{i}: no close on {len(gaps)} trading days after its first quote (e.g. {", ".join(gaps[:4])}) - lines skipped?')
        close.update(last7)                  # an open day's latest price comes from seven_days
        got[i] = (close, s7, y, gaps, s2, h1, hm)
    if errs:
        print('ERRORS (nothing written):', *errs, sep='\n  ')
        if redo:
            print('\nFETCH AGAIN: start one agent (price-fetcher, claude-sonnet-5-5) with this prompt, then run --finish-add again:')
            print('--- prompt 1/1 ---\n' + add_prompt(redo) + '\n--- end of prompts ---')
        sys.exit(1)
    alerts = []
    for i in new:
        close, s7, y, gaps = got[i][:4]
        head.append(i)
        for r in rows: r.append('%.10g' % close[r[0]] if r[0] in close else '')
        n_fill = sum(1 for r in rows if r[0] in close)
        before = sum(1 for r in rows if r[0] < min(close))
        print(f'{i} {ins[i]["short"]}: {n_fill} of {len(rows)} trading days filled'
              + (f', {before} days before its first quote {min(close)} (flat in the engine)' if before else '')
              + (f', no close on {", ".join(gaps)} (forward-filled)' if gaps else '')
              + f'; {len(s7)} 30-min points {fmt_ts(s7[0][0])[:10]} .. {fmt_ts(s7[-1][0])[:10]}')
    s30, s2h = read_store(STORE_30M), read_store(STORE_2H)
    for i in new:
        merge_store(s30, i, got[i][1]); merge_store(s2h, i, got[i][4])
    with open(D/'prices_daily.csv', 'w', encoding='utf-8', newline='') as f:
        w = csv.writer(f); w.writerow(head); w.writerows(rows)
    write_store(STORE_30M, s30); write_store(STORE_2H, s2h)
    print(f'prices_daily.csv: {len(head) - 3} columns; intraday.csv: {store_info(s30)}; intraday_2h.csv: {store_info(s2h)}')
    print(add_history({i: (got[i][5], got[i][6]) for i in new}))
    # the raw year_to_date files stay as history in source/ (like the earlier backfills), the seven_days files are temporary
    meta = D/'source'/'ytd_meta.csv'
    new_meta = not meta.exists()
    with open(meta, 'a', encoding='utf-8', newline='') as f:
        w = csv.writer(f)
        if new_meta: w.writerow(['isin', 'name', 'currency', 'source', 'points', 'first_timestamp', 'last_timestamp'])
        for i in new:
            y = got[i][2]
            w.writerow([i, ins[i]['name'], 'EUR', f'year_to_date backfill {today}', len(y), fmt_ts(y[0][0]), fmt_ts(y[-1][0])])
            dst = D/'source'/f'ytd_{i}.csv'
            if dst.exists(): dst = D/'source'/f'ytd_{i}_{today}.csv'
            (YTD/f'{i}.csv').replace(dst)
            (INC/f'{i}.csv').unlink(); (INC2H/f'{i}.csv').unlink()
            for sub, name in (('1y', 'one_year'), ('max', 'max')):
                dh = D/'source'/f'history_{today}'/name
                dh.mkdir(parents=True, exist_ok=True)
                (INC/sub/f'{i}.csv').replace(dh/f'{i}.csv')
    print('\n== rebuild ==')
    code, out = run_cmd([sys.executable, str(D/'build_data.py')])
    if code: print('\nSTOP: build_data.py failed (prices_daily.csv / intraday*.csv are already written). Show this to the user.'); sys.exit(1)
    alerts = [ln.strip() for ln in out.splitlines() if any(i in ln for i in new) and ('SPLIT' in ln or 'check value' in ln)]
    sys.exit(tests_status_report(alerts))


# ------------------------------------------------------------------ history before the daily data: --plan-history / --finish-history
# (user 28.09.2026) one_year = every 2nd trading day of the last year, max = month-end closes back to ~2016; both go to
# prices_history.csv (date,res,<ISIN>…; res "2d" / "m"), only for dates before the first row of prices_daily.csv.

if '--plan-history' in sys.argv:
    i = sys.argv.index('--plan-history')
    isins = arg_isins('--plan-history') if i + 1 < len(sys.argv) and not sys.argv[i + 1].startswith('--') else head[3:]
    for d in (INC1Y, INCMAX):
        d.mkdir(parents=True, exist_ok=True)
        for x in isins:
            if (d/f'{x}.csv').exists(): (d/f'{x}.csv').unlink()
    k = math.ceil(len(isins) / ADD_BATCH)
    size = math.ceil(len(isins) / k)
    batches = [isins[j:j + size] for j in range(0, len(isins), size)]
    print(f'HISTORY PLAN for {len(isins)} ISINs (one_year + max; the hook writes data/incoming/1y/ and data/incoming/max/):')
    print(f'\nAGENT PROMPTS - start {len(batches)} agents at once: agent type price-fetcher, model claude-sonnet-5-5, one prompt each:')
    for j, b in enumerate(batches, 1): print(f'--- prompt {j}/{len(batches)} ---\n' + agent_prompt(['one_year', 'max'], b))
    print('--- end of prompts --- then: python data/update_prices.py --finish-history')
    sys.exit(0)

def history_rows(y_pts, m_pts, first_daily):
    """one_year points {isin: [(ts, price)]} + max points -> {date: [res, {isin: price}]} before first_daily:
    every one_year point before the daily data ("2d"), and for the months before the first one_year date one row per month
    ("m", dated on the month's latest point over all ISINs; each ISIN's own month-end close)."""
    out = {}
    starts = [to_berlin(y[0][0]).date().isoformat() for y in y_pts.values() if y]
    y_start = min(starts) if starts else first_daily
    for i, y in y_pts.items():
        for ts, p in y:
            d = to_berlin(ts).date()
            if d.isoformat() < first_daily and d.weekday() < 5: out.setdefault(d.isoformat(), ['2d', {}])[1][i] = p
    months = {}
    for i, m in m_pts.items():
        for ts, p in m:
            d = to_berlin(ts).date().isoformat()
            if d < y_start: months.setdefault(d[:7], {})[i] = (d, p)
    for mon, v in months.items():
        d = max(x[0] for x in v.values())
        while datetime.date.fromisoformat(d).weekday() > 4: d = (datetime.date.fromisoformat(d) - datetime.timedelta(1)).isoformat()
        if d in out: continue
        out[d] = ['m', {i: p for i, (_, p) in v.items()}]
    return out

if '--finish-history' in sys.argv:
    first_daily = rows[0][0]
    errs, redo, y_pts, m_pts = [], [], {}, {}
    for i in head[3:]:
        y, py = read_points(INC1Y/f'{i}.csv')
        m, pm = read_points(INCMAX/f'{i}.csv')
        prob = [f'incoming/1y/{i}.csv: {x}' for x in py] + [f'incoming/max/{i}.csv: {x}' for x in pm]
        if prob: redo.append(i); errs.append(f'{i}: ' + '; '.join(prob[:3])); continue
        off = []                                   # same source as the daily closes: final days must agree
        for src, P in (('one_year', y), ('max', m)):
            for ts, p in P:
                r = by_date.get(to_berlin(ts).date().isoformat())
                if r and r[1] == 'final' and r[col[i]] and abs(p / float(r[col[i]]) - 1) > 0.005:
                    off.append(f'{src} {r[0]} {p:g} vs daily {r[col[i]]}')
        if off: redo.append(i); errs.append(f'{i}: differs from prices_daily.csv on {len(off)} days, e.g. ' + '; '.join(off[:2]))
        y_pts[i], m_pts[i] = y, m
    if errs:
        print('ERRORS (nothing written):', *errs, sep='\n  ')
        if redo:
            parts = [redo[j:j + ADD_BATCH] for j in range(0, len(redo), ADD_BATCH)]
            print(f'\nFETCH AGAIN: start {len(parts)} agent(s) at once (price-fetcher, claude-sonnet-5-5), one prompt each, then --finish-history again:')
            for j, b in enumerate(parts, 1): print(f'--- prompt {j}/{len(parts)} ---\n' + agent_prompt(['one_year', 'max'], b))
            print('--- end of prompts ---')
        sys.exit(1)
    hist = history_rows(y_pts, m_pts, first_daily)
    with open(HIST, 'w', encoding='utf-8', newline='') as f:
        w = csv.writer(f); w.writerow(['date', 'res'] + head[3:])
        for d in sorted(hist):
            res, v = hist[d]
            w.writerow([d, res] + ['%.10g' % v[i] if i in v else '' for i in head[3:]])
    nm, n2 = sum(1 for v in hist.values() if v[0] == 'm'), sum(1 for v in hist.values() if v[0] == '2d')
    firsts = sorted((min(d for d, v in hist.items() if i in v[1]), i) for i in head[3:] if any(i in v[1] for v in hist.values()))
    print(f'prices_history.csv: {len(hist)} rows {min(hist)} .. {max(hist)} ({nm} month-end + {n2} every-2nd-day rows) for '
          f'{len(firsts)} of {len(head) - 3} ISINs; latest first quote: ' + ', '.join(f'{i} {d}' for d, i in firsts[-5:]))
    src = D/'source'/f'history_{today}'                  # the raw fetches stay as history, like the ytd backfills
    for d, sub in ((INC1Y, 'one_year'), (INCMAX, 'max')):
        (src/sub).mkdir(parents=True, exist_ok=True)
        for p in d.glob('*.csv'): p.replace(src/sub/p.name)
    print('\n== rebuild ==')
    code, out = run_cmd([sys.executable, str(D/'build_data.py')])
    if code: print('\nSTOP: build_data.py failed (prices_history.csv is written). Show this to the user.'); sys.exit(1)
    sys.exit(tests_status_report([ln.strip() for ln in out.splitlines() if 'SPLIT' in ln and 'history' in ln]))


# ------------------------------------------------------------------ read the hook's fetch files (+ validation)
DIRS = {'seven_days': INC, 'one_month': INC2H, 'three_months': INC3M}

def read_incoming(strict):
    """-> (points {timeframe: {isin: [(ts, price)]}}, problems {isin: [text]}, notes [text]).
    strict: every ISIN needs a file for each planned timeframe (--check / --finish)."""
    tfs = planned_timeframes()
    pts, problems, notes = {tf: {} for tf in DIRS}, {}, []
    for tf, d in DIRS.items():
        where = 'incoming/' + ('' if d == INC else d.name + '/')
        files = {p.stem: p for p in d.glob('*.csv')} if d.exists() else {}
        for stem in files:
            if stem not in col: problems.setdefault(stem, []).append(f'{where}{stem}.csv: file name is not an ISIN column of prices_daily.csv')
        for isin in head[3:]:
            f = files.get(isin)
            if f is None:
                if strict and tf in tfs: problems.setdefault(isin, []).append(f'{tf} missing ({where}{isin}.csv)')
                continue
            out, bad = read_points(f)
            ref = last_price(isin)
            if out and ref:
                q = out[-1][1] / ref
                if not 0.5 <= q <= 2: bad.append(f'latest price {out[-1][1]:g} vs last known {ref:g} ({(q - 1) * 100:+.0f} %) - wrong ISIN?')
            if bad: problems.setdefault(isin, []).extend(f'{tf}: {x}' for x in bad)
            else: pts[tf][isin] = out
    short_gap = last_final and weekdays_between(last_final, today) <= GAP_DAYS
    thin = []
    for isin, out in pts['seven_days'].items():
        days = {to_berlin(t).date().isoformat() for t, _ in out}
        if short_gap and last_final not in days:
            notes.append(f'{isin}: no 30-min points on {last_final}')
        if any(to_berlin(a[0]).date() == to_berlin(b[0]).date() and (b[0] - a[0]).total_seconds() > 50 * 60
               for a, b in zip(out, out[1:])): thin.append(isin)
    if thin: notes.append(f'{len(thin)} ISINs have gaps > 50 min in their 30-min points (thinly traded; no action needed): ' + ' '.join(thin))
    return pts, problems, notes


if '--check' in sys.argv:
    pts, problems, notes = read_incoming(strict=True)
    print(f'planned timeframes: {" ".join(planned_timeframes())}; last final close {last_final}')
    for tf, v in pts.items():
        if v or tf in planned_timeframes():
            print(f'  {tf}: {len(v)} of {len(head) - 3} ISIN files OK ({sum(len(x) for x in v.values())} points)')
    for x in notes: print('note:', x)
    if problems:
        print('FETCH AGAIN (then re-run --check):')
        for isin, why in problems.items(): print(f'  {isin}: ' + '; '.join(why[:3]) + (' ...' if len(why) > 3 else ''))
        sys.exit(1)
    print('all files OK - next: python data/update_prices.py --dry-run')
    sys.exit(0)


# ------------------------------------------------------------------ merge
dry = '--dry-run' in sys.argv
errors, changes, skipped = [], [], []
inc, problems, notes = read_incoming(strict=False)
inc_pts, inc2h, inc3m = inc['seven_days'], inc['one_month'], inc['three_months']
for isin, why in problems.items(): errors.append(f'{isin}: ' + '; '.join(why[:3]))
has_legacy = (D/'incoming.csv').exists()
if not any(inc.values()) and not has_legacy and not problems:
    print('nothing to merge: data/incoming/ is empty and incoming.csv not found (run --plan first)'); sys.exit(1)

latest = {}   # (isin, berlin_date) -> (ts, price)
def offer(isin, ts, price, source):
    day = to_berlin(ts).date().isoformat()
    if datetime.date.fromisoformat(day).weekday() > 4: skipped.append(f'{isin} {ts}: weekend point skipped'); return
    if source == 'incoming/' and last_final and day <= last_final: return   # closes of final days stay untouched
    if (isin, day) not in latest or ts > latest[isin, day][0]: latest[isin, day] = (ts, price)

for isin, lst in inc_pts.items():
    for ts, price in lst: offer(isin, ts, price, 'incoming/')
for isin, lst in inc3m.items():          # gap fill: daily closes of new days that seven_days no longer covers
    covered = {to_berlin(ts).date().isoformat() for ts, _ in inc_pts.get(isin, [])}
    for ts, price in lst:
        if to_berlin(ts).date().isoformat() not in covered: offer(isin, ts, price, 'incoming/')
if has_legacy:
    for k, r in enumerate(csv.DictReader(open(D/'incoming.csv', encoding='utf-8'))):
        try:
            isin, ts, price = r['isin'].strip(), parse_ts(r['timestamp_utc']), float(r['price'])
        except Exception as e:
            errors.append(f'incoming.csv line {k + 2}: {e}'); continue
        if isin not in col: errors.append(f'{isin}: not a column of prices_daily.csv (add the column deliberately first)'); continue
        if price <= 0: errors.append(f'{isin} {ts}: non-positive price'); continue
        offer(isin, ts, price, 'incoming.csv')

day_closed = lambda d: d < today or now_berlin.hour >= CLOSE_HOUR_BERLIN
touched = {}
for (isin, day), (ts, price) in sorted(latest.items(), key=lambda kv: kv[0][1]):
    row = by_date.get(day)
    if row is None:
        row = by_date[day] = [day, '', ''] + [''] * (len(head) - 3)
        changes.append(f'new date {day}')
    old = row[col[isin]]
    if old and row[1] == 'final' and abs(float(old) - price) > 1e-9:
        changes.append(f'WARNING {isin} {day}: final close {old} replaced by {price:g} (corporate action? check)')
    row[col[isin]] = '%.10g' % price
    touched.setdefault(day, {})[isin] = ts

for day, row in sorted(by_date.items()):
    was_intraday = row[1] == 'intraday'
    if day_closed(day):
        if was_intraday:
            stale = [i for i, c in col.items() if row[c] and i not in touched.get(day, {})]
            if stale: errors.append(f'{day} was intraday but these ISINs got no closing price: {", ".join(stale)}')
        if row[1] != 'final': changes.append(f'{day}: {row[1] or "new"} -> final')
        row[1], row[2] = 'final', ''
    else:
        row[1] = 'intraday'
        ts = max(touched.get(day, {}).values(), default=None)
        if ts: row[2] = ts.strftime('%Y-%m-%dT%H:%MZ')
out = [by_date[d] for d in sorted(by_date)]
if [r[1] for r in out[:-1]].count('intraday'):
    errors.append('an intraday row is not the last row (a later day was added without closing the earlier one)')

# intraday.csv (30-min) / intraday_2h.csv (2-h): everything collected so far + the new fetch (merge_store)
s30, s2h = read_store(STORE_30M), read_store(STORE_2H)
info30, info2h = store_info(s30), store_info(s2h)
d30 = sum(merge_store(s30, isin, lst) for isin, lst in inc_pts.items())
d2h = sum(merge_store(s2h, isin, lst) for isin, lst in inc2h.items())

print(f'{len(latest)} (isin, day) closes/latest prices from {len(inc_pts)} seven_days files'
      + (f' + {len(inc3m)} three_months files' if inc3m else '') + (' + incoming.csv' if has_legacy else '')
      + f'; now Berlin {now_berlin:%Y-%m-%d %H:%M}')
print(f'intraday.csv: {info30} -> {store_info(s30)} ({d30} ISIN-days new/updated)')
print(f'intraday_2h.csv: {info2h} -> {store_info(s2h)} ({d2h} ISIN-days new/updated)')
for line in skipped[:10] + changes: print(line)
for x in notes: print('note:', x)
if errors:
    print('ERRORS (nothing written):', *errors, sep='\n  '); sys.exit(1)
if dry:
    print('dry run: nothing written - next: python data/update_prices.py'); sys.exit(0)
with open(D/'prices_daily.csv', 'w', encoding='utf-8', newline='') as f:
    w = csv.writer(f); w.writerow(head); w.writerows(out)
write_store(STORE_30M, s30); write_store(STORE_2H, s2h)
print(f'prices_daily.csv: {len(out)} rows, last {out[-1][0]} ({out[-1][1]} {out[-1][2]})')
res = subprocess.run([sys.executable, str(D/'build_data.py')])
if res.returncode == 0:   # temporary fetch files only – their content now lives in prices_daily.csv / intraday*.csv
    if has_legacy: (D/'incoming.csv').unlink()
    clear_incoming()
    if (INC/'_plan.txt').exists(): (INC/'_plan.txt').unlink()
sys.exit(res.returncode)
