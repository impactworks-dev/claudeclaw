#!/bin/bash
# Register the monthly Vendasta Settlement Slip scheduled task.
set -e
cd "$HOME/claudeclaw"
PROMPT='It is the 5th of the month. Run the Vendasta Settlement Slip generator to produce last months journal entry.

Execute: cd /app && /usr/local/bin/node scripts/settlement-slip.mjs

Then send me a Telegram message with the following:
1. The "VENDASTA SETTLEMENT SLIP" section from the output
2. The brand split + journal entry numbers
3. The Drive doc link (the line starting with Doc:)
4. End with: "Reply post slip <slip-id> to record this in QBO."

Use the notify script for clean Telegram output. The slip is already saved to store/pending-slips.json — you do not need to save it again.'

CRON='0 14 5 * *'   # 5th of month, 14:00 UTC ≈ 9am EST (10am EDT)

/usr/local/bin/node "$HOME/claudeclaw/dist/schedule-cli.js" create "$PROMPT" "$CRON"
