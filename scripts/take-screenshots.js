/**
 * Marketing screenshots for Calbridge landing page
 * Uses Puppeteer-core with Chromium + existing Redis session (CyberPower)
 */
const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const CHROMIUM = '/usr/bin/chromium-browser';
const BASE_URL = 'http://localhost:3000';
const OUT_DIR = '/home/azureuser/.openclaw/workspace/public/images/screenshots';
const SESSION_SECRET = 'c8eb476b2adbce8569fa26da38050cbb119d675526f2211740db772961ffccdba3996c4931552ab53a4e60287f1dd8fb';
const SID = 'qE5S7yXnGKXYO7TK7_ij2VxNp_2rarL2';

function signSessionId(sid, secret) {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(sid);
  return 's:' + sid + '.' + hmac.digest('base64').replace(/=+$/, '');
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function setSession(page) {
  const signedSid = signSessionId(SID, SESSION_SECRET);
  await page.setCookie({
    name: 'connect.sid',
    value: signedSid,
    domain: 'localhost',
    path: '/',
    httpOnly: true,
    secure: false,
    sameSite: 'Lax'
  });
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  console.log('Launching browser...');
  const browser = await puppeteer.launch({
    executablePath: CHROMIUM,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    headless: true,
    defaultViewport: { width: 1440, height: 900 }
  });

  // === Screenshot 1: dashboard-main.png — Main overview with KPIs + charts ===
  {
    console.log('\n=== 1: dashboard-main.png (Overview) ===');
    const page = await browser.newPage();
    await setSession(page);
    await page.goto(BASE_URL + '/analytics/', { waitUntil: 'networkidle0' });
    await sleep(5000);
    console.log('URL:', page.url());
    await page.screenshot({ path: path.join(OUT_DIR, 'dashboard-main.png'), fullPage: false });
    console.log('✓ Saved (', Math.round(fs.statSync(path.join(OUT_DIR, 'dashboard-main.png')).size / 1024), 'KB)');
    await page.close();
  }

  // === Screenshot 2: dashboard-campaigns.png — Campaigns with data table ===
  {
    console.log('\n=== 2: dashboard-campaigns.png (Campaigns) ===');
    const page = await browser.newPage();
    await setSession(page);
    await page.goto(BASE_URL + '/analytics/advertising/campaigns', { waitUntil: 'networkidle0' });
    await sleep(5000);
    console.log('URL:', page.url());
    await page.screenshot({ path: path.join(OUT_DIR, 'dashboard-campaigns.png'), fullPage: false });
    console.log('✓ Saved (', Math.round(fs.statSync(path.join(OUT_DIR, 'dashboard-campaigns.png')).size / 1024), 'KB)');
    await page.close();
  }

  // === Screenshot 3: dashboard-overview.png — Full page scroll of main dashboard ===
  {
    console.log('\n=== 3: dashboard-overview.png (Full-page Overview) ===');
    const page = await browser.newPage();
    await setSession(page);
    // Try advertising overview first
    const paths = [
      '/analytics/advertising',
      '/analytics/advertising/overview',
      '/analytics/',
    ];
    let captured = false;
    for (const p of paths) {
      await page.goto(BASE_URL + p, { waitUntil: 'networkidle0' });
      await sleep(5000);
      const url = page.url();
      console.log(`Tried ${p} → ${url}`);
      // Take full-page screenshot
      const shot = await page.screenshot({ path: path.join(OUT_DIR, 'dashboard-overview.png'), fullPage: true });
      const size = fs.statSync(path.join(OUT_DIR, 'dashboard-overview.png')).size;
      console.log(`  Size: ${Math.round(size/1024)}KB`);
      if (size > 50000) { // >50KB means it has content
        console.log('✓ Good screenshot!');
        captured = true;
        break;
      } else {
        console.log('  ⚠ Too small, trying next path...');
      }
    }
    if (!captured) console.log('⚠ Fallback used for overview');
    await page.close();
  }

  await browser.close();
  console.log('\n=== All screenshots done ===');
  fs.readdirSync(OUT_DIR).filter(f => f.endsWith('.png') && !f.startsWith('debug')).forEach(f => {
    const stat = fs.statSync(path.join(OUT_DIR, f));
    console.log(`  ${f}: ${Math.round(stat.size/1024)}KB`);
  });
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
