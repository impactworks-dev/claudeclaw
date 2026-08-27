#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('memory/operating-memory');

const requiredFiles = [
  'README.md',
  'SOURCE-MANIFEST.md',
  'INGESTION-LOG.md',
  'state.json',
  'VALIDATION-REPORT.md',
  'COMPLETION-AUDIT.md',
  'G-BRAIN-HANDOFF.md',
  'Context Packs/ImpactWorks Rocket Local Agent Brief.md',
  'Procedures/Build Source-Backed Context Pack.md',
  'Procedures/G-Brain Sync Procedure.md',
];

const requiredDirs = [
  'Context Packs',
  'Projects',
  'Companies',
  'People',
  'Decisions',
  'Procedures',
  'Sources',
  '_tools',
];

const credentialPatterns = [
  { name: 'OpenAI key', re: /sk-[A-Za-z0-9_-]{20,}/ },
  { name: 'Generic API key assignment', re: /\b(api[_-]?key|secret|password|private[_-]?key|access[_-]?token)\b\s*[:=]\s*['"]?[A-Za-z0-9_./+=-]{16,}/i },
  { name: 'JWT', re: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  { name: 'AWS access key', re: /AKIA[0-9A-Z]{16}/ },
];

const ignoredDirs = new Set(['.git', 'node_modules']);
const errors = [];
const warnings = [];

function exists(rel) {
  return fs.existsSync(path.join(root, rel));
}

function walk(dir, rel = '') {
  const abs = path.join(dir, rel);
  let entries = [];
  try {
    entries = fs.readdirSync(abs, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];
  for (const entry of entries) {
    if (ignoredDirs.has(entry.name)) continue;
    const childRel = rel ? path.posix.join(rel, entry.name) : entry.name;
    if (entry.isDirectory()) files.push(...walk(dir, childRel));
    if (entry.isFile()) files.push(childRel);
  }
  return files;
}

function parseFrontmatterTitle(text, rel) {
  if (text.startsWith('---')) {
    const end = text.indexOf('\n---', 3);
    if (end > -1) {
      const fm = text.slice(3, end);
      const title = fm.match(/^title:\s*(.+)$/mi)?.[1]?.trim()?.replace(/^["']|["']$/g, '');
      if (title) return title;
    }
  }
  return path.basename(rel, '.md');
}

for (const rel of requiredDirs) {
  if (!exists(rel) || !fs.statSync(path.join(root, rel)).isDirectory()) {
    errors.push(`Missing required directory: ${rel}`);
  }
}

for (const rel of requiredFiles) {
  if (!exists(rel) || !fs.statSync(path.join(root, rel)).isFile()) {
    errors.push(`Missing required file: ${rel}`);
  }
}

try {
  JSON.parse(fs.readFileSync(path.join(root, 'state.json'), 'utf8'));
} catch (err) {
  errors.push(`state.json is invalid JSON: ${err.message}`);
}

const files = walk(root);
const mdFiles = files.filter((f) => f.endsWith('.md'));
const titleToFile = new Map();
for (const rel of mdFiles) {
  const text = fs.readFileSync(path.join(root, rel), 'utf8');
  const title = parseFrontmatterTitle(text, rel).toLowerCase();
  if (!titleToFile.has(title)) titleToFile.set(title, rel);
  const base = path.basename(rel, '.md').toLowerCase();
  if (!titleToFile.has(base)) titleToFile.set(base, rel);
}

const wikiRe = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]+)?\]\]/g;
for (const rel of mdFiles) {
  const text = fs.readFileSync(path.join(root, rel), 'utf8');
  for (const pattern of credentialPatterns) {
    if (pattern.re.test(text)) {
      errors.push(`Possible credential-like string (${pattern.name}) in ${rel}`);
    }
  }
  let match;
  while ((match = wikiRe.exec(text))) {
    const target = match[1].trim().toLowerCase();
    if (!titleToFile.has(target)) {
      errors.push(`Unresolved wikilink in ${rel}: [[${match[1]}]]`);
    }
  }
  if (rel.startsWith('Context Packs/') && !/\[\[SOURCE-MANIFEST\]\]|Source references/i.test(text)) {
    warnings.push(`Context pack may be missing source references: ${rel}`);
  }
}

for (const rel of files) {
  if (/\/\.md$/.test(rel) || /(^|\/)(People|Projects|Companies)\.md$/.test(rel)) {
    errors.push(`Invalid path-like note filename: ${rel}`);
  }
}

const report = [
  '# VALIDATION-REPORT',
  '',
  `Generated: ${new Date().toISOString()}`,
  '',
  `Files checked: ${files.length}`,
  `Markdown files checked: ${mdFiles.length}`,
  '',
  '## Result',
  '',
  errors.length === 0 ? 'PASS' : 'FAIL',
  '',
  '## Errors',
  '',
  ...(errors.length ? errors.map((e) => `- ${e}`) : ['- None']),
  '',
  '## Warnings',
  '',
  ...(warnings.length ? warnings.map((w) => `- ${w}`) : ['- None']),
  '',
];

fs.writeFileSync(path.join(root, 'VALIDATION-REPORT.md'), `---\ntitle: VALIDATION-REPORT\ntags:\n  - operating-memory\n  - validation\nstatus: ${errors.length === 0 ? 'pass' : 'fail'}\nlast_verified: ${new Date().toISOString().slice(0, 10)}\n---\n\n${report.join('\n')}`);

console.log(report.join('\n'));
if (errors.length) process.exit(1);
