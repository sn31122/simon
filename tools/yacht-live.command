#!/bin/bash
# Yacht-Dashboard live fuer macOS (Gegenstueck zu yacht-live.bat). Seit 05.10.2026 (user) ohne eigene Kopie: die Datei
# aktualisiert den Repo-Ordner, in dem sie liegt (<Ordner>/tools/yacht-live.command), von GitHub und oeffnet dessen
# dashboard.html; danach prueft sie alle 60 Sekunden auf neue Commits.
# Start: Doppelklick im Finder (oeffnet das Terminal).
# Aktualisiert wird der Branch, der im Ordner ausgecheckt ist, nur vorwaerts (fast-forward) und nur ohne lokale
# Aenderungen - es wird nie etwas ueberschrieben. Ein als ZIP geladener Ordner (ohne .git) wird nur geoeffnet.
WAIT=60
# 1 = bei neuer Version das Dashboard automatisch neu oeffnen (neuer Tab), 0 = nur Hinweis im Fenster
REOPEN=1

printf '\033]0;Yacht-Dashboard live\007'
DIR="$(cd "$(dirname "$0")/.." && pwd)"
PAGE="$DIR/dashboard.html"

pause_exit() { echo; read -r -p "Enter druecken zum Schliessen ..." _; exit "$1"; }
[ -f "$PAGE" ] || { echo "Neben tools/ fehlt dashboard.html ($DIR). Die Datei muss im Ordner tools/ des Repos liegen."; pause_exit 1; }

# ohne Git oder ohne .git (ZIP-Download): nur oeffnen
if ! command -v git >/dev/null 2>&1 || ! git --version >/dev/null 2>&1 || [ ! -d "$DIR/.git" ]; then
  open "$PAGE"
  echo "Dashboard geoeffnet: $PAGE"
  echo "Kein Abgleich mit GitHub: der Ordner ist kein Git-Klon (oder Git fehlt; Mac: xcode-select --install)."
  echo "Fuer automatische Updates das Repo mit git clone laden. Dieses Fenster kann geschlossen werden."
  pause_exit 0
fi

BRANCH=$(git -C "$DIR" rev-parse --abbrev-ref HEAD 2>/dev/null)
show() { git -C "$DIR" log -1 --format="Stand: %h  %cd  %s" --date=format:"%d.%m.%Y %H:%M"; }

# holt origin/<Branch> und spult vor, wenn das gefahrlos geht; Rueckgabe 0 = neuer Stand geladen
update() {
  [ "$BRANCH" = "HEAD" ] && return 1
  if ! git -C "$DIR" fetch --quiet origin "$BRANCH" >/dev/null 2>&1; then
    echo "[$(date +%H:%M:%S)] Abgleich mit GitHub fehlgeschlagen - kein Netz oder keine Anmeldung. Zeige den lokalen Stand."
    return 1
  fi
  [ "$(git -C "$DIR" rev-parse HEAD)" = "$(git -C "$DIR" rev-parse "origin/$BRANCH")" ] && return 1
  if [ -n "$(git -C "$DIR" status --porcelain --untracked-files=no)" ]; then
    echo "[$(date +%H:%M:%S)] Neue Version auf GitHub, aber lokale Aenderungen im Ordner - nichts ueberschrieben."
    return 1
  fi
  if ! git -C "$DIR" merge --ff-only --quiet "origin/$BRANCH" >/dev/null 2>&1; then
    echo "[$(date +%H:%M:%S)] Neue Version auf GitHub, aber eigene Commits im Ordner - nichts ueberschrieben."
    return 1
  fi
  return 0
}

update
show
open "$PAGE"
echo
echo "Dashboard geoeffnet: $PAGE"
echo "Dieses Fenster offen lassen: alle $WAIT Sekunden wird \"$BRANCH\" auf GitHub geprueft."
echo "Im Browser nach einer neuen Version Cmd+Shift+R druecken (laedt auch CSS/JS neu). Beenden: Ctrl+C oder Fenster schliessen."
echo

while true; do
  sleep "$WAIT"
  if update; then
    echo
    echo "[$(date '+%d.%m.%Y %H:%M:%S')] NEUE VERSION geladen - im Browser Cmd+Shift+R druecken:"
    show
    [ "$REOPEN" = "1" ] && open "$PAGE"
  fi
done
