// JXA script: export Contacts.app entries to ~/claudeclaw/relay/contacts.json
// Run via: osascript -l JavaScript export-contacts.js

ObjC.import('Foundation');

function normalizePhone(s) {
  return String(s || '').replace(/[^\d+]/g, '');
}

const Contacts = Application('Contacts');
const people = Contacts.people();

const out = [];
for (let i = 0; i < people.length; i++) {
  const p = people[i];
  let first = ''; let last = ''; let org = ''; let nick = '';
  try { first = p.firstName() || ''; } catch (e) {}
  try { last = p.lastName() || ''; } catch (e) {}
  try { org = p.organization() || ''; } catch (e) {}
  try { nick = p.nickname() || ''; } catch (e) {}

  let name = '';
  if (first && last) name = first + ' ' + last;
  else if (first) name = first;
  else if (last) name = last;
  else if (org) name = org;
  else if (nick) name = nick;

  if (!name) continue;

  const phones = [];
  try {
    const ps = p.phones();
    for (let j = 0; j < ps.length; j++) {
      let v = '';
      try { v = ps[j].value() || ''; } catch (e) {}
      const n = normalizePhone(v);
      if (n) phones.push(n);
    }
  } catch (e) {}

  const emails = [];
  try {
    const es = p.emails();
    for (let j = 0; j < es.length; j++) {
      let v = '';
      try { v = es[j].value() || ''; } catch (e) {}
      if (v) emails.push(String(v).toLowerCase());
    }
  } catch (e) {}

  if (phones.length === 0 && emails.length === 0) continue;
  out.push({ name, org: org || null, phones, emails });
}

const fm = $.NSFileManager.defaultManager;
const json = JSON.stringify(out, null, 0);
const data = $(json).dataUsingEncoding($.NSUTF8StringEncoding);
const path = $('~/claudeclaw/relay/contacts.json').stringByExpandingTildeInPath.js;
const ok = data.writeToFileAtomically(path, true);

JSON.stringify({ contacts: out.length, written: ok, path });
