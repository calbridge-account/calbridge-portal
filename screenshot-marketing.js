require('dotenv').config();
const puppeteer = require('puppeteer-core');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Find a valid client session from Redis
const { createClient } = require('redis');

const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET) {
  console.error('SESSION_SECRET not set in .env');
  process.exit(1);
}

// Express-session cookie signing (cookie-signature compatible, base64url)
function signSid(sid, secret) {
  const sig = crypto
    .createHmac('sha256', secret)
    .update(sid)
    .digest('base64')
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  // URL-encode the colon prefix for the cookie value
  return 's%3A' + sid + '.' + sig;
}

const OUTPUT_DIR = '/home/azureuser/.openclaw/workspace/public/images/screenshots';

async function findClientSession() {
  const client = createClient();
  await client.connect();

  const keys = await client.keys('sess:*');
  let bestSid = null;

  for (const key of keys) {
    const sid = key.replace(/^sess:/, '');
    const raw = await client.get(key);
    if (!raw) continue;
    try {
      const data = JSON.parse(raw);
      // Must have clientId but NOT be abe-admin-001 (prefer real client)
      if (data.clientId && data.clientId !== 'abe-admin-001') {
        // Check cookie not expired
        const exp = data.cookie && data.cookie.expires ? new Date(data.cookie.expires) : null;
        if (!exp || exp > new Date()) {
          console.log(`Found valid client session: ${sid} (clientId: ${data.clientId})`);
          // Prefer sessions without adminId
          if (!data.adminId) {
            bestSid = sid;
            break;
          }
          bestSid = bestSid || sid;
        }
      }
    } catch (e) {
      // skip
    }
  }

  await client.quit();
  return bestSid;
}

async function waitForChartsOrTimeout(page, ms = 8000) {
  const start = Date.now();
  try {
    await page.waitForSelector('.recharts-wrapper', { timeout: ms });
    console.log(`  .recharts-wrapper found after ${Date.now() - start}ms`);
  } catch (e) {
    console.log(`  Timeout waiting for .recharts-wrapper after ${Date.now() - start}ms — proceeding`);
  }
}

async function ensureChartsRendered(page) {
  // Trigger resize to ensure ResponsiveContainer recalculates dimensions
  await page.evaluate(() => {
    window.dispatchEvent(new Event('resize'));
    window.dispatchEvent(new Event('load'));
  });
  await sleep(1000);

  // Scroll through page so all lazy charts enter viewport
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

  // Resize again after scroll
  await page.evaluate(() => window.dispatchEvent(new Event('resize')));
  await sleep(1500);

  // Scroll back to top
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(1000);
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // Find session
  const sid = await findClientSession();
  if (!sid) {
    console.error('No valid client session found in Redis');
    process.exit(1);
  }

  const cookieVal = signSid(sid, SESSION_SECRET);
  console.log(`Using session: ${sid}`);
  console.log(`Cookie value prefix: ${cookieVal.substring(0, 40)}...`);

  // Launch Puppeteer
  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/chromium-browser',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
    headless: true,
  });

  try {
    // ─── SCREENSHOT 1: Advertising Overview ───────────────────────────────
    console.log('\n=== Taking dashboard-overview.png ===');
    const page1 = await browser.newPage();
    await page1.setViewport({ width: 1440, height: 900 });

    page1.on('console', msg => {
      if (msg.type() === 'error') console.log('  PAGE ERROR:', msg.text().substring(0, 120));
    });

    await page1.setCookie({
      name: 'connect.sid',
      value: decodeURIComponent(cookieVal),
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    });

    console.log('Navigating to /analytics/advertising...');
    await page1.goto('http://localhost:3000/analytics/advertising', {
      waitUntil: 'networkidle0',
      timeout: 45000,
    });

    const url1 = page1.url();
    console.log('Current URL:', url1);
    if (url1.includes('login') || url1.includes('signin')) {
      console.log('Redirected to login — trying raw cookie value...');
      // Try with raw (URL-encoded) cookie value
      await page1.setCookie({
        name: 'connect.sid',
        value: cookieVal,
        domain: 'localhost',
        path: '/',
        httpOnly: true,
        sameSite: 'Lax',
      });
      await page1.goto('http://localhost:3000/analytics/advertising', {
        waitUntil: 'networkidle0',
        timeout: 45000,
      });
      const url1b = page1.url();
      console.log('URL after retry:', url1b);
      if (url1b.includes('login')) {
        console.error('Still redirected to login — session invalid');
        await browser.close();
        process.exit(1);
      }
    }

    await waitForChartsOrTimeout(page1, 8000);
    console.log('Waiting 3s for animations...');
    await sleep(3000);
    await ensureChartsRendered(page1);

    // Check how many recharts wrappers we have
    const chartCount1 = await page1.evaluate(() => document.querySelectorAll('.recharts-wrapper').length);
    const pathCount1 = await page1.evaluate(() => document.querySelectorAll('.recharts-layer path[d]').length);
    console.log(`  Charts found: ${chartCount1}, SVG paths: ${pathCount1}`);

    const out1 = path.join(OUTPUT_DIR, 'dashboard-overview.png');
    await page1.screenshot({ path: out1, fullPage: true });
    console.log(`Screenshot saved: ${out1}`);
    await page1.close();

    // Blur top-left 220x120 with ImageMagick
    console.log('Blurring top-left region...');
    execSync(`convert "${out1}" -region 220x120+0+0 -blur 0x20 "${out1}"`);
    console.log('Blur applied.');

    // ─── SCREENSHOT 2: Campaigns ──────────────────────────────────────────
    console.log('\n=== Taking dashboard-campaigns.png ===');
    const page2 = await browser.newPage();
    await page2.setViewport({ width: 1440, height: 900 });

    page2.on('console', msg => {
      if (msg.type() === 'error') console.log('  PAGE ERROR:', msg.text().substring(0, 120));
    });

    await page2.setCookie({
      name: 'connect.sid',
      value: decodeURIComponent(cookieVal),
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    });

    console.log('Navigating to /analytics/advertising/campaigns...');
    await page2.goto('http://localhost:3000/analytics/advertising/campaigns', {
      waitUntil: 'networkidle0',
      timeout: 45000,
    });

    const url2 = page2.url();
    console.log('Current URL:', url2);
    if (url2.includes('login')) {
      console.error('Redirected to login on campaigns page');
      await browser.close();
      process.exit(1);
    }

    await waitForChartsOrTimeout(page2, 8000);
    console.log('Waiting 3s for animations...');
    await sleep(3000);
    await ensureChartsRendered(page2);

    const chartCount2 = await page2.evaluate(() => document.querySelectorAll('.recharts-wrapper').length);
    const pathCount2 = await page2.evaluate(() => document.querySelectorAll('.recharts-layer path[d]').length);
    console.log(`  Charts found: ${chartCount2}, SVG paths: ${pathCount2}`);

    const out2 = path.join(OUTPUT_DIR, 'dashboard-campaigns.png');
    await page2.screenshot({ path: out2, fullPage: true });
    console.log(`Screenshot saved: ${out2}`);
    await page2.close();

    // Blur top-left 220x120 with ImageMagick
    console.log('Blurring top-left region...');
    execSync(`convert "${out2}" -region 220x120+0+0 -blur 0x20 "${out2}"`);
    console.log('Blur applied.');

  } finally {
    await browser.close();
  }

  // Final size check
  const stat1 = fs.statSync(path.join(OUTPUT_DIR, 'dashboard-overview.png'));
  const stat2 = fs.statSync(path.join(OUTPUT_DIR, 'dashboard-campaigns.png'));
  console.log(`\n✅ Done!`);
  console.log(`  dashboard-overview.png  — ${(stat1.size / 1024).toFixed(1)} KB`);
  console.log(`  dashboard-campaigns.png — ${(stat2.size / 1024).toFixed(1)} KB`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
