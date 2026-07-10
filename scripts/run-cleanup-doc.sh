#!/bin/bash
cd "$HOME/claudeclaw"
set -a; . .env; set +a
/usr/local/bin/node scripts/qbo-cleanup-doc.mjs 2>&1
