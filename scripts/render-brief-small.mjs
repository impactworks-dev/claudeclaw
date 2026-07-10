import puppeteer from 'puppeteer';

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox']
});

const page = await browser.newPage();
// Use 1x scale instead of 2x to keep images small
await page.setViewport({ width: 816, height: 1056, deviceScaleFactor: 1 });
await page.goto('file:///tmp/vendasta-brief.html', { waitUntil: 'networkidle0', timeout: 30000 });

const pages = await page.$$('.page');

for (let i = 0; i < pages.length; i++) {
  await pages[i].screenshot({
    path: `/tmp/vendasta-brief-sm-p${i + 1}.png`,
    type: 'png'
  });
}

await browser.close();

// Output base64 as JSON
import { readFileSync } from 'fs';
const pdf = readFileSync('/tmp/vendasta-financial-brief.pdf').toString('base64');
const img1 = readFileSync(`/tmp/vendasta-brief-sm-p1.png`).toString('base64');
const img2 = readFileSync(`/tmp/vendasta-brief-sm-p2.png`).toString('base64');

console.log(JSON.stringify({ pdfLen: pdf.length, img1Len: img1.length, img2Len: img2.length }));
