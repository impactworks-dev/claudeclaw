import { readFileSync } from 'fs';

const pdfB64 = readFileSync('/tmp/vendasta-pdf-b64-clean.txt', 'utf8');
const img1B64 = readFileSync('/tmp/vendasta-img1-b64-clean.txt', 'utf8');
const img2B64 = readFileSync('/tmp/vendasta-img2-b64-clean.txt', 'utf8');

const output = JSON.stringify({
  pdf: pdfB64,
  img1: img1B64,
  img2: img2B64
});

process.stdout.write(output);
