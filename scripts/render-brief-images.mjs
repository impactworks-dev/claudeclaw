import puppeteer from 'puppeteer';

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox']
});

const page = await browser.newPage();
await page.setViewport({ width: 816, height: 1056, deviceScaleFactor: 2 });
await page.goto('file:///tmp/vendasta-brief.html', { waitUntil: 'networkidle0', timeout: 30000 });

// Get both page elements
const pages = await page.$$('.page');

for (let i = 0; i < pages.length; i++) {
  await pages[i].screenshot({
    path: `/tmp/vendasta-brief-page${i + 1}.png`,
    type: 'png'
  });
  console.log(`Page ${i + 1} screenshot saved`);
}

await browser.close();
console.log('Done');
