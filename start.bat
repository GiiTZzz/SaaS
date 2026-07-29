@echo off
setlocal
title Dispecr

rem Prepne se do adresare, kde lezi tento soubor, at je jedno odkud ho spustite.
cd /d "%~dp0"

echo ============================================
echo   Dispecr - AI dispecer pro remeslniky
echo ============================================
echo.

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

set NODEMAJOR=
for /f "tokens=1 delims=." %%v in ('node -p process.versions.node') do set NODEMAJOR=%%v
if not defined NODEMAJOR (
    echo [CHYBA] Nepodarilo se zjistit verzi Node.js.
    pause
    exit /b 1
)
if %NODEMAJOR% LSS 22 (
    echo [CHYBA] Potrebujete Node 22.5 nebo novejsi. Nainstalovanou mate:
    node -v
    echo.
    echo Aktualizujte Node z https://nodejs.org/ a spustte tento soubor znovu.
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo Instaluji zavislosti. Poprve to trva par minut, pak uz ne.
    echo.
    call npm install
    if errorlevel 1 (
        echo.
        echo [CHYBA] Instalace zavislosti selhala. Zkontrolujte pripojeni k internetu.
        pause
        exit /b 1
    )
    echo.
)

if not exist "data\dispecr.db" (
    echo Zakladam databazi a demo firmu...
    call npm run seed
    echo.
)

echo Spoustim server v samostatnem okne...
start "Dispecr - server" cmd /k npm run dev

echo Cekam, nez server nabehne...
timeout /t 12 /nobreak >nul

start "" http://localhost:3000

echo.
echo ============================================
echo   Hotovo.
echo ============================================
echo.
echo   Prijem poptavek:  http://localhost:3000
echo   Dispecink:        http://localhost:3000/dispatch
echo.
echo   Server bezi v druhem okne. Zavrenim toho okna ho vypnete.
echo.
echo   Zkuste do chatu napsat treba:
echo     Unika mi voda z kotle a tece to na podlahu
echo.
pause
