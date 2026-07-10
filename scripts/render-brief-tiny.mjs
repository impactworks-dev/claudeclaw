import puppeteer from 'puppeteer';
import { readFileSync, writeFileSync } from 'fs';

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox']
});

const page = await browser.newPage();
await page.setViewport({ width: 816, height: 1056, deviceScaleFactor: 1 });
await page.goto('file:///tmp/vendasta-brief.html', { waitUntil: 'networkidle0', timeout: 30000 });

const pages = await page.$$('.page');

for (let i = 0; i < pages.length; i++) {
  await pages[i].screenshot({
    path: `/tmp/vb-t${i + 1}.jpg`,
    type: 'jpeg',
    quality: 50
  });
}

await browser.close();

const img1b64 = readFileSync('/tmp/vb-t1.jpg').toString('base64');
const img2b64 = readFileSync('/tmp/vb-t2.jpg').toString('base64');
const pdfb64 = readFileSync('/tmp/vendasta-financial-brief.pdf').toString('base64');

// Write out the base64 strings for easy access
writeFileSync('/tmp/email-img1.b64', img1b64);
writeFileSync('/tmp/email-img2.b64', img2b64);
writeFileSync('/tmp/email-pdf.b64', pdfb64);

console.log(JSON.stringify({
  img1Len: img1b64.length,
  img2Len: img2b64.length,
  pdfLen: pdfb64.length,
  totalKB: Math.round((img1b64.length + img2b64.length + pdfb64.length) / 1024)
}));
