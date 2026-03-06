@echo off
setlocal

:loop
cd /d %~dp0
call npm run dev %*
goto loop
