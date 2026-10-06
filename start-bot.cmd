@echo off
chcp 65001 >nul
cd /d "%~dp0"
title assistant-bot
echo Запускаю бота... (закрыть окно = остановить бота)
npm start
pause
