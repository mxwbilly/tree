// Customer master data was already implicitly created by the public inquiry
// form (see functions/api/[[path]].js) — this domain adds the missing CRUD
// surface so the SalesOrder UI can list/search/create customers directly,
// without requiring a public inquiry first.
import { json, newId, hasText, nowIso, readBody } from '../../_lib/http.js';
import { requireAuth } from '../../_lib/auth.js';

function normalizeCustomer(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    phone: row.phone || '',
    company: row.company || '',
    country: row.country || '',
    source: row.source || '',
    inquiryCount: row.inquiry_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastInquiryAt: row.last_inquiry_at
  };
}

async function handleList(request, env) {
  const url = new URL(request.url);
  const q = String(url.searchParams.get('q') || '').trim();
  const page = Math.max(1, Number.parseInt(url.searchParams.get('page') || '1', 10) || 1);
  // Keep the existing ?limit=30 client contract while also supporting the
  // shared pageSize convention used by the other ERP list endpoints.
  const requestedSize = url.searchParams.get('pageSize') || url.searchParams.get('limit') || '50';
  const pageSize = Math.min(Math.max(Number.parseInt(requestedSize, 10) || 50, 1), 200);
  const conditions = [];
  const bindings = [];

  if (q) {
    const needle = `%${q.toLowerCase()}%`;
    conditions.push('(LOWER(name) LIKE ? OR LOWER(email) LIKE ? OR LOWER(company) LIKE ?)');
    bindings.push(needle, needle, needle);
  }

  const where = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';
  const totalRow = await env.DB.prepare(`SELECT COUNT(*) AS total FROM customers${where}`).bind(...bindings).first();
  const { results } = await env.DB.prepare(`
    SELECT * FROM customers${where}
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `).bind(...bindings, pageSize, (page - 1) * pageSize).all();

  return json({
    ok: true,
    items: (results || []).map(normalizeCustomer),
    page,
    pageSize,
    total: Number(totalRow?.total || 0)
  });
}

async function handleDetail(env, id) {
  const row = await env.DB.prepare('SELECT * FROM customers WHERE id = ?').bind(id).first();
  if (!row) return json({ ok: false, error: 'Customer not found.' }, { status: 404 });
  return json({ ok: true, item: normalizeCustomer(row) });
}

async function handleCreate(request, env) {
  const body = await readBody(request);
  if (!hasText(body.email)) return json({ ok: false, error: 'email is required.' }, { status: 400 });
  if (!hasText(body.name)) return json({ ok: false, error: 'name is required.' }, { status: 400 });

  const email = String(body.email).trim().toLowerCase();
  const existing = await env.DB.prepare('SELECT * FROM customers WHERE email = ?').bind(email).first();
  if (existing) return json({ ok: true, item: normalizeCustomer(existing) }, { status: 200 });

  const id = newId('cust');
  const now = nowIso();
  await env.DB.prepare(`
    INSERT INTO customers (id, email, name, phone, company, country, source, inquiry_count, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
  `).bind(
    id,
    email,
    String(body.name).trim(),
    String(body.phone || '').trim(),
    String(body.company || '').trim(),
    String(body.country || '').trim(),
    String(body.source || 'manual').trim(),
    now,
    now
  ).run();

  const created = await env.DB.prepare('SELECT * FROM customers WHERE id = ?').bind(id).first();
  return json({ ok: true, item: normalizeCustomer(created) }, { status: 201 });
}

async function handleUpdate(request, env, id) {
  const existing = await env.DB.prepare('SELECT * FROM customers WHERE id = ?').bind(id).first();
  if (!existing) return json({ ok: false, error: 'Customer not found.' }, { status: 404 });

  const body = await readBody(request);
  const next = {
    name: hasText(body.name) ? String(body.name).trim() : existing.name,
    phone: typeof body.phone === 'string' ? body.phone.trim() : existing.phone,
    company: typeof body.company === 'string' ? body.company.trim() : existing.company,
    country: typeof body.country === 'string' ? body.country.trim() : existing.country
  };

  await env.DB.prepare(`
    UPDATE customers SET name = ?, phone = ?, company = ?, country = ?, updated_at = ? WHERE id = ?
  `).bind(next.name, next.phone, next.company, next.country, nowIso(), id).run();

  return handleDetail(env, id);
}

export async function onRequest(context) {
  const { request, env } = context;
  if (!env.DB) {
    return json({ ok: false, error: 'D1 binding DB is not configured.' }, { status: 500 });
  }

  const authResult = await requireAuth(request, env, ['admin', 'sales']);
  if (authResult.response) return authResult.response;

  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';

  if (path === '/api/customers' && request.method === 'GET') return handleList(request, env);
  if (path === '/api/customers' && request.method === 'POST') return handleCreate(request, env);

  const detailMatch = path.match(/^\/api\/customers\/([^/]+)$/);
  if (detailMatch) {
    const id = decodeURIComponent(detailMatch[1]);
    if (request.method === 'GET') return handleDetail(env, id);
    if (request.method === 'PATCH') return handleUpdate(request, env, id);
  }

  return json({ ok: false, error: 'Not found.' }, { status: 404 });
}
