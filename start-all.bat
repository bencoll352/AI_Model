@echo off
setlocal

echo =======================================================
echo  Starting AI Model + Locally Uncensored Studio
echo =======================================================

cd /d "%~dp0"

echo [1/2] Launching API Server on http://127.0.0.1:5000 ...
start "AI Model - API Server" cmd /k "pnpm --filter @workspace/api-server run dev"

timeout /t 2 /nobreak >nul

echo [2/2] Launching Finch + Locally Uncensored UI on http://127.0.0.1:5173 ...
start "AI Model - UI" cmd /k "pnpm --filter @workspace/finch-local-chat run dev:local"

echo.
echo =======================================================
echo  Services started in separate background windows!
echo  Open your browser to: http://127.0.0.1:5173
echo =======================================================
echo.
