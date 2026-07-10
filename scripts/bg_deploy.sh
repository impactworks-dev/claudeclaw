#!/bin/bash
# Kick off fly deploy in background and exit immediately so osascript
# doesn't time out. Logs go to /tmp/fly-deploy.log.
cd /Users/dantecrescenzi/claudeclaw
nohup /opt/homebrew/bin/flyctl deploy --remote-only --strategy immediate \
  > /tmp/fly-deploy.log 2>&1 < /dev/null &
disown
echo "deploy started PID=$!"
