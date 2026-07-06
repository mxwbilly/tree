import { json, csv, newId, hasText, parseJson, nowIso, readBody } from '../../_lib/http.js';
import { requireAuth } from '../../_lib/auth.js';

function normalizeProduct(row) {
  if (!row) return null;
  return {
    id: row.id,
    sku: row.sku,
    name: row.name,
    category: row.category || '',
    spec: parseJson(row.spec_json, {}),
    packaging: parseJson(row.packaging_json, {}),
    defaultSupplierId: row.default_supplier_id || null,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function handleList(request, env) {
  const url = new URL(request.url);
  const params = url.searchParams;
  const page = Math.max(1, Number.parseInt(params.get('page') || '1', 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(params.get('pageSize') || '20', 10) || 20));
  const status = String(params.get('status') || '').trim();
  const q = String(params.get('q') || '').trim().toLowerCase();

  const { results } = await env.DB.prepare('SELECT * FROM products ORDER BY created_at DESC').all();
  let items = (results || []).map(normalizeProduct);
  if (status) items = items.filter((item) => item.status === status);
  if (q) {
    items = items.filter((item) => [item.sku, item.name, item.category]
      .map((value) => String(value || '').toLowerCase())
      .some((value) => value.includes(q)));
  }
  const total = items.length;
  const offset = (page - 1) * pageSize;
  return json({ ok: true, items: items.slice(offset, offset + pageSize), page, pageSize, total });
}

async function handleExport(env) {
  const { results } = await env.DB.prepare('SELECT * FROM products ORDER BY created_at DESC').all();
  const items = (results || []).map(normalizeProduct);
  const header = ['id', 'sku', 'name', 'category', 'defaultSupplierId', 'status', 'createdAt', 'updatedAt'];
  const rows = items.map((item) => [item.id, item.sku, item.name, item.category, item.defaultSupplierId || '', item.status, item.createdAt, item.updatedAt]);
  const body = [header, ...rows].map((row) => row.map((value) => `"${String(value ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  return csv(body, `products-${timestamp}.csv`);
}

async function handleDetail(env, id) {
  const row = await env.DB.prepare('SELECT * FROM products WHERE id = ?').bind(id).first();
  if (!row) return json({ ok: false, error: 'Product not found.' }, { status: 404 });
  return json({ ok: true, item: normalizeProduct(row) });
}

async function handleCreate(request, env) {
  const body = await readBody(request);
  if (!hasText(body.sku)) return json({ ok: false, error: 'sku is required.' }, { status: 400 });
  if (!hasText(body.name)) return json({ ok: false, error: 'name is required.' }, { status: 400 });

  if (body.defaultSupplierId) {
    const supplier = await env.DB.prepare('SELECT id FROM suppliers WHERE id = ?').bind(body.defaultSupplierId).first();
    if (!supplier) return json({ ok: false, error: 'defaultSupplierId does not exist.' }, { status: 400 });
  }

  const id = newId('prod');
  const now = nowIso();
  try {
    await env.DB.prepare(`
      INSERT INTO products (id, sku, name, category, spec_json, packaging_json, default_supplier_id, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id,
      String(body.sku).trim(),
      String(body.name).trim(),
      String(body.category || '').trim(),
      JSON.stringify(body.spec || {}),
      JSON.stringify(body.packaging || {}),
      body.defaultSupplierId || null,
      'active',
      now,
      now
    ).run();
  } catch (error) {
    if (String(error?.message || '').includes('UNIQUE')) {
      return json({ ok: false, error: `sku "${body.sku}" already exists.` }, { status: 409 });
    }
    throw error;
  }
  const created = await env.DB.prepare('SELECT * FROM products WHERE id = ?').bind(id).first();
  return json({ ok: true, item: normalizeProduct(created) }, { status: 201 });
}

async function handleUpdate(request, env, id) {
  const existing = await env.DB.prepare('SELECT * FROM products WHERE id = ?').bind(id).first();
  if (!existing) return json({ ok: false, error: 'Product not found.' }, { status: 404 });

  const body = await readBody(request);
  const next = {
    name: hasText(body.name) ? String(body.name).trim() : existing.name,
    category: typeof body.category === 'string' ? body.category.trim() : existing.category,
    spec_json: body.spec ? JSON.stringify(body.spec) : existing.spec_json,
    packaging_json: body.packaging ? JSON.stringify(body.packaging) : existing.packaging_json,
    default_supplier_id: typeof body.defaultSupplierId === 'string' ? body.defaultSupplierId || null : existing.default_supplier_id,
    status: hasText(body.status) ? body.status : existing.status
  };

  if (next.default_supplier_id) {
    const supplier = await env.DB.prepare('SELECT id FROM suppliers WHERE id = ?').bind(next.default_supplier_id).first();
    if (!supplier) return json({ ok: false, error: 'defaultSupplierId does not exist.' }, { status: 400 });
  }

  await env.DB.prepare(`
    UPDATE products
    SET name = ?, category = ?, spec_json = ?, packaging_json = ?, default_supplier_id = ?, status = ?, updated_at = ?
    WHERE id = ?
  `).bind(next.name, next.category, next.spec_json, next.packaging_json, next.default_supplier_id, next.status, nowIso(), id).run();

  return handleDetail(env, id);
}

// Products are never hard-deleted (supplier_price_tiers reference them) — this
// just flips status to 'discontinued'.
async function handleDiscontinue(env, id) {
  const existing = await env.DB.prepare('SELECT id FROM products WHERE id = ?').bind(id).first();
  if (!existing) return json({ ok: false, error: 'Product not found.' }, { status: 404 });
  await env.DB.prepare('UPDATE products SET status = ?, updated_at = ? WHERE id = ?').bind('discontinued', nowIso(), id).run();
  return json({ ok: true });
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

  if (path === '/api/products/export.csv' && request.method === 'GET') return handleExport(env);
  if (path === '/api/products' && request.method === 'GET') return handleList(request, env);
  if (path === '/api/products' && request.method === 'POST') return handleCreate(request, env);

  const detailMatch = path.match(/^\/api\/products\/([^/]+)$/);
  if (detailMatch) {
    const id = decodeURIComponent(detailMatch[1]);
    if (request.method === 'GET') return handleDetail(env, id);
    if (request.method === 'PATCH') return handleUpdate(request, env, id);
    if (request.method === 'DELETE') return handleDiscontinue(env, id);
  }

  return json({ ok: false, error: 'Not found.' }, { status: 404 });
}
