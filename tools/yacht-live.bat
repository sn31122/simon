@echo off
rem Yacht-Dashboard live (Windows). Seit 05.10.2026 (user) ohne eigene Kopie: die Datei aktualisiert den Repo-Ordner, in
rem dem sie liegt (<Ordner>\tools\yacht-live.bat), von GitHub und oeffnet dessen dashboard.html; danach prueft sie alle
rem 60 Sekunden auf neue Commits. Aktualisiert wird der Branch, der im Ordner ausgecheckt ist, nur vorwaerts
rem (fast-forward) und nur ohne lokale Aenderungen - es wird nie etwas ueberschrieben. Ein als ZIP geladener Ordner
rem (ohne .git) wird nur geoeffnet.
setlocal EnableDelayedExpansion
title Yacht-Dashboard live
set "WAIT=60"
rem 1 = bei neuer Version das Dashboard automatisch neu oeffnen (neuer Tab), 0 = nur Hinweis im Fenster
set "REOPEN=1"
for %%d in ("%~dp0..") do set "DIR=%%~fd"
set "PAGE=%DIR%\dashboard.html"
if not exist "%PAGE%" (
  echo Neben tools\ fehlt dashboard.html: %DIR%
  echo Die Datei muss im Ordner tools\ des Repos liegen.
  pause
  exit /b 1
)

rem Git: aus PATH, sonst aus den Standardordnern von Git for Windows (fuer alle / nur fuer mich installiert)
where git >nul 2>nul
if errorlevel 1 if exist "%ProgramFiles%\Git\cmd\git.exe" set "PATH=%ProgramFiles%\Git\cmd;%PATH%"
where git >nul 2>nul
if errorlevel 1 if exist "%LOCALAPPDATA%\Programs\Git\cmd\git.exe" set "PATH=%LOCALAPPDATA%\Programs\Git\cmd;%PATH%"
where git >nul 2>nul
if errorlevel 1 goto onlyopen
if not exist "%DIR%\.git" goto onlyopen

set "BRANCH="
for /f "delims=" %%b in ('git -C "%DIR%" rev-parse --abbrev-ref HEAD') do set "BRANCH=%%b"
call :update
call :show
start "" "%PAGE%"
echo.
echo Dashboard geoeffnet: %PAGE%
echo Dieses Fenster offen lassen: alle %WAIT% Sekunden wird "%BRANCH%" auf GitHub geprueft.
echo Im Browser nach einer neuen Version STRG+F5 druecken (laedt auch CSS/JS neu). Beenden: Fenster schliessen.
echo.

:loop
timeout /t %WAIT% /nobreak >nul
call :update
if "!NEWVER!"=="1" (
  echo.
  echo [%date% !time:~0,8!] NEUE VERSION geladen - im Browser STRG+F5 druecken:
  call :show
  if "%REOPEN%"=="1" start "" "%PAGE%"
)
goto loop

rem holt origin/<Branch> und spult vor, wenn das gefahrlos geht; NEWVER=1 = neuer Stand geladen
:update
set "NEWVER=0"
if "%BRANCH%"=="HEAD" exit /b 0
if "%BRANCH%"=="" exit /b 0
git -C "%DIR%" fetch --quiet origin %BRANCH% >nul 2>&1
if errorlevel 1 (
  echo [!time:~0,8!] Abgleich mit GitHub fehlgeschlagen - kein Netz oder keine Anmeldung. Zeige den lokalen Stand.
  exit /b 0
)
for /f "delims=" %%h in ('git -C "%DIR%" rev-parse HEAD') do set "OLD=%%h"
for /f "delims=" %%h in ('git -C "%DIR%" rev-parse origin/%BRANCH%') do set "NEW=%%h"
if "!OLD!"=="!NEW!" exit /b 0
set "DIRTY="
for /f "delims=" %%s in ('git -C "%DIR%" status --porcelain --untracked-files^=no') do set "DIRTY=1"
if defined DIRTY (
  echo [!time:~0,8!] Neue Version auf GitHub, aber lokale Aenderungen im Ordner - nichts ueberschrieben.
  exit /b 0
)
git -C "%DIR%" merge --ff-only --quiet origin/%BRANCH% >nul 2>&1
if errorlevel 1 (
  echo [!time:~0,8!] Neue Version auf GitHub, aber eigene Commits im Ordner - nichts ueberschrieben.
  exit /b 0
)
set "NEWVER=1"
exit /b 0

:show
git -C "%DIR%" log -1 --format="Stand: %%h  %%cd  %%s" --date=format:"%%d.%%m.%%Y %%H:%%M"
exit /b 0

:onlyopen
start "" "%PAGE%"
echo Dashboard geoeffnet: %PAGE%
echo Kein Abgleich mit GitHub: der Ordner ist kein Git-Klon oder Git fehlt (https://git-scm.com/download/win).
echo Fuer automatische Updates das Repo mit git clone laden. Dieses Fenster kann geschlossen werden.
pause
exit /b 0
