#!/usr/bin/env pwsh
# ─────────────────────────────────────────
#  push.ps1  —  Git push + Vercel prod deploy
# ─────────────────────────────────────────

$msg = if ($args[0]) { $args[0] } else { "UI improvements and style updates" }

Write-Host "`n📦 Staging all changes..." -ForegroundColor Cyan
git add -A

Write-Host "💬 Committing: $msg" -ForegroundColor Cyan
git commit -m $msg

Write-Host "🚀 Pushing to GitHub..." -ForegroundColor Cyan
git push

Write-Host "`n⚡ Deploying to Vercel (production)..." -ForegroundColor Yellow
vercel --prod

Write-Host "`n✅ Done! Pushed to GitHub + deployed to Vercel prod.`n" -ForegroundColor Green
