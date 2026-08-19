@echo off
cd /d "%~dp0"
REM The browser used to be launched BEFORE the server, so a cold start always
REM landed on ERR_CONNECTION_REFUSED and needed a manual refresh. Open the tab
REM from a short delayed side-shell instead; the server keeps this window (so
REM Ctrl+C still stops it).
start "" /min cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:8420"
node tools\serve.mjs 8420
