require('dotenv').config();
const { Resend } = require('resend');

const sp  = { spend: 556186, sales: 3105945, orders: 16430, clicks: 204108 };
const sb  = { spend: 292250, sales: 925644,  orders: 3858  };
const sd  = { spend: 89808,  sales: 254536,  orders: 1306  };
const dsp = { spend: 962949, sales: 8132533, orders: 29732, ntb: 5621 };

const totalSpend  = sp.spend + sb.spend + sd.spend + dsp.spend;
const totalSales  = sp.sales + sb.sales + sd.sales + dsp.sales;

const roas = (sales, spend) => '$' + (sales / spend).toFixed(2);

const spROAS      = roas(sp.sales, sp.spend);
const sbROAS      = roas(sb.sales, sb.spend);
const dspROAS     = roas(dsp.sales, dsp.spend);
const overallROAS = roas(totalSales, totalSpend);
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

Attached is the updated 2026 Amazon Advertising campaign report for the US, reflecting data through March 27th, 2026. Please note that, due to the 14-day attribution window, finalized data is available through March 13th, 2026.

As we close out Q1, the results have been encouraging. Sponsored Products continues to strengthen month-over-month — January came in at a ${spJanROAS} ROAS, February climbed to ${spFebROAS}, and March is currently tracking at ${spMarROAS} as data continues to settle. SP conversion rate is holding strong at ${spCVR}% YTD, which reflects the tighter keyword discipline we've been running.

DSP is performing well at a ${dspROAS} ROAS YTD with ${fmtM(dsp.sales)} in total attributed sales. Of the ${Number(dsp.orders).toLocaleString()} total DSP orders, ${Number(dsp.ntb).toLocaleString()} (${ntbPct}%) were new-to-brand — a strong signal that the top-of-funnel investment is bringing in net new customers, not just re-converting existing ones.

On the Business segment, performance remains a bright spot at a ${bizROAS} ROAS and ${bizCVR}% conversion rate, despite representing a smaller share of overall SP spend. There may be room to increase investment here given the efficiency. On the Consumer side, the non-branded research campaigns (Broad/Phrase) are generating solid volume but at lower ROAS ($2.43–$4.23) — we'll continue monitoring those against the defensive and product-targeted campaigns that are outperforming.

Looking forward to our next conversation.


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
