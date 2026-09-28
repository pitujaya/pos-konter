@echo off
REM server.bat - POS Konter pitujaya.my.id
REM Otomatis: backend :8000 + named tunnel (kalau sudah login) / quick tunnel (kalau belum)
REM PENTING: hanya 1 proses tunnel boleh jalan. Matikan sisa proses ganda dulu.
taskkill /F /IM cloudflared.exe >nul 2>&1
timeout /t 2 >nul
cd /d H:\POS KONTER\backend
start "POS-Backend" cmd /k python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
timeout /t 6 >nul
if exist "%USERPROFILE%\.cloudflared\cert.pem" (
  echo Login OK - named tunnel pos-konter: pos.pitujaya.my.id + api.pitujaya.my.id
  "C:\Program Files (x86)\cloudflared\cloudflared.exe" tunnel run pos-konter
) else (
  echo Belum login - quick tunnel sementara ...
  echo Buka URL trycloudflare.com yang muncul di bawah.
  echo Untuk permanen pos.pitujaya.my.id: jalankan tunnel login dulu, lalu setup-named-tunnel.bat pitujaya.my.id
  "C:\Program Files (x86)\cloudflared\cloudflared.exe" tunnel --url http://localhost:8000 --no-autoupdate
)
pause

