#!/usr/bin/env pwsh
# ─────────────────────────────────────────
#  push.ps1  —  Quick Git push to GitHub
# ─────────────────────────────────────────

$msg = if ($args[0]) { $args[0] } else { "UI improvements and style updates" }

Write-Host "`n📦 Staging all changes..." -ForegroundColor Cyan
git add -A

Write-Host "💬 Committing: $msg" -ForegroundColor Cyan
git commit -m $msg

Write-Host "🚀 Pushing to GitHub..." -ForegroundColor Cyan
git push

Write-Host "`n✅ Done! All changes pushed to GitHub.`n" -ForegroundColor Green
