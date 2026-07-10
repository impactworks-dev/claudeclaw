#!/bin/bash
set -a; . ~/claudeclaw/.env; set +a
cd ~/claudeclaw
/usr/local/bin/node connectors/vendasta/server.mjs --call vendasta_revenue_by_account '{}' 2>&1 > /tmp/vendasta-rollup.json
/usr/local/bin/node -e '
const d = JSON.parse(require("fs").readFileSync("/tmp/vendasta-rollup.json","utf-8"));
const t = d.totals;
const fmt = c => "$" + (c/100).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
const margin = t.retailMRR - t.wholesaleMonthly;
const marginPct = t.retailMRR ? (margin / t.retailMRR * 100).toFixed(1) : "0.0";
console.log("");
console.log("UMBRELLA ROLLUP (partner 0BYD)");
console.log("  Retail MRR (you charge customers):  " + fmt(t.retailMRR) + "/mo");
console.log("  Wholesale 31-day (Vendasta charges): " + fmt(t.wholesaleMonthly));
console.log("  Gross margin/mo:                     " + fmt(margin));
console.log("  Margin %:                            " + marginPct + "%");
console.log("  Accounts contributing:               " + t.accounts);
console.log("");
// Top contributors
const arr = Object.entries(d.byAccount)
  .map(([id, v]) => ({id, ...v, margin: v.retailMRR - v.wholesaleMonthly}))
  .sort((a,b) => b.retailMRR - a.retailMRR);
console.log("TOP 10 ACCOUNTS BY RETAIL MRR");
for (const a of arr.slice(0,10)) {
  console.log(`  ${(a.name||a.id).slice(0,40).padEnd(40)} retail ${fmt(a.retailMRR).padStart(12)} | whlse ${fmt(a.wholesaleMonthly).padStart(11)} | margin ${fmt(a.margin).padStart(11)}`);
}
'
