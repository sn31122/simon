# Kurs-Update beim Start (user 05.10.2026: "make the prices update upon launch"). The launchers tools/yacht-live.bat /
# yacht-live.command run this script after they opened the dashboard: it checks whether the prices in this folder (a copy
# of GitHub main) are stale and, if so, fires the cloud routine that runs the normal price update (skill update-quotes)
# and merges it into main. The launcher checks GitHub every 60 s and reopens the dashboard with the new prices.
#
#   python tools/update_on_launch.py            check + fire when stale (what the launchers run)
#   python tools/update_on_launch.py --setup    once per computer: asks for the routine's API URL and token
#                                               (claude.ai/code/routines > routine > Edit > API trigger > Generate token)
#   python tools/update_on_launch.py --dry-run  only says what it would do
#   python tools/update_on_launch.py --force    fires even when the prices are current
#
# The URL and token live in yacht-routine.txt in the user folder (never in the repository); a file with "off" disables it.
# Stale = during 07:30-23:00 Berlin on a weekday the newest price is older than MAX_AGE_MIN minutes, or the final close of
# the last finished session (after 23:00 Berlin) is missing. Never fires twice within GAP_MIN minutes on one computer.
# Standard library only (Windows + macOS); always exits 0 so the launcher keeps running.
import csv, datetime, json, os, pathlib, platform, re, shutil, subprocess, sys, urllib.error, urllib.request

if hasattr(sys.stdout, 'reconfigure'): sys.stdout.reconfigure(encoding='utf-8', errors='replace')
ROOT = pathlib.Path(__file__).resolve().parent.parent
CONF = pathlib.Path.home() / 'yacht-routine.txt'
STAMP = pathlib.Path.home() / '.yacht-routine-last-fire'   # time of the last fire from this computer
MAX_AGE_MIN = 30                     # intraday prices older than this count as stale during the session
GAP_MIN = 20                         # a run takes ~5-10 min until main has the new prices: no second fire before
OPEN, CLOSE = 7 * 60 + 30, 23 * 60   # Berlin session of the dashboard charts (minutes after midnight)
URL_RE = re.compile(r'https://api\.anthropic\.com/v1/claude_code/routines/[A-Za-z0-9_]+/fire')
TOKEN_RE = re.compile(r'sk-ant-[A-Za-z0-9_-]{8,}')
HEADERS = {'anthropic-beta': 'experimental-cc-routine-2026-04-01', 'anthropic-version': '2023-06-01',
           'Content-Type': 'application/json'}


def say(text):
    print('[Kurs-Update] ' + text, flush=True)


def _last_sunday(y, m):
    d = datetime.date(y, m, 31)
    while d.weekday() != 6: d -= datetime.timedelta(1)
    return d


def berlin(t):
    """UTC datetime -> naive Europe/Berlin time (CEST from the last Sunday of March to the last Sunday of October)."""
    start, end = (datetime.datetime.combine(_last_sunday(t.year, m), datetime.time(1), datetime.timezone.utc) for m in (3, 10))
    return (t + datetime.timedelta(hours=2 if start <= t < end else 1)).replace(tzinfo=None)


def last_closed_session(now):
    """Newest weekday whose session (until 23:00 Berlin) is over at Berlin time now."""
    d = now.date() if now.hour * 60 + now.minute >= CLOSE else now.date() - datetime.timedelta(1)
    while d.weekday() > 4: d -= datetime.timedelta(1)
    return d.isoformat()


def staleness(now_utc):
    """-> (stale, reason) for data/prices_daily.csv (date,status,asof_utc,...) at UTC time now_utc."""
    f = ROOT / 'data' / 'prices_daily.csv'
    if not f.exists(): return False, 'data/prices_daily.csv fehlt'
    with open(f, encoding='utf-8', newline='') as fh:
        rows = [r for r in csv.reader(fh) if r][1:]
    if not rows: return True, 'keine Kurse'
    now = berlin(now_utc)
    last = rows[-1]
    final = max((r[0] for r in rows if r[1] == 'final'), default='')
    need = last_closed_session(now)
    if final < need:
        return True, f'Schlusskurs vom {need} fehlt (letzter: {final or "-"})'
    minute = now.hour * 60 + now.minute
    if now.weekday() < 5 and OPEN <= minute < CLOSE:
        today = now.date().isoformat()
        if last[0] != today or last[1] != 'intraday' or not last[2]:
            return True, f'noch keine Kurse von heute (letzte Zeile {last[0]} {last[1]})'
        asof = datetime.datetime.strptime(last[2][:16], '%Y-%m-%dT%H:%M').replace(tzinfo=datetime.timezone.utc)
        age = (now_utc - asof).total_seconds() / 60
        if age > MAX_AGE_MIN:
            return True, f'letzter Kurs {berlin(asof):%H:%M} ist {age:.0f} min alt'
        return False, f'Kurse aktuell (Stand {berlin(asof):%H:%M})'
    return False, f'Kurse aktuell (Schlusskurs vom {final})'


def read_conf():
    """-> (url, token), 'off' or None (not set up). Environment variables YACHT_ROUTINE_URL / _TOKEN win over the file."""
    url, token = os.environ.get('YACHT_ROUTINE_URL', ''), os.environ.get('YACHT_ROUTINE_TOKEN', '')
    if not (url and token) and CONF.exists():
        text = CONF.read_text(encoding='utf-8-sig').strip()
        if text.lower() == 'off': return 'off'
        for line in text.splitlines():
            k, _, v = line.partition('=')
            if k.strip() == 'url' and not url: url = v.strip()
            if k.strip() == 'token' and not token: token = v.strip()
    return (url, token) if url and token else None


def setup():
    print('Kurs-Update beim Start einrichten (einmal pro Computer).')
    print('1. claude.ai/code/routines > Routine "Yacht Kurs-Update" > Bearbeiten > Trigger "API" hinzufuegen.')
    print('2. URL kopieren, "Generate token" klicken, Token kopieren (wird nur einmal angezeigt).')
    raw = input('URL (oder der ganze curl-Befehl; Enter = Kurs-Update beim Start ausschalten): ').strip()
    if not raw:
        CONF.write_text('off\n', encoding='utf-8')
        print(f'Ausgeschaltet ({CONF}). Spaeter einschalten: python tools/update_on_launch.py --setup')
        return
    m = URL_RE.search(raw)
    if not m:
        print('Darin steht keine Routine-URL (https://api.anthropic.com/v1/claude_code/routines/.../fire). Nichts gespeichert.')
        return
    url = m.group(0)
    t = TOKEN_RE.search(input('Token: ').strip())
    if not t:
        print('Das sieht nicht wie ein Routine-Token aus (beginnt mit sk-ant-). Nichts gespeichert.')
        return
    token = t.group(0)
    CONF.write_text(f'url={url}\ntoken={token}\n', encoding='utf-8')
    if os.name == 'posix': os.chmod(CONF, 0o600)
    print(f'Gespeichert in {CONF} (nicht im Repository). Ab jetzt startet der Launcher das Update, wenn die Kurse alt sind.')


def fire(url, token, text):
    """POST {text} to the routine's /fire endpoint -> session URL. urllib first, curl as fallback (certificate stores)."""
    body = json.dumps({'text': text}).encode('utf-8')
    try:
        req = urllib.request.Request(url, data=body, method='POST', headers=dict(HEADERS, Authorization='Bearer ' + token))
        with urllib.request.urlopen(req, timeout=30) as r:
            answer = json.loads(r.read().decode('utf-8') or '{}')
    except urllib.error.HTTPError as e:
        raise RuntimeError(f'HTTP {e.code}: {e.read().decode("utf-8", "replace")[:300]}')
    except (urllib.error.URLError, OSError) as e:
        if not shutil.which('curl'): raise RuntimeError(str(e))
        cmd = ['curl', '-sS', '--max-time', '30', '-X', 'POST', url, '-d', body.decode('utf-8'), '-w', '\n%{http_code}']
        for k, v in dict(HEADERS, Authorization='Bearer ' + token).items(): cmd += ['-H', f'{k}: {v}']
        r = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='replace')
        out, _, code = (r.stdout or '').rpartition('\n')
        if r.returncode or not code.startswith('2'): raise RuntimeError(f'curl {r.returncode} HTTP {code}: {(out or r.stderr)[:300]}')
        answer = json.loads(out or '{}')
    return answer.get('claude_code_session_url') or answer.get('claude_code_session_id') or json.dumps(answer)[:200]


def main():
    if '--setup' in sys.argv: return setup()
    now = datetime.datetime.now(datetime.timezone.utc)
    stale, why = staleness(now)
    force, dry = '--force' in sys.argv, '--dry-run' in sys.argv
    if not stale and not force:
        return say(why + '.')
    conf = read_conf()
    if conf == 'off':
        return say(why + ' - Update beim Start ist ausgeschaltet (einschalten: python tools/update_on_launch.py --setup).')
    if conf is None:
        say(why + ' - Update beim Start ist noch nicht eingerichtet.')
        if sys.stdin and sys.stdin.isatty() and not dry:
            ans = input('[Kurs-Update] Jetzt einrichten? (j/n, Enter = spaeter): ').strip().lower()
            if ans in ('j', 'ja', 'y', 'yes'):
                setup()
                conf = read_conf()
        if not isinstance(conf, tuple):
            return say('Einrichten: python tools/update_on_launch.py --setup  (oder im Claude-Projekt "update" sagen).')
    if STAMP.exists() and not force:
        try:
            last = datetime.datetime.fromisoformat(STAMP.read_text(encoding='utf-8').strip())
            if (now - last).total_seconds() < GAP_MIN * 60:
                return say(f'{why} - Update laeuft schon (gestartet {berlin(last):%H:%M}); neue Kurse kommen automatisch.')
        except ValueError:
            pass
    if dry:
        return say(f'{why} - wuerde jetzt das Cloud-Update starten (--dry-run).')
    text = f'Launcher on {platform.node() or "?"} at {berlin(now):%d.%m.%Y %H:%M} Berlin; reason: {why}'
    try:
        session = fire(conf[0], conf[1], text)
    except Exception as e:                                         # network, token revoked, limits: report and go on
        return say(f'{why} - Start fehlgeschlagen: {e}. Alternativ im Claude-Projekt "update" sagen.')
    STAMP.write_text(now.isoformat(timespec='seconds') + '\n', encoding='utf-8')
    say(f'{why} - Cloud-Update gestartet: {session}')
    say('Neue Kurse kommen in etwa 5-10 Minuten; dieses Fenster laedt das Dashboard dann automatisch neu.')


if __name__ == '__main__':
    try:
        main()
    except (KeyboardInterrupt, EOFError):
        print()
    except Exception as e:                                         # never stop the launcher
        say(f'Fehler: {e}')
    sys.exit(0)
