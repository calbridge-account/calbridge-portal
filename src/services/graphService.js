'use strict';
/**
 * Microsoft Graph service — Ash's inbox (ash@teamcalbridge.com)
 * Provides read/send/calendar access via app-level credentials.
 */

const { ClientSecretCredential } = require('@azure/identity');
const { Client } = require('@microsoft/microsoft-graph-client');
const { TokenCredentialAuthenticationProvider } = require('@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials');

const USER = process.env.GRAPH_USER_EMAIL || 'ash@teamcalbridge.com';

function _buildSignature() {
  let logoSrc = 'https://app.calbridge.ai/calbridge-logo-email.png';
  try {
    const fs = require('fs');
    const logoPath = process.env.LOGO_PATH || '/home/azureuser/.openclaw/workspace/public/calbridge-logo.png';
    const b64 = fs.readFileSync(logoPath).toString('base64');
    logoSrc = `data:image/png;base64,${b64}`;
  } catch (e) { /* fall back to URL */ }
  return `
<br><br>
<table style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 14px; color: #222; border-collapse: collapse; border-spacing: 0;">
  <tr>
    <td style="vertical-align: top; padding-bottom: 10px;">
      <div style="font-weight: 700; font-size: 15px; color: #111; margin: 0; padding: 0;">Ash Mercer</div>
      <div style="color: #444; font-size: 13px; margin: 2px 0 4px 0;">Operations Lead</div>
      <div style="font-size: 13px; color: #444;">
        <a href="mailto:ash@teamcalbridge.com" style="color: #222; text-decoration: none;">ash@teamcalbridge.com</a>
        &nbsp;&nbsp;|&nbsp;&nbsp;
        <a href="https://app.calbridge.ai" style="color: #222; text-decoration: none;">app.calbridge.ai</a>
      </div>
    </td>
  </tr>
  <tr>
    <td style="padding-top: 10px;">
      <img src="${logoSrc}" alt="Calbridge" height="144" style="display: block;" />
    </td>
  </tr>
</table>
`;
}

const EMAIL_SIGNATURE = _buildSignature();

function getClient() {
  const credential = new ClientSecretCredential(
    process.env.GRAPH_TENANT_ID,
    process.env.GRAPH_CLIENT_ID,
    process.env.GRAPH_CLIENT_SECRET
  );
  const authProvider = new TokenCredentialAuthenticationProvider(credential, {
    scopes: ['https://graph.microsoft.com/.default'],
  });
  return Client.initWithMiddleware({ authProvider });
}

/**
 * List inbox messages.
 * @param {object} opts
 * @param {number} opts.top        - Max messages to return (default 20)
 * @param {boolean} opts.unreadOnly - Only unread messages
 * @param {string} opts.folder     - Folder name (default 'inbox')
 */
async function listMessages({ top = 20, unreadOnly = false, folder = 'inbox' } = {}) {
  const client = getClient();
  let req = client.api(`/users/${USER}/mailFolders/${folder}/messages`)
    .top(top)
    .select('id,subject,from,toRecipients,receivedDateTime,isRead,bodyPreview,conversationId')
    .orderby('receivedDateTime DESC');
  if (unreadOnly) req = req.filter('isRead eq false');
  const res = await req.get();
  return res.value || [];
}

/**
 * Get full message body by ID.
 */
async function getMessage(messageId) {
  const client = getClient();
  return client.api(`/users/${USER}/messages/${messageId}`)
    .select('id,subject,from,toRecipients,ccRecipients,receivedDateTime,isRead,body,conversationId')
    .get();
}

/**
 * Get a full conversation thread by conversationId.
 */
async function getThread(conversationId) {
  const client = getClient();
  const res = await client.api(`/users/${USER}/messages`)
    .filter(`conversationId eq '${conversationId}'`)
    .select('id,subject,from,toRecipients,receivedDateTime,isRead,body,bodyPreview')
    .top(20)
    .get();
  return res.value || [];
}

/**
 * Mark a message as read.
 */
async function markRead(messageId) {
  const client = getClient();
  return client.api(`/users/${USER}/messages/${messageId}`).patch({ isRead: true });
}

/**
 * Send an email.
 * @param {object} opts
 * @param {string|string[]} opts.to      - Recipient(s)
 * @param {string} opts.subject
 * @param {string} opts.body             - HTML body
 * @param {string[]} [opts.cc]
 * @param {string} [opts.replyToMessageId] - If replying, the message ID to reply to
 */
async function sendEmail({ to, subject, body, cc = [], replyToMessageId = null }) {
  const client = getClient();
  const toList = (Array.isArray(to) ? to : [to]).map(addr => ({
    emailAddress: { address: addr }
  }));
  const ccList = cc.map(addr => ({ emailAddress: { address: addr } }));

  const bodyWithSig = body + EMAIL_SIGNATURE;

  if (replyToMessageId) {
    return client.api(`/users/${USER}/messages/${replyToMessageId}/replyAll`).post({
      message: {
        toRecipients: toList,
        ccRecipients: ccList,
        body: { contentType: 'HTML', content: bodyWithSig },
      },
    });
  }

  return client.api(`/users/${USER}/sendMail`).post({
    message: {
      subject,
      body: { contentType: 'HTML', content: bodyWithSig },
      toRecipients: toList,
      ccRecipients: ccList,
    },
    saveToSentItems: true,
  });
}

/**
 * List upcoming calendar events.
 * @param {number} days - How many days ahead to look (default 7)
 */
async function listCalendarEvents(days = 7) {
  const client = getClient();
  const now = new Date().toISOString();
  const end = new Date(Date.now() + days * 86400000).toISOString();
  const res = await client.api(`/users/${USER}/calendarView`)
    .query({ startDateTime: now, endDateTime: end })
    .select('subject,start,end,location,attendees,bodyPreview')
    .orderby('start/dateTime ASC')
    .top(20)
    .get();
  return res.value || [];
}

module.exports = { listMessages, getMessage, getThread, markRead, sendEmail, listCalendarEvents };
