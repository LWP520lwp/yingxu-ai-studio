@echo off
setlocal
chcp 65001 >nul
title FrameFlow GitHub Login Setup
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\configure-github-oauth.ps1" %*
set "setupExitCode=%errorlevel%"
if not "%setupExitCode%"=="0" goto setup_failed
if /I "%~1"=="-CheckOnly" exit /b 0
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\configure-github-oauth.ps1" -RequireConfigured
set "setupExitCode=%errorlevel%"
if not "%setupExitCode%"=="0" goto setup_failed
echo.
echo Configuration saved. Restarting this workbench API...
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\restart-api.ps1" -SkipBuild
set "setupExitCode=%errorlevel%"
if not "%setupExitCode%"=="0" goto setup_failed
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\launch-workbench.ps1"
set "setupExitCode=%errorlevel%"
if not "%setupExitCode%"=="0" goto setup_failed
echo.
echo Setup finished. Refresh the workbench, then choose GitHub login.
pause
exit /b 0

:setup_failed
echo.
echo Setup did not finish. See the message above. No credentials were printed.
pause
exit /b %setupExitCode%
