@echo off
title KnightCat Endless Run
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0sunucu.ps1"
