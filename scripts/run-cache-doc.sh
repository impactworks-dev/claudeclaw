#!/bin/bash
cd "$HOME/claudeclaw"
set -a
. .env
set +a
/usr/local/bin/node scripts/margin-doc-from-cache.mjs 2>&1
