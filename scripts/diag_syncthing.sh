#!/bin/bash
# Diagnose Syncthing state on Fly: folders, devices, file counts, pending changes.
set +e

CFG=/app/store/syncthing-config/config.xml
echo "=== Folders configured ==="
grep -E 'folder id|path=' "$CFG" 2>/dev/null | head -30

echo ""
echo "=== Devices configured ==="
grep -E 'device id|<name>' "$CFG" 2>/dev/null | head -30

echo ""
echo "=== File counts in obsidian-brain folder ==="
echo "Total files: $(find /app/store/obsidian-brain -type f 2>/dev/null | wc -l)"
echo "Markdown:    $(find /app/store/obsidian-brain -type f -name '*.md' 2>/dev/null | wc -l)"
echo "Top-level dirs:"
ls -la /app/store/obsidian-brain/ 2>/dev/null | head -25

echo ""
echo "=== Syncthing process state ==="
ps aux | grep -i syncthing | grep -v grep | head -3

echo ""
echo "=== Recent syncthing log lines ==="
tail -25 /app/store/logs/syncthing.log 2>/dev/null
