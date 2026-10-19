# AI Model + Locally Uncensored Studio - PowerShell Launcher
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition

Write-Host "=======================================================" -ForegroundColor Cyan
Write-Host " Starting AI Model + Locally Uncensored Studio" -ForegroundColor Cyan
Write-Host "=======================================================" -ForegroundColor Cyan

Write-Host "`n[1/2] Launching API Server on http://127.0.0.1:5000 ..." -ForegroundColor Green
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$ScriptDir'; pnpm --filter @workspace/api-server run dev"

Start-Sleep -Seconds 2

Write-Host "[2/2] Launching Finch + Locally Uncensored UI on http://127.0.0.1:5173 ..." -ForegroundColor Green
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$ScriptDir'; pnpm --filter @workspace/finch-local-chat run dev:local"

Write-Host "`n=======================================================" -ForegroundColor Cyan
Write-Host " Services started in dedicated terminal windows!" -ForegroundColor Cyan
Write-Host " Open your browser to: http://127.0.0.1:5173" -ForegroundColor Yellow
Write-Host "=======================================================`n" -ForegroundColor Cyan
