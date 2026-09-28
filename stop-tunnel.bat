@echo off
REM stop-tunnel.bat - hentikan SEMUA proses cloudflared yang jalan
REM Pakai ini sebelum menjalankan tunnel ulang, atau bila sudah pindah ke server Ubuntu LAN
REM (http://192.168.18.50/) sehingga tunnel Windows tidak diperlukan lagi.
taskkill /F /IM cloudflared.exe >nul 2>&1
timeout /t 2 >nul
tasklist | findstr /I cloudflared >nul 2>&1
if errorlevel 1 (
  echo Tunnel berhenti. Tidak ada proses cloudflared yang jalan.
) else (
  echo MASIH ADA proses cloudflared. Tutup manual via Task Manager.
)
pause
