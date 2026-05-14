require('dotenv').config();
const puppeteer = require('puppeteer-core');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const SESSION_SECRET = process.env.SESSION_SECRET;
// Use the known-good session with real clientId
const SID = 'qE5S7yXnGKXYO7TK7_ij2VxNp_2rarL2';

const OUTPUT_DIR = '/home/azureuser/.openclaw/workspace/public/images/screenshots';

// cookie-signature compatible signing (express-session format)
function signSid(sid, secret) {
  const mac = crypto
    .createHmac('sha256', secret)
    .update(sid)
    .digest('base64')
    .replace(/=+$/, '');
  return `s:${sid}.${mac}`;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function waitForChartsOrTimeout(page, ms = 8000) {
  try {
    await page.waitForSelector('.recharts-wrapper', { timeout: ms });
    console.log('  .recharts-wrapper found');
  } catch (e) {
    console.log('  Timeout waiting for .recharts-wrapper — proceeding');
  }
}

async function ensureChartsRendered(page) {
  await page.evaluate(() => window.dispatchEvent(new Event('resize')));
  await sleep(800);
  // Scroll through page
  await page.evaluate(async () => {
    return new Promise(resolve => {
      let pos = 0;
      const step = 400;
      const interval = setInterval(() => {
        window.scrollBy(0, step);
        pos += step;
        if (pos >= document.body.scrollHeight) {
          clearInterval(interval);
          resolve();
        }
      }, 150);
    });
  });
  await page.evaluate(() => window.dispatchEvent(new Event('resize')));
  await sleep(1500);
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(800);
}

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const cookieVal = signSid(SID, SESSION_SECRET);
  console.log(`Using session: ${SID}`);
  console.log(`Cookie: ${cookieVal.substring(0, 50)}...`);

  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/chromium-browser',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
    headless: true,
  });

  try {
    // ─── Campaigns page ───────────────────────────────────────────────────
    console.log('\n=== Taking dashboard-campaigns.png ===');
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });

    page.on('console', msg => {
      if (msg.type() === 'error') console.log('  PAGE ERROR:', msg.text().substring(0, 120));
    });

    await page.setCookie({
      name: 'connect.sid',
      value: cookieVal,
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    });

    console.log('Navigating to /analytics/advertising/campaigns...');
    await page.goto('http://localhost:3000/analytics/advertising/campaigns', {
      waitUntil: 'networkidle0',
      timeout: 45000,
    });

    const url = page.url();
    console.log('Current URL:', url);
    if (url.includes('login') || url.includes('redirect')) {
      console.error('ERROR: Redirected away from campaigns page!');
      await page.screenshot({ path: path.join(OUTPUT_DIR, 'debug-redirect.png') });
      await browser.close();
      process.exit(1);
    }

    await waitForChartsOrTimeout(page, 8000);
    console.log('Waiting 3s for animations...');
    await sleep(3000);
    await ensureChartsRendered(page);

    const chartCount = await page.evaluate(() => document.querySelectorAll('.recharts-wrapper').length);
    const pathCount = await page.evaluate(() => document.querySelectorAll('.recharts-layer path[d]').length);
    console.log(`  Charts: ${chartCount}, SVG paths: ${pathCount}`);

    const outPath = path.join(OUTPUT_DIR, 'dashboard-campaigns.png');
    await page.screenshot({ path: outPath, fullPage: true });
    console.log(`Screenshot saved: ${outPath}`);
    await page.close();

    // Blur top-left 220x120 with ImageMagick
    console.log('Blurring top-left region...');
    execSync(`convert "${outPath}" -region 220x120+0+0 -blur 0x20 "${outPath}"`);
    console.log('Blur applied.');

  } finally {
    await browser.close();
  }

  const stat = fs.statSync(path.join(OUTPUT_DIR, 'dashboard-campaigns.png'));
  console.log(`\n✅ Done! dashboard-campaigns.png — ${(stat.size / 1024).toFixed(1)} KB`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
