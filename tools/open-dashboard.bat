@echo off
rem Yacht-Dashboard: Doppelklick = neueste Version von GitHub (Branch main) holen und dashboard.html oeffnen.
rem Beim ersten Start wird das Repository nach %USERPROFILE%\yacht-live geklont, danach nur noch aktualisiert.
rem Fenster schliesst sich von selbst. Fuer laufendes Nachladen alle 60 s: tools\yacht-live.bat.
setlocal
set "REPO=https://github.com/sn31122/simon.git"
set "DIR=%USERPROFILE%\yacht-live"
set "BRANCH=main"

where git >nul 2>nul
if errorlevel 1 if exist "%ProgramFiles%\Git\cmd\git.exe" set "PATH=%ProgramFiles%\Git\cmd;%PATH%"
where git >nul 2>nul
if errorlevel 1 goto nogit

if exist "%DIR%\.git" goto update
echo Erster Start: lade das Repository nach %DIR% ...
git clone --branch %BRANCH% %REPO% "%DIR%"
if errorlevel 1 goto fail
goto open

:update
git -C "%DIR%" checkout --quiet %BRANCH%
git -C "%DIR%" pull --ff-only --quiet origin %BRANCH%
if errorlevel 1 echo Aktualisieren fehlgeschlagen - oeffne die zuletzt geladene Version.

:open
for /f "delims=" %%c in ('git -C "%DIR%" log -1 --format^=%%cd --date^=format:%%d.%%m.%%Y_%%H:%%M') do echo Stand: %%c
start "" "%DIR%\dashboard.html"
exit /b 0

:nogit
echo Git wurde nicht gefunden. Bitte Git for Windows installieren: https://git-scm.com/download/win
pause
exit /b 1

:fail
echo Klonen fehlgeschlagen. Internetverbindung / GitHub-Anmeldung pruefen und erneut starten.
pause
exit /b 1
