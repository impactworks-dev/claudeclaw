#!/usr/bin/env node
import fs from 'node:fs';
import crypto from 'node:crypto';

const CREDS_PATH = process.env.VENDASTA_CREDENTIALS || 'secrets/vendasta-nikki-service-account.json';
const PARTNER_ID = process.env.VENDASTA_NAMESPACE || '0BYD';
const BASE = 'https://sales-opportunities-prod.apigateway.co/salesopportunities.v1.SalesOpportunities';

const _tokens = new Map();
async function getToken(scope = 'sales.opportunity') {
  const now = Math.floor(Date.now() / 1000);
  const cached = _tokens.get(scope);
  if (cached && cached.exp - 60 > now) return cached.access_token;
  const c = JSON.parse(fs.readFileSync(CREDS_PATH, 'utf-8'));
  const ap = c.assertionPayloadData || {};
  const ah = c.assertionHeaderData || {};
  const aud = ap.aud || 'https://iam-prod.apigateway.co';
  const b64url = s => Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const header = { alg: 'RS256', typ: 'JWT', kid: ah.kid || c.private_key_id };
  const payload = { aud, iss: ap.iss || c.client_email, sub: ap.sub || c.client_email, scope, iat: now, exp: now + 600 };
  const si = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(si);
  const sig = b64url(signer.sign(c.private_key));
  const assertion = `${si}.${sig}`;
  const res = await fetch(c.token_uri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Token failed (${res.status}): ${text.slice(0, 300)}`);
  const json = JSON.parse(text);
  _tokens.set(scope, { access_token: json.access_token, exp: now + (json.expires_in || 3600) });
  return json.access_token;
}

async function grpc(method, body, scope = 'sales.opportunity') {
  const token = await getToken(scope);
  const res = await fetch(`${BASE}/${method}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Connect-Protocol-Version': '1',
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text };
}

// List
const listed = await grpc('ListOpportunities', { partnerId: PARTNER_ID });
const data = JSON.parse(listed.body);
const opps = data.results || [];
const openOpps = opps.filter(o => o.pipelineStage === 'open');
console.log(`Total: ${opps.length} | Open: ${openOpps.length}`);
console.log('Open ones:', openOpps.map(o => `${o.opportunityId} | ${o.name}`).join('\n'));

// Try CloseOpportunity method (close as lost)
const testId = openOpps[0]?.opportunityId;
if (testId) {
  console.log('\nTrying CloseOpportunity on:', testId);
  const methods = ['CloseOpportunity', 'LoseOpportunity', 'CloseAsLost'];
  for (const m of methods) {
    const r = await grpc(m, { opportunityId: testId });
    console.log(`${m}: ${r.status} | ${r.body.substring(0, 150)}`);
  }

  // Try UpdateOpportunity to set pipelineStage=closed-lost
  console.log('\nTrying UpdateOpportunity:');
  const ur = await grpc('UpdateOpportunity', {
    opportunityId: testId,
    pipelineStage: 'closed-lost',
    closedLostReason: { value: 'OTHER' }
  });
  console.log(`UpdateOpportunity: ${ur.status} | ${ur.body.substring(0, 300)}`);
}
