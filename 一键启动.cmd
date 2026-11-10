@echo off
setlocal
chcp 65001 >nul
title FrameFlow Workbench
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\launch-workbench.ps1" %*
set "launchExitCode=%errorlevel%"
if not "%launchExitCode%"=="0" (
  echo.
  echo Startup did not finish. See the message and log path above.
  pause
)
exit /b %launchExitCode%
