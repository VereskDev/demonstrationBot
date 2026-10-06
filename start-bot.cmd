@echo off
chcp 65001 >nul
cd /d "%~dp0"
title assistant-bot
echo Запускаю бота. Закрыть это окно = остановить бота. При сбое перезапускается сам.
:loop
node --disable-warning=ExperimentalWarning node_modules\tsx\dist\cli.mjs src\main.ts
echo [%date% %time%] бот завершился с кодом %errorlevel%, перезапуск через 5 секунд...
timeout /t 5 /nobreak >nul
goto loop
