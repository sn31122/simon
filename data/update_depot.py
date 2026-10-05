# Updates the real Scalable depot ("update depot"; also after every price update): depot.csv (isin,name,shares),
# depot_ref.csv (Scalable snapshot: securities value, total, G/V per period = what the "Mein Depot" block shows) and the
# weights of the "Mein Depot" card (benchmarks.csv row my_depot = shares x latest final close), then rebuilds + runs the tests.
#
# Input: the raw answers of the read-only Scalable tools get_portfolio_holdings and get_portfolio_overview, saved by the
# hook .claude/hooks/save-portfolio.cjs to data/incoming/depot/holdings.json and overview.json (Claude Code). Without the
# hook (e.g. Codex), save the two JSON answers to files and pass them:  --holdings FILE --overview FILE
#
# Usage:  python data/update_depot.py            check -> write the three files -> rebuild -> tests
#         python data/update_depot.py --dry-run  only print what would change
#         python data/update_depot.py --no-tests rebuild without the tests (update_prices.py --finish runs them afterwards)
# Checks: every held ISIN must be a price column (else: add it as a new instrument first, skill update-quotes); the sum of
# shares x Scalable quote must match the overview's securities value within 0.5 %.
import csv, io, json, pathlib, re, subprocess, sys

if hasattr(sys.stdout, 'reconfigure'): sys.stdout.reconfigure(encoding='utf-8', errors='replace')
D = pathlib.Path(__file__).resolve().parent
INC = D / 'incoming' / 'depot'


def arg(flag, default):
    return pathlib.Path(sys.argv[sys.argv.index(flag) + 1]) if flag in sys.argv else default


def load(path):
    if not path.exists():
        sys.exit(f'STOP: {path} is missing. Call get_portfolio_holdings and get_portfolio_overview (Scalable, read-only, no '
                 f'portfolioId) in Claude Code (the hook saves them), or pass --holdings FILE --overview FILE.')
    d = json.loads(path.read_text(encoding='utf-8'))
    return d.get('response', d), d.get('saved_utc')


hold, saved = load(arg('--holdings', INC / 'holdings.json'))
over, _ = load(arg('--overview', INC / 'overview.json'))
dry = '--dry-run' in sys.argv

with open(D / 'prices_daily.csv', encoding='utf-8') as f:
    rows = [r for r in csv.reader(f) if r]
head, rows = rows[0], rows[1:]
col = {i: k for k, i in enumerate(head)}
final = [r for r in rows if r[1] == 'final']
close_date = final[-1][0]

def close(isin):
    for r in reversed(final):
        if r[col[isin]]: return float(r[col[isin]])
    return None

errors = []
held = [h for h in hold.get('holdings', []) if (h.get('position') or {}).get('filled', 0) > 0]
if not held: errors.append('holdings.json has no positions with filled > 0')
for h in held:
    if h['isin'] not in col:
        errors.append(f"{h['isin']} ({h['name']}) is not a price column: add it as a new instrument first (skill update-quotes)")
crypto = [c['ticker'] for c in hold.get('cryptoHoldings', []) if (c.get('position') or {}).get('filled', 0) > 0]
if crypto: errors.append(f'crypto holdings are not supported by the dashboard: {crypto}')
val = over.get('valuation') or {}
sec, tot = val.get('securities'), val.get('total')
perf = {p.get('timeframe'): p.get('simpleAbsoluteReturn') for p in over.get('performance', [])}
gv = perf.get('MAX')
# Scalable's own € result per period (user 02.10.2026: the "Mein Depot" block shows these, never a recomputation)
PERIODS = [('pl_1t', 'INTRADAY'), ('pl_1w', 'ONE_WEEK'), ('pl_1m', 'ONE_MONTH'), ('pl_3m', 'THREE_MONTHS'),
           ('pl_6m', 'SIX_MONTHS'), ('pl_ytd', 'YEAR_TO_DATE'), ('pl_1j', 'ONE_YEAR')]
if sec is None or gv is None: errors.append('overview.json lacks valuation.securities or the MAX performance')
if hold.get('portfolioId') != over.get('portfolioId'): errors.append('holdings and overview belong to different portfolios')
if errors:
    print('STOP: nothing written.', *errors, sep='\n  '); sys.exit(1)

quoted = sum(h['position']['filled'] * h['currentQuote']['midPrice'] for h in held)
if abs(quoted / sec - 1) > 0.005:
    print(f'STOP: shares x quote = {quoted:,.2f} EUR, but securities value = {sec:,.2f} EUR (> 0.5 % apart); nothing written.')
    sys.exit(1)

# depot.csv
old = {r['isin']: float(r['shares']) for r in csv.DictReader(open(D / 'depot.csv', encoding='utf-8'))}
new = {h['isin']: h['position']['filled'] for h in held}
buf = io.StringIO(); w = csv.writer(buf, lineterminator='\n')
w.writerow(['isin', 'name', 'shares'])
for h in held: w.writerow([h['isin'], h['name'], f"{h['position']['filled']:g}"])
depot_csv = buf.getvalue()

# depot_ref.csv
asof = (over.get('timestamps') or {}).get('valuationTimestampUtc', '')
asof = re.sub(r'\.\d+Z$', 'Z', asof)                     # 2026-10-02T10:18:00.147Z -> …:00Z
buf = io.StringIO(); w = csv.writer(buf, lineterminator='\n')
w.writerow(['asof_utc', 'securities_value', 'total_value', 'gv_since_buy'] + [c for c, _ in PERIODS] + ['source'])
w.writerow([asof, f'{sec:.2f}', f'{tot:.2f}' if tot is not None else '', f'{gv:.2f}'] +
           [f'{perf[t]:.2f}' if isinstance(perf.get(t), (int, float)) else '' for _, t in PERIODS] +
           [f'Scalable get_portfolio_holdings + get_portfolio_overview (valuation.securities / valuation.total / performance '
            f'simpleAbsoluteReturn MAX, INTRADAY … ONE_YEAR), saved {(saved or asof)[:16]}Z by data/update_depot.py'])
ref_csv = buf.getvalue()

# benchmarks.csv: my_depot weights = shares x latest final close (3 decimals, rounding rest on the largest weight)
vals = {}
for i, q in new.items():
    c = close(i)
    if c is None: print(f'STOP: {i} has no final close yet; nothing written.'); sys.exit(1)
    vals[i] = q * c
total = sum(vals.values())
wts = {i: round(v / total * 100, 3) for i, v in vals.items()}
big = max(wts, key=wts.get); wts[big] = round(wts[big] + 100 - sum(wts.values()), 3)
dd = f'{close_date[8:10]}.{close_date[5:7]}.{close_date[:4]}'
bench_lines = (D / 'benchmarks.csv').read_text(encoding='utf-8').splitlines()
out, found = [], False
for ln in bench_lines:
    r = next(csv.reader([ln])) if ln.strip() else []
    if r and r[0] == 'my_depot':
        found = True
        r[2] = '|'.join(f'{i}:{wts[i]:.3f}%' for i in new)
        r[3] = (f'Echtes Scalable-Depot als Gewichtung: Anteile = Stückzahlen vom {asof[8:10]}.{asof[5:7]}.{asof[:4]} × '
                f'Schlusskurse vom {dd} (data/update_depot.py); einzige Karte beim Laden, im Chart eingeblendet; beim Neuladen '
                f'wieder wie hier; auch im Menü „+ Benchmark“')
        buf = io.StringIO(); csv.writer(buf, lineterminator='').writerow(r); ln = buf.getvalue()
    out.append(ln)
if not found: print('STOP: benchmarks.csv has no my_depot row; nothing written.'); sys.exit(1)
bench_csv = '\n'.join(out) + '\n'

print(f'DEPOT {asof}: securities {sec:,.2f} EUR, total {tot:,.2f} EUR, G/V seit Kauf {gv:,.2f} EUR '
      f'(shares x quote {quoted:,.2f} EUR)')
print('  Scalable G/V: ' + ', '.join(f"{c[3:].upper()} {perf[t]:+,.2f}" for c, t in PERIODS if isinstance(perf.get(t), (int, float))))
for i in dict.fromkeys(list(old) + list(new)):
    a, b = old.get(i, 0), new.get(i, 0)
    name = next((h['name'] for h in held if h['isin'] == i), i)
    tag = 'new' if not a else 'sold' if not b else 'changed' if a != b else ''
    print(f'  {i} {name[:40]:40} {a:>10g} -> {b:<10g} {tag}  weight {wts.get(i, 0):.3f} %')
if dry: print('dry run: nothing written.'); sys.exit(0)

for name, text in (('depot.csv', depot_csv), ('depot_ref.csv', ref_csv), ('benchmarks.csv', bench_csv)):
    with open(D / name, 'w', encoding='utf-8', newline='') as f: f.write(text)
print('written: depot.csv, depot_ref.csv, benchmarks.csv (my_depot)')

def run(cmd):
    r = subprocess.run(cmd, cwd=D.parent, capture_output=True, text=True, encoding='utf-8', errors='replace')
    return r.returncode, (r.stdout or '') + (r.stderr or '')

code, o = run([sys.executable, str(D / 'build_data.py')])
if code: print(o); print('STOP: build_data.py failed'); sys.exit(1)
if '--no-tests' in sys.argv: sys.exit(0)        # update_prices.py --finish: tests + AGENTS.md status follow there
c1, o1 = run(['node', 'tests/engine.test.cjs'])
t1 = next((ln for ln in o1.splitlines() if ln.startswith('engine tests')), 'engine tests: no result')
ok = not (c1)
print('Tests: ' + ('OK - ' if ok else 'FAILED - ') + t1)
print('Depot-Historie (depot_transactions.csv) is separate: import a new Scalable export with data/import_transactions.py.')
sys.exit(0 if ok else 1)
