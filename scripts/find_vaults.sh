#!/bin/bash
echo "=== .obsidian directories (each = a vault root) ==="
find /Users/dantecrescenzi -maxdepth 6 -type d -name '.obsidian' 2>/dev/null
echo ""
echo "=== Folders with > 20 markdown files (max depth 4) ==="
for dir in $(find /Users/dantecrescenzi -maxdepth 4 -type d 2>/dev/null); do
  count=$(find "$dir" -maxdepth 2 -type f -name '*.md' 2>/dev/null | wc -l | tr -d ' ')
  if [ "$count" -gt 20 ]; then
    echo "  $count notes in: $dir"
  fi
done
