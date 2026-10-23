require('dotenv').config();
const https = require('https');

const RESEND_API_KEY = process.env.RESEND_API_KEY;
if (!RESEND_API_KEY) {
  console.error('RESEND_API_KEY saknas i .env');
  process.exit(1);
}

const data = JSON.stringify({
  from: 'onboarding@resend.dev',
  to: 'ckarjalainenjoels@gmail.com',
  subject: 'Forsyne — testmail',
  html: '<p>Resend fungerar.</p>'
});

const req = https.request({
  hostname: 'api.resend.com',
  path: '/emails',
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${RESEND_API_KEY}`,
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data)
  }
}, res => {
  let body = '';
  res.on('data', chunk => body += chunk);
  res.on('end', () => {
    const parsed = JSON.parse(body);
    if (parsed.id) console.log('Mail skickat! ID:', parsed.id);
    else console.log('Fel:', body);
  });
});

req.on('error', e => console.error('Request error:', e));
req.write(data);
req.end();
