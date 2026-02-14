#!/bin/bash
# Fireclaude installer — sets up the /firecrawl command for Claude Code

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "Installing Fireclaude..."

# Copy command
mkdir -p ~/.claude/commands
cp "$SCRIPT_DIR/commands/firecrawl.md" ~/.claude/commands/firecrawl.md

# Copy scripts
mkdir -p ~/.claude/scripts
cp "$SCRIPT_DIR/scripts/scrape.mjs" ~/.claude/scripts/scrape.mjs
cp "$SCRIPT_DIR/scripts/utils.mjs" ~/.claude/scripts/utils.mjs
cp "$SCRIPT_DIR/scripts/package.json" ~/.claude/scripts/package.json
cp "$SCRIPT_DIR/scripts/example-params.json" ~/.claude/scripts/example-params.json

# Install dependencies
cd ~/.claude/scripts && npm install --silent

# Check for Playwright browsers
if ! npx playwright install --dry-run chromium >/dev/null 2>&1; then
  echo "Installing Playwright Chromium browser..."
  npx playwright install chromium
fi

echo ""
echo "Fireclaude installed successfully!"
echo ""
echo "Usage: /firecrawl <url> [--params=schema.json] [--mobile] [--block-media] ..."
echo "Run /firecrawl --help in Claude Code for all options."
