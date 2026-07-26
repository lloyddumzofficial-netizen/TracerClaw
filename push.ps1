#!/usr/bin/env pwsh
# -----------------------------------------
#  push.ps1  --  Git push to GitHub
# -----------------------------------------

$msg = if ($args[0]) { $args[0] } else { "UI improvements and style updates" }

Write-Host "`nStaging all changes..." -ForegroundColor Cyan
git add -A

Write-Host "Committing: $msg" -ForegroundColor Cyan
git commit -m $msg

if ($LASTEXITCODE -ne 0) {
    Write-Host "Nothing new to commit." -ForegroundColor Yellow
}

Write-Host "Pushing to GitHub..." -ForegroundColor Cyan
git push

Write-Host "`nDone! Pushed to GitHub.`n" -ForegroundColor Green
