#!/bin/bash
# obsidian-to-fly.sh
# Extracts Obsidian vault memories and pipes them into the Fly DB.
# Run from project root: bash scripts/obsidian-to-fly.sh

set -e
PROJECT_ROOT="$(git rev-parse --show-toplevel)"
cd "$PROJECT_ROOT"

echo "Extracting Obsidian vault memories and syncing to Fly..."
node dist/obsidian-ingest.js --output-json | \
  fly ssh console -a claudeclaw-impactworks -C "node /app/dist/obsidian-import.js"

echo "Done."
