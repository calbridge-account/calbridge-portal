const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY);

resend.emails.send({
  from: 'Ash <ash@teamcalbridge.com>',
  to: 'abe@teamcalbridge.com',
  subject: 'Calbridge Portal — Fix Auto-Start on Reboot (1 command needed)',
  html: `
<p>Hey Abe,</p>
<p>The portal went down today because PM2 wasn't configured to auto-start after a system reboot. I've already restarted both services and they're back online, but here's what you need to do to prevent it from happening again:</p>
<hr>
<p><strong>SSH into the server and run this ONE command:</strong></p>
<pre style="background:#f4f4f4;padding:12px;border-radius:4px;font-size:14px;">sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u azureuser --hp /home/azureuser</pre>
<p>That's it. It registers PM2 as a systemd service so it starts automatically on every reboot.</p>
<p><strong>Steps:</strong></p>
<ol>
  <li>SSH into the Azure VM</li>
  <li>Run the command above (requires sudo/root)</li>
  <li>Confirm it says "PM2 successfully configured"</li>
</ol>
<p>The saved process list already includes both <strong>calbridge-portal</strong> and <strong>calbridge-worker</strong>, so once that command is run, everything will auto-restart on any future reboot.</p>
<p>— Ash</p>
`
}).then(r => console.log('sent', JSON.stringify(r))).catch(e => console.error('error', e.message));
