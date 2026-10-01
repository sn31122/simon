# Session check for every tool (Claude Code, Codex, a terminal): run it at the start of a session.
#   python tools/check.py          git sync with origin/main, tools, data freshness, tests
#   python tools/check.py --quick  without the tests
# Changes nothing; prints what to do (e.g. "git pull") and exits 1 if something blocks work.
import csv, datetime, pathlib, shutil, subprocess, sys

if hasattr(sys.stdout, 'reconfigure'): sys.stdout.reconfigure(encoding='utf-8', errors='replace')
R = pathlib.Path(__file__).resolve().parent.parent
D = R / 'data'
problems, todo = [], []


def run(cmd, timeout=300):
    try:
        r = subprocess.run(cmd, cwd=R, capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=timeout)
        return r.returncode, ((r.stdout or '') + (r.stderr or '')).strip()
    except (OSError, subprocess.TimeoutExpired) as e:
        return 1, str(e)


def weekdays_since(day):
    d, n, today = datetime.date.fromisoformat(day), 0, datetime.date.today()
    while d < today:
        d += datetime.timedelta(days=1); n += d.weekday() < 5
    return n


print('== git ==')
c, branch = run(['git', 'rev-parse', '--abbrev-ref', 'HEAD'])
c2, _ = run(['git', 'fetch', '--quiet', 'origin', 'main'], timeout=60)
_, dirty = run(['git', 'status', '--porcelain', '--untracked-files=no'])
_, counts = run(['git', 'rev-list', '--left-right', '--count', 'HEAD...origin/main'])
ahead, behind = (int(x) for x in counts.split()) if c2 == 0 and len(counts.split()) == 2 else (0, 0)
print(f'branch {branch}; {ahead} commit(s) not on main, {behind} commit(s) of main missing'
      + ('' if c2 == 0 else ' (fetch failed: offline or no GitHub login)') + (f'; uncommitted changes:\n  ' + dirty.replace(chr(10), chr(10) + '  ') if dirty else ''))
if behind:
    if branch == 'main' and not dirty: todo.append('git pull --ff-only   (main has newer commits)')
    elif branch == 'main': todo.append('commit or stash your changes, then git pull --ff-only')
    else: todo.append('git merge origin/main   (this branch is behind main)')

print('== tools ==')
for exe, need in (('node', 'tests, price hook'), ('git', 'sync')):
    print(f'{exe}: ' + (run([exe, '--version'])[1].splitlines()[0] if shutil.which(exe) else 'MISSING'))
    if not shutil.which(exe): problems.append(f'{exe} is not on PATH ({need})')
print(f'python: {sys.version.split()[0]}')
if sys.version_info < (3, 9): problems.append('Python 3.9 or newer is needed')

print('== data ==')
rows = [r for r in csv.reader(open(D / 'prices_daily.csv', encoding='utf-8')) if r]
last = rows[-1]
lastfinal = next(r[0] for r in reversed(rows[1:]) if r[1] == 'final')
gap = weekdays_since(lastfinal)
print(f'prices: last row {last[0]} ({last[1]}), last final close {lastfinal} ({gap} weekday(s) ago), {len(rows[0]) - 3} series')
if gap > 1: todo.append('prices are old: say "update" in Claude Code (needs the Scalable connector + hook)')
ref = next(csv.DictReader(open(D / 'depot_ref.csv', encoding='utf-8')), {})
print(f'depot: as of {ref.get("asof_utc", "?")}, securities {ref.get("securities_value", "?")} EUR')
tx = [r for r in csv.reader(open(D / 'depot_transactions.csv', encoding='utf-8-sig'), delimiter=';') if r][1:]
print(f'transactions: {len(tx)} rows, newest {max(r[0] for r in tx)}')
gen = (D / 'portfolio-data.js').read_text(encoding='utf-8')
if f'"last_date":"{last[0]}"' not in gen:
    problems.append('portfolio-data.js is out of date: python data/build_data.py')

if '--quick' not in sys.argv:
    print('== tests ==')
    c1, o1 = run(['node', 'tests/engine.test.cjs'])
    c2, o2 = run([sys.executable, 'tests/crosscheck.py'])
    c3, o3 = run(['node', 'tests/crosscheck.cjs'])
    pick = lambda o, p: next((ln for ln in o.splitlines() if ln.startswith(p)), p + ': no result')
    print(pick(o1, 'engine tests')); print(pick(o3, 'crosscheck'))
    if c1 or c2 or c3: problems.append('tests fail (see above)')
    if c2 == 0 and run(['git', 'diff', '--quiet', 'tests/reference.json'])[0]:
        print('(tests/reference.json was regenerated; commit it with your next data change or: git checkout tests/reference.json)')

print('== result ==')
for t in todo: print('TODO: ' + t)
for p in problems: print('PROBLEM: ' + p)
if not todo and not problems: print('OK: in sync with main, tools present, data current, tests green.')
sys.exit(1 if problems else 0)
