@echo off
rem Yacht-Dashboard live (neu 30.09.2026): holt github.com/sn31122/simon (Branch main) in einen eigenen Ordner, oeffnet
rem dashboard.html und prueft alle 10 Sekunden auf neue Commits. Die Datei kann in einem beliebigen Ordner liegen.
rem Der Ordner %DIR% ist nur eine Kopie von main: lokale Aenderungen darin werden bei jedem Abgleich verworfen.
setlocal EnableDelayedExpansion
title Yacht-Dashboard live
set "REPO=https://github.com/sn31122/simon.git"
set "DIR=%USERPROFILE%\yacht-live-main"
set "BRANCH=main"
set "WAIT=10"
rem 1 = bei neuer Version das Dashboard automatisch neu oeffnen (neuer Tab), 0 = nur Hinweis im Fenster
set "REOPEN=1"

rem Git: aus PATH, sonst aus dem Standardordner von Git for Windows
where git >nul 2>nul
if errorlevel 1 if exist "%ProgramFiles%\Git\cmd\git.exe" set "PATH=%ProgramFiles%\Git\cmd;%PATH%"
where git >nul 2>nul
if errorlevel 1 goto nogit

if exist "%DIR%\.git" goto sync
echo Erster Start: lade das Repository nach %DIR% ...
echo Falls ein Anmeldefenster erscheint: mit deinem GitHub-Konto anmelden.
echo.
git -c core.autocrlf=false clone --branch %BRANCH% %REPO% "%DIR%"
if errorlevel 1 goto noclone

:sync
rem Ordner fest auf origin/main setzen (kein pull: ein pull bricht bei lokalen Abweichungen still ab)
git -C "%DIR%" config core.autocrlf false
git -C "%DIR%" remote set-url origin %REPO%
git -C "%DIR%" fetch --quiet origin %BRANCH%
if errorlevel 1 (
  echo [%time:~0,8%] Abgleich mit GitHub fehlgeschlagen - kein Netz oder keine Anmeldung. Zeige den letzten Stand.
) else (
  git -C "%DIR%" checkout --quiet -B %BRANCH% origin/%BRANCH%
  git -C "%DIR%" reset --quiet --hard origin/%BRANCH%
)
call :show
start "" "%DIR%\dashboard.html"
echo.
echo Dashboard geoeffnet: %DIR%\dashboard.html
echo Dieses Fenster offen lassen: alle %WAIT% Sekunden wird "%BRANCH%" auf GitHub geprueft.
echo Im Browser nach einer neuen Version STRG+F5 druecken (laedt auch CSS/JS neu). Beenden: Fenster schliessen.
echo.

:loop
timeout /t %WAIT% /nobreak >nul
for /f "delims=" %%h in ('git -C "%DIR%" rev-parse HEAD') do set "OLD=%%h"
git -C "%DIR%" fetch --quiet origin %BRANCH% >nul 2>&1
if errorlevel 1 (
  echo [%time:~0,8%] Abgleich fehlgeschlagen - neuer Versuch in %WAIT% s.
  goto loop
)
for /f "delims=" %%h in ('git -C "%DIR%" rev-parse origin/%BRANCH%') do set "NEW=%%h"
if not "!OLD!"=="!NEW!" (
  git -C "%DIR%" reset --quiet --hard origin/%BRANCH%
  echo.
  echo [%date% %time:~0,8%] NEUE VERSION geladen - im Browser STRG+F5 druecken:
  call :show
  if "%REOPEN%"=="1" start "" "%DIR%\dashboard.html"
)
goto loop

:show
git -C "%DIR%" log -1 --format="Stand: %%h  %%cd  %%s" --date=format:"%%d.%%m.%%Y %%H:%%M"
exit /b 0

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
