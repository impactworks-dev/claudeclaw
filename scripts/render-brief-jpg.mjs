import puppeteer from 'puppeteer';
import { readFileSync } from 'fs';

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox']
});

const page = await browser.newPage();
await page.setViewport({ width: 816, height: 1056, deviceScaleFactor: 1.5 });
await page.goto('file:///tmp/vendasta-brief.html', { waitUntil: 'networkidle0', timeout: 30000 });

const pages = await page.$$('.page');

for (let i = 0; i < pages.length; i++) {
  await pages[i].screenshot({
    path: `/tmp/vb-p${i + 1}.jpg`,
    type: 'jpeg',
    quality: 75
  });
}

await browser.close();

const img1 = readFileSync('/tmp/vb-p1.jpg').toString('base64');
const img2 = readFileSync('/tmp/vb-p2.jpg').toString('base64');
console.log(JSON.stringify({ img1Len: img1.length, img2Len: img2.length, totalKB: Math.round((img1.length + img2.length) / 1024) }));
