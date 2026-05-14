'use strict';
const express = require('express');
const router  = express.Router();
const { Resend } = require('resend');

/**
 * POST /contact
 * Public contact form submission — no auth required.
 * Sends an email to ash@teamcalbridge.com via Resend.
 */
router.post('/', async (req, res) => {
  try {
    const { name, email, company, interest, message } = req.body || {};

    if (!name?.trim() || !email?.trim()) {
      return res.status(400).json({ error: 'Name and email are required.' });
    }

    const resend = new Resend(process.env.RESEND_API_KEY);

    const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px;color:#111;max-width:600px;">
  <h2 style="margin:0 0 20px;font-size:18px;color:#4f46e5;">New contact form submission</h2>
  <table style="width:100%;border-collapse:collapse;">
    <tr><td style="padding:8px 0;color:#666;width:130px;vertical-align:top;font-weight:600;">Name</td><td style="padding:8px 0;">${name}</td></tr>
    <tr><td style="padding:8px 0;color:#666;vertical-align:top;font-weight:600;">Email</td><td style="padding:8px 0;"><a href="mailto:${email}">${email}</a></td></tr>
    ${company ? `<tr><td style="padding:8px 0;color:#666;vertical-align:top;font-weight:600;">Company</td><td style="padding:8px 0;">${company}</td></tr>` : ''}
    ${interest ? `<tr><td style="padding:8px 0;color:#666;vertical-align:top;font-weight:600;">Interest</td><td style="padding:8px 0;">${interest}</td></tr>` : ''}
    ${message ? `<tr><td style="padding:8px 0;color:#666;vertical-align:top;font-weight:600;">Message</td><td style="padding:8px 0;white-space:pre-wrap;">${message}</td></tr>` : ''}
  </table>
  <div style="margin-top:24px;padding-top:16px;border-top:1px solid #e5e7eb;font-size:12px;color:#9ca3af;">
    Submitted via ${req.get('referer') || req.get('origin') || 'calbridge.ai'}
  </div>
</div>`;

    await resend.emails.send({
      from: process.env.EMAIL_FROM || 'ash@teamcalbridge.com',
      to:   'ash@teamcalbridge.com',
      replyTo: email,
      subject: `New contact: ${name}${company ? ` — ${company}` : ''}`,
      html,
    });

    res.json({ ok: true, message: 'Message sent! We\'ll be in touch shortly.' });
  } catch (err) {
    console.error('[contact] Form submission error:', err.message);
    res.status(500).json({ error: 'Failed to send message. Please email us directly at ash@teamcalbridge.com' });
  }
});

module.exports = router;
