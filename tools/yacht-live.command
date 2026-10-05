#!/bin/bash
# Yacht-Dashboard live fuer macOS (neu 30.09.2026, Gegenstueck zu yacht-live.bat): holt github.com/sn31122/simon
# (Branch main) in einen eigenen Ordner, oeffnet dashboard.html und prueft alle 60 Sekunden auf neue Commits.
# Start: Doppelklick im Finder (oeffnet das Terminal). Die Datei kann in einem beliebigen Ordner liegen.
# Der Ordner $DIR ist nur eine Kopie von main: lokale Aenderungen darin werden bei jedem Abgleich verworfen.
REPO="https://github.com/sn31122/simon.git"
# anderer Ordner fuer die Kopie: Umgebungsvariable YACHT_LIVE_DIR setzen
# Kopie im Downloads-Ordner (user 05.10.2026), frueher $HOME/yacht-live-main
DIR="${YACHT_LIVE_DIR:-$HOME/Downloads/yacht-live-main}"
OLDDIR="$HOME/yacht-live-main"
# Ordner dieser Datei: liegt sie in tools/ eines Checkouts, ist dessen dashboard.html der Offline-Ersatz
HERE="$(cd "$(dirname "$0")" && pwd)"
BRANCH="main"
WAIT=60
# 1 = bei neuer Version das Dashboard automatisch neu oeffnen (neuer Tab), 0 = nur Hinweis im Fenster
REOPEN=1

printf '\033]0;Yacht-Dashboard live\007'

# Offline-Ersatz: das Dashboard des Checkouts, in dem diese Datei liegt (Stand dieses Checkouts, nicht GitHub)
local_copy() {
  [ -f "$HERE/../dashboard.html" ] || return 0
  echo; echo "Oeffne solange die lokale Kopie neben dieser Datei: $HERE/../dashboard.html"
  open "$HERE/../dashboard.html"
}
fail() { echo; echo "$1"; local_copy; echo; read -r -p "Enter druecken zum Schliessen ..." _; exit 1; }

# Git: /usr/bin/git ist nur ein Platzhalter, bis die Command Line Tools installiert sind
if ! command -v git >/dev/null 2>&1 || ! git --version >/dev/null 2>&1; then
  xcode-select --install >/dev/null 2>&1
  fail "Git fehlt. Im Fenster, das sich jetzt oeffnet, die Command Line Tools installieren (bringen auch python3 mit;
oder: https://git-scm.com/download/mac). Danach diese Datei erneut starten."
fi

show() { git -C "$DIR" log -1 --format="Stand: %h  %cd  %s" --date=format:"%d.%m.%Y %H:%M"; }

# vorhandene Kopie vom alten Ort einmalig umziehen (spart das Klonen und die Anmeldung). Beim ersten Zugriff auf
# Downloads fragt macOS, ob das Terminal darauf zugreifen darf: mit OK bestaetigen.
if [ ! -e "$DIR" ] && [ -d "$OLDDIR/.git" ]; then
  echo "Ziehe die Kopie um: $OLDDIR nach $DIR ..."
  mkdir -p "$(dirname "$DIR")" && mv "$OLDDIR" "$DIR"
fi

if [ ! -d "$DIR/.git" ]; then
  echo "Erster Start: lade das Repository nach $DIR ..."
  echo "Falls nach Benutzername/Passwort gefragt wird: GitHub-Benutzername und als Passwort ein"
  echo "Personal Access Token (github.com > Settings > Developer settings > Tokens) eingeben."
  echo
  git -c core.autocrlf=false clone --branch "$BRANCH" "$REPO" "$DIR" \
    || fail "Klonen fehlgeschlagen. Pruefe die Internetverbindung und die GitHub-Anmeldung, dann die Datei
erneut starten. Ein halb angelegter Ordner $DIR darf vorher geloescht werden."
fi

# Ordner fest auf origin/main setzen (kein pull: ein pull bricht bei lokalen Abweichungen still ab)
git -C "$DIR" config core.autocrlf false
git -C "$DIR" remote set-url origin "$REPO"
if git -C "$DIR" fetch --quiet origin "$BRANCH"; then
  git -C "$DIR" checkout --quiet -B "$BRANCH" "origin/$BRANCH"
  git -C "$DIR" reset --quiet --hard "origin/$BRANCH"
else
  echo "[$(date +%H:%M:%S)] Abgleich mit GitHub fehlgeschlagen - kein Netz oder keine Anmeldung. Zeige den letzten Stand."
fi
show
[ -f "$DIR/dashboard.html" ] || fail "Im Ordner $DIR fehlt dashboard.html. Ordner loeschen und diese Datei erneut starten."
open "$DIR/dashboard.html"
echo
echo "Dashboard geoeffnet: $DIR/dashboard.html"
echo "Dieses Fenster offen lassen: alle $WAIT Sekunden wird \"$BRANCH\" auf GitHub geprueft."
echo "Im Browser nach einer neuen Version Cmd+Shift+R druecken (laedt auch CSS/JS neu). Beenden: Ctrl+C oder Fenster schliessen."
echo

while true; do
  sleep "$WAIT"
  OLD=$(git -C "$DIR" rev-parse HEAD)
  if ! git -C "$DIR" fetch --quiet origin "$BRANCH" >/dev/null 2>&1; then
    echo "[$(date +%H:%M:%S)] Abgleich fehlgeschlagen - neuer Versuch in $WAIT s."
    continue
  fi
  NEW=$(git -C "$DIR" rev-parse "origin/$BRANCH")
  if [ "$OLD" != "$NEW" ]; then
    git -C "$DIR" reset --quiet --hard "origin/$BRANCH"
    echo
    echo "[$(date '+%d.%m.%Y %H:%M:%S')] NEUE VERSION geladen - im Browser Cmd+Shift+R druecken:"
    show
    [ "$REOPEN" = "1" ] && open "$DIR/dashboard.html"
  fi
done
