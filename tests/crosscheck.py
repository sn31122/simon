# Independent reference implementation of the SPEC.md metrics, straight from the CSVs (no engine code).
# Writes tests/reference.json; tests/crosscheck.cjs compares PFEngine against it.
import csv, json, math, datetime, pathlib

R = pathlib.Path(__file__).resolve().parent.parent
pos = list(csv.DictReader(open(R/'data/positions.csv', encoding='utf-8')))
def parse_preset(h):   # benchmarks.csv: "ISIN:qty|…" = fixed quantities (Mein Depot), "ISIN:20%|…" = weighting preset (Energie)
    parts = [x.split(':') for x in h.split('|')]
    if all(v.endswith('%') for _, v in parts): return ('weights', {i: float(v[:-1]) for i, v in parts})
    return ('holdings', {i: float(v) for i, v in parts})
presets = {b['id']: parse_preset(b['holdings']) for b in csv.DictReader(open(R/'data/benchmarks.csv', encoding='utf-8'))}
# fixed test benchmarks, independent of the UI: ('holdings', {ISIN: qty}) = constant quantities,
# ('weights', {ISIN: %}) = benchmark card, bought at the range start and held (buy and hold)
P9 = 'US5951121038:191.032|AT0000969985:482.8456|IE00B53SZB19:37.1794|FR0010342592:4707.2392|US5128073062:123.3333|IE00BMC38736:326.1522|US0079031078:58.9772|US4581401001:252.9732|IE00BKVD2N49:32.9963'
BENCH = {
    'msci_world': ('holdings', {'IE00B4L5Y983': 1.0}), 'sp500': ('holdings', {'IE00B3YCGJ38': 1.0}),
    'nasdaq100': ('holdings', {'IE00B53SZB19': 1.0}), 'semis': ('holdings', {'IE00BMC38736': 1.0}),
    'dax': ('holdings', {'DE0005933931': 1.0}), 'gold': ('holdings', {'IE00B4ND3602': 1.0}),
    'ftse_all_world': ('holdings', {'IE00BK5BQT80': 1.0}),
    'proxy9': ('holdings', {x.split(':')[0]: float(x.split(':')[1]) for x in P9.split('|')}),
    'my_depot': presets['my_depot'],
    'mix_w': ('weights', {'IE00B4L5Y983': 40.0, 'FR0010342592': 35.0, 'US5951121038': 25.0}),
    'spacex_w': ('weights', {'US84615Q1031': 50.0, 'IE00B53SZB19': 50.0}),     # SpaceX quoted from 12.06. (flat before)
    'energie': presets['energie'],                                               # weighting preset of benchmarks.csv
}
rows = list(csv.reader(open(R/'data/prices_daily.csv', encoding='utf-8')))
head, rows = rows[0], rows[1:]
dates, status = [r[0] for r in rows], [r[1] for r in rows]
n = len(dates)

def fill(s):
    last = next(v for v in s if v is not None)
    out = []
    for v in s:
        last = v if v is not None else last
        out.append(last)
    return out

px = {i: fill([float(r[3 + j]) if r[3 + j] else None for r in rows]) for j, i in enumerate(head[3:])}
D = lambda s: datetime.date.fromisoformat(s)

def minus_months(d, m):
    y, mo = divmod(d.year * 12 + d.month - 1 - m, 12)
    mo += 1
    last = (datetime.date(y + (mo == 12), mo % 12 + 1, 1) - datetime.timedelta(1)).day
    return datetime.date(y, mo, min(d.day, last))

def preset(p):
    end = n - 1
    if p == '1T': return end - 1, end
    if p == 'MAX': return 0, end
    if p == 'YTD': return next(k for k in range(n) if dates[k][:4] == dates[end][:4]), end
    e = D(dates[end])
    lim = e - datetime.timedelta(7) if p == '1W' else minus_months(e, {'1M': 1, '3M': 3, '6M': 6, '1J': 12}[p])
    ks = [k for k in range(n) if D(dates[k]) <= lim]
    return (ks[-1] if ks else 0), end

def custom(a, b):
    s = next(k for k in range(n) if dates[k] >= a)
    e = max(k for k in range(n) if dates[k] <= b)
    return s, e

def raw_value(hold, s, e):
    return [sum(q * px[i][k] for i, q in hold.items()) for k in range(s, e + 1)]

def bench_value(b, s, e, v0):
    kind, h = BENCH[b]
    if kind == 'weights':
        tot = sum(h.values())
        return [v0 * sum(w / tot * px[i][k] / px[i][s] for i, w in h.items()) for k in range(s, e + 1)]
    r = raw_value(h, s, e)
    return [v0 * x / r[0] for x in r]

mean = lambda x: sum(x) / len(x)
def sd(x):
    m = mean(x); return math.sqrt(sum((v - m) ** 2 for v in x) / (len(x) - 1))
def cov(a, b):
    ma, mb = mean(a), mean(b); return sum((x - ma) * (y - mb) for x, y in zip(a, b)) / (len(a) - 1)
def quantile(x, p):
    x = sorted(x); h = (len(x) - 1) * p; lo = math.floor(h)
    return x[lo] if lo + 1 >= len(x) else x[lo] + (h - lo) * (x[lo + 1] - x[lo])

def drawdown(v):
    peak, dd = -1e300, []
    for x in v:
        peak = max(peak, x); dd.append(x / peak - 1)
    t = dd.index(min(dd)); p = max(range(t + 1), key=lambda k: (v[k], -k))  # running max at trough (first index)
    rec = next((k for k in range(t + 1, len(v)) if v[k] >= v[p]), None) if dd[t] < 0 else None
    return dd, dd[t], p, t, rec

def stats(v, ds, rf=0.02):
    r = [v[k] / v[k - 1] - 1 for k in range(1, len(v))]
    rfd = (1 + rf) ** (1 / 252) - 1
    ex = [x - rfd for x in r]
    tr = v[-1] / v[0] - 1
    days = (D(ds[-1]) - D(ds[0])).days
    dd, mdd, p, t, rec = drawdown(v)
    q = quantile(r, 0.05)
    cagr = (1 + tr) ** (365 / days) - 1
    down = math.sqrt(sum(min(0, x) ** 2 for x in ex) / len(r))
    return dict(startValue=v[0], endValue=v[-1], pl=v[-1] - v[0], totalReturn=tr, days=days, cagr=cagr,
                volAnn=sd(r) * math.sqrt(252), sharpe=mean(ex) / sd(r) * math.sqrt(252),
                sortino=mean(ex) / down * math.sqrt(252), maxDD=mdd, maxDDPeakDate=ds[p], maxDDTroughDate=ds[t],
                maxDDRecoveryDate=ds[rec] if rec is not None else None, currentDD=dd[-1],
                calmar=cagr / abs(mdd) if mdd < 0 else None, pctPositive=sum(x > 0 for x in r) / len(r),
                bestDay=max(r), worstDay=min(r), var95=-q, cvar95=-mean([x for x in r if x <= q]))

def relative(vp, vb, rf=0.02):
    rp = [vp[k] / vp[k - 1] - 1 for k in range(1, len(vp))]
    rb = [vb[k] / vb[k - 1] - 1 for k in range(1, len(vb))]
    rfd = (1 + rf) ** (1 / 252) - 1
    beta = cov(rp, rb) / cov(rb, rb)
    corr = cov(rp, rb) / (sd(rp) * sd(rb))
    diff = [a - b for a, b in zip(rp, rb)]
    te = sd(diff) * math.sqrt(252)
    up = [k for k in range(len(rb)) if rb[k] > 0]; dn = [k for k in range(len(rb)) if rb[k] < 0]
    return dict(beta=beta, corr=corr, r2=corr ** 2, alpha=(mean([x - rfd for x in rp]) - beta * mean([x - rfd for x in rb])) * 252,
                trackingError=te, infoRatio=mean(diff) * 252 / te, excessReturn=(vp[-1] / vp[0]) - (vb[-1] / vb[0]),
                upCapture=mean([rp[k] for k in up]) / mean([rb[k] for k in up]),
                downCapture=mean([rp[k] for k in dn]) / mean([rb[k] for k in dn]))

def monthly(v):
    out, anchor, k = [], v[0], 0
    months = sorted({d[:7] for d in dates})
    for m in months:
        last = max(i for i in range(n) if dates[i][:7] == m)
        out.append(dict(month=m, ret=v[last] / anchor - 1)); anchor = v[last]
    return out

ALL = {p['isin']: float(p['shares']) for p in pos}
SEMI = {p['isin']: float(p['shares']) for p in pos if p['group'] == 'High Players Semiconductors'}
cases = [
    dict(name='all_MAX', hold=ALL, rng=preset('MAX'), startValue=None, bench=['msci_world', 'proxy9', 'sp500', 'mix_w', 'spacex_w', 'energie']),
    dict(name='all_3M', hold=ALL, rng=preset('3M'), startValue=None, bench=['nasdaq100', 'mix_w']),
    dict(name='all_1M', hold=ALL, rng=preset('1M'), startValue=None, bench=['semis', 'my_depot']),
    dict(name='all_1W', hold=ALL, rng=preset('1W'), startValue=None, bench=['dax']),
    dict(name='all_6M', hold=ALL, rng=preset('6M'), startValue=None, bench=['gold', 'ftse_all_world', 'spacex_w']),
    dict(name='semis_custom_100k', hold=SEMI, rng=custom('2026-03-01', '2026-07-31'), startValue=100000.0, bench=['semis', 'proxy9', 'mix_w']),
]
out = {'dates': [dates[0], dates[-1], n], 'cases': []}
for c in cases:
    s, e = c['rng']
    raw = raw_value(c['hold'], s, e)
    scale = c['startValue'] / raw[0] if c['startValue'] else 1.0
    v = [x * scale for x in raw]
    ds = dates[s:e + 1]
    res = dict(name=c['name'], isins=sorted(c['hold']), start=s, end=e, startDate=ds[0], endDate=ds[-1],
               startValueInput=c['startValue'], scale=scale, stats=stats(v, ds), bench={}, contrib_sum=None)
    for b in c['bench']:
        bv = bench_value(b, s, e, v[0])
        res['bench'][b] = dict(defn=dict(kind=BENCH[b][0], h=BENCH[b][1]), stats=stats(bv, ds), relative=relative(v, bv))
    contrib = {i: q * (px[i][e] - px[i][s]) * scale / v[0] for i, q in c['hold'].items()}
    res['contrib_sum'] = sum(contrib.values())
    res['top_contrib'] = sorted(contrib.items(), key=lambda kv: -kv[1])[:5]
    out['cases'].append(res)
out['monthly_all'] = monthly(raw_value(ALL, 0, n - 1))

# --- correlationMatrix (pairwise, real quotes only), riskContribution (filled returns), withShares ---
first = {i: next(k for k, r in enumerate(rows) if r[3 + j]) for j, i in enumerate(head[3:])}

def corr_pair(a, b, s, e):
    ks = [k for k in range(s + 1, e + 1) if k - 1 >= first[a] and k - 1 >= first[b]]
    if len(ks) < 3: return None, len(ks)
    ra = [px[a][k] / px[a][k - 1] - 1 for k in ks]; rb = [px[b][k] / px[b][k - 1] - 1 for k in ks]
    sa, sb = sd(ra), sd(rb)
    return (cov(ra, rb) / (sa * sb) if sa > 0 and sb > 0 else None), len(ks)

def corr_matrix(isins, s, e):
    m = [[1.0 if a == b else corr_pair(a, b, s, e)[0] for b in isins] for a in isins]
    cnt = [[corr_pair(a, b, s, e)[1] for b in isins] for a in isins]
    return dict(isins=isins, m=m, n=cnt)

def risk(hold, s, e):
    isins = [p['isin'] for p in pos if p['isin'] in hold]
    v = [hold[i] * px[i][e] for i in isins]; V = sum(v); w = [x / V for x in v]
    R = [[px[i][k] / px[i][k - 1] - 1 for k in range(s + 1, e + 1)] for i in isins]
    S = [[cov(R[a], R[b]) for b in range(len(isins))] for a in range(len(isins))]
    Sw = [sum(S[a][b] * w[b] for b in range(len(isins))) for a in range(len(isins))]
    var = sum(w[a] * Sw[a] for a in range(len(isins)))
    vol = math.sqrt(var * 252)
    rws = []
    for a, i in enumerate(isins):
        mctr = Sw[a] / math.sqrt(var) * math.sqrt(252)
        rws.append(dict(isin=i, weight=w[a], vol=math.sqrt(S[a][a] * 252), mctr=mctr, ctr=w[a] * mctr, pctr=w[a] * mctr / vol))
    return dict(volAnn=vol, diversificationRatio=sum(r['weight'] * r['vol'] for r in rws) / vol, rows=rws)

s3, e3 = preset('3M')
out['corr_3M'] = corr_matrix([p['isin'] for p in pos], s3, e3)
out['corr_MAX'] = corr_matrix([p['isin'] for p in pos], 0, n - 1)   # SpaceX pairs only after its listing
out['risk_MAX_all'] = risk(ALL, 0, n - 1)
out['risk_custom_semis'] = dict(range=custom('2026-03-01', '2026-07-31'), **risk(SEMI, *custom('2026-03-01', '2026-07-31')))
WHATIF = {'US5951121038': 0.0, 'AT0000969985': 100.0, 'US4581401001': 500.0}
wi_hold = {i: WHATIF.get(i, q) for i, q in ALL.items()}
v = raw_value(wi_hold, 0, n - 1)
cb = {p['isin']: float(p['cost_basis']) * (WHATIF[p['isin']] / float(p['shares'])) for p in pos if p['isin'] in WHATIF}
out['whatif'] = dict(overrides=WHATIF, stats=stats(v, dates), risk=risk({i: q for i, q in wi_hold.items() if q > 0}, 0, n - 1),
                     cost_basis=cb, gl_since_buy={i: WHATIF[i] * px[i][n - 1] - cb[i] for i in WHATIF})
print('risk MAX all: vol %.2f%%  DR %.2f  top pctr %s' % (out['risk_MAX_all']['volAnn'] * 100, out['risk_MAX_all']['diversificationRatio'],
      sorted(((r['isin'], round(r['pctr'] * 100, 1)) for r in out['risk_MAX_all']['rows']), key=lambda x: -x[1])[:5]))
print('whatif MAX: TR %+.2f%%  end %.2f' % (out['whatif']['stats']['totalReturn'] * 100, out['whatif']['stats']['endValue']))
# ---- sub-daily grids (chart interval: 1T/1W 30 min, 1M 2 h, custom by length), straight from data/intraday.csv and
# data/intraday_2h.csv. Slots Europe/Berlin (a point goes to its nearest slot, a tie to the later one, the latest point
# wins, +-15 min tolerance); per instrument and session the previous daily close until the first point, then forward-fill
# (a session without any point: flat at the daily price); a final session ends on its daily close; an open session stops
# after its latest point. A chart over the daily range [s, e]: point 0 = the close of s, then every session s+1 .. e.
def berlin_offset_h(t):          # EU summer time: last Sunday of March 01:00 UTC .. last Sunday of October 01:00 UTC
    import calendar
    def last_sun(y, m):
        c = calendar.monthcalendar(y, m)
        return c[-1][6] or c[-2][6]
    a = datetime.datetime(t.year, 3, last_sun(t.year, 3), 1, tzinfo=datetime.timezone.utc)
    b = datetime.datetime(t.year, 10, last_sun(t.year, 10), 1, tzinfo=datetime.timezone.utc)
    return 2 if a <= t < b else 1

GRID_FILES = {'m30': ('intraday.csv', ['%02d:%02d' % divmod(m, 60) for m in range(450, 1381, 30)]),
              'h2': ('intraday_2h.csv', ['%02d:%02d' % divmod(m, 60) for m in range(450, 1291, 120)] + ['23:00'])}
raw_cell = {i: [r[3 + j] for r in rows] for j, i in enumerate(head[3:])}

def load_grid(key):
    fname, times = GRID_FILES[key]
    if not (R/'data'/fname).exists(): return None
    mins = [int(t[:2]) * 60 + int(t[3:]) for t in times]
    S, cells = len(times), {}                                  # (isin, day) -> {slot: (utc, price)}
    for r in csv.DictReader(open(R/'data'/fname, encoding='utf-8')):
        t = datetime.datetime.strptime(r['timestamp_utc'][:19], '%Y-%m-%dT%H:%M:%S').replace(tzinfo=datetime.timezone.utc)
        b = t + datetime.timedelta(hours=berlin_offset_h(t))
        m, d = b.hour * 60 + b.minute + b.second / 60, b.date().isoformat()
        if not (mins[0] - 15 <= m <= mins[-1] + 15) or d not in dates: continue
        k = min(range(S), key=lambda j: (abs(mins[j] - m), -j))
        c = cells.setdefault((r['isin'], d), {})
        if k not in c or t > c[k][0]: c[k] = (t, float(r['price']))
    sess = sorted({d for _, d in cells})
    di = {d: dates.index(d) for d in sess}
    last = {d: S - 1 if status[di[d]] == 'final' else max(k for (_, dd), c in cells.items() if dd == d for k in c) for d in sess}
    memo = {}
    def prices(i, d):                                          # filled slot prices of isin i in session d
        if (i, d) in memo: return memo[i, d]
        k0, c = di[d], {k: v[1] for k, v in cells.get((i, d), {}).items()}
        final = status[k0] == 'final'
        seen = bool(c) or (final and raw_cell[i][k0] != '')    # build_data writes the close into a final day's 23:00 slot
        cur, o = (px[i][max(0, k0 - 1)] if seen else px[i][k0]), []
        for k in range(last[d] + 1):
            if seen and k in c: cur = c[k]
            o.append(cur)
        if final: o[S - 1] = px[i][k0]                         # a finished session ends on its daily close
        memo[i, d] = o
        return o
    return dict(S=S, times=times, sess=set(sess), last=last, prices=prices)

grids = {k: load_grid(k) for k in GRID_FILES}

def frame(g, s, e, context=False):
    """points over the daily range [s, e]: ('close', s) = daily close, (day, slot) = grid slot; None if a session is missing"""
    if not g or e - s < 1 or any(dates[k] not in g['sess'] for k in range(s + 1, e + 1)): return None
    pts = [(dates[s], j) for j in range(g['S'])] if context and dates[s] in g['sess'] else [('close', s)]
    for k in range(s + 1, e + 1): pts += [(dates[k], j) for j in range(g['last'][dates[k]] + 1)]
    return pts

def fval(g, pts, hold):
    p = lambda i, pt: px[i][pt[1]] if pt[0] == 'close' else g['prices'](i, pt[0])[pt[1]]
    return [sum(q * p(i, pt) for i, q in hold) for pt in pts]

def bench_hold(bid, s):          # weights: bought at the close of s (the chart's point 0), then held
    kind, hh = BENCH[bid]
    if kind == 'weights':
        tot = sum(hh.values())
        return [(i, w / tot / px[i][s]) for i, w in hh.items()]
    return list(hh.items())

def interval(s, e, p):
    days = (D(dates[e]) - D(dates[s])).days
    want = ('m30' if days <= 7 else 'h2' if days <= 31 else 'day') if p == 'custom' else {'1T': 'm30', '1W': 'm30', '1M': 'h2'}.get(p, 'day')
    order = ['m30', 'h2', 'day']
    return next(k for k in order[order.index(want):] if k == 'day' or frame(grids[k], s, e) is not None)

allp = [(p['isin'], float(p['shares'])) for p in pos]
semis = [(p['isin'], float(p['shares'])) for p in pos if p['group'] == pos[0]['group']]

def grid_case(name, key, s, e, benches, context=False):
    g = grids[key]
    pts = frame(g, s, e, context)
    if not pts: return None
    base = sum(q * px[i][s] for i, q in allp)
    res = dict(name=name, key=key, start=s, end=e, m=len(pts), last=len(pts) - 1, days=sorted({pt[0] for pt in pts if pt[0] != 'close'}),
               base_all=base, value_all=fval(g, pts, allp), sub_isins=[i for i, _ in semis],
               sub_base=sum(q * px[i][s] for i, q in semis), value_sub=fval(g, pts, semis), bench={}, bench_defs={}, realpl=[])
    for bid in benches:
        h = bench_hold(bid, s)
        r0 = sum(q * px[i][s] for i, q in h)
        res['bench'][bid] = [base * v / r0 for v in fval(g, pts, h)]
        res['bench_defs'][bid] = dict(kind=BENCH[bid][0], h=BENCH[bid][1])
    vd = fval(g, pts, list(BENCH['my_depot'][1].items()))     # real € change of the depot's own holdings
    for a, b in [(0, len(pts) - 1), (10, len(pts) // 2), (len(pts) - 3, 3)]:
        res['realpl'].append([a, b, vd[max(a, b)] - vd[min(a, b)]])
    if status[e] == 'final' and not context:                   # finished sessions end exactly on the daily value
        assert abs(res['value_all'][-1] / raw_value(dict(allp), s, e)[-1] - 1) < 1e-12, name
    return res

out['grid_cases'] = [c for c in [
    grid_case('1W_m30', 'm30', *preset('1W'), ['my_depot', 'mix_w', 'msci_world']),
    grid_case('1M_h2', 'h2', *preset('1M'), ['my_depot', 'mix_w', 'spacex_w', 'energie']),
    grid_case('custom_0901_0907_h2', 'h2', *custom('2026-09-01', '2026-09-07'), ['my_depot', 'mix_w']),
] if c]
CUSTOM_IV = [('2026-09-18', '2026-09-25'), ('2026-09-01', '2026-09-07'), ('2026-08-10', '2026-08-17'), ('2026-09-01', '2026-09-21'),
             ('2026-09-24', '2026-09-25'), ('2026-08-25', '2026-09-01'), ('2026-08-20', '2026-08-27'), ('2026-07-01', '2026-09-25')]
out['intervals'] = [dict(label=p, preset=p, start=preset(p)[0], end=preset(p)[1], key=interval(*preset(p), p))
                    for p in ['1T', '1W', '1M', '3M', '6M', 'YTD', '1J', 'MAX']] + \
                   [dict(label=a + '..' + b, preset='custom', frm=a, to=b, start=custom(a, b)[0], end=custom(a, b)[1], key=interval(*custom(a, b), 'custom'))
                    for a, b in CUSTOM_IV]
# 1T: the last session on the 30-min grid, the previous session as grey context (bought at the previous close)
if grids['m30'] and dates[n - 1] in grids['m30']['sess']:
    c = grid_case('1T_m30', 'm30', n - 2, n - 1, ['msci_world', 'my_depot', 'mix_w'], context=True)
    out['intraday'] = {k: c[k] for k in ('days', 'last', 'base_all', 'value_all', 'sub_isins', 'sub_base', 'value_sub', 'bench', 'bench_defs')}
    print('intraday %s last slot %d: %.2f -> %.2f' % (c['days'], c['last'], c['base_all'], c['value_all'][-1]))
for c in out['grid_cases']:
    print('grid %-22s %s %s..%s %3d points: %.2f -> %.2f' % (c['name'], c['key'], dates[c['start']], dates[c['end']], c['m'], c['base_all'], c['value_all'][-1]))
print('intervals', [(x['label'], x['key']) for x in out['intervals']])

(R/'tests'/'reference.json').write_text(json.dumps(out, indent=1), encoding='utf-8')
for c in out['cases']:
    st = c['stats']
    print(f"{c['name']:<20} {c['startDate']}..{c['endDate']}  V0 {st['startValue']:>12,.2f}  V1 {st['endValue']:>12,.2f}  "
          f"TR {st['totalReturn']*100:+7.2f}%  CAGR {st['cagr']*100:+8.2f}%  vol {st['volAnn']*100:6.2f}%  "
          f"Sharpe {st['sharpe']:5.2f}  MDD {st['maxDD']*100:6.2f}% ({st['maxDDPeakDate']}->{st['maxDDTroughDate']})")
    for b, x in c['bench'].items():
        print(f"    {b:<16} TR {x['stats']['totalReturn']*100:+7.2f}%  beta {x['relative']['beta']:5.2f}  corr {x['relative']['corr']:5.2f}  "
              f"alpha {x['relative']['alpha']*100:+7.2f}%  TE {x['relative']['trackingError']*100:6.2f}%")
print('monthly', [(m['month'], round(m['ret'] * 100, 2)) for m in out['monthly_all']])
