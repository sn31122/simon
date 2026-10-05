# Session check for every tool (Claude Code, Codex, a terminal): run it at the start of a session.
#   python tools/check.py          git sync with origin/main, tools, data freshness, tests
#   python tools/check.py --quick  without the tests
# Changes nothing; prints what to do (e.g. "git pull") and exits 1 if something blocks work.
import csv, datetime, os, pathlib, platform, re, shutil, subprocess, sys

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


if R.name == 'yacht-live-main':
    print('PROBLEM: this is the live-view copy (reset to origin/main every 60 s) - work in your own checkout instead')
    sys.exit(1)

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
MAC = sys.platform == 'darwin'
print(f'system: {platform.system()} {platform.mac_ver()[0] if MAC else platform.release()} ({platform.machine()})')
for exe, need in (('node', 'tests, price hook'), ('git', 'sync')):
    print(f'{exe}: ' + (run([exe, '--version'])[1].splitlines()[0] if shutil.which(exe) else 'MISSING'))
    if not shutil.which(exe):
        problems.append(f'{exe} is not on PATH ({need})' + ('; Mac: Node 22 LTS from nodejs.org (Node 24 needs macOS 13.5)'
                                                             if MAC and exe == 'node' else ''))
nv = re.match(r'v(\d+)', run(['node', '--version'])[1]) if shutil.which('node') else None
if nv and int(nv.group(1)) < 18: problems.append(f'node {nv.group(0)} is too old: install Node 22 LTS')
print(f'python: {sys.version.split()[0]} ({sys.executable})')
# 3.8 = python3 of the Command Line Tools on macOS Big Sur (2013 MacBook Air); everything runs on it
if sys.version_info < (3, 8): problems.append('Python 3.8 or newer is needed')
if MAC and shutil.which('python') and not run(['python', '--version'])[1].startswith('Python 3'):
    print('note: on this Mac `python` is Python 2 - always type python3 (e.g. python3 tools/check.py)')

print('== portable ==')
# the page must run from its own folder on Windows and Mac: offline, relative paths, no modules, exact file-name case
page = [R / 'dashboard.html'] + sorted((R / 'css').glob('*.css')) + sorted((R / 'js').glob('*.js'))
bad = []
for f in page:
    t = f.read_text(encoding='utf-8')
    for pat, why in ((r'https?://(?!www\.w3\.org/)', 'web address'), (r'type=["\']module|\bimport\s*\(|^\s*import\s', 'ES module'),
                     (r'\bfetch\s*\(|XMLHttpRequest', 'file loading (blocked on file://)'),
                     (r'[A-Za-z]:\\\\|file:///|/Users/|/home/', 'absolute path'), (r'@import|url\(\s*["\']?https?:', 'external CSS')):
        if re.search(pat, t, re.M): bad.append(f'{f.relative_to(R).as_posix()}: {why}')
ref = re.findall(r'(?:src|href)="([^"#:]+)"', (R / 'dashboard.html').read_text(encoding='utf-8'))
logos = re.findall(r'"logo":"([^"]+)"', (D / 'portfolio-data.js').read_text(encoding='utf-8'))
for rel in ref + [x if '/' in x else 'company-logos/' + x for x in logos]:
    parts, cur = rel.split('/'), R
    for part in parts:   # exact case: Windows and macOS forgive a wrong case, GitHub and the other checkout may not
        names = os.listdir(cur) if cur.is_dir() else []
        if part not in names: bad.append(f'missing or wrong case: {rel}'); break
        cur = cur / part
print(f'page: {len(page)} files, {len(ref)} links, {len(logos)} logos; ' + ('self-contained, works offline from its folder' if not bad else f'{len(bad)} problem(s)'))
for b in bad: problems.append('not self-contained: ' + b)

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
    print(next((ln for ln in o1.splitlines() if ln.startswith('engine tests')), 'engine tests: no result'))
    if c1: problems.append('tests fail (see above)')

print('== result ==')
for t in todo: print('TODO: ' + t)
for p in problems: print('PROBLEM: ' + p)
if not todo and not problems: print('OK: in sync with main, tools present, data current, tests green.')
sys.exit(1 if problems else 0)
