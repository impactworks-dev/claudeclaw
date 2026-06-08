#!/bin/bash
# One-shot test fire for tomorrow morning (June 9, 9am EST = 14:00 UTC).
set -e
cd "$HOME/claudeclaw"
PROMPT='Test run of the Vendasta Settlement Slip generator. This is a one-time test, not the monthly job.

Execute: cd /app && /usr/local/bin/node scripts/settlement-slip.mjs

Then send me a Telegram message containing:
1. The full "VENDASTA SETTLEMENT SLIP" section from stdout
2. The Drive doc link if one was created
3. The slip ID
4. End with: "This is a TEST run. Reply post slip <id> to record it in QBO, or ignore to discard."

After sending, delete THIS scheduled task using: /usr/local/bin/node dist/schedule-cli.js delete <this-task-id>. The monthly recurring task (a1f38408) stays in place.'

# Cron that fires only on June 9 at 14:00 UTC.
CRON='0 14 9 6 *'

/usr/local/bin/node "$HOME/claudeclaw/dist/schedule-cli.js" create "$PROMPT" "$CRON"
