#!/bin/bash
echo "--- /app/store top level ---"
ls -la /app/store/ | head -40
echo ""
echo "--- syncthing config (key folders) ---"
grep -oE 'path="[^"]+"' /app/store/syncthing-config/config.xml 2>/dev/null | head -10 || echo "no syncthing config"
echo ""
echo "--- md files anywhere in /app/store (top 10) ---"
find /app/store -type f -name '*.md' 2>/dev/null | head -10
