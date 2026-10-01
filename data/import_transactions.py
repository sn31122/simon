# Imports a Scalable transaction export (CSV: date;time;status;reference;…) into depot_transactions.csv, the source of the
# "Depot-Historie" preset, then rebuilds portfolio-data.js and runs the tests.
#
# Usage:  python data/import_transactions.py              newest Scalable export in ~/Downloads (Windows: %USERPROFILE%\Downloads)
#         python data/import_transactions.py FILE.csv     a given export (e.g. a file attached in a cloud session)
#         python data/import_transactions.py --dry-run    only report what would change
# Rules: rows are matched by reference + assetType + type (a corporate action shares its reference with its cash
# booking); the new export wins for a known reference, rows only in the old file are
# kept (an export over a shorter period never deletes history). Order = newest first, like Scalable's export.
# Check: the replayed holdings (executed buys/sells, minus the instruments build_data.py ignores) must equal depot.csv;
# a difference is printed (then update the depot too: data/update_depot.py).
import ast, csv, pathlib, re, subprocess, sys

if hasattr(sys.stdout, 'reconfigure'): sys.stdout.reconfigure(encoding='utf-8', errors='replace')
D = pathlib.Path(__file__).resolve().parent
TARGET = D / 'depot_transactions.csv'
HEADER = 'date;time;status;reference;description;assetType;type;isin;shares;price;amount;fee;tax;currency'


def first_line(p):
    try:
        with open(p, encoding='utf-8-sig') as f: return f.readline().strip()
    except (OSError, UnicodeDecodeError):
        return ''


args = [a for a in sys.argv[1:] if not a.startswith('--')]
dry = '--dry-run' in sys.argv
if args:
    src = pathlib.Path(args[0]).expanduser()
    if not src.exists(): sys.exit(f'STOP: {src} not found.')
else:
    dl = pathlib.Path.home() / 'Downloads'
    cands = sorted((p for p in dl.glob('*.csv') if first_line(p) == HEADER), key=lambda p: p.stat().st_mtime, reverse=True) \
        if dl.exists() else []
    if not cands: sys.exit(f'STOP: no Scalable transaction export (*.csv starting with "{HEADER[:30]}…") in {dl}. '
                           'Pass the file: python data/import_transactions.py FILE.csv')
    src = cands[0]
if first_line(src) != HEADER:
    sys.exit(f'STOP: {src.name} is not a Scalable transaction export (first line must be:\n  {HEADER})')


def read(p):
    """-> {(reference, assetType, type): raw line} (raw lines keep Scalable's exact quoting and decimal commas)"""
    text = p.read_text(encoding='utf-8-sig').replace('\r\n', '\n').replace('\r', '\n')
    out = {}
    for ln in text.split('\n')[1:]:
        if not ln.strip(): continue
        r = next(csv.reader([ln], delimiter=';'))
        if len(r) != 14: sys.exit(f'STOP: {p.name}: line with {len(r)} fields instead of 14:\n  {ln}')
        if not re.match(r'^\d{4}-\d{2}-\d{2}$', r[0]): sys.exit(f'STOP: {p.name}: bad date {r[0]!r}')
        k = (r[3], r[5], r[6])
        if k in out: sys.exit(f'STOP: {p.name}: duplicate row {k}')
        out[k] = ln
    return out


old, new = read(TARGET), read(src)
added = [k for k in new if k not in old]
changed = [k for k in new if k in old and new[k] != old[k]]
kept = [k for k in old if k not in new]
merged = {**old, **new}
key = lambda ln: tuple(next(csv.reader([ln], delimiter=';'))[:2])
lines = sorted(merged.values(), key=key, reverse=True)
dates = [key(ln)[0] for ln in lines]
print(f'IMPORT {src}: {len(new)} rows ({min(key(l)[0] for l in new.values())} … {max(key(l)[0] for l in new.values())})')
print(f'  {len(added)} new, {len(changed)} changed, {len(kept)} kept only from the old file; total {len(lines)} rows '
      f'{dates[-1]} … {dates[0]}')
for k in added[:20]:
    r = next(csv.reader([new[k]], delimiter=';'))
    print(f'  + {r[0]} {r[2]:9} {r[6]:10} {r[4][:40]:40} {r[8]:>8} {r[10]:>12}')
if len(added) > 20: print(f'  … and {len(added) - 20} more')

# replay check against depot.csv
src_py = (D / 'build_data.py').read_text(encoding='utf-8')
m = re.search(r"'ignore':\s*(\[[^\]]*\])", src_py)
ignore = set(ast.literal_eval(m.group(1))) if m else set()
num = lambda s: float(s.replace('.', '').replace(',', '.')) if s.strip() else 0.0
hold = {}
for ln in lines:
    r = next(csv.reader([ln], delimiter=';'))
    if r[2] == 'Executed' and r[5] == 'Security' and r[6] in ('Buy', 'Sell') and r[7] not in ignore:
        hold[r[7]] = hold.get(r[7], 0) + num(r[8]) * (1 if r[6] == 'Buy' else -1)
hold = {i: q for i, q in hold.items() if abs(q) > 1e-9}
depot = {r['isin']: float(r['shares']) for r in csv.DictReader(open(D / 'depot.csv', encoding='utf-8'))}
diff = {i: (hold.get(i, 0), depot.get(i, 0)) for i in set(hold) | set(depot) if abs(hold.get(i, 0) - depot.get(i, 0)) > 1e-6}
if diff:
    print('NOTE: the replayed export does not end at depot.csv (export vs depot.csv):')
    for i, (a, b) in sorted(diff.items()): print(f'  {i}: {a:g} vs {b:g}')
    print('  -> if the depot changed since, update it too (Claude Code: "update depot"; data/update_depot.py).')
else:
    print('Check OK: the replayed export ends exactly at the holdings in depot.csv.')
if dry: print('dry run: nothing written.'); sys.exit(0)
if not added and not changed: print('Nothing new; depot_transactions.csv unchanged.'); sys.exit(0)

with open(TARGET, 'w', encoding='utf-8', newline='') as f: f.write(HEADER + '\n' + '\n'.join(lines) + '\n')
print('written: data/depot_transactions.csv')

def run(cmd):
    r = subprocess.run(cmd, cwd=D.parent, capture_output=True, text=True, encoding='utf-8', errors='replace')
    return r.returncode, (r.stdout or '') + (r.stderr or '')

code, o = run([sys.executable, str(D / 'build_data.py')])
if code: print(o); print('STOP: build_data.py failed - restore with: git checkout data/depot_transactions.csv'); sys.exit(1)
c1, o1 = run(['node', 'tests/engine.test.cjs'])
c2, _ = run([sys.executable, 'tests/crosscheck.py'])
c3, o3 = run(['node', 'tests/crosscheck.cjs'])
t1 = next((ln for ln in o1.splitlines() if ln.startswith('engine tests')), 'engine tests: no result')
t3 = next((ln for ln in o3.splitlines() if ln.startswith('crosscheck')), 'crosscheck: no result')
ok = not (c1 or c2 or c3)
print('Tests: ' + ('OK - ' if ok else 'FAILED - ') + t1 + '; ' + t3)
sys.exit(0 if ok else 1)
