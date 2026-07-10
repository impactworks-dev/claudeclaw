import puppeteer from 'puppeteer';

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox']
});

const page = await browser.newPage();
await page.goto('file:///tmp/vendasta-brief.html', { waitUntil: 'networkidle0', timeout: 30000 });

await page.pdf({
  path: '/tmp/vendasta-financial-brief.pdf',
  width: '816px',
  height: '1056px',
  printBackground: true,
  margin: { top: 0, bottom: 0, left: 0, right: 0 }
});

await browser.close();
console.log('PDF generated: /tmp/vendasta-financial-brief.pdf');
