#!/bin/bash
echo "=== Claude Projects subfolders ==="
for d in /Users/dantecrescenzi/Documents/Claude/Projects/*/; do
  name=$(basename "$d")
  md=$(find "$d" -type f -name '*.md' 2>/dev/null | wc -l | tr -d ' ')
  total=$(find "$d" -type f 2>/dev/null | wc -l | tr -d ' ')
  echo "  $name: $md markdown / $total total files"
done

echo ""
echo "=== All .md files under Documents/Claude (first 20) ==="
find /Users/dantecrescenzi/Documents/Claude -type f -name '*.md' 2>/dev/null | head -20
echo "Total: $(find /Users/dantecrescenzi/Documents/Claude -type f -name '*.md' 2>/dev/null | wc -l | tr -d ' ')"

echo ""
echo "=== Apple Notes count (via SQLite) ==="
NOTES_DB="/Users/dantecrescenzi/Library/Group Containers/group.com.apple.notes/NoteStore.sqlite"
if [ -f "$NOTES_DB" ]; then
  sqlite3 "$NOTES_DB" "SELECT COUNT(*) AS notes FROM ZICCLOUDSYNCINGOBJECT WHERE ZNOTEDATA IS NOT NULL;" 2>&1 | head -1
else
  echo "Notes DB not at expected path"
fi
