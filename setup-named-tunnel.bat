@echo off
setlocal
set CF="C:\Program Files (x86)\cloudflared\cloudflared.exe"
set DOMAIN=%1
if "%DOMAIN%"=="" (
  echo Pakai: setup-named-tunnel.bat pitujaya.my.id
  pause
  exit /b 1
)
set TUNNEL_NAME=pos-konter
echo [1/4] Membuat tunnel %TUNNEL_NAME% ...
%CF% tunnel create %TUNNEL_NAME%
if errorlevel 1 (
  echo GAGAL create. Belum login? Jalankan: tunnel login
  pause
  exit /b 1
)
echo [2/4] Route DNS ...
%CF% tunnel route dns %TUNNEL_NAME% pos.%DOMAIN%
%CF% tunnel route dns %TUNNEL_NAME% api.%DOMAIN%
echo [3/4] Membuat config.yml ...
set TUNNEL_JSON=
for %%F in ("%USERPROFILE%\.cloudflared\*.json") do set TUNNEL_JSON=%%F
if "%TUNNEL_JSON%"=="" (
  echo File json tunnel tidak ketemu di %USERPROFILE%\.cloudflared\
  pause
  exit /b 1
)
(
echo protocol: http2
echo tunnel: %TUNNEL_NAME%
echo credentials-file: %TUNNEL_JSON%
echo ingress:
echo   - hostname: pos.%DOMAIN%
echo     service: http://localhost:8000
echo   - hostname: api.%DOMAIN%
echo     service: http://localhost:8000
echo   - service: http_status:404
) > "%USERPROFILE%\.cloudflared\config.yml"
echo [4/4] Selesai. Isi config.yml:
type "%USERPROFILE%\.cloudflared\config.yml"
echo.
echo Jalankan: jalankan-pos.bat
pause

