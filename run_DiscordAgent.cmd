@echo off
setlocal

:loop
cd /d %~dp0
call npm run dev %*
set ERR=%ERRORLEVEL%
if "%ERR%"=="10" (
  echo [run_DiscordAgent] another instance already running. exit.
  exit /b 0
)
if "%ERR%"=="0" (
  goto loop
)
echo [run_DiscordAgent] exited with errorlevel %ERR%. retry in 3 sec.
timeout /t 3 /nobreak >nul
goto loop
