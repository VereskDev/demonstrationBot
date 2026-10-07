@echo off
rem assistant-bot launcher. ASCII only: cmd misreads batch lines after chcp 65001 + Cyrillic.
rem Closing this window stops the bot. Crashes restart after 5 s. Log: data\bot.out.log
cd /d "%~dp0"
title assistant-bot
if not exist data mkdir data
echo Starting assistant-bot. Log: data\bot.out.log
:loop
node --disable-warning=ExperimentalWarning node_modules\tsx\dist\cli.mjs src\main.ts >> data\bot.out.log 2>&1
echo [%date% %time%] bot exited with code %errorlevel%, restarting in 5 s... >> data\bot.out.log
timeout /t 5 /nobreak >nul
goto loop
