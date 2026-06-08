// JXA: single-handle contact lookup. Returns plain text name or empty string.
// Usage: osascript -l JavaScript lookup-contact.js '+15551234567'

function run(argv) {
  if (!argv || argv.length === 0) return '';
  const query = String(argv[0]).trim();
  if (!query) return '';

  const isEmail = query.includes('@');
  // Strip everything but digits/+ for phone normalization
  const norm = query.replace(/[^\d+]/g, '');
  // Also try without leading +
  const noPlus = norm.startsWith('+') ? norm.slice(1) : norm;

  const Contacts = Application('Contacts');
  const people = Contacts.people();

  for (let i = 0; i < people.length; i++) {
    const p = people[i];
    try {
      if (isEmail) {
        const emails = p.emails();
        for (let j = 0; j < emails.length; j++) {
          let v = '';
          try { v = (emails[j].value() || '').toLowerCase(); } catch (e) {}
          if (v === query.toLowerCase()) {
            return formatName(p);
          }
        }
      } else if (norm) {
        const phones = p.phones();
        for (let j = 0; j < phones.length; j++) {
          let raw = '';
          try { raw = phones[j].value() || ''; } catch (e) {}
          const phoneNorm = String(raw).replace(/[^\d+]/g, '');
          const phoneNoPlus = phoneNorm.startsWith('+') ? phoneNorm.slice(1) : phoneNorm;
          if (phoneNorm === norm || phoneNoPlus === noPlus ||
              phoneNorm.endsWith(noPlus) || norm.endsWith(phoneNoPlus.slice(-10))) {
            return formatName(p);
          }
        }
      }
    } catch (e) {}
  }
  return '';
}

function formatName(p) {
  let first = ''; let last = ''; let org = '';
  try { first = p.firstName() || ''; } catch (e) {}
  try { last = p.lastName() || ''; } catch (e) {}
  try { org = p.organization() || ''; } catch (e) {}
  if (first && last) return first + ' ' + last;
  if (first) return first;
  if (last) return last;
  if (org) return org;
  return '';
}
