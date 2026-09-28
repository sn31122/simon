@echo off
rem Yacht-Dashboard live: clones github.com/sn31122/simon once, opens dashboard.html and then fetches new commits
rem every 60 seconds. Keep this window open; press F5 in the browser to see the latest version.
rem Settings below: target folder, branch (main = merged work), wait time in seconds.
setlocal
title Yacht-Dashboard live
set "REPO=https://github.com/sn31122/simon.git"
set "DIR=%USERPROFILE%\yacht-live"
set "BRANCH=main"
set "WAIT=60"

rem Git: from PATH, else the default install folder of Git for Windows
where git >nul 2>nul
if errorlevel 1 if exist "%ProgramFiles%\Git\cmd\git.exe" set "PATH=%ProgramFiles%\Git\cmd;%PATH%"
where git >nul 2>nul
if errorlevel 1 goto nogit

if exist "%DIR%\.git" goto ready
echo Erster Start: lade das Repository nach %DIR% ...
echo Beim ersten Mal oeffnet Git ein Anmeldefenster - dort mit deinem GitHub-Konto anmelden.
echo.
git clone --branch %BRANCH% %REPO% "%DIR%"
if errorlevel 1 goto noclone

:ready
git -C "%DIR%" checkout --quiet %BRANCH%
git -C "%DIR%" pull --ff-only --quiet origin %BRANCH%
start "" "%DIR%\dashboard.html"
echo.
echo Dashboard geoeffnet: %DIR%\dashboard.html
echo Dieses Fenster offen lassen: alle %WAIT% Sekunden werden neue Commits von "%BRANCH%" geholt.
echo Bei "Neue Version geladen" im Browser F5 druecken. Beenden: Fenster schliessen.
echo.

:loop
for /f "delims=" %%h in ('git -C "%DIR%" rev-parse HEAD') do set "OLD=%%h"
git -C "%DIR%" pull --ff-only --quiet origin %BRANCH% >nul 2>&1
if errorlevel 1 echo [%time:~0,8%] Aktualisieren fehlgeschlagen - kein Netz? Neuer Versuch in %WAIT% s.
for /f "delims=" %%h in ('git -C "%DIR%" rev-parse HEAD') do set "NEW=%%h"
if not "%OLD%"=="%NEW%" (
  echo [%date% %time:~0,8%] Neue Version geladen - im Browser F5 druecken:
  git -C "%DIR%" log --oneline -1
)
timeout /t %WAIT% /nobreak >nul
goto loop

:nogit
echo Git wurde nicht gefunden. Bitte Git for Windows installieren: https://git-scm.com/download/win
echo Danach dieses Fenster schliessen und die Datei erneut starten.
pause
exit /b 1

:noclone
echo Klonen fehlgeschlagen. Pruefe die Internetverbindung und ob die GitHub-Anmeldung geklappt hat,
echo dann die Datei erneut starten. Ein halb angelegter Ordner %DIR% darf vorher geloescht werden.
pause
exit /b 1
