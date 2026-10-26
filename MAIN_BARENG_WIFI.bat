@echo off
chcp 65001 >nul
title VITA - PUSAT KONEKSI CO-OP WI-FI (LAN HOST)
color 0b
cls

echo ===================================================================
echo           VITA: FORGOTTEN SECTOR - LAN CO-OP LAUNCHER
echo ===================================================================
echo  Mencari alamat IP Wi-Fi komputer Anda...

:: Ambil IPv4 lokal komputer
for /f "tokens=*" %%a in ('powershell -NoProfile -Command "(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -notlike '*Loopback*' -and $_.IPAddress -notlike '169.254*' -and $_.IPAddress -notlike '172.*' -and $_.IPAddress -notlike '10.*' } | Select-Object -First 1).IPAddress"') do set LOCAL_IP=%%a

if "%LOCAL_IP%"=="" (
    for /f "tokens=*" %%a in ('powershell -NoProfile -Command "(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -notlike '*Loopback*' -and $_.IPAddress -notlike '169.254*' } | Select-Object -First 1).IPAddress"') do set LOCAL_IP=%%a
)

if "%LOCAL_IP%"=="" set LOCAL_IP=127.0.0.1

echo.
echo  [OK] IP Wi-Fi Anda terdeteksi : %LOCAL_IP%
echo.
echo ===================================================================
echo                    SERVER ONLINE AKTIF!
echo ===================================================================
echo.
echo  1. Game di laptop ini akan otomatis terbuka di browser.
echo.
echo  2. AGAR TEMAN BISA GABUNG DARI HP / LAPTOP LAIN:
echo     Pastikan terhubung ke Wi-Fi / Hotspot yang sama.
echo     Lalu minta teman buka link ini di browser HP:
echo.
echo     👉👉  http://%LOCAL_IP%:8000  👈👈
echo.
echo ===================================================================
echo  CARA MAIN BARENG (ALA MINECRAFT):
echo  - Di laptop Anda : Klik [ OPERASI CO-OP ] ^> [ BUAT RUANG ]
echo                     (akan muncul 4 huruf kode, contoh: 8X7K)
echo.
echo  - Di HP Teman    : Buka link di atas ^> Klik [ OPERASI CO-OP ]
echo                     ^> [ GABUNG RUANG ] ^> Masukkan 4 huruf kode.
echo.
echo  - SELESAI! Teman akan langsung muncul di lobi dan bisa main bareng!
echo ===================================================================
echo  PERHATIAN: Jendela hitam ini JANGAN DITUTUP selama sedang bermain!
echo ===================================================================
echo.

:: Buka browser di laptop
start http://localhost:8000

:: Jalankan server game dan relay WebSocket
start /b "" node tools/relay.mjs
node tools/serve.mjs
