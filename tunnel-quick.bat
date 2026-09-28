@echo off
REM Quick Tunnel - tanpa login, URL random. Backend harus jalan di :8000
cd /d H:\POS KONTER\backend
start "POS-Backend-8000" cmd /k python -m uvicorn app.main:app --port 8000
timeout /t 6 >nul
"C:\Program Files (x86)\cloudflared\cloudflared.exe" tunnel --url http://localhost:8000 --no-autoupdate
pause

