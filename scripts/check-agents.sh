#!/bin/bash
echo "=== Node processes running ==="
ps -ef 2>/dev/null | grep "dist/index.js" | grep -v grep || \
  for f in /proc/[0-9]*/cmdline; do
    cmd=$(cat "$f" 2>/dev/null | tr '\0' ' ')
    case "$cmd" in
      *dist/index.js*) echo "$f: $cmd" ;;
    esac
  done

echo ""
echo "=== Memory usage ==="
free -h 2>/dev/null || cat /proc/meminfo | head -3

echo ""
echo "=== Sub-agent log tails ==="
for A in comms content ops research; do
  echo "--- agent-$A.log ---"
  tail -n 3 "/app/store/logs/agent-$A.log" 2>/dev/null || echo "(no log)"
done
