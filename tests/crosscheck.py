# Independent reference implementation of the SPEC.md metrics, straight from the CSVs (no engine code).
# Writes tests/reference.json; tests/crosscheck.cjs compares PFEngine against it.
import csv, json, math, datetime, pathlib

R = pathlib.Path(__file__).resolve().parent.parent
pos = list(csv.DictReader(open(R/'data/positions.csv', encoding='utf-8')))
presets = {b['id']: {x.split(':')[0]: float(x.split(':')[1]) for x in b['holdings'].split('|')}
           for b in csv.DictReader(open(R/'data/benchmarks.csv', encoding='utf-8'))}          # UI presets (today only my_depot)
# fixed test benchmarks, independent of the UI: ('holdings', {ISIN: qty}) = constant quantities,
# ('weights', {ISIN: %}) = benchmark card, bought at the range start and held (buy and hold)
P9 = 'US5951121038:191.032|AT0000969985:482.8456|IE00B53SZB19:37.1794|FR0010342592:4707.2392|US5128073062:123.3333|IE00BMC38736:326.1522|US0079031078:58.9772|US4581401001:252.9732|IE00BKVD2N49:32.9963'
BENCH = {
    'msci_world': ('holdings', {'IE00B4L5Y983': 1.0}), 'sp500': ('holdings', {'IE00B3YCGJ38': 1.0}),
    'nasdaq100': ('holdings', {'IE00B53SZB19': 1.0}), 'semis': ('holdings', {'IE00BMC38736': 1.0}),
    'dax': ('holdings', {'DE0005933931': 1.0}), 'gold': ('holdings', {'IE00B4ND3602': 1.0}),
    'ftse_all_world': ('holdings', {'IE00BK5BQT80': 1.0}),
    'proxy9': ('holdings', {x.split(':')[0]: float(x.split(':')[1]) for x in P9.split('|')}),
    'my_depot': ('holdings', presets['my_depot']),
    'mix_w': ('weights', {'IE00B4L5Y983': 40.0, 'FR0010342592': 35.0, 'US5951121038': 25.0}),
    'spacex_w': ('weights', {'US84615Q1031': 50.0, 'IE00B53SZB19': 50.0}),     # SpaceX quoted from 12.06. (flat before)
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
    dict(name='all_MAX', hold=ALL, rng=preset('MAX'), startValue=None, bench=['msci_world', 'proxy9', 'sp500', 'mix_w', 'spacex_w']),
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
# ---- intraday (1T 30-min grid), straight from data/intraday.csv
def berlin_offset_h(t):          # EU summer time: last Sunday of March 01:00 UTC .. last Sunday of October 01:00 UTC
    import calendar
    def last_sun(y, m):
        c = calendar.monthcalendar(y, m)
        return c[-1][6] or c[-2][6]
    a = datetime.datetime(t.year, 3, last_sun(t.year, 3), 1, tzinfo=datetime.timezone.utc)
    b = datetime.datetime(t.year, 10, last_sun(t.year, 10), 1, tzinfo=datetime.timezone.utc)
    return 2 if a <= t < b else 1

if (R/'data'/'intraday.csv').exists():
    S, cells = 32, {}                                     # slots 07:30 .. 23:00 Berlin
    for r in csv.DictReader(open(R/'data'/'intraday.csv', encoding='utf-8')):
        t = datetime.datetime.strptime(r['timestamp_utc'][:19], '%Y-%m-%dT%H:%M:%S').replace(tzinfo=datetime.timezone.utc)
        b = t + datetime.timedelta(hours=berlin_offset_h(t))
        k = int(math.floor((b.hour * 60 + b.minute + b.second / 60 - 450) / 30 + 0.5))
        if 0 <= k < S:
            key = (r['isin'], b.date().isoformat(), k)
            if key not in cells or t > cells[key][0]: cells[key] = (t, float(r['price']))
    days = sorted({d for _, d, _ in cells})[-2:]
    di = [dates.index(d) for d in days]
    last = max(j * S + k for (_, d, k) in cells if d in days for j in [days.index(d)])
    def ipx(i):
        has = any((i, d, k) in cells for d in days for k in range(S))
        o = []
        for j, d in enumerate(days):
            cur = px[i][di[j] - 1] if has else px[i][di[j]]
            for k in range(S):
                if j * S + k > last: break
                if has and (i, d, k) in cells: cur = cells[i, d, k][1]
                o.append(cur)
        return o
    allp = [(p['isin'], float(p['shares'])) for p in pos]
    semis = [(p['isin'], float(p['shares'])) for p in pos if p['group'] == pos[0]['group']]
    def ival(hold):
        cols = [(ipx(i), q) for i, q in hold]
        return [sum(c[k] * q for c, q in cols) for k in range(last + 1)]
    base_all = sum(px[i][n - 2] * q for i, q in allp)
    out['intraday'] = {'days': days, 'last': last, 'base_all': base_all, 'value_all': ival(allp),
                       'sub_isins': [i for i, _ in semis], 'sub_base': sum(px[i][n - 2] * q for i, q in semis), 'value_sub': ival(semis), 'bench': {}}
    out['intraday']['bench_defs'] = {}
    for bid in ('msci_world', 'my_depot', 'mix_w'):
        kind, hh = BENCH[bid]
        if kind == 'weights':               # bought at the previous close (1T start), then held
            tot = sum(hh.values())
            h = [(i, w / tot / px[i][n - 2]) for i, w in hh.items()]
        else:
            h = list(hh.items())
        r0 = sum(px[i][n - 2] * q for i, q in h)
        out['intraday']['bench'][bid] = [base_all * v / r0 for v in ival(h)]
        out['intraday']['bench_defs'][bid] = dict(kind=kind, h=hh)
    print('intraday %s last slot %d: %.2f -> %.2f' % (days, last, base_all, out['intraday']['value_all'][-1]))

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
