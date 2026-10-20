@echo off
title VITA - Forgotten Sector (PC Standalone Edition)

:: Pastikan selalu bekerja di dalam direktori proyek game
if exist "%~dp0tools\serve.mjs" (
    cd /d "%~dp0"
) else if exist "c:\Users\user\Desktop\pengenal web\vita\tools\serve.mjs" (
    cd /d "c:\Users\user\Desktop\pengenal web\vita"
)

echo ============================================================
echo      VITA - Forgotten Sector (PC Standalone Edition)
echo ============================================================
echo.
echo [*] Memeriksa server lokal VITA (port 8000)...

:: Cek apakah server lokal di port 8000 sudah aktif
powershell -NoProfile -Command "(Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue)" >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [*] Memulai server lokal di latar belakang...
    start /B "" node tools/serve.mjs >nul 2>&1
    powershell -NoProfile -Command "Start-Sleep -Milliseconds 1000"
) else (
    echo [*] Server lokal sudah aktif.
)

echo [*] Meluncurkan jendela game mandiri (Standalone App Window)...

:: Luncurkan jendela mandiri tanpa address bar / tabs via Edge atau Chrome
if exist "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" (
    start "" "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --app="http://localhost:8000/?autolaunch=1" --window-size=1280,800
) else if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" (
    start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --app="http://localhost:8000/?autolaunch=1" --window-size=1280,800
) else (
    start "" "http://localhost:8000/?autolaunch=1"
)

echo.
echo [V] Game berhasil dibuka! Selamat berpetualang di Sektor Terlupakan.
timeout /t 3 >nul
exit
