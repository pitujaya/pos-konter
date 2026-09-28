@echo off
REM Nyalakan backend + named tunnel permanen
REM PENTING: hanya 1 proses tunnel boleh jalan. Matikan sisa proses ganda dulu.
taskkill /F /IM cloudflared.exe >nul 2>&1
timeout /t 2 >nul
if not exist "%USERPROFILE%\.cloudflared\cert.pem" (
  echo BELUM LOGIN. Jalankan dulu:
  echo   "C:\Program Files (x86)\cloudflared\cloudflared.exe" tunnel login
  echo Lalu: setup-named-tunnel.bat pitujaya.my.id
  pause
  exit /b 1
)
start "POS-Backend" cmd /k "cd /d H:\POS KONTER\backend && python -m uvicorn app.main:app --port 8000"
timeout /t 6 >nul
"C:\Program Files (x86)\cloudflared\cloudflared.exe" tunnel run pos-konter
pause

