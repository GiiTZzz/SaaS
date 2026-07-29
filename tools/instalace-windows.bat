@echo off
setlocal
title Dispecr - instalace

rem Stahne projekt do slozky uzivatele a rovnou ho spusti.
rem Tento soubor lze spustit odkudkoli - treba primo ze slozky Stazene soubory.

set "REPO=https://github.com/GiiTZzz/SaaS.git"
set "BRANCH=claude/agentic-ai-opportunities-2026-kmhshj"
set "TARGET=%USERPROFILE%\Dispecr"

echo ============================================
echo   Dispecr - instalace
echo ============================================
echo.
echo Projekt se nainstaluje do:
echo   %TARGET%
echo.

where git >nul 2>nul
if errorlevel 1 (
    echo [CHYBA] Git neni nainstalovan.
    echo.
    echo Stahnete si ho z https://git-scm.com/download/win
    echo Po instalaci spustte tento soubor znovu.
    echo.
    pause
    exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
    echo [CHYBA] Node.js neni nainstalovan.
    echo.
    echo Stahnete si ho z https://nodejs.org/ - staci varianta LTS.
    echo Po instalaci spustte tento soubor znovu.
    echo.
    pause
    exit /b 1
)

if exist "%TARGET%\.git" (
    echo Projekt uz existuje, aktualizuji ho...
    cd /d "%TARGET%"
    git fetch origin
    git checkout "%BRANCH%"
    git pull --ff-only origin "%BRANCH%"
) else (
    echo Stahuji projekt z GitHubu...
    git clone -b "%BRANCH%" "%REPO%" "%TARGET%"
    if errorlevel 1 (
        echo.
        echo [CHYBA] Stazeni projektu selhalo.
        pause
        exit /b 1
    )
    cd /d "%TARGET%"
)

echo.
echo Predavam spousteci skript...
echo.
call "%TARGET%\start.bat"
