const TOKEN_EXPIRES_SECONDS = 12 * 60 * 60;
const SESSION_COOKIE_NAME = 'greensmart_admin_session';
const STATUS_VALUES = new Set(['new', 'contacted', 'quoted', 'won', 'lost']);
const MIN_JWT_SECRET_LENGTH = 32;
const MIN_ADMIN_PASSWORD_LENGTH = 12;
const MAX_INQUIRY_BODY_BYTES = 16 * 1024;
const MAX_TURNSTILE_TOKEN_LENGTH = 2048;
const INQUIRY_FIELD_LIMITS = {
  name: 100,
  email: 254,
  country: 100,
  message: 5000,
  company: 150,
  phone: 50,
  product: 500,
  quantity: 30,
  oem: 30,
  port: 120,
  deadline: 80,
  lang: 10,
  source: 50,
  pageUrl: 1000
};
const INSECURE_JWT_SECRETS = new Set([
  'change-this-secret',
  'change-this-secret-in-production',
  'change-this-secret-before-production'
]);
const INSECURE_ADMIN_PASSWORDS = new Set(['ChangeMe123!']);
const INSECURE_ADMIN_EMAILS = new Set(['admin@novagardenhome.com']);

function nowIso() {
  return new Date().toISOString();
}

function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    status: init.status || 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...(init.headers || {})
    }
  });
}

function csv(text, filename) {
  return new Response(`\uFEFF${text}`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store'
    }
  });
}

function newId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function hasText(value) {
  return String(value || '').trim().length > 0;
}

function parseJson(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function toCsvCell(value) {
  const text = String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
}

function base64UrlEncode(bytes) {
  const text = String.fromCharCode(...new Uint8Array(bytes));
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlEncodeText(text) {
  return base64UrlEncode(new TextEncoder().encode(text));
}

function base64UrlDecodeText(text) {
  const normalized = text.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function hmacSign(input, secret) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return base64UrlEncode(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(input)));
}

function getSecurityConfigIssues(env) {
  const jwtSecret = String(env.JWT_SECRET || '').trim();
  const adminEmail = String(env.ADMIN_EMAIL || '').trim().toLowerCase();
  const adminPassword = String(env.ADMIN_PASSWORD || '');
  const issues = [];

  if (jwtSecret.length < MIN_JWT_SECRET_LENGTH || INSECURE_JWT_SECRETS.has(jwtSecret)) {
    issues.push('JWT_SECRET');
  }
  if (!/^\S+@\S+\.\S+$/.test(adminEmail) || INSECURE_ADMIN_EMAILS.has(adminEmail)) {
    issues.push('ADMIN_EMAIL');
  }
  if (adminPassword.length < MIN_ADMIN_PASSWORD_LENGTH || INSECURE_ADMIN_PASSWORDS.has(adminPassword)) {
    issues.push('ADMIN_PASSWORD');
  }
  return issues;
}

function getJwtSecret(env) {
  const issues = getSecurityConfigIssues(env);
  if (issues.includes('JWT_SECRET')) throw new Error('JWT_SECRET is missing or insecure.');
  return String(env.JWT_SECRET).trim();
}

async function createToken(payload, env) {
  const header = base64UrlEncodeText(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64UrlEncodeText(JSON.stringify({
    ...payload,
    exp: Math.floor(Date.now() / 1000) + TOKEN_EXPIRES_SECONDS
  }));
  const unsigned = `${header}.${body}`;
  const signature = await hmacSign(unsigned, getJwtSecret(env));
  return `${unsigned}.${signature}`;
}

async function verifyToken(token, env) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new Error('Invalid token.');
  const [header, body, signature] = parts;
  const expected = await hmacSign(`${header}.${body}`, getJwtSecret(env));
  if (signature !== expected) throw new Error('Invalid signature.');
  const payload = JSON.parse(base64UrlDecodeText(body));
  if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error('Expired token.');
  }
  return payload;
}

function parseBearerToken(request) {
  const header = request.headers.get('Authorization') || '';
  const [scheme, token] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' ? token : '';
}

function parseCookieToken(request) {
  const cookie = request.headers.get('Cookie') || '';
  const prefix = `${SESSION_COOKIE_NAME}=`;
  const part = cookie.split(';').map((item) => item.trim()).find((item) => item.startsWith(prefix));
  return part ? decodeURIComponent(part.slice(prefix.length)) : '';
}

function getRequestToken(request) {
  return parseBearerToken(request) || parseCookieToken(request);
}

function sessionCookie(request, token) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=${TOKEN_EXPIRES_SECONDS}${secure}`;
}

function expiredSessionCookie(request) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${SESSION_COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/api; Max-Age=0${secure}`;
}

async function requireAuth(request, env, roles = []) {
  const token = getRequestToken(request);
  if (!token) {
    return { response: json({ ok: false, error: 'Missing authorization token.' }, { status: 401 }) };
  }
  try {
    const auth = await verifyToken(token, env);
    if (roles.length && !roles.includes(auth.role)) {
      return { response: json({ ok: false, error: 'Forbidden.' }, { status: 403 }) };
    }
    return { auth };
  } catch {
    return { response: json({ ok: false, error: 'Invalid or expired token.' }, { status: 401 }) };
  }
}

function computeRfqCompleteness(inquiry) {
  const messageLength = String(inquiry?.message || '').trim().length;
  const rules = [
    { key: 'name', weight: 8, pass: hasText(inquiry?.contact?.name) },
    { key: 'email', weight: 8, pass: hasText(inquiry?.contact?.email) },
    { key: 'country', weight: 8, pass: hasText(inquiry?.contact?.country) },
    { key: 'company', weight: 10, pass: hasText(inquiry?.contact?.company) },
    { key: 'phone', weight: 10, pass: hasText(inquiry?.contact?.phone) },
    { key: 'product', weight: 12, pass: hasText(inquiry?.product) },
    { key: 'quantity', weight: 10, pass: hasText(inquiry?.quantity) },
    { key: 'oem', weight: 6, pass: hasText(inquiry?.oem) },
    { key: 'port', weight: 5, pass: hasText(inquiry?.port) },
    { key: 'deadline', weight: 5, pass: hasText(inquiry?.deadline) },
    { key: 'message', weight: 18, pass: messageLength >= 10 }
  ];
  const maxScore = rules.reduce((sum, item) => sum + item.weight, 0);
  let score = 0;
  for (const item of rules) {
    if (item.key === 'message') {
      if (messageLength >= 30) score += item.weight;
      else if (messageLength >= 10) score += 10;
    } else if (item.pass) {
      score += item.weight;
    }
  }
  const percent = Math.round((score / maxScore) * 100);
  const level = percent >= 85 ? 'high' : percent >= 70 ? 'medium' : 'low';
  const missingFields = rules
    .filter((item) => (item.key === 'message' ? messageLength < 10 : !item.pass))
    .map((item) => item.key);
  return {
    score,
    maxScore,
    percent,
    level,
    missingFields,
    filledFields: rules.map((item) => item.key).filter((key) => !missingFields.includes(key))
  };
}

function getPriorityLevelByRfqPercent(percent) {
  if (percent >= 85) return 'high';
  if (percent >= 70) return 'medium';
  return 'low';
}

function buildInquiryMailSubject(prefix, product, country, inquiryId) {
  const safeProduct = String(product || 'unknown-product').trim() || 'unknown-product';
  const safeCountry = String(country || 'unknown-country').trim() || 'unknown-country';
  return `[GreenSmart] ${prefix} ${safeProduct} | ${safeCountry} | ${inquiryId}`;
}

function formatResendError(payload, raw, status) {
  const nested = payload?.error;
  if (nested && typeof nested === 'object') {
    return nested.message || nested.error || JSON.stringify(nested);
  }
  if (typeof payload?.error === 'string' && payload.error.trim()) {
    return payload.error.trim();
  }
  if (typeof payload?.message === 'string' && payload.message.trim()) {
    return payload.message.trim();
  }
  if (typeof raw === 'string' && raw.trim()) {
    return raw.trim();
  }
  return `Resend HTTP ${status}`;
}

async function sendEmailViaResend(env, { to, subject, text }) {
  const apiKey = env.RESEND_API_KEY;
  const from = String(env.MAIL_FROM || '').trim();
  const recipient = String(to || '').trim().toLowerCase();
  if (!apiKey) {
    return { ok: false, error: 'RESEND_API_KEY is not configured.' };
  }
  if (!from) {
    return { ok: false, error: 'MAIL_FROM is not configured.' };
  }
  if (!recipient) {
    return { ok: false, error: 'Recipient email is empty.' };
  }
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ from, to: [recipient], subject, text })
    });
    const raw = await response.text();
    let payload = {};
    try {
      payload = raw ? JSON.parse(raw) : {};
    } catch {
      payload = {};
    }
    if (!response.ok) {
      const error = formatResendError(payload, raw, response.status);
      console.error('[mail] Resend error:', response.status, error);
      return { ok: false, status: response.status, error, details: payload };
    }
    return { ok: true, id: payload.id || payload.data?.id || null };
  } catch (error) {
    console.error('[mail] Resend failed:', error);
    return { ok: false, error: String(error?.message || error) };
  }
}

function resolveNotifyEmail(env, settings) {
  const stored = String(settings?.notifyEmail || '').trim();
  if (stored) return stored.toLowerCase();
  return String(env.NOTIFY_EMAIL || env.ADMIN_EMAIL || '').trim().toLowerCase();
}

async function notifyNewInquiry(env, { inquiryId, product, source, message, contact, notifyEmail, assigneeEmail }) {
  const safeName = contact.name || '';
  const safeEmail = contact.email || '';
  const safeCountry = contact.country || '';
  const results = { notify: null, assignee: null };

  if (notifyEmail) {
    results.notify = await sendEmailViaResend(env, {
      to: notifyEmail,
      subject: buildInquiryMailSubject('New inquiry', product, safeCountry, inquiryId),
      text: [
        `Inquiry ID: ${inquiryId}`,
        `Name: ${safeName}`,
        `Email: ${safeEmail}`,
        `Country: ${safeCountry}`,
        `Product: ${product || '-'}`,
        `Message: ${message}`,
        `Source: ${source || 'website'}`
      ].join('\n')
    });
  } else {
    results.notify = { ok: false, error: 'No notify email configured.' };
  }

  if (assigneeEmail) {
    results.assignee = await sendEmailViaResend(env, {
      to: assigneeEmail,
      subject: buildInquiryMailSubject('Assigned inquiry', product, safeCountry, inquiryId),
      text: [
        'A new inquiry was assigned to you.',
        '',
        `Inquiry ID: ${inquiryId}`,
        `Buyer: ${safeName}`,
        `Email: ${safeEmail}`,
        `Country: ${safeCountry}`
      ].join('\n')
    });
  }

  return results;
}

async function notifyInquiryAssigned(env, { inquiryId, product, contact, status, assigneeEmail }) {
  if (!assigneeEmail) return { ok: false, error: 'No assignee email configured.' };
  return sendEmailViaResend(env, {
    to: assigneeEmail,
    subject: buildInquiryMailSubject('Inquiry assigned', product, contact?.country, inquiryId),
    text: [
      `You were assigned inquiry ${inquiryId}.`,
      `Buyer: ${contact?.name || ''}`,
      `Email: ${contact?.email || ''}`,
      `Status: ${status || ''}`
    ].join('\n')
  });
}

function scheduleMailTask(waitUntil, task) {
  const wrapped = task.catch((error) => {
    console.error('[mail] background task failed:', error);
    return { ok: false, error: String(error?.message || error) };
  });
  if (waitUntil) {
    waitUntil(wrapped);
    return null;
  }
  return wrapped;
}

function computeSlaState(inquiry, nowMs = Date.now()) {
  if (['won', 'lost'].includes(String(inquiry?.status || ''))) {
    return { breached: false, overdueHours: 0, thresholdHours: 24 };
  }
  const parsedTs = new Date(inquiry?.updatedAt || inquiry?.createdAt || nowIso()).getTime();
  const anchorTs = Number.isFinite(parsedTs) ? parsedTs : nowMs;
  const elapsedHours = Math.max(0, (nowMs - anchorTs) / (1000 * 60 * 60));
  return {
    breached: elapsedHours > 24,
    overdueHours: Math.max(0, Math.floor(elapsedHours - 24)),
    thresholdHours: 24
  };
}

function normalizeInquiry(row) {
  if (!row) return null;
  const item = {
    id: row.id,
    customerId: row.customer_id,
    status: row.status,
    assigneeId: row.assignee_id || null,
    lang: row.lang || 'en',
    source: row.source || 'website',
    pageUrl: row.page_url || '',
    product: row.product || '',
    quantity: row.quantity || '',
    oem: row.oem || '',
    port: row.port || '',
    deadline: row.deadline || '',
    message: row.message || '',
    contact: parseJson(row.contact_json, {}),
    timeline: parseJson(row.timeline_json, []),
    quotes: parseJson(row.quotes_json, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
  const rfq = computeRfqCompleteness(item);
  return {
    ...item,
    rfqCompleteness: rfq,
    priority: getPriorityLevelByRfqPercent(rfq.percent),
    sla: computeSlaState(item)
  };
}

async function ensureBootstrap(env) {
  await env.DB.prepare(`
    INSERT INTO users (id, email, name, role, password_hash, created_at, updated_at)
    VALUES (?, ?, ?, 'admin', ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      email = excluded.email,
      name = excluded.name,
      role = 'admin',
      password_hash = excluded.password_hash,
      updated_at = excluded.updated_at
  `).bind(
    'user_admin',
    String(env.ADMIN_EMAIL).trim().toLowerCase(),
    String(env.ADMIN_NAME || 'Site Administrator').trim(),
    await sha256Hex(String(env.ADMIN_PASSWORD)),
    nowIso(),
    nowIso()
  ).run();

  await env.DB.prepare(`
    INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES ('notifyEmail', ?, ?)
  `).bind(env.NOTIFY_EMAIL || env.ADMIN_EMAIL || '', nowIso()).run();
  await env.DB.prepare(`
    INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES ('defaultAssigneeId', '', ?)
  `).bind(nowIso()).run();
}

async function checkRateLimit(env, request, bucket, limit, windowSeconds) {
  if (!env.RATE_LIMIT) {
    console.error('[config] RATE_LIMIT KV binding is not configured.');
    return json({ ok: false, error: 'Request protection is temporarily unavailable.' }, { status: 503 });
  }
  try {
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const slot = Math.floor(Date.now() / (windowSeconds * 1000));
    const key = `${bucket}:${ip}:${slot}`;
    const count = Number(await env.RATE_LIMIT.get(key) || '0') + 1;
    await env.RATE_LIMIT.put(key, String(count), { expirationTtl: windowSeconds + 60 });
    if (count > limit) {
      return json({ ok: false, error: `Too many ${bucket} requests. Please retry later.` }, { status: 429 });
    }
  } catch (error) {
    console.error(`[rate-limit] ${bucket} failed:`, error);
    return json({ ok: false, error: 'Request protection is temporarily unavailable.' }, { status: 503 });
  }
  return null;
}

async function readBody(request) {
  if (!request.headers.get('Content-Type')?.includes('application/json')) return {};
  return request.json().catch(() => ({}));
}

async function readInquiryBody(request) {
  if (!request.headers.get('Content-Type')?.includes('application/json')) {
    return { response: json({ ok: false, error: 'Content-Type must be application/json.' }, { status: 415 }) };
  }
  const declaredLength = Number(request.headers.get('Content-Length') || 0);
  if (declaredLength > MAX_INQUIRY_BODY_BYTES) {
    return { response: json({ ok: false, error: 'Inquiry request is too large.' }, { status: 413 }) };
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_INQUIRY_BODY_BYTES) {
    return { response: json({ ok: false, error: 'Inquiry request is too large.' }, { status: 413 }) };
  }
  try {
    const payload = JSON.parse(text);
    if (!payload || Array.isArray(payload) || typeof payload !== 'object') throw new Error('Invalid body.');
    return { payload };
  } catch {
    return { response: json({ ok: false, error: 'Invalid JSON body.' }, { status: 400 }) };
  }
}

function validateInquiryPayload(payload) {
  for (const field of ['name', 'email', 'country', 'product', 'message']) {
    if (!String(payload[field] || '').trim()) return `${field} is required.`;
  }
  const email = String(payload.email).trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return 'A valid email address is required.';
  for (const [field, limit] of Object.entries(INQUIRY_FIELD_LIMITS)) {
    if (String(payload[field] || '').trim().length > limit) return `${field} is too long.`;
  }
  return '';
}

async function verifyTurnstile(env, request, token) {
  const secret = String(env.TURNSTILE_SECRET_KEY || '').trim();
  if (!secret) {
    console.error('[config] TURNSTILE_SECRET_KEY is not configured.');
    return json({ ok: false, error: 'Security verification is temporarily unavailable.' }, { status: 503 });
  }
  const responseToken = String(token || '').trim();
  if (!responseToken || responseToken.length > MAX_TURNSTILE_TOKEN_LENGTH) {
    return json({ ok: false, error: 'Please complete the security verification.' }, { status: 400 });
  }
  try {
    const body = new URLSearchParams({
      secret,
      response: responseToken,
      remoteip: request.headers.get('CF-Connecting-IP') || ''
    });
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    });
    if (!response.ok) throw new Error(`Siteverify returned ${response.status}.`);
    const result = await response.json();
    if (!result.success) {
      console.warn('[turnstile] Verification rejected:', result['error-codes'] || []);
      return json({ ok: false, error: 'Security verification failed. Please try again.' }, { status: 400 });
    }
    return null;
  } catch (error) {
    console.error('[turnstile] Siteverify failed:', error);
    return json({ ok: false, error: 'Security verification is temporarily unavailable.' }, { status: 503 });
  }
}

async function getSettings(env) {
  const { results } = await env.DB.prepare('SELECT key, value FROM settings').all();
  const settings = { notifyEmail: env.NOTIFY_EMAIL || env.ADMIN_EMAIL || '', defaultAssigneeId: null };
  for (const item of results || []) {
    if (item.key === 'notifyEmail') {
      const stored = String(item.value || '').trim();
      if (stored) settings.notifyEmail = stored;
    }
    if (item.key === 'defaultAssigneeId') settings.defaultAssigneeId = item.value || null;
  }
  return settings;
}

async function appendActivityLog(env, entry) {
  await env.DB.prepare(`
    INSERT INTO activity_logs (id, type, actor_id, target_id, payload_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(
    newId('log'),
    entry.type,
    entry.actorId || null,
    entry.targetId || null,
    JSON.stringify(entry.payload || {}),
    nowIso()
  ).run();
}

function applyInquiryFilters(items, params) {
  const status = String(params.get('status') || '').trim();
  const q = String(params.get('q') || '').trim().toLowerCase();
  const country = String(params.get('country') || '').trim().toLowerCase();
  const product = String(params.get('product') || '').trim().toLowerCase();
  const rfqLevel = String(params.get('rfqLevel') || '').trim().toLowerCase();
  const priority = String(params.get('priority') || '').trim().toLowerCase();
  const sla = String(params.get('sla') || '').trim().toLowerCase();
  return items.filter((item) => {
    if (status && item.status !== status) return false;
    if (country && !String(item.contact?.country || '').toLowerCase().includes(country)) return false;
    if (product && !String(item.product || '').toLowerCase().includes(product)) return false;
    if (rfqLevel && item.rfqCompleteness.level !== rfqLevel) return false;
    if (priority && item.priority !== priority) return false;
    if (sla === 'breached' && !item.sla.breached) return false;
    if (q) {
      const targets = [item.id, item.contact?.name, item.contact?.email, item.contact?.company, item.contact?.country, item.product, item.message]
        .map((value) => String(value || '').toLowerCase());
      return targets.some((value) => value.includes(q));
    }
    return true;
  });
}

function applyInquirySort(items, sortBy) {
  const sort = String(sortBy || 'created_desc');
  const sorted = [...items];
  if (sort === 'created_asc') return sorted.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  if (sort === 'rfq_desc') return sorted.sort((a, b) => b.rfqCompleteness.percent - a.rfqCompleteness.percent || new Date(b.createdAt) - new Date(a.createdAt));
  if (sort === 'rfq_asc') return sorted.sort((a, b) => a.rfqCompleteness.percent - b.rfqCompleteness.percent || new Date(b.createdAt) - new Date(a.createdAt));
  if (sort === 'priority_desc') {
    const rank = { high: 3, medium: 2, low: 1 };
    return sorted.sort((a, b) => (rank[b.priority] - rank[a.priority]) || new Date(b.createdAt) - new Date(a.createdAt));
  }
  if (sort === 'sla_desc') {
    return sorted.sort((a, b) => {
      if (a.sla.breached !== b.sla.breached) return a.sla.breached ? -1 : 1;
      return b.sla.overdueHours - a.sla.overdueHours;
    });
  }
  return sorted.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

async function loadAllInquiries(env) {
  const { results } = await env.DB.prepare('SELECT * FROM inquiries ORDER BY created_at DESC').all();
  return (results || []).map(normalizeInquiry);
}

async function handleHealth() {
  return json({ ok: true, service: 'greensmart-api', runtime: 'cloudflare-pages-functions', time: nowIso() });
}

async function handlePublicConfig(env) {
  const turnstileSiteKey = String(env.TURNSTILE_SITE_KEY || '').trim();
  if (!turnstileSiteKey) {
    return json({ ok: false, error: 'Public security configuration is incomplete.' }, { status: 503 });
  }
  return json({ ok: true, turnstileSiteKey });
}

async function handleCreateInquiry(request, env, waitUntil) {
  const limited = await checkRateLimit(env, request, 'inquiry', 10, 15 * 60);
  if (limited) return limited;

  const bodyResult = await readInquiryBody(request);
  if (bodyResult.response) return bodyResult.response;
  const payload = bodyResult.payload;

  if (String(payload.website || '').trim()) {
    return json({ ok: true, status: 'new', message: 'Inquiry received.' }, { status: 201 });
  }

  const validationError = validateInquiryPayload(payload);
  if (validationError) return json({ ok: false, error: validationError }, { status: 400 });

  const turnstileError = await verifyTurnstile(env, request, payload['cf-turnstile-response']);
  if (turnstileError) return turnstileError;

  const safeEmail = String(payload.email).trim().toLowerCase();
  const safeName = String(payload.name).trim();
  const safeCountry = String(payload.country).trim();
  const safePhone = String(payload.phone || '').trim();
  const safeCompany = String(payload.company || '').trim();
  const safeMessage = String(payload.message).trim();
  const now = nowIso();

  const existingCustomer = await env.DB.prepare('SELECT * FROM customers WHERE email = ?').bind(safeEmail).first();
  let customerId = existingCustomer?.id;
  if (!customerId) {
    customerId = newId('cust');
    await env.DB.prepare(`
      INSERT INTO customers (id, email, name, phone, company, country, source, inquiry_count, created_at, updated_at, last_inquiry_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
    `).bind(customerId, safeEmail, safeName, safePhone, safeCompany, safeCountry, payload.source || 'website', now, now, now).run();
  } else {
    await env.DB.prepare(`
      UPDATE customers
      SET name = ?, phone = COALESCE(NULLIF(?, ''), phone), company = COALESCE(NULLIF(?, ''), company),
          country = COALESCE(NULLIF(?, ''), country), inquiry_count = inquiry_count + 1,
          updated_at = ?, last_inquiry_at = ?
      WHERE id = ?
    `).bind(safeName, safePhone, safeCompany, safeCountry, now, now, customerId).run();
  }

  const settings = await getSettings(env);
  const users = await env.DB.prepare('SELECT id, email, name, role FROM users').all();
  const preview = {
    product: String(payload.product || ''),
    quantity: String(payload.quantity || ''),
    oem: String(payload.oem || ''),
    port: String(payload.port || ''),
    deadline: String(payload.deadline || ''),
    message: safeMessage,
    contact: { name: safeName, email: safeEmail, phone: safePhone, company: safeCompany, country: safeCountry }
  };
  const rfq = computeRfqCompleteness(preview);
  let assigneeId = settings.defaultAssigneeId || null;
  if (!assigneeId && rfq.level === 'high') {
    const candidate = (users.results || []).find((user) => user.role === 'sales') || (users.results || []).find((user) => user.role === 'admin');
    assigneeId = candidate?.id || null;
  }

  const inquiryId = newId('inq');
  const timeline = [{ at: now, type: 'created', note: 'Inquiry submitted from website form.' }];
  if (assigneeId) timeline.push({ at: now, type: 'assigned', note: `Auto assigned to ${assigneeId}.` });
  if (rfq.level === 'high') timeline.push({ at: now, type: 'priority', note: 'High-priority RFQ detected.' });

  await env.DB.prepare(`
    INSERT INTO inquiries (
      id, customer_id, status, assignee_id, lang, source, page_url, product, quantity, oem,
      port, deadline, message, contact_json, timeline_json, quotes_json, created_at, updated_at
    ) VALUES (?, ?, 'new', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?)
  `).bind(
    inquiryId,
    customerId,
    assigneeId,
    payload.lang || 'en',
    payload.source || 'website',
    payload.pageUrl || '',
    payload.product || '',
    payload.quantity || '',
    payload.oem || '',
    payload.port || '',
    payload.deadline || '',
    safeMessage,
    JSON.stringify(preview.contact),
    JSON.stringify(timeline),
    now,
    now
  ).run();

  await appendActivityLog(env, {
    type: 'inquiry.created',
    targetId: inquiryId,
    payload: { email: safeEmail, product: payload.product || '', country: safeCountry }
  });

  const assignee = assigneeId
    ? (users.results || []).find((user) => user.id === assigneeId)
    : null;
  const notifyEmail = resolveNotifyEmail(env, settings);
  const mailTask = notifyNewInquiry(env, {
    inquiryId,
    product: payload.product || '',
    source: payload.source || 'website',
    message: safeMessage,
    contact: preview.contact,
    notifyEmail,
    assigneeEmail: assignee?.email || ''
  }).then(async (mailResult) => {
    await appendActivityLog(env, {
      type: 'mail.inquiry_notify',
      targetId: inquiryId,
      payload: { notifyEmail, ...mailResult }
    });
    return mailResult;
  });
  scheduleMailTask(waitUntil, mailTask);

  return json({ ok: true, inquiryId, status: 'new', message: 'Inquiry received.' }, { status: 201 });
}

async function handleLogin(request, env) {
  const limited = await checkRateLimit(env, request, 'login', 8, 15 * 60);
  if (limited) return limited;
  const body = await readBody(request);
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (!email || !password) {
    return json({ ok: false, error: 'Email and password are required.' }, { status: 400 });
  }
  const user = await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
  if (!user || user.password_hash !== await sha256Hex(password)) {
    return json({ ok: false, error: 'Invalid credentials.' }, { status: 401 });
  }
  const token = await createToken({ sub: user.id, role: user.role, email: user.email, name: user.name }, env);
  await appendActivityLog(env, { type: 'auth.login', actorId: user.id, payload: { email: user.email } });
  return json({ ok: true, user: { id: user.id, email: user.email, role: user.role, name: user.name } }, {
    headers: { 'Set-Cookie': sessionCookie(request, token) }
  });
}

function handleLogout(request) {
  return json({ ok: true }, { headers: { 'Set-Cookie': expiredSessionCookie(request) } });
}

async function handleUsers(env) {
  const { results } = await env.DB.prepare('SELECT id, email, name, role FROM users ORDER BY created_at ASC').all();
  return json({ ok: true, items: results || [] });
}

async function handleSettings(request, env) {
  if (request.method === 'GET') {
    return json({ ok: true, item: await getSettings(env) });
  }
  const body = await readBody(request);
  const settings = await getSettings(env);
  if (typeof body.notifyEmail === 'string') {
    const normalized = body.notifyEmail.trim().toLowerCase();
    if (normalized && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
      return json({ ok: false, error: 'Invalid notifyEmail format.' }, { status: 400 });
    }
    settings.notifyEmail = normalized;
  }
  if (typeof body.defaultAssigneeId === 'string') {
    const normalized = body.defaultAssigneeId.trim();
    if (normalized) {
      const user = await env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(normalized).first();
      if (!user) return json({ ok: false, error: 'defaultAssigneeId does not exist.' }, { status: 400 });
    }
    settings.defaultAssigneeId = normalized || null;
  }
  const now = nowIso();
  await env.DB.prepare('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)')
    .bind('notifyEmail', settings.notifyEmail || '', now).run();
  await env.DB.prepare('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)')
    .bind('defaultAssigneeId', settings.defaultAssigneeId || '', now).run();
  return json({ ok: true, item: settings });
}

async function handleDashboard(env) {
  const inquiries = await loadAllInquiries(env);
  const now = Date.now();
  const byStatus = { new: 0, contacted: 0, quoted: 0, won: 0, lost: 0 };
  const byPriority = { high: 0, medium: 0, low: 0 };
  const byCountry = {};
  const byProduct = {};
  const byPage = {};
  let slaBreachedOpen = 0;
  for (const item of inquiries) {
    if (byStatus[item.status] !== undefined) byStatus[item.status] += 1;
    byPriority[item.priority] = (byPriority[item.priority] || 0) + 1;
    if (item.sla.breached) slaBreachedOpen += 1;
    const country = item.contact?.country || 'unknown';
    const product = item.product || 'unknown';
    const page = item.pageUrl || `/product/${product}`;
    byCountry[country] = (byCountry[country] || 0) + 1;
    byProduct[product] = (byProduct[product] || 0) + 1;
    byPage[page] = byPage[page] || { page, total: 0, quoted: 0, won: 0 };
    byPage[page].total += 1;
    if (item.status === 'quoted') byPage[page].quoted += 1;
    if (item.status === 'won') byPage[page].won += 1;
  }
  const recent7d = inquiries.filter((item) => new Date(item.createdAt).getTime() >= now - 7 * 24 * 3600 * 1000).length;
  const recent30d = inquiries.filter((item) => new Date(item.createdAt).getTime() >= now - 30 * 24 * 3600 * 1000).length;
  const topCountries = Object.entries(byCountry).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([country, count]) => ({ country, count }));
  const topProducts = Object.entries(byProduct).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([product, count]) => ({ product, count }));
  const topPages = Object.values(byPage).sort((a, b) => b.total - a.total).slice(0, 10);
  const highIntentPages = topPages.filter((item) => item.total >= 2 && (item.quoted > 0 || item.won > 0)).slice(0, 5);
  return json({ ok: true, item: { total: inquiries.length, recent7d, recent30d, byStatus, byPriority, slaBreachedOpen, topCountries, topProducts, topPages, highIntentPages } });
}

async function handleInquiriesList(request, env) {
  const url = new URL(request.url);
  const page = Math.max(1, Number.parseInt(url.searchParams.get('page') || '1', 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(url.searchParams.get('pageSize') || '20', 10) || 20));
  const filtered = applyInquiryFilters(await loadAllInquiries(env), url.searchParams);
  const sorted = applyInquirySort(filtered, url.searchParams.get('sort'));
  const offset = (page - 1) * pageSize;
  return json({ ok: true, items: sorted.slice(offset, offset + pageSize), page, pageSize, total: sorted.length });
}

async function handleInquiriesExport(request, env) {
  const url = new URL(request.url);
  const sorted = applyInquirySort(applyInquiryFilters(await loadAllInquiries(env), url.searchParams), url.searchParams.get('sort'));
  const header = ['id', 'createdAt', 'updatedAt', 'status', 'assigneeId', 'lang', 'source', 'pageUrl', 'name', 'email', 'phone', 'company', 'country', 'product', 'quantity', 'oem', 'port', 'deadline', 'message', 'rfqScore', 'rfqPercent', 'rfqLevel', 'rfqMissingFields', 'priority', 'slaBreached', 'slaOverdueHours'];
  const rows = sorted.map((item) => [item.id, item.createdAt, item.updatedAt, item.status, item.assigneeId || '', item.lang, item.source, item.pageUrl, item.contact?.name || '', item.contact?.email || '', item.contact?.phone || '', item.contact?.company || '', item.contact?.country || '', item.product, item.quantity, item.oem, item.port, item.deadline, item.message, item.rfqCompleteness.score, item.rfqCompleteness.percent, item.rfqCompleteness.level, item.rfqCompleteness.missingFields.join('|'), item.priority, item.sla.breached ? 'yes' : 'no', item.sla.overdueHours]);
  const body = [header, ...rows].map((row) => row.map(toCsvCell).join(',')).join('\n');
  const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  return csv(body, `inquiries-${timestamp}.csv`);
}

async function getInquiry(env, inquiryId) {
  const row = await env.DB.prepare('SELECT * FROM inquiries WHERE id = ?').bind(inquiryId).first();
  return normalizeInquiry(row);
}

async function saveInquiryJson(env, inquiry) {
  await env.DB.prepare(`
    UPDATE inquiries
    SET status = ?, assignee_id = ?, timeline_json = ?, quotes_json = ?, updated_at = ?
    WHERE id = ?
  `).bind(
    inquiry.status,
    inquiry.assigneeId || null,
    JSON.stringify(inquiry.timeline || []),
    JSON.stringify(inquiry.quotes || []),
    inquiry.updatedAt,
    inquiry.id
  ).run();
}

async function handleInquiryDetail(env, inquiryId) {
  const inquiry = await getInquiry(env, inquiryId);
  if (!inquiry) return json({ ok: false, error: 'Inquiry not found.' }, { status: 404 });
  return json({ ok: true, item: inquiry });
}

async function handleCreateQuote(request, env, auth, inquiryId) {
  const inquiry = await getInquiry(env, inquiryId);
  if (!inquiry) return json({ ok: false, error: 'Inquiry not found.' }, { status: 404 });
  const body = await readBody(request);
  const unitPrice = Number(body.unitPrice);
  if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
    return json({ ok: false, error: 'unitPrice must be a positive number.' }, { status: 400 });
  }
  const currency = String(body.currency || 'USD').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    return json({ ok: false, error: 'currency must be a 3-letter code.' }, { status: 400 });
  }
  const quote = {
    id: newId('quote'),
    quoteNo: `Q-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(1000 + Math.random() * 9000)}`,
    currency,
    unitPrice,
    moq: String(body.moq || '').trim(),
    incoterm: String(body.incoterm || '').trim().toUpperCase(),
    validityDays: Math.max(1, Math.min(180, Number.parseInt(String(body.validityDays || '30'), 10) || 30)),
    note: String(body.note || '').trim(),
    createdBy: auth.sub,
    createdAt: nowIso()
  };
  inquiry.quotes = Array.isArray(inquiry.quotes) ? inquiry.quotes : [];
  inquiry.quotes.push(quote);
  inquiry.timeline.push({ at: nowIso(), type: 'quote', actorId: auth.sub, note: `Quote ${quote.quoteNo} created (${currency} ${unitPrice}).` });
  inquiry.status = inquiry.status === 'new' || inquiry.status === 'contacted' ? 'quoted' : inquiry.status;
  inquiry.updatedAt = nowIso();
  await saveInquiryJson(env, inquiry);
  await appendActivityLog(env, { type: 'quote.created', actorId: auth.sub, targetId: inquiry.id, payload: { quoteNo: quote.quoteNo, currency, unitPrice } });
  return json({ ok: true, item: quote }, { status: 201 });
}

async function handlePatchInquiry(request, env, auth, inquiryId, waitUntil) {
  const inquiry = await getInquiry(env, inquiryId);
  if (!inquiry) return json({ ok: false, error: 'Inquiry not found.' }, { status: 404 });
  const body = await readBody(request);
  const oldAssigneeId = inquiry.assigneeId;
  let changed = false;
  if (body.status) {
    if (!STATUS_VALUES.has(body.status)) return json({ ok: false, error: 'Invalid status value.' }, { status: 400 });
    inquiry.status = body.status;
    changed = true;
  }
  if (typeof body.assigneeId === 'string') {
    const assigneeId = body.assigneeId.trim();
    if (assigneeId) {
      const user = await env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(assigneeId).first();
      if (!user) return json({ ok: false, error: 'Assignee does not exist.' }, { status: 400 });
    }
    inquiry.assigneeId = assigneeId || null;
    changed = true;
  }
  if (typeof body.note === 'string' && body.note.trim()) {
    inquiry.timeline.push({ at: nowIso(), type: 'note', actorId: auth.sub, note: body.note.trim().slice(0, 1000) });
    changed = true;
  }
  if (!changed) return json({ ok: false, error: 'No updatable fields provided.' }, { status: 400 });
  inquiry.updatedAt = nowIso();
  await saveInquiryJson(env, inquiry);
  await appendActivityLog(env, { type: 'inquiry.updated', actorId: auth.sub, targetId: inquiry.id, payload: { status: inquiry.status, assigneeId: inquiry.assigneeId || '' } });

  if (inquiry.assigneeId && inquiry.assigneeId !== oldAssigneeId) {
    const assignee = await env.DB.prepare('SELECT email FROM users WHERE id = ?').bind(inquiry.assigneeId).first();
    const mailTask = notifyInquiryAssigned(env, {
      inquiryId: inquiry.id,
      product: inquiry.product,
      contact: inquiry.contact,
      status: inquiry.status,
      assigneeEmail: assignee?.email || ''
    }).then(async (mailResult) => {
      await appendActivityLog(env, {
        type: 'mail.inquiry_assigned',
        actorId: auth.sub,
        targetId: inquiry.id,
        payload: mailResult
      });
      return mailResult;
    });
    scheduleMailTask(waitUntil, mailTask);
  }

  return json({ ok: true, item: inquiry });
}

async function handleMailStatus(env) {
  const settings = await getSettings(env);
  const notifyEmail = resolveNotifyEmail(env, settings);
  return json({
    ok: true,
    item: {
      resendConfigured: Boolean(env.RESEND_API_KEY),
      mailFrom: String(env.MAIL_FROM || '').trim() || null,
      notifyEmail: notifyEmail || null,
      envNotifyEmail: String(env.NOTIFY_EMAIL || '').trim() || null,
      envAdminEmail: String(env.ADMIN_EMAIL || '').trim() || null
    }
  });
}

async function handleMailTest(env) {
  try {
    const settings = await getSettings(env);
    const notifyEmail = resolveNotifyEmail(env, settings);
    if (!notifyEmail) {
      return json({ ok: false, error: 'No notify email configured. Set NOTIFY_EMAIL or update admin settings.' }, { status: 400 });
    }
    const result = await sendEmailViaResend(env, {
      to: notifyEmail,
      subject: '[GreenSmart] Resend test email',
      text: [
        'This is a test email from GreenSmart inquiry notifications.',
        '',
        `Time: ${nowIso()}`,
        `Notify email: ${notifyEmail}`,
        `Mail from: ${String(env.MAIL_FROM || '').trim() || '(not set)'}`
      ].join('\n')
    });
    try {
      await appendActivityLog(env, {
        type: 'mail.test',
        payload: { notifyEmail, ...result }
      });
    } catch (logError) {
      console.error('[mail] failed to write activity log:', logError);
    }
    if (!result.ok) {
      const error = String(result.error || 'Resend rejected the email request.');
      return json({ ok: false, error, item: result }, { status: 400 });
    }
    return json({ ok: true, message: `Test email sent to ${notifyEmail}.`, item: result });
  } catch (error) {
    console.error('[mail] handleMailTest failed:', error);
    return json({ ok: false, error: String(error?.message || error) }, { status: 500 });
  }
}

async function routeAdmin(request, env, path, waitUntil) {
  if (path === '/api/admin/auth/login' && request.method === 'POST') {
    await ensureBootstrap(env);
    return handleLogin(request, env);
  }
  if (path === '/api/admin/auth/logout' && request.method === 'POST') {
    return handleLogout(request);
  }

  const authResult = await requireAuth(request, env, ['admin', 'sales']);
  if (authResult.response) return authResult.response;
  const auth = authResult.auth;

  if (path === '/api/admin/auth/me' && request.method === 'GET') {
    return json({ ok: true, user: { id: auth.sub, email: auth.email, role: auth.role, name: auth.name } });
  }
  if (path === '/api/admin/users' && request.method === 'GET') return handleUsers(env);
  if (path === '/api/admin/dashboard/summary' && request.method === 'GET') return handleDashboard(env);

  if (path === '/api/admin/settings') {
    if (auth.role !== 'admin') return json({ ok: false, error: 'Forbidden.' }, { status: 403 });
    if (request.method === 'GET' || request.method === 'PATCH') return handleSettings(request, env);
  }

  if (path === '/api/admin/mail/status' && request.method === 'GET') {
    if (auth.role !== 'admin') return json({ ok: false, error: 'Forbidden.' }, { status: 403 });
    return handleMailStatus(env);
  }

  if (path === '/api/admin/mail/test' && request.method === 'POST') {
    if (auth.role !== 'admin') return json({ ok: false, error: 'Forbidden.' }, { status: 403 });
    return handleMailTest(env);
  }

  if (path === '/api/admin/inquiries' && request.method === 'GET') return handleInquiriesList(request, env);
  if (path === '/api/admin/inquiries/export.csv' && request.method === 'GET') return handleInquiriesExport(request, env);

  const quoteMatch = path.match(/^\/api\/admin\/inquiries\/([^/]+)\/quotes$/);
  if (quoteMatch) {
    if (request.method === 'GET') {
      const inquiry = await getInquiry(env, decodeURIComponent(quoteMatch[1]));
      if (!inquiry) return json({ ok: false, error: 'Inquiry not found.' }, { status: 404 });
      return json({ ok: true, items: inquiry.quotes || [] });
    }
    if (request.method === 'POST') return handleCreateQuote(request, env, auth, decodeURIComponent(quoteMatch[1]));
  }

  const inquiryMatch = path.match(/^\/api\/admin\/inquiries\/([^/]+)$/);
  if (inquiryMatch) {
    if (request.method === 'GET') return handleInquiryDetail(env, decodeURIComponent(inquiryMatch[1]));
    if (request.method === 'PATCH') return handlePatchInquiry(request, env, auth, decodeURIComponent(inquiryMatch[1]), waitUntil);
  }

  return json({ ok: false, error: 'Not found.' }, { status: 404 });
}

export async function onRequest(context) {
  const { request, env, waitUntil } = context;
  if (!env.DB) {
    return json({ ok: false, error: 'D1 binding DB is not configured.' }, { status: 500 });
  }
  const securityIssues = getSecurityConfigIssues(env);
  if (securityIssues.length) {
    console.error(`[config] Missing or insecure values: ${securityIssues.join(', ')}`);
    return json({ ok: false, error: 'Server security configuration is incomplete.' }, { status: 500 });
  }

  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';

  if (path === '/api/health' && request.method === 'GET') return handleHealth();
  if (path === '/api/public-config' && request.method === 'GET') return handlePublicConfig(env);
  if (path === '/api/inquiries' && request.method === 'POST') return handleCreateInquiry(request, env, waitUntil);
  if (path.startsWith('/api/admin/')) return routeAdmin(request, env, path, waitUntil);
  return json({ ok: false, error: 'Not found.' }, { status: 404 });
}
