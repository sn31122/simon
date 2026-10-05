# Builds portfolio-data.js (window.PORTFOLIO_DATA) for dashboard.html from the CSVs in this folder.
# Run after every data change:  python build_data.py   (exit code 1 = data error, nothing written)
import csv, json, datetime, pathlib, sys, urllib.parse
if hasattr(sys.stdout, 'reconfigure'): sys.stdout.reconfigure(encoding='utf-8', errors='replace')   # Windows consoles/pipes (cp1252)

D = pathlib.Path(__file__).resolve().parent
LOGO_DIR = 'company-logos'   # Scalable logos (128x128 PNG, file = <ISIN>.png), copied 1:1 from Downloads/scalable-company-pictures/images
NOTES = [
    'Rückrechnung mit den Stückzahlen vom 02.09.2026 (keine Transaktionshistorie): Werte vor dem Kaufdatum sind hypothetisch.',
    'Kurse: Scalable (Mid, EUR, CONSOLIDATED). Tagesschlusskurse ab 02.01.2026; davor jeder 2. Handelstag (29.09.–29.12.2025) '
    'und Monatsschlusskurse bis etwa 2016 (je nach Titel). Volatilität, Sharpe, Sortino, VaR, Beta, Korrelation usw. nutzen nur die Tageskurse.',
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
errors, warns = [], []
# history before the daily data (update_prices.py --finish-history): prices_history.csv, date,res,<ISIN>… with res "m"
# (month-end close), "2d" (every 2nd trading day) or "dh" (daily history from finanzen.net, one-time import); prepended as final rows, res marks the resolution of every date
hrows, hres = [], []
if (D/'prices_history.csv').exists():
    with open(D/'prices_history.csv', encoding='utf-8') as f:
        rd = csv.reader(f)
        hh = next(rd)
        pos_h = {i: k for k, i in enumerate(hh)}
        for r in rd:
            if not r: continue
            if r[1] not in ('m', '2d', 'dh'): errors.append(f'prices_history.csv {r[0]}: bad res {r[1]!r}')
            hres.append(r[1])
            hrows.append([r[0], 'final', ''] + [r[pos_h[i]] if i in pos_h and pos_h[i] < len(r) else '' for i in isins])
            if r[0] >= rows[0][0]: errors.append(f'prices_history.csv {r[0]}: not before the daily data ({rows[0][0]})')
        extra = [i for i in hh[2:] if i not in isins]
        if extra: errors.append('prices_history.csv: columns that are not in prices_daily.csv: ' + ', '.join(extra))
res = hres + ['d'] * len(rows)
n_hist = len(hrows)
rows = hrows + rows
dates, status = [r[0] for r in rows], [r[1] for r in rows]
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
    for k, (d, v) in enumerate(zip(dates, s)):
        if v is None: continue
        if v <= 0: errors.append(f'{i} {d}: non-positive price {v}')
        elif last:
            q = max(v / last, last / v)
            split = next((x for x in SPLIT_RATIOS if abs(q / x - 1) < 0.03), None)
            if k < n_hist:                          # history: steps of a month / 2 days - only split-like jumps of >= 3x
                if split and split >= 3:
                    warns.append(f'{i} {d} (history): {last:g} -> {v:g} ({(v / last - 1) * 100:+.1f} %) SPLIT 1:{split}? check')
            elif split or q > 1.3:
                warns.append(f'{i} {d}: {last:g} -> {v:g} ({(v / last - 1) * 100:+.1f} %)'
                             + (f' SPLIT 1:{split}? divide the history before {d} if confirmed' if split else ' check value'))
        last = v
    if last is None: errors.append(f'{i}: column has no prices')
# holdings "ISIN:qty|…" = locked preset with fixed quantities; "ISIN:20%|…" = weighting preset (must total 100 %), offered in
# the "+ Benchmark" menu; start "card" = also an editable own card at load, shown in the chart (user 28.09.2026: only Mein
# Depot), "menu" (or empty) = only in the menu
# "Depot-Historie" (user 29.09.2026): the real depot replayed from the Scalable transaction export (depot_transactions.csv,
# semicolon CSV with German decimals). Securities value only (shares x daily close; no cash), from START on; per trading day
# the holdings after that day's executed trades. Alphabet 2x Factor GS has no prices: its shares count as the Leverage
# Shares 2x Alphabet ETP scaled by the mean ratio of its trade prices to that ETP's close; the Broadcom call's value is
# bridged linearly from its purchase amount to its sale amount; SK Hynix ADR, the WTI 10x factor and the D-Wave turbo
# (same-day trades / before START) are left out. The preset row in benchmarks.csv has holdings = "transactions".
DEPOT_HISTORY = {'file': 'depot_transactions.csv', 'start': '2026-03-17',
                 'proxy': {'DE000GX6ZLS7': 'IE00BF01VY89'}, 'bridge': ['DE000PK3XT09'],
                 'ignore': ['US78392B2060', 'DE000MR1T947', 'DE000HM0L6H3']}

def de_num(s):
    s = (s or '').strip()
    return float(s.replace('.', '').replace(',', '.')) if s else 0.0

def depot_schedule(dates_daily, prices_daily):
    """-> {start, steps: [{date, holdings: {ISIN: qty}, extra: EUR}], proxies, info} (steps only where something changes)"""
    cfg, f = DEPOT_HISTORY, D/DEPOT_HISTORY['file']
    if not f.exists(): return None
    tx = [r for r in csv.DictReader(open(f, encoding='utf-8-sig'), delimiter=';') if r['status'] == 'Executed'
          and r['assetType'] == 'Security' and r['type'] in ('Buy', 'Sell') and r['isin'] not in cfg['ignore']]
    tx.sort(key=lambda r: (r['date'], r['time']))
    # proxy factor per replaced ISIN: mean(trade price / proxy close on the trade date)
    factor = {}
    for i, pi in cfg['proxy'].items():
        rs = [de_num(r['price']) / prices_daily[pi][dates_daily.index(r['date'])] for r in tx
              if r['isin'] == i and r['date'] in dates_daily and prices_daily[pi][dates_daily.index(r['date'])]]
        if not rs: errors.append(f'Depot-Historie: no proxy prices for {i}'); return None
        factor[i] = sum(rs) / len(rs)
    # bridged instruments: (buy date, buy amount, sell date, sell amount) -> value per day in between
    bridge = {}
    for i in cfg['bridge']:
        b = [r for r in tx if r['isin'] == i]
        buys = [r for r in b if r['type'] == 'Buy']; sells = [r for r in b if r['type'] == 'Sell']
        if buys and sells:
            bridge[i] = (buys[0]['date'], -de_num(buys[0]['amount']), sells[-1]['date'], de_num(sells[-1]['amount']))
    hold, k, steps, prev = {}, 0, [], None
    for d in [x for x in dates_daily if x >= cfg['start']]:
        while k < len(tx) and tx[k]['date'] <= d:
            r = tx[k]; k += 1
            if r['isin'] in bridge: continue
            q = de_num(r['shares']) * (1 if r['type'] == 'Buy' else -1)
            i = r['isin']
            if i in factor: i, q = cfg['proxy'][i], q * factor[i]
            hold[i] = hold.get(i, 0) + q
            if abs(hold[i]) < 1e-9: del hold[i]
        extra = 0.0
        for i, (d0, a0, d1, a1) in bridge.items():
            if d0 <= d < d1:
                days = [x for x in dates_daily if d0 <= x <= d1]
                extra += a0 + (a1 - a0) * days.index(d) / (len(days) - 1)
        cur = ({i: round(q, 10) for i, q in sorted(hold.items())}, round(extra, 2))
        if cur != prev: steps.append({'date': d, 'holdings': cur[0], 'extra': cur[1]}); prev = cur
    for s in steps:
        for i in s['holdings']:
            if i not in prices_daily: errors.append(f'Depot-Historie: {i} is not a price column')
    return {'start': cfg['start'], 'steps': steps, 'proxies': {i: [cfg['proxy'][i], factor[i]] for i in factor},
            'bridged': sorted(bridge), 'ignored': cfg['ignore'], 'transactions': len(tx)}

benchmarks, card_presets = [], []
for b in bench:
    if b['holdings'].strip() == 'transactions':               # Depot-Historie: replayed from the transaction export
        sch = depot_schedule([r[0] for r in rows], {i: [num(r[3 + j]) if 3 + j < len(r) else None for r in rows] for j, i in enumerate(isins)})
        if sch: card_presets.append({'id': b['id'], 'name': b['name'], 'description': b['description'],
                                     'start': (b.get('start') or 'menu').strip(), 'schedule': sch})
        continue
    parts = [x.split(':') for x in b['holdings'].split('|') if x.strip()]
    pct = [v.strip().endswith('%') for _, v in parts]
    if any(pct) and not all(pct): errors.append(f"benchmarks.csv {b['id']}: mix of quantities and percentages"); continue
    if all(pct):
        w = {i.strip(): float(v.strip().rstrip('%').replace(',', '.')) for i, v in parts}
        if abs(sum(w.values()) - 100) > 0.01: errors.append(f"benchmarks.csv {b['id']}: weights total {sum(w.values()):g} %, not 100 %")
        for i in w:
            if i not in prices: errors.append(f"benchmarks.csv {b['id']}: {i} is not a price column")
        start = (b.get('start') or 'menu').strip()
        if start not in ('card', 'menu'): errors.append(f"benchmarks.csv {b['id']}: start must be card or menu, not {start!r}")
        card_presets.append({'id': b['id'], 'name': b['name'], 'description': b['description'], 'weights': w, 'start': start})
    else:
        benchmarks.append({'id': b['id'], 'name': b['name'], 'description': b['description'],
                           'holdings': {i.strip(): float(v) for i, v in parts}})
# phases of the real depot (data/history_phases.csv, optional; written by the main session from depot_transactions.csv):
# the "+ Benchmark" menu item "Historie" opens a submenu with one weighting preset per phase
history_phases = []
if (D/'history_phases.csv').exists():
    for h in csv.DictReader(open(D/'history_phases.csv', encoding='utf-8')):
        tag = f"history_phases.csv {h.get('id') or '?'}"
        try:
            w = {i.strip(): float(v.strip().rstrip('%').replace(',', '.'))
                 for i, v in (x.split(':') for x in (h.get('holdings') or '').split('|') if x.strip())}
        except ValueError:
            errors.append(f'{tag}: holdings must be ISIN:pct%|…, not {h.get("holdings")!r}'); continue
        if not w: errors.append(f'{tag}: no holdings'); continue
        if abs(sum(w.values()) - 100) > 0.01: errors.append(f'{tag}: weights total {sum(w.values()):g} %, not 100 %')
        for i in w:
            if i not in prices: errors.append(f'{tag}: {i} is not a price column')
        for k in ('from', 'to'):
            try: datetime.date.fromisoformat((h.get(k) or '').strip())
            except ValueError: errors.append(f'{tag}: bad {k} date {h.get(k)!r}')
        history_phases.append({'id': h['id'], 'name': h['name'], 'from': (h.get('from') or '').strip(), 'to': (h.get('to') or '').strip(),
                               'weights': w, 'description': h.get('description') or ''})
# the user's real Scalable depot (user 29.09.2026): share counts (depot.csv) + the Scalable snapshot (depot_ref.csv:
# securities value, total incl. cash, G/V seit Kauf = performance MAX, G/V per period) -> the "Mein Depot" block shows these
# numbers as Scalable reports them (user 02.10.2026); opened = first date of depot_transactions.csv
depot = None
if (D/'depot.csv').exists():
    dh = {r['isin']: float(r['shares']) for r in csv.DictReader(open(D/'depot.csv', encoding='utf-8'))}
    ref = next(iter(csv.DictReader(open(D/'depot_ref.csv', encoding='utf-8'))), None) if (D/'depot_ref.csv').exists() else None
    for i in dh:
        if i not in isins: errors.append(f'depot.csv: {i} is not a price column')
    sv = float(ref['securities_value']) if ref else None
    gv = float(ref['gv_since_buy']) if ref else None
    # Scalable's own € result per period (pl_1t … pl_1j, user 02.10.2026); older snapshots without them -> {}
    perf = {k[3:].upper(): float(ref[k]) for k in ('pl_1t', 'pl_1w', 'pl_1m', 'pl_3m', 'pl_6m', 'pl_ytd', 'pl_1j')
            if ref and (ref.get(k) or '').strip()}
    if ref: perf['MAX'] = gv
    tf = D/DEPOT_HISTORY['file']
    opened = min((r['date'] for r in csv.DictReader(open(tf, encoding='utf-8-sig'), delimiter=';') if r.get('date')),
                 default=None) if tf.exists() else None
    depot = {'holdings': dh, 'asof_utc': ref['asof_utc'] if ref else None, 'securities_value': sv,
             'total_value': float(ref['total_value']) if ref and ref['total_value'] else None,
             'gv_since_buy': gv, 'cost_basis': sv - gv if ref else None, 'performance': perf, 'opened': opened,
             'source': ref['source'] if ref else ''}
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

# ---- sub-daily grids (Europe/Berlin slots, Scalable trading hours 07:30-23:00), every collected session -> data.grids:
#   m30  30-min slots 07:30 .. 23:00 (32) from intraday.csv (seven_days)             -> charts 1T, 1W, custom <= 7 days
#   h2   2-hour slots 07:30 .. 21:30 + 23:00 (9) from intraday_2h.csv (one_month)    -> chart 1M, custom <= 31 days
# The engine picks the chart interval per range from these grids (engine.chartInterval / gridFrame); 1T = the last session of m30.
# A point goes to the nearest slot (the latest point wins a slot). On a final day the 23:00 slot of every instrument is its
# daily close when no point landed there (one_month's last point of a day is ~21:30 Berlin, not the close), so every
# finished session ends exactly on prices_daily.csv. Sessions need not be consecutive; they must be daily dates.
TIMES = ['%02d:%02d' % divmod(m, 60) for m in range(7 * 60 + 30, 23 * 60 + 1, 30)]
TIMES_2H = ['%02d:%02d' % divmod(m, 60) for m in range(7 * 60 + 30, 21 * 60 + 31, 120)] + ['23:00']
SLOT_TOL = 15                                   # minutes a point may lie before the first / after the last slot

def _last_sunday(y, m):
    d = datetime.date(y, m, 31)
    while d.weekday() != 6: d -= datetime.timedelta(1)
    return d

def to_berlin(t):
    start = datetime.datetime.combine(_last_sunday(t.year, 3), datetime.time(1), datetime.timezone.utc)
    end = datetime.datetime.combine(_last_sunday(t.year, 10), datetime.time(1), datetime.timezone.utc)
    return (t + datetime.timedelta(hours=2 if start <= t < end else 1)).replace(tzinfo=None)

def build_grid(fname, times, needed):
    f = D/fname
    if not f.exists(): return None
    mins = [int(t[:2]) * 60 + int(t[3:]) for t in times]
    grid, asof, outside, foreign = {}, None, 0, set()   # (isin, day) -> {slot: (ts, price)}
    for r in csv.DictReader(open(f, encoding='utf-8')):
        ts = datetime.datetime.fromisoformat(r['timestamp_utc'].replace('Z', '+00:00')).astimezone(datetime.timezone.utc)
        b = to_berlin(ts)
        m = b.hour * 60 + b.minute + b.second / 60        # 05:59:39 UTC -> 07:59.65 Berlin -> slot 08:00
        if not mins[0] - SLOT_TOL <= m <= mins[-1] + SLOT_TOL: outside += 1; continue
        slot = min(range(len(mins)), key=lambda k: (abs(mins[k] - m), -k))   # a tie goes to the later slot
        day = b.date().isoformat()
        if day not in dates: foreign.add(day); continue
        cell = grid.setdefault((r['isin'], day), {})
        if slot not in cell or ts > cell[slot][0]: cell[slot] = (ts, float(r['price']))
        asof = max(asof or ts, ts)
    days = sorted({d for _, d in grid})
    if not days: return None
    S, px, missing, off = len(times), {}, [], []
    for i in needed:
        arr = [None] * (len(days) * S)
        for k, d in enumerate(days):
            for s, (_, p) in grid.get((i, d), {}).items(): arr[k * S + s] = p
            di = dates.index(d)
            close = prices[i][di]
            if status[di] == 'final' and close is not None:
                if arr[k * S + S - 1] is None: arr[k * S + S - 1] = close
                elif abs(arr[k * S + S - 1] / close - 1) > 0.005: off.append(f'{i} {d}')
        if not any((i, d) in grid for d in days): missing.append(i)
        if all(v is None for v in arr): continue
        px[i] = arr
    last_day, di = days[-1], dates.index(days[-1])
    for i in px:                                        # the open session: latest point vs the daily price
        last = next((v for v in reversed(px[i][-S:]) if v is not None), None)
        daily = prices[i][di]
        if status[di] != 'final' and last and daily and abs(last / daily - 1) > 0.005:
            warns.append(f'{fname}: {i} last price {last:g} differs from the daily price {daily:g} on {last_day} by {(last / daily - 1) * 100:+.2f} %')
    if missing: warns.append(f'{fname}: no points (flat at the previous close, then the close) for ' + ', '.join(missing))
    if off: warns.append(f'{fname}: 23:00 point differs from the daily close by > 0.5 % on {len(off)} ISIN-days, e.g. ' + ', '.join(off[:4]))
    if outside: warns.append(f'{fname}: {outside} points outside 07:30-23:00 Berlin ignored')
    if foreign: warns.append(f'{fname}: points on dates without a daily row ignored: ' + ', '.join(sorted(foreign)))
    return {'dates': days, 'times': times, 'asof_utc': asof.strftime('%Y-%m-%dT%H:%MZ'), 'px': px}

def check_latest(g, fname, charts):
    """The chart intervals need the latest session: warn when a grid does not end on the last daily date."""
    if not g: warns.append(f'{fname}: no sessions - {charts} use daily prices'); return
    if g['dates'][-1] != dates[-1]:
        warns.append(f"{fname}: last session {g['dates'][-1]} is not the last daily date {dates[-1]} - {charts} step down to a coarser interval")

positions = [{'isin': p['isin'], 'name': p['name'], 'short': p['short'], 'group': p['group'], 'shares': float(p['shares']),
              'ref_date': p['ref_date'], 'ref_price': float(p['ref_price']), 'gv_ref': float(p['gv_ref']),
              'cost_basis': float(p['cost_basis']), 'note': p['note'], 'first_date': first_date(p['isin']),
              'logo': logo_for(p)} for p in pos]
data = {
    'meta': {'title': 'Yacht-Portfolio', 'currency': 'EUR',
             'source': 'Scalable MCP get_security_chart year_to_date (Tagesschluss, Mid, EUR)',
             'generated_at': datetime.datetime.now().astimezone().isoformat(timespec='seconds'),
             'first_date': dates[0], 'last_date': dates[-1], 'last_status': status[-1], 'daily_from': dates[n_hist],
             'last_asof_utc': rows[-1][2], 'positions_ref_date': pos[0]['ref_date'], 'notes': NOTES},
    'dates': dates,
    'status': status,
    'res': res,                               # resolution per date: 'm' month-end, '2d' every 2nd trading day, 'd' daily
    'groups': list(dict.fromkeys(p['group'] for p in pos)),
    'positions': positions,
    'benchmarks': benchmarks,                 # locked presets (fixed quantities)
    'card_presets': card_presets,             # weighting presets: start as editable own cards
    'history_phases': history_phases,         # phases of the real depot (submenu "Historie"): [{id, name, from, to, weights, description}]
    'depot': depot,                           # the real Scalable depot: {holdings, asof_utc, securities_value, total_value, gv_since_buy, cost_basis, performance, opened}
    # instruments for the benchmark cards: every price column, sorted by short name
    'instruments': sorted(({'isin': i, 'name': (inst.get(i) or {}).get('name') or i, 'short': (inst.get(i) or {}).get('short') or i,
                            'type': (inst.get(i) or {}).get('type') or '', 'position': i in {p['isin'] for p in pos}}
                           for i in isins), key=lambda x: x['short'].casefold()),
    'prices': {i: prices[i] for i in dict.fromkeys(needed)},
    'grids': {'m30': build_grid('intraday.csv', TIMES, list(dict.fromkeys(needed))),
              'h2': build_grid('intraday_2h.csv', TIMES_2H, list(dict.fromkeys(needed)))},
}
check_latest(data['grids']['m30'], 'intraday.csv', '1T/1W'); check_latest(data['grids']['h2'], 'intraday_2h.csv', '1M')
js = ('// Generated by build_data.py from positions.csv, benchmarks.csv, history_phases.csv, instruments.csv, prices_history.csv, prices_daily.csv, intraday.csv, intraday_2h.csv. Do not edit by hand.\n'
      '(typeof window !== "undefined" ? window : globalThis).PORTFOLIO_DATA = '
      + json.dumps(data, ensure_ascii=False, separators=(',', ':')) + ';\n')
(D/'portfolio-data.js').write_text(js, encoding='utf-8')
print(f'portfolio-data.js: {len(dates)} dates {dates[0]} -> {dates[-1]} ({status[-1]}; {n_hist} history rows before {dates[n_hist]}), '
      f'{len(positions)} positions, {len(benchmarks)} locked + {len(card_presets)} card presets, {len(history_phases)} history phases, {len(data["instruments"])} instruments, {len(data["prices"])} price series'
      + ''.join(f', {k} {len(g["dates"])} sessions {g["dates"][0]} .. {g["dates"][-1]} ({len(g["px"])} series, asof {g["asof_utc"]})'
                if g else f', no {k}' for k, g in data['grids'].items()))
gaps = {i: sum(v is None for v in prices[i]) for i in data['prices'] if any(v is None for v in prices[i])}
if gaps: print('empty cells per ISIN:', gaps)
if warns: print('WARNINGS:', *warns, sep='\n  ')
