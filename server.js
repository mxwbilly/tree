require('dotenv').config();

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');

const PORT = Number(process.env.PORT || 8000);
const HOST = process.env.HOST || '0.0.0.0';
const ROOT_DIR = __dirname;
const STATIC_DIR = path.resolve(ROOT_DIR, process.env.STATIC_DIR || ROOT_DIR);
const DATA_DIR = path.resolve(ROOT_DIR, process.env.DATA_DIR || 'data');
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret-in-production';
const TOKEN_EXPIRES_IN = '12h';

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@novagardenhome.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'ChangeMe123!';
const ADMIN_NAME = process.env.ADMIN_NAME || 'Default Admin';
const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL || ADMIN_EMAIL;

const DATA_FILES = {
  users: path.join(DATA_DIR, 'users.json'),
  customers: path.join(DATA_DIR, 'customers.json'),
  inquiries: path.join(DATA_DIR, 'inquiries.json'),
  activityLogs: path.join(DATA_DIR, 'activity_logs.json'),
  settings: path.join(DATA_DIR, 'settings.json')
};

const loginRateState = new Map();
const inquiryRateState = new Map();
let transporter = null;

function nowIso() {
  return new Date().toISOString();
}

function newId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function parseBearerToken(headerValue) {
  if (!headerValue || typeof headerValue !== 'string') {
    return '';
  }
  const [scheme, token] = headerValue.split(' ');
  return scheme?.toLowerCase() === 'bearer' ? token : '';
}

function toCsvCell(value) {
  const text = String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
}

function hasText(value) {
  return String(value || '').trim().length > 0;
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
      if (messageLength >= 30) {
        score += item.weight;
      } else if (messageLength >= 10) {
        score += 10;
      }
      continue;
    }
    if (item.pass) {
      score += item.weight;
    }
  }
  const percent = Math.round((score / maxScore) * 100);
  const level = percent >= 85 ? 'high' : percent >= 70 ? 'medium' : 'low';
  const missingFields = rules.filter((item) => {
    if (item.key === 'message') {
      return messageLength < 10;
    }
    return !item.pass;
  }).map((item) => item.key);
  const filledFields = rules
    .map((item) => item.key)
    .filter((key) => !missingFields.includes(key));
  return {
    score,
    maxScore,
    percent,
    level,
    missingFields,
    filledFields
  };
}

function getPriorityLevelByRfqPercent(percent) {
  if (percent >= 85) return 'high';
  if (percent >= 70) return 'medium';
  return 'low';
}

function computeSlaState(inquiry, nowMs = Date.now()) {
  const terminal = new Set(['won', 'lost']);
  if (terminal.has(String(inquiry?.status || ''))) {
    return { breached: false, overdueHours: 0, thresholdHours: 24 };
  }
  const parsedTs = new Date(inquiry?.updatedAt || inquiry?.createdAt || nowIso()).getTime();
  const anchorTs = Number.isFinite(parsedTs) ? parsedTs : nowMs;
  const elapsedHours = Math.max(0, (nowMs - anchorTs) / (1000 * 60 * 60));
  const overdueHours = Math.max(0, Math.floor(elapsedHours - 24));
  return {
    breached: elapsedHours > 24,
    overdueHours,
    thresholdHours: 24
  };
}

function withRfqCompleteness(inquiry) {
  const rfq = computeRfqCompleteness(inquiry);
  return {
    ...inquiry,
    rfqCompleteness: rfq,
    priority: getPriorityLevelByRfqPercent(rfq.percent),
    sla: computeSlaState(inquiry)
  };
}

function buildInquiryMailSubject(prefix, product, country, inquiryId) {
  const safeProduct = String(product || 'unknown-product').trim() || 'unknown-product';
  const safeCountry = String(country || 'unknown-country').trim() || 'unknown-country';
  return `[GreenSmart] ${prefix} ${safeProduct} | ${safeCountry} | ${inquiryId}`;
}

function isTruthy(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').toLowerCase());
}

function getTransporter() {
  if (transporter) {
    return transporter;
  }
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
    return null;
  }
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: isTruthy(process.env.SMTP_SECURE),
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
  return transporter;
}

async function sendEmail({ to, subject, text, html }) {
  const mailer = getTransporter();
  const fromAddress = process.env.SMTP_FROM || process.env.SMTP_USER || ADMIN_EMAIL;
  if (!mailer) {
    console.warn('[mail] skipped (smtp not configured):', subject);
    return false;
  }
  await mailer.sendMail({
    from: fromAddress,
    to,
    subject,
    text,
    html
  });
  return true;
}

function createRateLimiter(store, options) {
  const windowMs = options.windowMs;
  const limit = options.limit;
  const label = options.label || 'request';
  return (req, res, next) => {
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const row = store.get(key) || { count: 0, windowStart: now };
    if (now - row.windowStart > windowMs) {
      row.count = 0;
      row.windowStart = now;
    }
    row.count += 1;
    store.set(key, row);
    if (row.count > limit) {
      return res.status(429).json({ ok: false, error: `Too many ${label} requests. Please retry later.` });
    }
    return next();
  };
}

async function ensureFile(filePath, defaultData) {
  if (!fs.existsSync(filePath)) {
    await fsp.writeFile(filePath, JSON.stringify(defaultData, null, 2), 'utf8');
  }
}

async function readJson(filePath) {
  const raw = await fsp.readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

async function writeJson(filePath, value) {
  await fsp.writeFile(filePath, JSON.stringify(value, null, 2), 'utf8');
}

async function bootstrapDataStore() {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  const seedAdmin = {
    id: newId('user'),
    email: ADMIN_EMAIL.toLowerCase(),
    name: ADMIN_NAME,
    role: 'admin',
    passwordHash: bcrypt.hashSync(ADMIN_PASSWORD, 10),
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  await ensureFile(DATA_FILES.users, [seedAdmin]);
  await ensureFile(DATA_FILES.customers, []);
  await ensureFile(DATA_FILES.inquiries, []);
  await ensureFile(DATA_FILES.activityLogs, []);
  await ensureFile(DATA_FILES.settings, {
    notifyEmail: NOTIFY_EMAIL,
    defaultAssigneeId: null
  });
}

async function appendActivityLog(entry) {
  const logs = await readJson(DATA_FILES.activityLogs);
  logs.push({
    id: newId('log'),
    createdAt: nowIso(),
    ...entry
  });
  await writeJson(DATA_FILES.activityLogs, logs);
}

function createApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  function applyInquiryFilters(inquiries, filters) {
    const statusFilter = String(filters.status || '').trim();
    const keywordFilter = String(filters.q || '').trim().toLowerCase();
    const countryFilter = String(filters.country || '').trim().toLowerCase();
    const productFilter = String(filters.product || '').trim().toLowerCase();
    const rfqLevelFilter = String(filters.rfqLevel || '').trim().toLowerCase();
    const priorityFilter = String(filters.priority || '').trim().toLowerCase();
    const slaFilter = String(filters.sla || '').trim().toLowerCase();
    const dateFrom = String(filters.from || '').trim();
    const dateTo = String(filters.to || '').trim();

    return inquiries.filter((item) => {
      if (statusFilter && item.status !== statusFilter) {
        return false;
      }
      if (countryFilter && !String(item.contact?.country || '').toLowerCase().includes(countryFilter)) {
        return false;
      }
      if (productFilter && !String(item.product || '').toLowerCase().includes(productFilter)) {
        return false;
      }
      if (rfqLevelFilter) {
        const level = computeRfqCompleteness(item).level;
        if (level !== rfqLevelFilter) {
          return false;
        }
      }
      if (priorityFilter) {
        const priority = getPriorityLevelByRfqPercent(computeRfqCompleteness(item).percent);
        if (priority !== priorityFilter) {
          return false;
        }
      }
      if (slaFilter === 'breached') {
        if (!computeSlaState(item).breached) {
          return false;
        }
      }
      if (dateFrom && new Date(item.createdAt) < new Date(dateFrom)) {
        return false;
      }
      if (dateTo && new Date(item.createdAt) > new Date(`${dateTo}T23:59:59.999Z`)) {
        return false;
      }
      if (keywordFilter) {
        const keywordTargets = [
          item.id,
          item.contact?.name,
          item.contact?.email,
          item.contact?.company,
          item.contact?.country,
          item.product,
          item.message
        ].map((value) => String(value || '').toLowerCase());
        return keywordTargets.some((entry) => entry.includes(keywordFilter));
      }
      return true;
    });
  }

  function applyInquirySort(inquiries, sortBy) {
    const sort = String(sortBy || 'created_desc').trim();
    const items = [...inquiries];
    if (sort === 'created_asc') {
      return items.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    }
    if (sort === 'rfq_desc') {
      return items.sort((a, b) => {
        const diff = computeRfqCompleteness(b).percent - computeRfqCompleteness(a).percent;
        if (diff !== 0) return diff;
        return new Date(b.createdAt) - new Date(a.createdAt);
      });
    }
    if (sort === 'rfq_asc') {
      return items.sort((a, b) => {
        const diff = computeRfqCompleteness(a).percent - computeRfqCompleteness(b).percent;
        if (diff !== 0) return diff;
        return new Date(b.createdAt) - new Date(a.createdAt);
      });
    }
    if (sort === 'priority_desc') {
      const rank = { high: 3, medium: 2, low: 1 };
      return items.sort((a, b) => {
        const diff = rank[getPriorityLevelByRfqPercent(computeRfqCompleteness(b).percent)]
          - rank[getPriorityLevelByRfqPercent(computeRfqCompleteness(a).percent)];
        if (diff !== 0) return diff;
        return new Date(b.createdAt) - new Date(a.createdAt);
      });
    }
    if (sort === 'sla_desc') {
      return items.sort((a, b) => {
        const aSla = computeSlaState(a);
        const bSla = computeSlaState(b);
        if (aSla.breached !== bSla.breached) {
          return aSla.breached ? -1 : 1;
        }
        return bSla.overdueHours - aSla.overdueHours;
      });
    }
    return items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  app.get('/api/health', (req, res) => {
    res.json({ ok: true, service: 'greensmart-api', time: nowIso() });
  });

  app.post('/api/admin/auth/login', createRateLimiter(loginRateState, {
    windowMs: 15 * 60 * 1000,
    limit: 12,
    label: 'login'
  }), async (req, res) => {
    try {
      const email = String(req.body?.email || '').trim().toLowerCase();
      const password = String(req.body?.password || '');
      if (!email || !password) {
        return res.status(400).json({ ok: false, error: 'Email and password are required.' });
      }
      const users = await readJson(DATA_FILES.users);
      const user = users.find((item) => item.email === email);
      if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
        return res.status(401).json({ ok: false, error: 'Invalid credentials.' });
      }
      const token = jwt.sign(
        { sub: user.id, role: user.role, email: user.email, name: user.name },
        JWT_SECRET,
        { expiresIn: TOKEN_EXPIRES_IN }
      );
      await appendActivityLog({ type: 'auth.login', actorId: user.id, payload: { email: user.email } });
      return res.json({
        ok: true,
        token,
        user: { id: user.id, email: user.email, role: user.role, name: user.name }
      });
    } catch (error) {
      return res.status(500).json({ ok: false, error: 'Login failed.' });
    }
  });

  async function requireAuth(req, res, next) {
    try {
      const token = parseBearerToken(req.headers.authorization);
      if (!token) {
        return res.status(401).json({ ok: false, error: 'Missing authorization token.' });
      }
      const payload = jwt.verify(token, JWT_SECRET);
      req.auth = payload;
      return next();
    } catch (error) {
      return res.status(401).json({ ok: false, error: 'Invalid or expired token.' });
    }
  }

  function requireRole(...allowedRoles) {
    return (req, res, next) => {
      if (!req.auth || !allowedRoles.includes(req.auth.role)) {
        return res.status(403).json({ ok: false, error: 'Forbidden.' });
      }
      return next();
    };
  }

  app.get('/api/admin/auth/me', requireAuth, (req, res) => {
    res.json({
      ok: true,
      user: {
        id: req.auth.sub,
        email: req.auth.email,
        role: req.auth.role,
        name: req.auth.name
      }
    });
  });

  app.get('/api/admin/settings', requireAuth, requireRole('admin'), async (req, res) => {
    try {
      const settings = await readJson(DATA_FILES.settings);
      return res.json({ ok: true, item: settings });
    } catch (error) {
      return res.status(500).json({ ok: false, error: 'Failed to load settings.' });
    }
  });

  app.patch('/api/admin/settings', requireAuth, requireRole('admin'), async (req, res) => {
    try {
      const body = req.body || {};
      const settings = await readJson(DATA_FILES.settings);
      if (typeof body.notifyEmail === 'string') {
        const normalized = body.notifyEmail.trim().toLowerCase();
        if (normalized && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
          return res.status(400).json({ ok: false, error: 'Invalid notifyEmail format.' });
        }
        settings.notifyEmail = normalized || '';
      }
      if (typeof body.defaultAssigneeId === 'string') {
        const normalized = body.defaultAssigneeId.trim();
        if (!normalized) {
          settings.defaultAssigneeId = null;
        } else {
          const users = await readJson(DATA_FILES.users);
          const exists = users.some((user) => user.id === normalized);
          if (!exists) {
            return res.status(400).json({ ok: false, error: 'defaultAssigneeId does not exist.' });
          }
          settings.defaultAssigneeId = normalized;
        }
      }
      await writeJson(DATA_FILES.settings, settings);
      await appendActivityLog({
        type: 'settings.updated',
        actorId: req.auth.sub,
        payload: {
          notifyEmail: settings.notifyEmail,
          defaultAssigneeId: settings.defaultAssigneeId || ''
        }
      });
      return res.json({ ok: true, item: settings });
    } catch (error) {
      return res.status(500).json({ ok: false, error: 'Failed to update settings.' });
    }
  });

  app.get('/api/admin/users', requireAuth, requireRole('admin', 'sales'), async (req, res) => {
    try {
      const users = await readJson(DATA_FILES.users);
      const items = users.map((user) => ({
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role
      }));
      return res.json({ ok: true, items });
    } catch (error) {
      return res.status(500).json({ ok: false, error: 'Failed to load users.' });
    }
  });

  app.post('/api/inquiries', createRateLimiter(inquiryRateState, {
    windowMs: 15 * 60 * 1000,
    limit: 40,
    label: 'inquiry'
  }), async (req, res) => {
    try {
      const payload = req.body || {};
      const requiredFields = ['name', 'email', 'country', 'message'];
      for (const field of requiredFields) {
        const value = String(payload[field] || '').trim();
        if (!value) {
          return res.status(400).json({ ok: false, error: `${field} is required.` });
        }
      }

      const safeEmail = String(payload.email).trim().toLowerCase();
      const safePhone = String(payload.phone || '').trim();
      const safeName = String(payload.name).trim();
      const safeCountry = String(payload.country).trim();
      const safeMessage = String(payload.message).trim();
      const safeCompany = String(payload.company || '').trim();

      const customers = await readJson(DATA_FILES.customers);
      let customer = customers.find((item) => item.email === safeEmail);
      if (!customer) {
        customer = {
          id: newId('cust'),
          email: safeEmail,
          name: safeName,
          phone: safePhone,
          company: safeCompany,
          country: safeCountry,
          source: String(payload.source || 'website'),
          inquiryCount: 0,
          createdAt: nowIso(),
          updatedAt: nowIso()
        };
        customers.push(customer);
      }
      customer.name = safeName;
      customer.phone = safePhone || customer.phone;
      customer.company = safeCompany || customer.company;
      customer.country = safeCountry || customer.country;
      customer.inquiryCount = Number(customer.inquiryCount || 0) + 1;
      customer.lastInquiryAt = nowIso();
      customer.updatedAt = nowIso();
      await writeJson(DATA_FILES.customers, customers);

      const inquiries = await readJson(DATA_FILES.inquiries);
      const settings = await readJson(DATA_FILES.settings);
      const users = await readJson(DATA_FILES.users);
      const rfqPreview = computeRfqCompleteness({
        product: String(payload.product || ''),
        quantity: String(payload.quantity || ''),
        oem: String(payload.oem || ''),
        port: String(payload.port || ''),
        deadline: String(payload.deadline || ''),
        message: safeMessage,
        contact: {
          name: safeName,
          email: safeEmail,
          phone: safePhone,
          company: safeCompany,
          country: safeCountry
        }
      });
      let autoAssignedByPriority = false;
      let autoAssignedAssigneeId = settings.defaultAssigneeId || null;
      if (!autoAssignedAssigneeId && rfqPreview.level === 'high') {
        const candidate = users.find((user) => user.role === 'sales') || users.find((user) => user.role === 'admin');
        if (candidate) {
          autoAssignedAssigneeId = candidate.id;
          autoAssignedByPriority = true;
        }
      }
      const inquiry = {
        id: newId('inq'),
        customerId: customer.id,
        status: 'new',
        assigneeId: autoAssignedAssigneeId,
        lang: String(payload.lang || 'en'),
        source: String(payload.source || 'website'),
        pageUrl: String(payload.pageUrl || ''),
        product: String(payload.product || ''),
        quantity: String(payload.quantity || ''),
        oem: String(payload.oem || ''),
        port: String(payload.port || ''),
        deadline: String(payload.deadline || ''),
        message: safeMessage,
        contact: {
          name: safeName,
          email: safeEmail,
          phone: safePhone,
          company: safeCompany,
          country: safeCountry
        },
        timeline: [
          {
            at: nowIso(),
            type: 'created',
            note: 'Inquiry submitted from website form.'
          }
        ],
        quotes: [],
        createdAt: nowIso(),
        updatedAt: nowIso()
      };
      if (inquiry.assigneeId) {
        inquiry.timeline.push({
          at: nowIso(),
          type: 'assigned',
          note: `Auto assigned to ${inquiry.assigneeId}.`
        });
      }
      if (rfqPreview.level === 'high') {
        inquiry.timeline.push({
          at: nowIso(),
          type: 'priority',
          note: autoAssignedByPriority
            ? 'High-priority RFQ detected and auto-assigned by rule.'
            : 'High-priority RFQ detected.'
        });
      }
      inquiries.push(inquiry);
      await writeJson(DATA_FILES.inquiries, inquiries);

      await appendActivityLog({
        type: 'inquiry.created',
        actorId: null,
        targetId: inquiry.id,
        payload: {
          email: safeEmail,
          product: inquiry.product,
          country: inquiry.contact.country
        }
      });

      const assignee = inquiry.assigneeId ? users.find((user) => user.id === inquiry.assigneeId) : null;
      const notifyEmail = settings.notifyEmail || NOTIFY_EMAIL;
      await sendEmail({
        to: notifyEmail,
        subject: buildInquiryMailSubject('New inquiry', inquiry.product, safeCountry, inquiry.id),
        text: [
          `Inquiry ID: ${inquiry.id}`,
          `Name: ${safeName}`,
          `Email: ${safeEmail}`,
          `Country: ${safeCountry}`,
          `Product: ${inquiry.product || '-'}`,
          `Message: ${safeMessage}`,
          `Source: ${inquiry.source}`
        ].join('\n')
      });
      if (assignee?.email) {
        await sendEmail({
          to: assignee.email,
          subject: buildInquiryMailSubject('Assigned inquiry', inquiry.product, safeCountry, inquiry.id),
          text: `A new inquiry was assigned to you.\n\nInquiry ID: ${inquiry.id}\nBuyer: ${safeName}\nEmail: ${safeEmail}\nCountry: ${safeCountry}`
        });
      }

      return res.status(201).json({
        ok: true,
        inquiryId: inquiry.id,
        status: inquiry.status,
        message: 'Inquiry received.'
      });
    } catch (error) {
      return res.status(500).json({ ok: false, error: 'Failed to create inquiry.' });
    }
  });

  app.get('/api/admin/dashboard/summary', requireAuth, requireRole('admin', 'sales'), async (req, res) => {
    try {
      const inquiries = await readJson(DATA_FILES.inquiries);
      const now = Date.now();
      const oneDayMs = 24 * 3600 * 1000;
      const sevenDaysAgo = now - 7 * oneDayMs;
      const thirtyDaysAgo = now - 30 * oneDayMs;
      const byStatus = {
        new: 0,
        contacted: 0,
        quoted: 0,
        won: 0,
        lost: 0
      };
      const byPriority = { high: 0, medium: 0, low: 0 };
      let slaBreachedOpen = 0;
      const byCountry = {};
      const byPage = {};
      const byProduct = {};
      for (const inquiry of inquiries) {
        if (byStatus[inquiry.status] !== undefined) {
          byStatus[inquiry.status] += 1;
        }
        const priority = getPriorityLevelByRfqPercent(computeRfqCompleteness(inquiry).percent);
        byPriority[priority] = (byPriority[priority] || 0) + 1;
        if (computeSlaState(inquiry).breached) {
          slaBreachedOpen += 1;
        }
        const country = String(inquiry.contact?.country || 'unknown').trim() || 'unknown';
        const product = String(inquiry.product || 'unknown').trim() || 'unknown';
        const page = String(inquiry.pageUrl || `/product/${product}`).trim() || '/';
        byCountry[country] = (byCountry[country] || 0) + 1;
        byProduct[product] = (byProduct[product] || 0) + 1;
        if (!byPage[page]) {
          byPage[page] = { page, total: 0, quoted: 0, won: 0 };
        }
        byPage[page].total += 1;
        if (inquiry.status === 'quoted') byPage[page].quoted += 1;
        if (inquiry.status === 'won') byPage[page].won += 1;
      }
      const recent7d = inquiries.filter((item) => new Date(item.createdAt).getTime() >= sevenDaysAgo).length;
      const recent30d = inquiries.filter((item) => new Date(item.createdAt).getTime() >= thirtyDaysAgo).length;
      const topCountries = Object.entries(byCountry)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([country, count]) => ({ country, count }));
      const topProducts = Object.entries(byProduct)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([product, count]) => ({ product, count }));
      const topPages = Object.values(byPage)
        .map((entry) => ({
          ...entry,
          quoteRate: entry.total ? Math.round((entry.quoted / entry.total) * 100) : 0,
          winRate: entry.total ? Math.round((entry.won / entry.total) * 100) : 0
        }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 10);
      const highIntentPages = topPages
        .filter((entry) => entry.total >= 2 && (entry.quoted > 0 || entry.won > 0))
        .sort((a, b) => (b.won * 3 + b.quoted) - (a.won * 3 + a.quoted))
        .slice(0, 5);
      return res.json({
        ok: true,
        item: {
          total: inquiries.length,
          recent7d,
          recent30d,
          byStatus,
          byPriority,
          slaBreachedOpen,
          topCountries,
          topProducts,
          topPages,
          highIntentPages
        }
      });
    } catch (error) {
      return res.status(500).json({ ok: false, error: 'Failed to load dashboard summary.' });
    }
  });

  app.get('/api/admin/inquiries', requireAuth, requireRole('admin', 'sales'), async (req, res) => {
    try {
      const page = Math.max(1, Number.parseInt(String(req.query.page || '1'), 10) || 1);
      const pageSize = Math.min(100, Math.max(1, Number.parseInt(String(req.query.pageSize || '20'), 10) || 20));
      const inquiries = await readJson(DATA_FILES.inquiries);
      const filtered = applyInquiryFilters(inquiries, req.query);
      const sorted = applyInquirySort(filtered, req.query.sort);
      const total = sorted.length;
      const offset = (page - 1) * pageSize;
      const items = sorted.slice(offset, offset + pageSize).map(withRfqCompleteness);
      return res.json({ ok: true, items, page, pageSize, total });
    } catch (error) {
      return res.status(500).json({ ok: false, error: 'Failed to load inquiries.' });
    }
  });

  app.get('/api/admin/inquiries/export.csv', requireAuth, requireRole('admin', 'sales'), async (req, res) => {
    try {
      const inquiries = await readJson(DATA_FILES.inquiries);
      const filtered = applyInquiryFilters(inquiries, req.query);
      const sorted = applyInquirySort(filtered, req.query.sort);
      const header = [
        'id', 'createdAt', 'updatedAt', 'status', 'assigneeId', 'lang', 'source', 'pageUrl',
        'name', 'email', 'phone', 'company', 'country', 'product', 'quantity', 'oem', 'port', 'deadline', 'message',
        'rfqScore', 'rfqPercent', 'rfqLevel', 'rfqMissingFields', 'priority', 'slaBreached', 'slaOverdueHours'
      ];
      const rows = sorted.map((item) => {
        const rfq = computeRfqCompleteness(item);
        const priority = getPriorityLevelByRfqPercent(rfq.percent);
        const sla = computeSlaState(item);
        return [
          item.id,
          item.createdAt,
          item.updatedAt,
          item.status,
          item.assigneeId || '',
          item.lang || '',
          item.source || '',
          item.pageUrl || '',
          item.contact?.name || '',
          item.contact?.email || '',
          item.contact?.phone || '',
          item.contact?.company || '',
          item.contact?.country || '',
          item.product || '',
          item.quantity || '',
          item.oem || '',
          item.port || '',
          item.deadline || '',
          item.message || '',
          rfq.score,
          rfq.percent,
          rfq.level,
          rfq.missingFields.join('|'),
          priority,
          sla.breached ? 'yes' : 'no',
          sla.overdueHours
        ];
      });
      const csv = [header, ...rows].map((row) => row.map(toCsvCell).join(',')).join('\n');
      const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="inquiries-${timestamp}.csv"`);
      return res.send(`\uFEFF${csv}`);
    } catch (error) {
      return res.status(500).json({ ok: false, error: 'Failed to export inquiries.' });
    }
  });

  app.get('/api/admin/inquiries/:inquiryId', requireAuth, requireRole('admin', 'sales'), async (req, res) => {
    try {
      const inquiryId = req.params.inquiryId;
      const inquiries = await readJson(DATA_FILES.inquiries);
      const target = inquiries.find((item) => item.id === inquiryId);
      if (!target) {
        return res.status(404).json({ ok: false, error: 'Inquiry not found.' });
      }
      return res.json({ ok: true, item: withRfqCompleteness(target) });
    } catch (error) {
      return res.status(500).json({ ok: false, error: 'Failed to load inquiry.' });
    }
  });

  app.get('/api/admin/inquiries/:inquiryId/quotes', requireAuth, requireRole('admin', 'sales'), async (req, res) => {
    try {
      const inquiryId = req.params.inquiryId;
      const inquiries = await readJson(DATA_FILES.inquiries);
      const target = inquiries.find((item) => item.id === inquiryId);
      if (!target) {
        return res.status(404).json({ ok: false, error: 'Inquiry not found.' });
      }
      return res.json({ ok: true, items: target.quotes || [] });
    } catch (error) {
      return res.status(500).json({ ok: false, error: 'Failed to load quotes.' });
    }
  });

  app.post('/api/admin/inquiries/:inquiryId/quotes', requireAuth, requireRole('admin', 'sales'), async (req, res) => {
    try {
      const inquiryId = req.params.inquiryId;
      const body = req.body || {};
      const unitPrice = Number(body.unitPrice);
      if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
        return res.status(400).json({ ok: false, error: 'unitPrice must be a positive number.' });
      }
      const currency = String(body.currency || 'USD').trim().toUpperCase();
      if (!/^[A-Z]{3}$/.test(currency)) {
        return res.status(400).json({ ok: false, error: 'currency must be a 3-letter code.' });
      }
      const validityDays = Math.max(1, Math.min(180, Number.parseInt(String(body.validityDays || '30'), 10) || 30));
      const moq = String(body.moq || '').trim();
      const incoterm = String(body.incoterm || '').trim().toUpperCase();
      const note = String(body.note || '').trim();
      if (note.length > 1000) {
        return res.status(400).json({ ok: false, error: 'Quote note exceeds 1000 characters.' });
      }
      const inquiries = await readJson(DATA_FILES.inquiries);
      const target = inquiries.find((item) => item.id === inquiryId);
      if (!target) {
        return res.status(404).json({ ok: false, error: 'Inquiry not found.' });
      }
      const quote = {
        id: newId('quote'),
        quoteNo: `Q-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${crypto.randomInt(1000, 10000)}`,
        currency,
        unitPrice,
        moq,
        incoterm,
        validityDays,
        note,
        createdBy: req.auth.sub,
        createdAt: nowIso()
      };
      target.quotes = Array.isArray(target.quotes) ? target.quotes : [];
      target.quotes.push(quote);
      target.timeline = Array.isArray(target.timeline) ? target.timeline : [];
      target.timeline.push({
        at: nowIso(),
        type: 'quote',
        actorId: req.auth.sub,
        note: `Quote ${quote.quoteNo} created (${currency} ${unitPrice}).`
      });
      target.updatedAt = nowIso();
      await writeJson(DATA_FILES.inquiries, inquiries);
      await appendActivityLog({
        type: 'quote.created',
        actorId: req.auth.sub,
        targetId: target.id,
        payload: { quoteNo: quote.quoteNo, currency, unitPrice }
      });
      return res.status(201).json({ ok: true, item: quote });
    } catch (error) {
      return res.status(500).json({ ok: false, error: 'Failed to create quote.' });
    }
  });

  app.patch('/api/admin/inquiries/:inquiryId', requireAuth, requireRole('admin', 'sales'), async (req, res) => {
    try {
      const inquiryId = req.params.inquiryId;
      const body = req.body || {};
      const allowedStatuses = new Set(['new', 'contacted', 'quoted', 'won', 'lost']);
      const inquiries = await readJson(DATA_FILES.inquiries);
      const target = inquiries.find((item) => item.id === inquiryId);
      if (!target) {
        return res.status(404).json({ ok: false, error: 'Inquiry not found.' });
      }

      const oldAssigneeId = target.assigneeId || null;
      if (body.status) {
        if (!allowedStatuses.has(body.status)) {
          return res.status(400).json({ ok: false, error: 'Invalid status value.' });
        }
        target.status = body.status;
      }
      if (typeof body.assigneeId === 'string') {
        const normalizedAssigneeId = body.assigneeId.trim();
        if (!normalizedAssigneeId) {
          target.assigneeId = null;
        } else {
          const users = await readJson(DATA_FILES.users);
          const exists = users.some((user) => user.id === normalizedAssigneeId);
          if (!exists) {
            return res.status(400).json({ ok: false, error: 'Assignee does not exist.' });
          }
          target.assigneeId = normalizedAssigneeId;
        }
      }
      let noteAdded = false;
      if (typeof body.note === 'string' && body.note.trim()) {
        if (body.note.trim().length > 1000) {
          return res.status(400).json({ ok: false, error: 'Note exceeds 1000 characters.' });
        }
        noteAdded = true;
        target.timeline.push({
          at: nowIso(),
          type: 'note',
          actorId: req.auth.sub,
          note: body.note.trim()
        });
      }

      if (!body.status && typeof body.assigneeId === 'undefined' && !noteAdded) {
        return res.status(400).json({ ok: false, error: 'No updatable fields provided.' });
      }

      target.updatedAt = nowIso();
      await writeJson(DATA_FILES.inquiries, inquiries);

      if (target.assigneeId !== oldAssigneeId) {
        const users = await readJson(DATA_FILES.users);
        const assignee = users.find((user) => user.id === target.assigneeId);
        if (assignee?.email) {
          await sendEmail({
            to: assignee.email,
            subject: buildInquiryMailSubject('Inquiry assigned', target.product, target.contact?.country, target.id),
            text: `You were assigned inquiry ${target.id}.\nBuyer: ${target.contact?.name || ''}\nEmail: ${target.contact?.email || ''}\nStatus: ${target.status}`
          });
        }
      }

      await appendActivityLog({
        type: 'inquiry.updated',
        actorId: req.auth.sub,
        targetId: target.id,
        payload: { status: target.status, assigneeId: target.assigneeId || '' }
      });
      return res.json({ ok: true, item: target });
    } catch (error) {
      return res.status(500).json({ ok: false, error: 'Failed to update inquiry.' });
    }
  });

  app.use(express.static(STATIC_DIR, {
    extensions: ['html'],
    dotfiles: 'deny',
    index: 'index.html'
  }));
  app.get('*', (req, res) => {
    res.status(404).sendFile(path.join(STATIC_DIR, '404.html'));
  });

  return app;
}

async function startServer() {
  await bootstrapDataStore();
  const app = createApp();
  app.listen(PORT, HOST, () => {
    console.log(`\nAPI + static server running at http://${HOST}:${PORT}`);
    console.log(`Static files: ${STATIC_DIR}`);
    console.log(`Data store: ${DATA_DIR}`);
    console.log(`Default admin: ${ADMIN_EMAIL}`);
    console.log('Set ADMIN_PASSWORD in .env before production use.\n');
  });
}

startServer().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
