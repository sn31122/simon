# Merges fetched Scalable quotes into prices_daily.csv (daily closes) and intraday.csv (30-min points for the 1T chart),
# then rebuilds portfolio-data.js via build_data.py.  The step-by-step runbook for the fetch is UPDATE_PRICES.md.
#
# Input (either or both):
#   incoming/<ISIN>.csv  header  timestamp_utc,price   – points of get_security_chart(ISIN, "seven_days") copied verbatim,
#                        only dates >= the "copy from" date of --plan. Feeds intraday.csv and the closes of NEW days.
#   incoming.csv         header  isin,timestamp_utc,price – legacy / backfills (e.g. year_to_date for a new column);
#                        may also fill final rows. Not used for intraday.
#   In both, several points per day are fine: the last one per Europe/Berlin date is that day's close / latest price.
#
# Usage (normal update = --plan, fetch agents, --finish; see UPDATE_PRICES.md):
#         python update_prices.py --plan      empties incoming/, prints the "copy from" date and one ready agent prompt per batch
#         python update_prices.py --finish    check -> merge -> rebuild -> tests -> HANDOFF status block -> short report
#   new instrument (only on user instruction; row in instruments.csv first):
#         python update_prices.py --plan-add ISIN[,ISIN]    prints the backfill prompts (year_to_date + seven_days per ISIN)
#         python update_prices.py --finish-add ISIN[,ISIN]  checks the backfill files, adds the columns, merges, rebuilds, tests
#   single steps (debugging):
#         python update_prices.py --check     validates incoming/*.csv, lists the ISINs to fetch again (exit 1 if any)
#         python update_prices.py --dry-run   prints what would change, writes nothing
#         python update_prices.py             writes prices_daily.csv + intraday.csv, rebuilds, deletes the incoming files
#         python update_prices.py --add-column ISIN[,ISIN]  (legacy) adds empty price columns before a plain run
import csv, datetime, math, pathlib, re, subprocess, sys

D = pathlib.Path(__file__).resolve().parent
INC = D / 'incoming'
CLOSE_HOUR_BERLIN = 23   # a day's last point counts as the close once Berlin time is past 23:00
KEEP_INTRADAY_DAYS = 7   # intraday.csv keeps the points of the last 7 trading days
BATCH = 10               # ISINs per fetch agent (Haiku: ~6k tokens per seven_days response)
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
def agent_prompt(date, isins):
    """The exact prompt for one price-fetcher agent (Haiku)."""
    return (f'{THINK}\nRead `UPDATE_PRICES.md` (section "Steps for a fetch agent") in `{D.parent}` and follow it exactly. '
            f'COPY FROM DATE: `{date}`. Your ISINs: `{" ".join(isins)}`.')

def weekdays_between(a, b):   # weekdays after a up to and including b
    d, n = datetime.date.fromisoformat(a), 0
    while d < datetime.date.fromisoformat(b):
        d += datetime.timedelta(1)
        n += d.weekday() < 5
    return n


# ------------------------------------------------------------------ --plan
if '--plan' in sys.argv:
    INC.mkdir(exist_ok=True)
    # leftovers of an earlier, unmerged fetch are removed: the agents must CREATE their files (the Write tool refuses
    # to overwrite a file it has not read, which cost every agent a failed write + Read + retry per ISIN on 27.09.)
    left = sorted(p.name for p in INC.glob('*.csv'))
    for p in INC.glob('*.csv'): p.unlink()
    isins, nm = head[3:], names()
    k = math.ceil(len(isins) / BATCH)
    size = math.ceil(len(isins) / k)
    batches = [isins[j:j + size] for j in range(0, len(isins), size)]
    lines = [f'FETCH PLAN  (Berlin {now_berlin:%Y-%m-%d %H:%M}, last final close in prices_daily.csv: {last_final})',
             f'COPY FROM DATE: {last_final}   -> copy every point whose timestampUtc starts with {last_final} or a later date',
             'TOOL: get_security_chart(isin=<ISIN>, timeframe="seven_days")   (read-only; no portfolioId)',
             'FILE: data/incoming/<ISIN>.csv   first line: timestamp_utc,price   then one line per point: <timestampUtc>,<midPrice>',
             f'{len(isins)} ISINs in {len(batches)} batches (one fetch agent per batch):']
    for j, b in enumerate(batches, 1):
        lines.append(f'BATCH {j}: ' + ' '.join(b))
        for i in b: lines.append(f'    {i}  {nm.get(i, "")}')
    gap = weekdays_between(last_final, today) if last_final else 99
    if gap > 5:
        lines.append(f'WARNING: {gap} weekdays since {last_final} - seven_days only covers ~5 trading days. '
                     'Fetch the missing closes with year_to_date first (AGENTS.md, legacy incoming.csv).')
    if left:
        lines.append(f'NOTE: removed {len(left)} files of an earlier, unmerged fetch from data/incoming/ (they are fetched again).')
    lines.append('')
    lines.append(f'AGENT PROMPTS - start {len(batches)} agents at once: agent type price-fetcher, model haiku, one prompt each '
                 '(copy each block exactly):')
    for j, b in enumerate(batches, 1):
        lines += [f'--- prompt {j}/{len(batches)} ---', agent_prompt(last_final, b)]
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
    idays = sorted({to_berlin(parse_ts(r['timestamp_utc'])).date().isoformat()
                    for r in csv.DictReader(open(D/'intraday.csv', encoding='utf-8'))}) if (D/'intraday.csv').exists() else []
    asof = f', asof {last[2]}' if last[2] else ''
    status = (f'<!-- data-status:start (written by update_prices.py --finish) -->\n'
              f'- Data status (update {now_berlin:%d.%m.%Y %H:%M} Berlin): {len(rr)} trading days {rr[0][0]} … {last[0]}; '
              f'last row {last[0]} = {last[1]}{asof}; intraday sessions in intraday.csv: {", ".join(idays[-2:]) or "-"}; '
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
    print(f'Prices up to {last[0]} ({last[1]}{asof}); {len(hd) - 3} ISINs; 1T sessions {", ".join(idays[-2:]) or "-"}.')
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
        print(f'\nFETCH AGAIN: start {len(parts)} agent(s) at once (price-fetcher, haiku), one prompt each:')
        for j, b in enumerate(parts, 1): print(f'--- prompt {j}/{len(parts)} ---\n' + agent_prompt(last_final, b))
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
ADD_BATCH = 3            # new ISINs per backfill agent (two calls each: year_to_date ~7k tokens + seven_days ~6k tokens)

def add_prompt(isins):
    """The exact prompt for one backfill agent (price-fetcher, Haiku)."""
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


if '--plan-add' in sys.argv:
    new, ins = arg_isins('--plan-add'), instruments()
    have = [i for i in new if i in col]
    if have: print('already price columns (they are fetched by the normal update):', ', '.join(have)); sys.exit(1)
    YTD.mkdir(parents=True, exist_ok=True)
    for i in new:                           # leftovers of an earlier attempt: the agents must CREATE their files
        for p in (YTD/f'{i}.csv', INC/f'{i}.csv'):
            if p.exists(): p.unlink()
    k = math.ceil(len(new) / ADD_BATCH)
    size = math.ceil(len(new) / k)
    batches = [new[j:j + size] for j in range(0, len(new), size)]
    print(f'BACKFILL PLAN for {len(new)} new ISIN(s) (Berlin {now_berlin:%Y-%m-%d %H:%M}):')
    for i in new: print(f'    {i}  {(ins.get(i) or {}).get("name", "- no row in instruments.csv yet -")}')
    missing = [i for i in new if i not in ins]
    if missing:
        print('TODO before --finish-add: add a row to data/instruments.csv (isin,name,short,type) for: ' + ', '.join(missing))
    print(f'\nAGENT PROMPTS - start {len(batches)} agent(s) at once: agent type price-fetcher, model haiku, one prompt each:')
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
        prob = [f'incoming/ytd/{i}.csv: {x}' for x in py] + [f'incoming/{i}.csv: {x}' for x in p7]
        if prob: redo.append(i); errs.append(f'{i}: ' + '; '.join(prob[:3])); continue
        close, last7 = last_per_day(y), last_per_day(s7)
        for d, p in sorted(last7.items()):   # both calls come from the same source: the closes must agree
            if d in close and abs(p / close[d] - 1) > 0.005:
                errs.append(f'{i} {d}: seven_days close {p:g} differs from year_to_date {close[d]:g} (copy error?)')
                if i not in redo: redo.append(i)
        ref = sorted(d for d in by_date if d >= min(close))
        gaps = [d for d in ref if d not in close and d not in last7]
        if len(gaps) > 5: errs.append(f'{i}: no close on {len(gaps)} trading days after its first quote (e.g. {", ".join(gaps[:4])}) - lines skipped?')
        close.update(last7)                  # an open day's latest price comes from seven_days
        got[i] = (close, s7, y, gaps)
    if errs:
        print('ERRORS (nothing written):', *errs, sep='\n  ')
        if redo:
            print('\nFETCH AGAIN: start one agent (price-fetcher, haiku) with this prompt, then run --finish-add again:')
            print('--- prompt 1/1 ---\n' + add_prompt(redo) + '\n--- end of prompts ---')
        sys.exit(1)
    alerts = []
    for i in new:
        close, s7, y, gaps = got[i]
        head.append(i)
        for r in rows: r.append('%.10g' % close[r[0]] if r[0] in close else '')
        n_fill = sum(1 for r in rows if r[0] in close)
        before = sum(1 for r in rows if r[0] < min(close))
        print(f'{i} {ins[i]["short"]}: {n_fill} of {len(rows)} trading days filled'
              + (f', {before} days before its first quote {min(close)} (flat in the engine)' if before else '')
              + (f', no close on {", ".join(gaps)} (forward-filled)' if gaps else '')
              + f'; {len(s7)} 30-min points {fmt_ts(s7[0][0])[:10]} .. {fmt_ts(s7[-1][0])[:10]}')
    intra = {}
    if (D/'intraday.csv').exists():
        for r in csv.DictReader(open(D/'intraday.csv', encoding='utf-8')): intra[r['isin'], r['timestamp_utc']] = float(r['price'])
    n_old = len(intra)
    for i in new:
        for ts, p in got[i][1]:
            if to_berlin(ts).date().weekday() < 5: intra[i, fmt_ts(ts)] = p
    keep = sorted({to_berlin(parse_ts(ts)).date().isoformat() for _, ts in intra})[-KEEP_INTRADAY_DAYS:]
    intra = {k: v for k, v in intra.items() if to_berlin(parse_ts(k[1])).date().isoformat() in keep}
    with open(D/'prices_daily.csv', 'w', encoding='utf-8', newline='') as f:
        w = csv.writer(f); w.writerow(head); w.writerows(rows)
    with open(D/'intraday.csv', 'w', encoding='utf-8', newline='') as f:
        w = csv.writer(f); w.writerow(['isin', 'timestamp_utc', 'price'])
        for (isin, ts), price in sorted(intra.items()): w.writerow([isin, ts, '%.10g' % price])
    print(f'prices_daily.csv: {len(head) - 3} columns; intraday.csv: {n_old} -> {len(intra)} points')
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
            (INC/f'{i}.csv').unlink()
    print('\n== rebuild ==')
    code, out = run_cmd([sys.executable, str(D/'build_data.py')])
    if code: print('\nSTOP: build_data.py failed (prices_daily.csv / intraday.csv are already written). Show this to the user.'); sys.exit(1)
    alerts = [ln.strip() for ln in out.splitlines() if any(i in ln for i in new) and ('SPLIT' in ln or 'check value' in ln)]
    sys.exit(tests_status_report(alerts))


# ------------------------------------------------------------------ read incoming/<ISIN>.csv (+ validation)
def read_incoming(strict):
    """-> (points {isin: [(ts, price)]}, problems {isin: [text]}, notes [text])"""
    pts, problems, notes = {}, {}, []
    files = {p.stem: p for p in INC.glob('*.csv')} if INC.exists() else {}
    for stem in files:
        if stem not in col: problems.setdefault(stem, []).append('file name is not an ISIN column of prices_daily.csv')
    for isin in head[3:]:
        f = files.get(isin)
        if f is None:
            if strict: problems.setdefault(isin, []).append('file missing')
            continue
        lines = [x.strip() for x in f.read_text(encoding='utf-8-sig').splitlines() if x.strip()]
        bad = []
        if not lines or lines[0].replace(' ', '') != 'timestamp_utc,price':
            bad.append('first line must be: timestamp_utc,price')
            lines = lines[1:] if lines and not LINE_RE.match(lines[0]) else lines
        else:
            lines = lines[1:]
        out, prev = [], None
        for n, x in enumerate(lines, 2):
            if not LINE_RE.match(x): bad.append(f'line {n} not "<timestampUtc>,<midPrice>": {x[:60]}'); continue
            ts, price = parse_ts(x.split(',')[0]), float(x.split(',')[1])
            if price <= 0: bad.append(f'line {n}: price <= 0'); continue
            if last_final and x[:10] < last_final: bad.append(f'line {n}: date {x[:10]} is before the copy-from date {last_final}'); continue
            if prev and ts <= prev: bad.append(f'line {n}: timestamps not ascending'); continue
            prev = ts
            out.append((ts, price))
        if not out: bad.append('no data points')
        ref = last_price(isin)
        if out and ref:
            q = out[-1][1] / ref
            if not 0.5 <= q <= 2: bad.append(f'latest price {out[-1][1]:g} vs last known {ref:g} ({(q - 1) * 100:+.0f} %) - wrong ISIN or typo?')
        days = sorted({to_berlin(t).date().isoformat() for t, _ in out})
        if out and last_final and last_final not in days:
            notes.append(f'{isin}: no points on {last_final} (the previous session is missing in the 1T chart)')
        for a, b in zip(out, out[1:]):
            if to_berlin(a[0]).date() == to_berlin(b[0]).date() and (b[0] - a[0]).total_seconds() > 50 * 60:
                notes.append(f'{isin}: gap {fmt_ts(a[0])[11:16]}-{fmt_ts(b[0])[11:16]} UTC on {fmt_ts(a[0])[:10]} (thinly traded: usually a gap in the source, no action needed)')
                break
        if bad: problems.setdefault(isin, []).extend(bad)
        else: pts[isin] = out
    return pts, problems, notes


if '--check' in sys.argv:
    pts, problems, notes = read_incoming(strict=True)
    n = sum(len(v) for v in pts.values())
    print(f'{len(pts)} of {len(head) - 3} ISIN files OK ({n} points, copy-from date {last_final})')
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
inc_pts, problems, notes = read_incoming(strict=False)
for isin, why in problems.items(): errors.append(f'incoming/{isin}.csv: ' + '; '.join(why[:3]))
has_legacy = (D/'incoming.csv').exists()
if not inc_pts and not has_legacy and not problems:
    print('nothing to merge: data/incoming/ is empty and incoming.csv not found (run --plan first)'); sys.exit(1)

latest = {}   # (isin, berlin_date) -> (ts, price)
def offer(isin, ts, price, source):
    day = to_berlin(ts).date().isoformat()
    if datetime.date.fromisoformat(day).weekday() > 4: skipped.append(f'{isin} {ts}: weekend point skipped'); return
    if source == 'incoming/' and last_final and day <= last_final: return   # closes of final days stay untouched
    if (isin, day) not in latest or ts > latest[isin, day][0]: latest[isin, day] = (ts, price)

for isin, lst in inc_pts.items():
    for ts, price in lst: offer(isin, ts, price, 'incoming/')
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

# intraday.csv: union of the stored and the new 30-min points, last KEEP_INTRADAY_DAYS trading days
intra = {}
if (D/'intraday.csv').exists():
    for r in csv.DictReader(open(D/'intraday.csv', encoding='utf-8')):
        intra[r['isin'], r['timestamp_utc']] = float(r['price'])
n_old = len(intra)
for isin, lst in inc_pts.items():
    for ts, price in lst:
        if to_berlin(ts).date().weekday() < 5: intra[isin, fmt_ts(ts)] = price
keep = sorted({to_berlin(parse_ts(ts)).date().isoformat() for _, ts in intra})[-KEEP_INTRADAY_DAYS:]
intra = {k: v for k, v in intra.items() if to_berlin(parse_ts(k[1])).date().isoformat() in keep}

print(f'{len(latest)} (isin, day) closes/latest prices from {len(inc_pts)} incoming/ files'
      + (' + incoming.csv' if has_legacy else '') + f'; now Berlin {now_berlin:%Y-%m-%d %H:%M}')
print(f'intraday.csv: {n_old} -> {len(intra)} points, days {keep[0] if keep else "-"} .. {keep[-1] if keep else "-"}')
for line in skipped[:10] + changes: print(line)
for x in notes: print('note:', x)
if errors:
    print('ERRORS (nothing written):', *errors, sep='\n  '); sys.exit(1)
if dry:
    print('dry run: nothing written - next: python data/update_prices.py'); sys.exit(0)
with open(D/'prices_daily.csv', 'w', encoding='utf-8', newline='') as f:
    w = csv.writer(f); w.writerow(head); w.writerows(out)
with open(D/'intraday.csv', 'w', encoding='utf-8', newline='') as f:
    w = csv.writer(f); w.writerow(['isin', 'timestamp_utc', 'price'])
    for (isin, ts), price in sorted(intra.items()): w.writerow([isin, ts, '%.10g' % price])
print(f'prices_daily.csv: {len(out)} rows, last {out[-1][0]} ({out[-1][1]} {out[-1][2]})')
res = subprocess.run([sys.executable, str(D/'build_data.py')])
if res.returncode == 0:   # temporary fetch files only – their content now lives in prices_daily.csv / intraday.csv
    if has_legacy: (D/'incoming.csv').unlink()
    for p in INC.glob('*.csv') if INC.exists() else []: p.unlink()
    if (INC/'_plan.txt').exists(): (INC/'_plan.txt').unlink()
sys.exit(res.returncode)
