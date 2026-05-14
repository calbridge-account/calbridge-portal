require('dotenv').config();
const fs = require('fs');
const { sendEmail } = require('./src/services/graphService');

const batchNum = parseInt(process.argv[2] || '1');
const BATCH_SIZE = 75;

const csv = fs.readFileSync('gtm/apollo-export.csv', 'utf8');
const lines = csv.trim().split('\n');
const raw = lines[0];

// CSV-aware parser handling quoted fields
function parseCSVLine(line) {
  const vals = [];
  let cur = '', inQuote = false;
  for (const ch of line) {
    if (ch === '"') inQuote = !inQuote;
    else if (ch === ',' && !inQuote) { vals.push(cur.trim()); cur = ''; }
    else cur += ch;
  }
  vals.push(cur.trim());
  return vals;
}

const headers = parseCSVLine(raw);
const idx = (h) => headers.indexOf(h);

// Load already-sent from log file
const _sentRaw = (() => { try { return JSON.parse(fs.readFileSync('gtm/already-sent.json','utf8')); } catch(e) { return []; } })();
const already = new Set([
  ..._sentRaw,
  // previously sent support@ addresses
  'support@govee.com','support@levoit.com','support@renpho.com','support@puracy.com',
  'service@sparkpaws.com','support@petlibro.com','ir@toughbuilt.com','support@hexclad.com',
  'customerservice@kizik.com','support@naturehike.com','info@gorillagriporiginal.com',
  'cs@caroteus.com','support@zulaykitchen.com','support@cosori.com','support@bn-link.com',
  'support@furbo.com','info@redbarninc.com','support@fixdapp.com','support@colorfulkoala.com',
  'support@miko.ai','hello@willowpump.com','customercare@aquasana.com','support@nativecos.com',
  'support@snapsupplements.com','support@mielleorganics.com','hello@branchbasics.com',
  'medicalinfo@obagi.com','consumerrelations@bioadvanced.com','support@cozsinoor.com','info@ecogreenusa.com',
  'asiri@amazon.com',
].map(e => e.toLowerCase()));

// Filter: verified or catch-all only, not already sent, not Amazon employees
const contacts = lines.slice(1)
  .map(l => {
    const c = parseCSVLine(l);
    return {
      firstName: c[idx('First Name')] || '',
      lastName: c[idx('Last Name')] || '',
      title: c[idx('Title')] || '',
      company: c[idx('Company Name')] || '',
      email: c[idx('Email')] || '',
      status: c[idx('Email Status')] || '',
    };
  })
  .filter(c => c.email && !already.has(c.email.toLowerCase()))
  .filter(c => ['Verified', 'Extrapolated', ''].includes(c.status) || c.status === '')
  .filter(c => !c.email.includes('@amazon.com'));

const start = (batchNum - 1) * BATCH_SIZE;
const batch = contacts.slice(start, start + BATCH_SIZE);

console.log(`Total contacts: ${contacts.length} | Batch ${batchNum}: rows ${start+1}-${start+batch.length}`);

async function send() {
  let sent = 0;
  for (const c of batch) {
    const firstName = c.firstName || 'there';
    const isAgency = /agency|media|marketing|consultant|partner|adviser|advisor/i.test(c.company + c.title);

    const body = isAgency
      ? `<p>Hi ${firstName},</p>
<p>I'm Ash — Operations Lead at Calbridge. We're an Amazon management consultancy out of Seattle running $500K+/month in ad spend, and we built a white-label analytics portal for agencies managing multiple brand accounts.</p>
<p>Short version: unified SP/SB/SD/DSP dashboard, contribution margin per ASIN, automated insights, and white-label client logins under your brand. Your clients see your logo, not ours.</p>
<p>Showing it to a handful of agencies this month — worth a 20-minute look? <a href="https://calbridge.ai">calbridge.ai</a></p>`
      : `<p>Hi ${firstName},</p>
<p>I'm Ash — Operations Lead at Calbridge. We're an Amazon management consultancy out of Seattle running $500K+/month in ad spend, and we built an analytics portal specifically for brands serious about their Amazon P&L.</p>
<p>What it does: unified SP/SB/SD/DSP dashboard updated every 6 hours, contribution margin per ASIN after COGS and FBA fees, and automated alerts when a campaign exceeds your break-even ACoS. Vendor Central analytics too if you sell through Vendor.</p>
<p>Free tier available, no credit card required: <a href="https://calbridge.ai">calbridge.ai</a> — happy to do a quick walkthrough with your data if that's useful.</p>`;

    const subject = isAgency
      ? `White-label Amazon analytics for ${c.company}`
      : `Amazon analytics built for brands like ${c.company}`;

    try {
      await sendEmail({ to: c.email, subject, body });
      console.log(`✅ ${c.firstName} ${c.lastName} — ${c.title} @ ${c.company} (${c.email})`);
      sent++;
      await new Promise(r => setTimeout(r, 3000));
    } catch(e) {
      console.error(`❌ ${c.company} (${c.email}): ${e.message}`);
    }
  }
  console.log(`\nBatch ${batchNum} done — ${sent}/${batch.length} sent`);
}

send().then(() => process.exit(0));
