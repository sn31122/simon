# Bundles the dashboard into ONE self-contained page for phones (user 02.10.2026: "can't open it on the phone"):
# dashboard.html + css + data/portfolio-data.js + js/*.js inlined, company logos as data: URIs. The result,
# mobile/yacht-dashboard.html, is published as a private claude.ai artifact (opens in any phone browser / the Claude app).
# The artifact host wraps the page in its own <!doctype>/<head>/<body>, so the bundle carries only <title>, <style>, the
# body markup and the scripts. Plain standard library; run after every price / depot update, then republish.
#
# Usage:  python tools/build_mobile.py        -> mobile/yacht-dashboard.html (size + logo count printed)
import base64, pathlib, re, sys, urllib.parse

if hasattr(sys.stdout, 'reconfigure'): sys.stdout.reconfigure(encoding='utf-8', errors='replace')
ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / 'mobile' / 'yacht-dashboard.html'

html = (ROOT / 'dashboard.html').read_text(encoding='utf-8')
css = (ROOT / 'css' / 'dashboard.css').read_text(encoding='utf-8')
title = re.search(r'<title>(.*?)</title>', html, re.S).group(1)
body = re.search(r'<body[^>]*>(.*)</body>', html, re.S).group(1)
body = re.sub(r'\s*<script src="[^"]+"></script>', '', body)   # scripts are inlined below
lang = (re.search(r'<html[^>]*lang="([^"]+)"', html) or [None, 'de'])[1]


def script(text):
    return '<script>\n' + text.replace('</script', '<\\/script') + '\n</script>\n'


# company logos: data/portfolio-data.js holds "company-logos/<file>" paths -> data: URIs (the host blocks other files)
data = (ROOT / 'data' / 'portfolio-data.js').read_text(encoding='utf-8')
logos = {}
def logo_uri(m):
    f = ROOT / 'company-logos' / urllib.parse.unquote(m.group(1))
    if not f.is_file(): return m.group(0)
    logos[f.name] = True
    return '"data:image/png;base64,' + base64.b64encode(f.read_bytes()).decode('ascii') + '"'
data = re.sub(r'"company-logos/([^"]+)"', logo_uri, data)

# phone extras for the hosted page: the sticky bar clears the notch / status bar (safe-area insets of the host skeleton);
# the dashboard is dark-only, so the host's light color-scheme is overridden
extra = (':root { color-scheme: dark; background: var(--bg); }\n'
         '.topbar { top: env(safe-area-inset-top, 0px); }\n')

page = (f'<title>{title}</title>\n<script>document.documentElement.lang = {lang!r};</script>\n'
        f'<style>\n{css}\n{extra}</style>\n{body.strip()}\n'
        + script(data)
        + ''.join(script((ROOT / 'js' / n).read_text(encoding='utf-8')) for n in ('engine.js', 'charts.js', 'app.js')))
OUT.parent.mkdir(exist_ok=True)
with open(OUT, 'w', encoding='utf-8', newline='') as f: f.write(page)
mb = OUT.stat().st_size / 1e6
print(f'written {OUT.relative_to(ROOT)}: {mb:.1f} MB, {len(logos)} logos inlined' + (' - TOO BIG (> 16 MB)' if mb > 16 else ''))
