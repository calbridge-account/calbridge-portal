require('dotenv').config();
const puppeteer = require('puppeteer-core');
const crypto = require('crypto');

const SESSION_ID = 'qE5S7yXnGKXYO7TK7_ij2VxNp_2rarL2';
const SESSION_SECRET = process.env.SESSION_SECRET;

function signSessionId(sid, secret) {
  const mac = crypto.createHmac('sha256', secret).update(sid).digest('base64').replace(/=+$/, '');
  return `s:${sid}.${mac}`;
}

async function main() {
  const signedCookie = signSessionId(SESSION_ID, SESSION_SECRET);
  console.log('Cookie value:', signedCookie);

  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/chromium-browser',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
    headless: true,
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  // Log network requests/responses
  page.on('response', async (response) => {
    const url = response.url();
    if (url.includes('/advertising') || url.includes('/api/')) {
      const status = response.status();
      console.log(`[NET] ${status} ${url}`);
      if (status >= 400) {
        try { const body = await response.text(); console.log('  BODY:', body.substring(0, 200)); } catch (e) {}
      }
    }
  });

  page.on('console', msg => {
    if (['error', 'warn'].includes(msg.type())) {
      console.log(`[PAGE ${msg.type().toUpperCase()}]`, msg.text());
    }
  });

  await page.setCookie({
    name: 'connect.sid',
    value: signedCookie,
    domain: 'localhost',
    path: '/',
    httpOnly: true,
    sameSite: 'Lax',
  });

  await page.goto('http://localhost:3000/analytics/advertising?range=30d', {
    waitUntil: 'networkidle0',
    timeout: 30000,
  });

  console.log('URL:', page.url());
  
  // Check session state
  const sessionInfo = await page.evaluate(() => {
    // Check for React Query data
    const charts = document.querySelectorAll('.recharts-surface');
    const paths = document.querySelectorAll('.recharts-layer path');
    const svgs = document.querySelectorAll('svg.recharts-surface');
    return {
      charts: charts.length,
      paths: paths.length,
      svgs: svgs.length,
      bodyText: document.body.innerText.substring(0, 500),
    };
  });
  console.log('Page state:', JSON.stringify(sessionInfo, null, 2));

  await new Promise(r => setTimeout(r, 5000));

  const sessionInfo2 = await page.evaluate(() => {
    const paths = document.querySelectorAll('.recharts-layer path[d]');
    return {
      paths: paths.length,
      pathSamples: Array.from(paths).slice(0, 3).map(p => p.getAttribute('d')?.substring(0, 50)),
    };
  });
  console.log('After 5s:', JSON.stringify(sessionInfo2, null, 2));

  await browser.close();
}

main().catch(console.error);
