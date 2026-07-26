#!/usr/bin/env bash
# ─────────────────────────────────────────
#  push.sh  —  Git push to GitHub
# ─────────────────────────────────────────

set -e

MSG="${1:-UI improvements and style updates}"

echo ""
echo "📦 Staging all changes..."
git add -A

echo "💬 Committing: $MSG"
git commit -m "$MSG" || echo "⚠️  Nothing new to commit."

echo "🚀 Pushing to GitHub..."
git push

echo ""
echo "✅ Done! Pushed to GitHub."
echo ""
