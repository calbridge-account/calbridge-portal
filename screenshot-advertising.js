require('dotenv').config();
const puppeteer = require('puppeteer-core');
const crypto = require('crypto');
const { Jimp } = require('jimp');
const path = require('path');
const fs = require('fs');

// Session info
const SESSION_ID = 'qE5S7yXnGKXYO7TK7_ij2VxNp_2rarL2';
const SESSION_SECRET = process.env.SESSION_SECRET;

// Sign the session ID the same way express-session does (using cookie-signature)
// cookie-signature: s:<sid>.<hmac-sha256>
function signSessionId(sid, secret) {
  const mac = crypto
    .createHmac('sha256', secret)
    .update(sid)
    .digest('base64')
    .replace(/=+$/, '');
  return `s:${sid}.${mac}`;
}

async function main() {
  const signedCookie = signSessionId(SESSION_ID, SESSION_SECRET);
  console.log('Signed cookie value prefix:', signedCookie.substring(0, 50) + '...');

  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/chromium-browser',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
    headless: true,
  });

  const page = await browser.newPage();
  // Start with standard viewport so Recharts gets proper container dimensions
  await page.setViewport({ width: 1440, height: 900 });

  // Set the session cookie
  await page.setCookie({
    name: 'connect.sid',
    value: signedCookie,
    domain: 'localhost',
    path: '/',
    httpOnly: true,
    sameSite: 'Lax',
  });

  console.log('Navigating to advertising overview...');
  await page.goto('http://localhost:3000/analytics/advertising?range=30d', {
    waitUntil: 'networkidle0',
    timeout: 45000,
  });

  // Check if we got redirected to login
  const currentUrl = page.url();
  console.log('Current URL:', currentUrl);

  if (currentUrl.includes('login')) {
    console.error('Got redirected to login - session not valid!');
    await browser.close();
    process.exit(1);
  }

  // Capture console errors for debugging
  page.on('console', msg => {
    if (msg.type() === 'error') console.log('PAGE ERROR:', msg.text());
  });

  // Wait initial load
  console.log('Waiting 3 seconds for initial render...');
  await new Promise(r => setTimeout(r, 3000));

  // Wait for API data to arrive (trend endpoint)
  console.log('Waiting for chart SVG paths to render...');
  try {
    await page.waitForFunction(
      () => document.querySelectorAll('.recharts-layer path[d]').length > 2,
      { timeout: 20000 }
    );
    console.log('Chart paths detected!');
  } catch (e) {
    console.log('Timeout waiting for chart paths — proceeding anyway');
  }

  // Extra buffer for animations to finish
  await new Promise(r => setTimeout(r, 2000));

  // Force Recharts ResponsiveContainer to resize by triggering a window resize event
  // This fixes blank charts caused by 0-height containers before the component mounts
  console.log('Triggering resize event for Recharts ResponsiveContainer...');
  await page.evaluate(() => {
    window.dispatchEvent(new Event('resize'));
  });
  await new Promise(r => setTimeout(r, 1500));

  // Scroll down slowly so Recharts containers get viewport visibility
  console.log('Scrolling page to ensure chart visibility...');
  await page.evaluate(async () => {
    await new Promise(resolve => {
      let totalHeight = 0;
      const distance = 300;
      const timer = setInterval(() => {
        window.scrollBy(0, distance);
        totalHeight += distance;
        if (totalHeight >= document.body.scrollHeight) {
          clearInterval(timer);
          resolve();
        }
      }, 200);
    });
  });

  // Dispatch another resize after scroll to re-trigger ResponsiveContainer layout
  await page.evaluate(() => window.dispatchEvent(new Event('resize')));
  await new Promise(r => setTimeout(r, 2000));

  // Scroll back to top
  await page.evaluate(() => window.scrollTo(0, 0));
  await new Promise(r => setTimeout(r, 1000));

  const outputPath = '/home/azureuser/.openclaw/workspace/public/images/screenshots/dashboard-overview-raw.png';
  const finalPath = '/home/azureuser/.openclaw/workspace/public/images/screenshots/dashboard-overview.png';

  // Ensure output dir exists
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  // Get the actual content height from the DOM
  const contentHeight = await page.evaluate(() => {
    return Math.max(
      document.documentElement.scrollHeight,
      document.body.scrollHeight,
      document.body.offsetHeight
    );
  });
  console.log('DOM content height:', contentHeight);

  // Expand viewport to full content height so Recharts ResponsiveContainers
  // remeasure correctly — but only AFTER data has loaded and charts have rendered.
  // This avoids the blank chart issue caused by fullPage:true expanding mid-render.
  await page.setViewport({ width: 1440, height: Math.min(contentHeight + 50, 4000) });
  // Trigger resize so Recharts re-measures its containers at the new height
  await page.evaluate(() => window.dispatchEvent(new Event('resize')));
  await new Promise(r => setTimeout(r, 1500));

  console.log('Taking screenshot...');
  await page.screenshot({
    path: outputPath,
    fullPage: false,
  });

  console.log('Screenshot saved to:', outputPath);
  await browser.close();

  // Blur top-left 220x120 area using Jimp
  console.log('Blurring top-left area...');
  const img = await Jimp.read(outputPath);
  console.log('Image dimensions:', img.bitmap.width, 'x', img.bitmap.height);

  // Blur the entire image region, then composite back
  // We'll manually pixelate the top-left 220x120 region
  const BLUR_W = 220;
  const BLUR_H = 120;
  const BLOCK = 10; // pixelation block size

  for (let y = 0; y < BLUR_H; y += BLOCK) {
    for (let x = 0; x < BLUR_W; x += BLOCK) {
      // Average color of block
      let rSum = 0, gSum = 0, bSum = 0, count = 0;
      for (let dy = 0; dy < BLOCK && y + dy < BLUR_H; dy++) {
        for (let dx = 0; dx < BLOCK && x + dx < BLUR_W; dx++) {
          const rgba = img.getPixelColor(x + dx, y + dy);
          const r = (rgba >>> 24) & 0xff;
          const g = (rgba >>> 16) & 0xff;
          const b = (rgba >>> 8) & 0xff;
          rSum += r; gSum += g; bSum += b; count++;
        }
      }
      const rAvg = Math.round(rSum / count);
      const gAvg = Math.round(gSum / count);
      const bAvg = Math.round(bSum / count);
      const color = (rAvg << 24) | (gAvg << 16) | (bAvg << 8) | 0xff;
      // Fill block with average color
      for (let dy = 0; dy < BLOCK && y + dy < BLUR_H; dy++) {
        for (let dx = 0; dx < BLOCK && x + dx < BLUR_W; dx++) {
          img.setPixelColor(color >>> 0, x + dx, y + dy);
        }
      }
    }
  }

  await img.write(finalPath);

  // Remove raw file
  fs.unlinkSync(outputPath);

  console.log('Final screenshot saved to:', finalPath);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
