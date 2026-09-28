@echo off
REM Named Tunnel pos-konter - butuh login + config sekali saja
REM PENTING: hanya 1 proses tunnel boleh jalan. 2 proses = error "already connected to this server".
taskkill /F /IM cloudflared.exe >nul 2>&1
timeout /t 2 >nul
if not exist "%USERPROFILE%\.cloudflared\cert.pem" (
  echo BELUM LOGIN. Jalankan dulu:
  echo   "C:\Program Files (x86)\cloudflared\cloudflared.exe" tunnel login
  pause
  exit /b 1
)
if not exist "%USERPROFILE%\.cloudflared\config.yml" (
  echo config.yml belum ada. Jalankan:
  echo   setup-named-tunnel.bat pitujaya.my.id
  pause
  exit /b 1
)
"C:\Program Files (x86)\cloudflared\cloudflared.exe" tunnel run pos-konter
pause

