# Adds, changes, renames and removes benchmark presets (data/benchmarks.csv, "+ Benchmark" menu), then rebuilds + tests.
#
#   python data/benchmarks.py list
#   python data/benchmarks.py add "asdf" "microsoft 30 nvidia 40 palantir 30"
#   python data/benchmarks.py set energie "ge vernova 20 vertiv 80"       (replaces all holdings)
#   python data/benchmarks.py rename energie "Energie neu"
#   python data/benchmarks.py remove energie
#   add --dry-run to any command to only print the result.
# Holdings: "<instrument> <percent>" pairs, separated by spaces, commas or "|" ("ISIN:20%" also works); an instrument is
# an ISIN or (part of) its short name / name in instruments.csv; weights must total 100 %. Benchmarks are found by id or
# name (case-insensitive). "Mein Depot" (update_depot.py) and "Depot-Historie" (transactions) cannot be changed here.
import csv, datetime, io, pathlib, re, subprocess, sys

if hasattr(sys.stdout, 'reconfigure'): sys.stdout.reconfigure(encoding='utf-8', errors='replace')
D = pathlib.Path(__file__).resolve().parent
F = D / 'benchmarks.csv'
PROTECTED = {'my_depot': 'Mein Depot is written by data/update_depot.py', 'depot_history': 'Depot-Historie replays the transactions'}
ISIN_RE = re.compile(r'^[A-Z]{2}[A-Z0-9]{9}\d$')


def stop(msg):
    print('STOP: ' + msg + '\nNothing written.'); sys.exit(1)


lines = F.read_text(encoding='utf-8').splitlines()
header, rows = lines[0], [next(csv.reader([ln])) for ln in lines[1:] if ln.strip()]
with open(D / 'prices_daily.csv', encoding='utf-8') as f: price_cols = set(next(csv.reader(f))[3:])
inst = {r['isin']: r for r in csv.DictReader(open(D / 'instruments.csv', encoding='utf-8'))}
short = lambda i: (inst.get(i) or {}).get('short') or i


def norm(s): return re.sub(r'[^a-z0-9]+', ' ', s.casefold()).strip()


def find_instrument(q):
    if ISIN_RE.match(q.upper()):
        if q.upper() in price_cols: return q.upper()
        stop(f'{q.upper()} is not a price column. Add it as a new instrument first (UPDATE_PRICES.md, "New instrument").')
    n = norm(q)
    for exact in (lambda r: norm(r['short']) == n, lambda r: norm(r['name']) == n):
        hits = [i for i, r in inst.items() if exact(r) and i in price_cols]
        if len(hits) == 1: return hits[0]
    words, text = n.split(), {i: norm(r['short'] + ' ' + r['name']) for i, r in inst.items() if i in price_cols}
    hits = [i for i, t in text.items() if all(w in t.split() for w in words)]               # whole words first
    if not hits: hits = [i for i, t in text.items() if all(w in t for w in words)]           # then parts of words
    if len(hits) == 1: return hits[0]
    if not hits:
        stop(f'no tracked instrument matches "{q}". If it should be added: search it on Scalable and add it as a new '
             f'instrument first (UPDATE_PRICES.md, "New instrument").')
    stop(f'"{q}" is ambiguous: ' + '; '.join(f'{short(i)} = {inst[i]["name"]} ({i})' for i in hits[:12])
         + ' - name it more exactly or use the ISIN.')


def parse_holdings(spec):
    toks = [t for t in re.split(r'[\s,;|]+', spec.replace(':', ' ')) if t]
    out, name = {}, []
    for t in toks:
        m = re.fullmatch(r'(\d+(?:[.,]\d+)?)\s*%?', t)
        if m and name:
            i = find_instrument(' '.join(name)); name = []
            if i in out: stop(f'{short(i)} appears twice')
            out[i] = float(m.group(1).replace(',', '.'))
        elif t != '%':
            name.append(t)
    if name: stop(f'no percentage after "{" ".join(name)}"')
    if not out: stop('no holdings given')
    tot = sum(out.values())
    if abs(tot - 100) > 0.01: stop(f'weights total {tot:g} %, not 100 %')
    return out


def find_row(q):
    n = norm(q)
    hits = [r for r in rows if norm(r[0]) == n or norm(r[1]) == n]
    if not hits: stop(f'no benchmark "{q}". Existing: ' + ', '.join(f'{r[1]} ({r[0]})' for r in rows))
    return hits[0]


def fmt(w): return '|'.join(f'{i}:{v:g}%' for i, v in w.items())
def describe(name, w):
    today = datetime.date.today().strftime('%d.%m.%Y')
    parts = ', '.join(f'{v:g} % {short(i)}' for i, v in w.items())
    return f'{name} (user {today}): {parts}; feste Startgewichtung, Kauf am Zeitraumbeginn, dann gehalten; im Menü „+ Benchmark“ wählbar'


args = [a for a in sys.argv[1:] if a != '--dry-run']
dry = '--dry-run' in sys.argv
cmd = args[0].lower() if args else 'list'
if cmd == 'list':
    for r in rows:
        h = r[2] if r[2] == 'transactions' else ', '.join(f'{short(i)} {v}' for i, v in (x.split(':') for x in r[2].split('|')))
        print(f'{r[1]} ({r[0]}, {r[4] or "menu"}): {h}')
    sys.exit(0)
if cmd == 'add':
    if len(args) != 3: stop('usage: add "<name>" "<instrument> <percent> ..."')
    name, w = args[1].strip(), parse_holdings(args[2])
    if any(norm(r[0]) == norm(name) or norm(r[1]) == norm(name) for r in rows): stop(f'a benchmark "{name}" exists already (use set)')
    bid = re.sub(r'[^a-z0-9]+', '_', name.casefold()).strip('_') or 'benchmark'
    while any(r[0] == bid for r in rows): bid += '_2'
    rows.append([bid, name, fmt(w), describe(name, w), 'menu'])
    msg = f'added {name} ({bid}): ' + ', '.join(f'{short(i)} {v:g} %' for i, v in w.items())
elif cmd in ('set', 'change'):
    if len(args) != 3: stop('usage: set <benchmark> "<instrument> <percent> ..."')
    r = find_row(args[1])
    if r[0] in PROTECTED: stop(PROTECTED[r[0]])
    w = parse_holdings(args[2])
    r[2], r[3] = fmt(w), describe(r[1], w)
    msg = f'changed {r[1]} ({r[0]}): ' + ', '.join(f'{short(i)} {v:g} %' for i, v in w.items())
elif cmd == 'rename':
    if len(args) != 3: stop('usage: rename <benchmark> "<new name>"')
    r = find_row(args[1])
    if r[0] in PROTECTED: stop(PROTECTED[r[0]])
    old, r[1] = r[1], args[2].strip()
    r[3] = r[3].replace(old, r[1], 1)
    msg = f'renamed {old} -> {r[1]} (id {r[0]} kept)'
elif cmd in ('remove', 'delete'):
    if len(args) != 2: stop('usage: remove <benchmark>')
    r = find_row(args[1])
    if r[0] in PROTECTED: stop(PROTECTED[r[0]])
    rows.remove(r)
    msg = f'removed {r[1]} ({r[0]})'
else:
    stop(f'unknown command {cmd!r} (list, add, set, rename, remove)')

buf = io.StringIO(); w = csv.writer(buf, lineterminator='\n')
for r in rows: w.writerow(r)
text = header + '\n' + buf.getvalue()
print(msg)
if dry: print('dry run: nothing written.'); sys.exit(0)
with open(F, 'w', encoding='utf-8', newline='') as f: f.write(text)


def run(c):
    p = subprocess.run(c, cwd=D.parent, capture_output=True, text=True, encoding='utf-8', errors='replace')
    return p.returncode, (p.stdout or '') + (p.stderr or '')

code, o = run([sys.executable, str(D / 'build_data.py')])
if code: print(o); print('STOP: build_data.py failed - restore with: git checkout data/benchmarks.csv'); sys.exit(1)
c1, o1 = run(['node', 'tests/engine.test.cjs'])
c2, _ = run([sys.executable, 'tests/crosscheck.py'])
c3, o3 = run(['node', 'tests/crosscheck.cjs'])
t1 = next((ln for ln in o1.splitlines() if ln.startswith('engine tests')), 'engine tests: no result')
t3 = next((ln for ln in o3.splitlines() if ln.startswith('crosscheck')), 'crosscheck: no result')
print('written: data/benchmarks.csv; Tests: ' + ('OK - ' if not (c1 or c2 or c3) else 'FAILED - ') + t1 + '; ' + t3)
sys.exit(1 if c1 or c2 or c3 else 0)
