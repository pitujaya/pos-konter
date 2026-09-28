@echo off
REM Sinkron ulang www -> assets biar mirror SELALU sama persis dengan web
copy /Y "..\index.html" "app\src\main\assets\www\index.html"
copy /Y "..\style.css" "app\src\main\assets\www\style.css"
copy /Y "..\script.js" "app\src\main\assets\www\script.js"
copy /Y "..\api.js" "app\src\main\assets\www\api.js"
copy /Y "..\icon.png" "app\src\main\assets\www\icon.png"
copy /Y "..\icon-192.png" "app\src\main\assets\www\icon-192.png"
copy /Y "..\apple-touch-icon.png" "app\src\main\assets\www\apple-touch-icon.png"
echo Sinkron selesai - mirror sama persis.
pause
