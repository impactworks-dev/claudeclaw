#!/usr/bin/env node
// Build the QuickBooks categorization clean-up plan as a Google Doc.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

const body = `QUICKBOOKS CATEGORIZATION CLEAN-UP PLAN
ImpactWorks (QBO realm 9130353734958806)
Generated: ${today}

=========================================
1. DIAGNOSIS — what we found
=========================================

YTD P&L (Jan 1 – Jun 8, 2026):
  Total Income:    $90.33  (all booked as "Commission" / Other Income)
  Total Expenses:  $1,696.33
  Net:             -$1,606.00

A/R Aging:  $0 (no open invoices)
Customers in QBO:  1 (University of North Carolina Wilmington, $0 sales)
Sales by customer YTD:  $0

What's actually happening in your business (from Vendasta):
  Customer retail MRR:   $3,308.46 / month  ($16,542 YTD)
  Vendasta wholesale:    $1,336.25 / month  ($6,681 YTD)
  Real gross margin:     $1,972.21 / month  ($9,861 YTD)

The gap:
  - QBO shows $90 in income; real customer-attributable margin is ~$9,861.
  - Roughly 99% of your business activity is not in QuickBooks.
  - Since Vendasta handles invoicing, the books-of-record need to capture
    your Vendasta settlement deposits (net payouts) instead of duplicate
    invoices to end customers.

=========================================
2. CATEGORIZATIONS YOU HAVE TODAY
=========================================

✓ LOOKS GOOD
  Travel ........................... $818.24 (48% of expenses)
    Reasonable spend pattern, no issues.
  Phone service .................... $403.31 (24%)
    ~$80/month, fine.
  QuickBooks Payments Fees ......... $34.50
    Auto-categorized correctly by QBO.
  Commission (Other Income) ........ $90.33
    Booked correctly. Just way under-volume.

⚠ NEEDS ATTENTION
  Memberships & subscriptions ...... $415.28 (24%)
    Likely mixing professional memberships with SaaS tools.
    Recommendation: split into two accounts (see Section 4).
  Software & apps .................. $25.00 (1%)
    Drastically under-reported. For an AI services agency you'd expect
    $300–600/month minimum (OpenAI, Anthropic, Vercel, GitHub, Cloudflare,
    ElevenLabs, Notion, etc.). Either:
     a) Those subscriptions are not booked anywhere, OR
     b) They're being mis-bucketed into "Memberships & subscriptions"

✗ MISSING ENTIRELY
  Income: Services ................. $0
    No customer revenue is hitting income accounts.
  Income: Vendasta Settlements ..... (doesn't exist)
    The net payouts you receive from Vendasta need their own income line.
  COGS: Vendasta Wholesale ......... (doesn't exist)
    Your $1,336/mo cost of resold services has no home.
  Professional Services / Contractors  (doesn't exist)
    If you ever pay subs, no place to book them.
  Bank fees / Merchant fees ........ (only QB Payments fees exists)
    Stripe, PayPal, wire fees, etc. should land here too.

=========================================
3. RECOMMENDED CHART-OF-ACCOUNTS CHANGES
=========================================

Add these accounts (suggested QBO Account Type in parentheses):

INCOME
  Income: Services
     Account Type: Income
     Detail Type: Service/Fee Income
     Use for: Any direct-to-client invoices you push through QBO.

  Income: Vendasta Settlements
     Account Type: Income
     Detail Type: Sales of Product Income
     Use for: Net monthly payouts from Vendasta.

  Income: Project / One-time Fees
     Account Type: Income
     Detail Type: Service/Fee Income
     Use for: Setup fees, audits, one-shot consulting.

COST OF GOODS SOLD (Cost of Revenue)
  COGS: Vendasta Wholesale
     Account Type: Cost of Goods Sold
     Detail Type: Supplies & Materials – COGS
     Use for: Monthly Vendasta wholesale charge ($1,336/mo currently).

  COGS: AI / API Costs (OpenAI, Anthropic, ElevenLabs)
     Account Type: Cost of Goods Sold
     Detail Type: Other Costs of Service – COGS
     Use for: API charges directly tied to delivering customer work.

  COGS: Third-party Fulfillment
     Account Type: Cost of Goods Sold
     Detail Type: Other Costs of Service – COGS
     Use for: Any contractor or fulfillment vendor delivering customer work.

OPERATING EXPENSES (rename / split)
  Software & SaaS Subscriptions
     Account Type: Expenses
     Detail Type: Office/General Administrative Expenses
     Renamed from "Software & apps" – this is your default for any
     SaaS tool used to RUN the business (Notion, GitHub, Slack, etc.)
     The distinction vs COGS: AI/API is whether it's delivery vs ops.

  Professional Memberships & Dues
     Account Type: Expenses
     Detail Type: Office/General Administrative Expenses
     Renamed from "Memberships & subscriptions" – use for professional
     organizations, chamber memberships, networking groups. NOT SaaS.

  Bank & Merchant Fees
     Account Type: Expenses
     Detail Type: Bank Charges
     Consolidates QuickBooks Payments Fees + Stripe + PayPal + wire fees.

  Contractors
     Account Type: Expenses
     Detail Type: Payroll Expenses
     (1099 contractors – DIFFERENT from COGS: Third-party Fulfillment)
     Use for: Bookkeeper, marketing freelancer, VA, etc.

  Insurance: Business
     Account Type: Expenses
     Detail Type: Insurance

  Legal & Accounting
     Account Type: Expenses
     Detail Type: Legal & Professional Fees

=========================================
4. VENDASTA-SPECIFIC BOOKKEEPING PLAYBOOK
=========================================

The cleanest pattern for your model (Vendasta as biller of record):

OPTION A — SIMPLE (single journal entry per settlement)
  When Vendasta deposits your monthly net into the bank:
    DR  Bank Account ............ $X (the deposit amount)
    CR  Income: Vendasta Settlements ... $X
  Then book the wholesale separately if Vendasta charges it as a
  separate transaction (probably via your card on file):
    DR  COGS: Vendasta Wholesale ..... $1,336.25
    CR  Bank Account / Credit Card ... $1,336.25

OPTION B — GROSS (shows full retail revenue)
  Two entries each month:
    1. Book retail revenue:
       DR  A/R ........................ $3,308.46
       CR  Income: Vendasta Settlements ... $3,308.46
    2. Book Vendasta net payout + their wholesale fee:
       DR  Bank Account ............... $1,972.21 (your margin)
       DR  COGS: Vendasta Wholesale ... $1,336.25
       CR  A/R ........................ $3,308.46

  Option B gives you proper gross profit %; Option A is faster but
  reports a smaller revenue number to the IRS / lenders.

RECOMMENDATION: Option B. Worth the extra 5 minutes per month for the
visibility into top-line revenue and gross margin.

=========================================
5. PRIORITY FIX LIST
=========================================

Do this week:
  [ ] Create the 4 missing income accounts (Section 3).
  [ ] Create the 3 missing COGS accounts.
  [ ] Decide Option A vs Option B for Vendasta bookkeeping.
  [ ] Find every Vendasta deposit since Jan 1, 2026 and categorize them.

Do this month:
  [ ] Reclassify Memberships & subscriptions transactions: SaaS → new
      "Software & SaaS Subscriptions" account; actual memberships stay.
  [ ] Audit "Software & apps" — find what's missing (OpenAI, Anthropic,
      Vercel, GitHub, Cloudflare, ElevenLabs, etc.) and locate those
      charges in your bank/card feeds.
  [ ] Set up bank rules in QBO so future Vendasta, OpenAI, Anthropic,
      Vercel, etc. auto-categorize.

Do this quarter:
  [ ] Reconcile YTD Vendasta gross margin from this doc against booked
      QBO numbers. Difference should be zero or close.
  [ ] Add the second QBO realm if RocketLocal has separate books.

=========================================
6. WHAT THIS UNLOCKS
=========================================

Once Vendasta revenue + wholesale are properly booked:
  - Your real P&L appears in QBO instead of the empty shell it is now.
  - Your Mission Control "Real MRR" tile and QBO Net Income tile will
    finally reconcile (today they're showing different worlds).
  - Lenders, partners, and an eventual acquirer can read your books.
  - Tax prep is dramatically easier (Schedule C / 1120-S line items
    actually populate).
  - You'll see margin compression or expansion month-over-month as it
    happens, instead of finding out at year-end.

=========================================
HEADLINE
=========================================

You don't have a categorization problem.
You have a "nothing's being categorized" problem.

The 5 categories in use today are mostly correct for what they
contain. The real fix is structural: add the income + COGS accounts
that match how your business actually generates and pays out money,
then move every Vendasta deposit and wholesale charge YTD into those
accounts. That's the unlock.
`;

console.log('Doc body: ' + body.length + ' bytes');
const name = 'QuickBooks Categorization Clean-Up Plan – ' + new Date().toISOString().slice(0, 10);
const { stdout: out } = await exec('/usr/local/bin/node', [
  path.join(ROOT, 'dist', 'gdrive-cli.js'),
  'create-doc',
  '--name', name,
  '--content', body,
], { maxBuffer: 5 * 1024 * 1024 });
console.log(out);
