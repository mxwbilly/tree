import fs from 'node:fs';
import crypto from 'node:crypto';
import https from 'node:https';

const CRED_PATH = process.env.GA_CREDENTIALS || '.credentials/ga-service-account.json';

function base64url(input) {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function signJwt(cred) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: cred.client_email,
    scope: 'https://www.googleapis.com/auth/analytics.readonly',
    aud: cred.token_uri,
    exp: now + 3600,
    iat: now
  };
  const enc = (obj) => base64url(JSON.stringify(obj));
  const unsigned = `${enc(header)}.${enc(claim)}`;
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(unsigned);
  const signature = sign.sign(cred.private_key, 'base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${unsigned}.${signature}`;
}

function httpJson(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(data); } catch { parsed = { raw: data.slice(0, 500) }; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function getAccessToken(cred) {
  const jwt = signJwt(cred);
  const res = await httpJson({
    hostname: 'oauth2.googleapis.com',
    path: '/token',
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  }, `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`);
  if (res.status !== 200) {
    throw new Error(`access token 换取失败 (HTTP ${res.status}): ${JSON.stringify(res.body)}`);
  }
  return res.body.access_token;
}

async function runReport(propertyId, token, body) {
  const res = await httpJson({
    hostname: 'analyticsdata.googleapis.com',
    path: `/v1beta/properties/${propertyId}:runReport`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    }
  }, JSON.stringify(body));
  return res;
}

function formatRows(report) {
  const { dimensionHeaders = [], metricHeaders = [], rows = [] } = report.body;
  const dims = dimensionHeaders.map((h) => h.name);
  const mets = metricHeaders.map((h) => h.name);
  return rows.map((row) => {
    const obj = {};
    row.dimensionValues.forEach((v, i) => { obj[dims[i]] = v.value; });
    row.metricValues.forEach((v, i) => { obj[mets[i]] = v.value; });
    return obj;
  });
}

async function main() {
  const propertyId = process.argv[2] || process.env.GA_PROPERTY_ID;
  if (!propertyId) {
    console.error('缺少 GA4 媒体资源 ID。用法: node ga-report.mjs <propertyId>');
    process.exit(1);
  }

  const cred = JSON.parse(fs.readFileSync(CRED_PATH, 'utf8'));
  const token = await getAccessToken(cred);

  const dailyReport = await runReport(propertyId, token, {
    dateRanges: [{ startDate: '7daysAgo', endDate: 'today' }],
    dimensions: [{ name: 'date' }],
    metrics: [
      { name: 'activeUsers' },
      { name: 'newUsers' },
      { name: 'sessions' },
      { name: 'screenPageViews' }
    ],
    orderBys: [{ dimension: { dimensionName: 'date' } }]
  });

  const countryReport = await runReport(propertyId, token, {
    dateRanges: [{ startDate: '7daysAgo', endDate: 'today' }],
    dimensions: [{ name: 'country' }],
    metrics: [{ name: 'activeUsers' }, { name: 'sessions' }],
    orderBys: [{ metric: { metricName: 'activeUsers' }, desc: true }],
    limit: 10
  });

  const result = {
    dailyStatus: dailyReport.status,
    daily: dailyReport.status === 200 ? formatRows(dailyReport) : dailyReport.body,
    countryStatus: countryReport.status,
    byCountry: countryReport.status === 200 ? formatRows(countryReport) : countryReport.body
  };

  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
