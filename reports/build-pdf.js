'use strict';
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, 'cyberpower-advertising-report-apr2026.pdf');
const doc = new PDFDocument({ margin: 50, size: 'A4' });
doc.pipe(fs.createWriteStream(OUT));

// ── Colors ──────────────────────────────────────────────────────────────────
const DARK   = '#1a1a2e';
const ACCENT = '#2d5a27';
const RED    = '#c81e1e';
const GRAY   = '#6b7280';
const LGRAY  = '#f3f4f6';
const WHITE  = '#ffffff';

// ── Helpers ─────────────────────────────────────────────────────────────────
function fmt$(n) { return '$' + Number(n).toLocaleString('en-US', {minimumFractionDigits:0,maximumFractionDigits:0}); }
function fmtX(n) { return Number(n).toFixed(1) + 'x'; }
function fmtN(n) { return Number(n).toLocaleString('en-US'); }
function roas(spend, sales) { return spend > 0 ? sales/spend : 0; }

// ── Header ───────────────────────────────────────────────────────────────────
doc.rect(0, 0, doc.page.width, 90).fill(DARK);
doc.fillColor(WHITE).fontSize(22).font('Helvetica-Bold')
   .text('CyberPower Amazon Advertising', 50, 22);
doc.fontSize(12).font('Helvetica')
   .text('Performance Analysis & Strategic Recommendations', 50, 50);
doc.fontSize(9).fillColor('#9ca3af')
   .text('Prepared by Calbridge  ·  April 14, 2026  ·  MTD: Apr 1–14', 50, 68);
doc.fillColor(DARK);

// ── Executive Summary ────────────────────────────────────────────────────────
doc.y = 108;
doc.fontSize(13).font('Helvetica-Bold').fillColor(DARK).text('Executive Summary');
doc.moveDown(0.3);
doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor(ACCENT).lineWidth(2).stroke();
doc.moveDown(0.4);

const summaryData = [
  ['Metric', 'April MTD (14 days)', 'March Full Month'],
  ['Total Spend', '$280,315', '$624,450'],
  ['Total Sales (attributed)', '$2,207,426', '$5,413,251'],
  ['Blended ROAS', '7.87x', '8.67x'],
  ['Total Orders', '9,059', '22,072'],
  ['Annual Budget', '$7,200,000', '($600k/mo target)'],
  ['April Monthly Pace', '~$601k/mo ✓ On Target', '—'],
];

const colW = [220, 155, 155];
let sx = 50, sy = doc.y;
summaryData.forEach((row, ri) => {
  const bg = ri === 0 ? DARK : ri % 2 === 0 ? WHITE : LGRAY;
  const txColor = ri === 0 ? WHITE : DARK;
  let cx = sx;
  colW.forEach((w, ci) => {
    doc.rect(cx, sy, w, 18).fill(bg);
    doc.fillColor(txColor).fontSize(ri === 0 ? 8.5 : 8)
       .font(ri === 0 ? 'Helvetica-Bold' : ci === 0 ? 'Helvetica-Bold' : 'Helvetica')
       .text(row[ci], cx + 4, sy + 5, { width: w - 8, lineBreak: false });
    cx += w;
  });
  sy += 18;
});
doc.y = sy + 10;

// ── Part 1: Inventory Gap ────────────────────────────────────────────────────
doc.fontSize(13).font('Helvetica-Bold').fillColor(DARK).text('Part 1 — Inventory Gap: High Stock, Low Ad Support');
doc.moveDown(0.2);
doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor(RED).lineWidth(2).stroke();
doc.moveDown(0.3);
doc.fontSize(8.5).font('Helvetica').fillColor(GRAY)
   .text('ASINs with significant on-hand inventory receiving little or no Sponsored Products spend. Immediate sell-through risk.');
doc.moveDown(0.4);

const invData = [
  ['ASIN', 'On Hand', '90+ Aged', 'Apr SP Spend', 'ROAS', 'Action'],
  ['B07GZR9DSK', '1,905', '126', '$0', '—', '🔴 Activate'],
  ['B07SKX78PV', '1,655', '455', '$0', '—', '🔴 Urgent'],
  ['B00DBAAJQ6', '1,488', '711', '$0', '—', '🔴 Urgent'],
  ['B01MYOYC9U', '504', '96', '$0', '—', '🟡 Add support'],
  ['B07SKX6YWS', '530', '245', '$0', '—', '🔴 Activate'],
  ['B000QZ3UG0', '952', '172', '$0', '—', '🔴 Activate'],
  ['B0BCN5JH25', '306', '276', '$0', '—', '🔴 Urgent'],
  ['B009ACPBXK', '290', '242', '$0', '—', '🔴 Urgent'],
  ['B0CPZLQ2BT', '198', '197', '$0', '—', '🔴 Urgent'],
  ['B00TCELZTK', '247', '108', '$0', '—', '🟡 Add support'],
  ['B0D825R9S4', '289', '156', '$0', '—', '🟡 Add support'],
  ['B000XJJN60', '961', '316', '$350', '86.4x', '⚡ Scale now'],
  ['B0B354X985', '952', '207', '$60', '33.4x', '⚡ Scale now'],
  ['B00429N192', '785', '269', '$2,427', '8.0x', '✅ Active'],
];

const inv1 = [70, 60, 65, 90, 65, 120];
let ix = 50, iy = doc.y;
invData.forEach((row, ri) => {
  const bg = ri === 0 ? DARK : ri % 2 === 0 ? WHITE : LGRAY;
  const txColor = ri === 0 ? WHITE : DARK;
  let cx = ix;
  inv1.forEach((w, ci) => {
    doc.rect(cx, iy, w, 16).fill(bg);
    doc.fillColor(txColor).fontSize(ri === 0 ? 7.5 : 7.5)
       .font(ri === 0 ? 'Helvetica-Bold' : ci === 0 ? 'Helvetica-Bold' : 'Helvetica')
       .text(row[ci], cx + 3, iy + 4, { width: w - 6, lineBreak: false });
    cx += w;
  });
  iy += 16;
});
doc.y = iy + 12;

// ── Part 2: Winner Rankings ──────────────────────────────────────────────────
doc.addPage();
doc.rect(0, 0, doc.page.width, 8).fill(ACCENT);

doc.y = 20;
doc.fontSize(13).font('Helvetica-Bold').fillColor(DARK).text('Part 2 — Back the Winners: ASIN ROI Ranking');
doc.moveDown(0.2);
doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor(ACCENT).lineWidth(2).stroke();
doc.moveDown(0.3);
doc.fontSize(8.5).font('Helvetica').fillColor(GRAY)
   .text('SP advertised ASINs ranked by ROAS. April 1–14, 14-day attribution window.');
doc.moveDown(0.4);

const winners = [
  ['Rank', 'ASIN', 'Spend', 'Sales', 'ROAS', 'Orders', 'Rev/Order'],
  ['1', 'B000XJJN60 (OR500LCDRM1U)', '$350', '$30,221', '86.4x', '100', '$302'],
  ['2', 'B0039YX77M (OR1500LCDRTXL2U)', '$196', '$6,635', '33.8x', '13', '$511'],
  ['3', 'B0B354X985 (CP1500PFCRM2U)', '$60', '$2,001', '33.4x', '6', '$333'],
  ['4', 'B00HDODQYS (UPS model)', '$261', '$7,954', '30.4x', '18', '$442'],
  ['5', 'B009ACPCIO (OL3000RTXL2U)', '$352', '$9,197', '26.1x', '7', '$1,314'],
  ['6', 'B000XJLLKG (OR700LCDRM1U)', '$429', '$8,857', '20.7x', '27', '$328'],
  ['7', 'B0083TXNMM (PR1500LCD)', '$1,323', '$25,647', '19.4x', '33', '$777'],
  ['8', 'B003OJAHW0 (CP1500AVRLCD)', '$1,202', '$21,794', '18.1x', '35', '$623'],
  ['9', 'B07GZR981Y (ST425)', '$2,550', '$33,165', '13.0x', '425', '$78'],
  ['10', 'B009ACPBCQ (OL1500RTXL2U)', '$1,631', '$18,010', '11.0x', '19', '$948'],
  ['11', 'B00429N19W (CP1500PFCLCD)', '$47,619', '$407,986', '8.6x', '1,578', '$259'],
  ['12', 'B00429N192 (CP1000PFCLCD)', '$2,427', '$19,399', '8.0x', '106', '$183'],
  ['13', 'B0125HR2ZG (AVRG900LCD)', '$2,087', '$16,310', '7.8x', '104', '$157'],
  ['14', 'B00K8ZMT74 (AVRG900U)', '$1,152', '$8,267', '7.2x', '48', '$172'],
  ['15', 'B0BCMLLSHL (CP1500AVRLCD3)', '$25,918', '$170,022', '6.6x', '769', '$221'],
  ['16', 'B00429N18S (CP850PFCLCD)', '$1,461', '$9,531', '6.5x', '47', '$203'],
  ['17', 'B00DBAA696 (EC850LCD)', '$38,514', '$208,544', '5.4x', '1,411', '$148'],
  ['18', 'B0778YGVV2 (PDU41003)', '$1,476', '$6,967', '4.7x', '12', '$581'],
  ['19', 'B01615H29O (RMCARD205)', '$1,535', '$4,564', '3.0x', '13', '$351'],
];

const wCols = [30, 175, 55, 65, 50, 50, 65];
let wx = 50, wy = doc.y;
winners.forEach((row, ri) => {
  // Highlight top 5 ROAS
  const highlight = ri >= 1 && ri <= 5;
  const bg = ri === 0 ? DARK : highlight ? '#f0fdf4' : ri % 2 === 0 ? WHITE : LGRAY;
  const txColor = ri === 0 ? WHITE : DARK;
  let cx = wx;
  wCols.forEach((w, ci) => {
    doc.rect(cx, wy, w, 16).fill(bg);
    const roasVal = ri > 0 && ci === 4;
    doc.fillColor(roasVal && highlight ? ACCENT : txColor)
       .fontSize(7.5)
       .font(ri === 0 ? 'Helvetica-Bold' : (ci === 1 || roasVal) ? 'Helvetica-Bold' : 'Helvetica')
       .text(row[ci], cx + 3, wy + 4, { width: w - 6, lineBreak: false });
    cx += w;
  });
  wy += 16;
});
doc.y = wy + 14;

// ── Part 3: Recommendations ──────────────────────────────────────────────────
doc.fontSize(13).font('Helvetica-Bold').fillColor(DARK).text('Strategic Recommendations');
doc.moveDown(0.2);
doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor(ACCENT).lineWidth(2).stroke();
doc.moveDown(0.5);

const recs = [
  ['1', '🚨 Activate aged inventory NOW',
   'B00DBAAJQ6 (1,488 units, 711 aged 90+) and B07SKX78PV (1,655 units, 455 aged) have ZERO ad support. Long-term storage fees imminent. Recommend $2,000–3,000/mo SP campaigns on each immediately.'],
  ['2', '⚡ Scale the starved high-ROAS winners',
   'B000XJJN60 (86x), B0039YX77M (34x), B0B354X985 (33x), B00HDODQYS (30x) are generating exceptional returns on micro budgets ($60–350/mo). Shift $10k–15k/mo from lower-ROAS campaigns here — potential $150k+ in incremental attributed sales.'],
  ['3', '🔍 Audit B00DBAA696 and B0BCMLLSHL keyword quality',
   'These two ASINs consume $64k/mo (48% of SP budget) at 5.4x and 6.6x ROAS. Solid but below portfolio average. Keyword harvest and negative keyword pruning could improve efficiency by 1–2x without cutting budget.'],
  ['4', '📦 B000QZ3UG0 — 952 units, zero direct ad support',
   'Appears in campaign names but shows $0 in advertised product report. Possible targeting gap — campaigns may be spending to land on competitors ASINs instead. Audit ad group ASIN targets and add as exact match advertised product.'],
  ['5', '🎯 Coordinate DSP retargeting with inventory push',
   'DSP is running at 8.3x ROAS (~$112k MTD). Add retargeting segments for high-inventory ASINs to DSP audience pools — people who viewed but didn\'t buy are cheapest to convert and accelerates sell-through without new SP campaigns.'],
];

recs.forEach(([num, title, body]) => {
  if (doc.y > 680) doc.addPage();
  // Number bubble
  doc.circle(60, doc.y + 8, 9).fill(ACCENT);
  doc.fillColor(WHITE).fontSize(9).font('Helvetica-Bold').text(num, 56, doc.y + 4);
  // Title
  doc.fillColor(DARK).fontSize(10).font('Helvetica-Bold').text(title, 76, doc.y - 10);
  doc.y += 4;
  doc.fillColor(GRAY).fontSize(8.5).font('Helvetica').text(body, 76, doc.y, { width: 465 });
  doc.moveDown(0.8);
});

// ── Footer ───────────────────────────────────────────────────────────────────
const footerY = doc.page.height - 35;
doc.rect(0, footerY - 5, doc.page.width, 40).fill(DARK);
doc.fillColor('#9ca3af').fontSize(8).font('Helvetica')
   .text('Calbridge — Amazon eCommerce Management  ·  abe@teamcalbridge.com  ·  Confidential', 50, footerY + 4);
doc.text('Generated April 14, 2026', 400, footerY + 4);

doc.end();
console.log('PDF written to:', OUT);
