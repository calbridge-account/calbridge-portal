require('dotenv').config();
const { Resend } = require('resend');

const sp  = { spend: 556186, sales: 3105945, orders: 16430, clicks: 204108 };
const sb  = { spend: 292250, sales: 925644,  orders: 3858  };
const sd  = { spend: 89808,  sales: 254536,  orders: 1306  };
const dsp = { spend: 962949, sales: 8132533, orders: 29732, ntb: 5621 };

const totalSpend  = sp.spend + sb.spend + sd.spend + dsp.spend;
const totalSales  = sp.sales + sb.sales + sd.sales + dsp.sales;

const roas = (sales, spend) => '$' + (sales / spend).toFixed(2);

const overallROAS = roas(totalSales, totalSpend);
const spROAS      = roas(sp.sales, sp.spend);
const sbROAS      = roas(sb.sales, sb.spend);
const dspROAS     = roas(dsp.sales, dsp.spend);
const bizROAS     = roas(332259, 33240);
const conROAS     = roas(2773685, 522947);

const spCVR  = ((sp.orders / sp.clicks) * 100).toFixed(1);
const bizCVR = ((1108 / 7243) * 100).toFixed(1);
const ntbPct = Math.round(dsp.ntb / dsp.orders * 100);

const spJanROAS = '$' + (501278  / 177448).toFixed(2);
const spFebROAS = '$' + (1254964 / 181062).toFixed(2);
const spMarROAS = '$' + (1349703 / 197675).toFixed(2);

const fmtM = n => '$' + (n / 1000000).toFixed(1) + 'M';
const fmt  = n => '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 });

const body = `Hi CyberPower Team,

Attached is the updated 2026 Amazon Advertising campaign report for the US, now reflecting data through March 27th, 2026. Please note that, due to the 14-day attribution window, finalized data is available through March 13th, 2026.

As we close out Q1, performance has recovered strongly after a challenging January. Increased competitive pressure driven by post-storm demand surge compressed ROAS early in the quarter, with SP coming in at ${spJanROAS} in January. As conditions normalized, February rebounded to ${spFebROAS} and March is currently tracking at ${spMarROAS} — both well above Q1 average. SP conversion rate is holding at ${spCVR}% YTD, reflecting the continued keyword optimizations we've been executing throughout the quarter.

DSP has been a consistent performer, delivering a ${dspROAS} ROAS on ${fmtM(dsp.sales)} in total attributed sales. ${ntbPct}% of DSP orders were new-to-brand, which is encouraging — the upper-funnel spend is generating genuine customer acquisition, not just retargeting existing buyers.

The Business segment continues to stand out with a ${bizROAS} ROAS and ${bizCVR}% conversion rate. Given the efficiency, there is a strong case for increasing investment in this segment as we move into Q2. We'll continue to optimize across all channels to drive overall performance and revenue growth through the rest of the year.


YTD US Highlights (Jan 1 – Mar 27, 2026):

Overall ROAS: ${overallROAS} with ${fmtM(totalSales)} in total attributed sales
Sponsored Products: ${fmtM(sp.sales)} in sales at a ${spROAS} ROAS | ${spCVR}% conversion rate
Sponsored Brands: ${fmtM(sb.sales)} in sales at a ${sbROAS} ROAS
DSP: ${fmtM(dsp.sales)} in total attributed sales at a ${dspROAS} ROAS | ${ntbPct}% new-to-brand orders
Business Segment (SP): ${bizROAS} ROAS | ${bizCVR}% conversion rate
Consumer Segment (SP): ${conROAS} ROAS | ${fmt(2773685)} in sales


Thanks,
Abe`;

console.log(body);

const resend = new Resend(process.env.RESEND_API_KEY);
resend.emails.send({
  from: 'Calbridge Portal <ash@teamcalbridge.com>',
  to: ['abe@teamcalbridge.com'],
  subject: 'CyberPower 2026 Amazon Advertising — YTD Summary (Through March 27)',
  text: body
}).then(r => { console.log('\nSent:', r.data?.id); process.exit(0); })
  .catch(e => { console.error('Error:', e.message); process.exit(1); });
