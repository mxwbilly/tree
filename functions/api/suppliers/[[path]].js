import { json, csv, newId, hasText, nowIso, readBody } from '../../_lib/http.js';
import { requireAuth } from '../../_lib/auth.js';

function normalizeSupplier(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    contactName: row.contact_name || '',
    contactPhone: row.contact_phone || '',
    contactEmail: row.contact_email || '',
    location: row.location || '',
    paymentTerms: row.payment_terms || '',
    notes: row.notes || '',
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function normalizeTier(row) {
  if (!row) return null;
  return {
    id: row.id,
    supplierId: row.supplier_id,
    productId: row.product_id,
    minQty: row.min_qty,
    unitCost: row.unit_cost,
    currency: row.currency,
    validFrom: row.valid_from || null,
    validUntil: row.valid_until || null,
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

  const { results } = await env.DB.prepare('SELECT * FROM suppliers ORDER BY created_at DESC').all();
  let items = (results || []).map(normalizeSupplier);
  if (status) items = items.filter((item) => item.status === status);
  if (q) {
    items = items.filter((item) => [item.name, item.location, item.contactEmail]
      .map((value) => String(value || '').toLowerCase())
      .some((value) => value.includes(q)));
  }
  const total = items.length;
  const offset = (page - 1) * pageSize;
  return json({ ok: true, items: items.slice(offset, offset + pageSize), page, pageSize, total });
}

async function handleExport(env) {
  const { results } = await env.DB.prepare('SELECT * FROM suppliers ORDER BY created_at DESC').all();
  const items = (results || []).map(normalizeSupplier);
  const header = ['id', 'name', 'contactName', 'contactPhone', 'contactEmail', 'location', 'paymentTerms', 'status', 'createdAt'];
  const rows = items.map((item) => [item.id, item.name, item.contactName, item.contactPhone, item.contactEmail, item.location, item.paymentTerms, item.status, item.createdAt]);
  const body = [header, ...rows].map((row) => row.map((value) => `"${String(value ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  return csv(body, `suppliers-${timestamp}.csv`);
}

async function handleDetail(env, id) {
  const row = await env.DB.prepare('SELECT * FROM suppliers WHERE id = ?').bind(id).first();
  if (!row) return json({ ok: false, error: 'Supplier not found.' }, { status: 404 });
  return json({ ok: true, item: normalizeSupplier(row) });
}

async function handleCreate(request, env) {
  const body = await readBody(request);
  if (!hasText(body.name)) return json({ ok: false, error: 'name is required.' }, { status: 400 });

  const id = newId('sup');
  const now = nowIso();
  await env.DB.prepare(`
    INSERT INTO suppliers (id, name, contact_name, contact_phone, contact_email, location, payment_terms, notes, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id,
    String(body.name).trim(),
    String(body.contactName || '').trim(),
    String(body.contactPhone || '').trim(),
    String(body.contactEmail || '').trim(),
    String(body.location || '').trim(),
    String(body.paymentTerms || '').trim(),
    String(body.notes || '').trim(),
    'active',
    now,
    now
  ).run();

  const created = await env.DB.prepare('SELECT * FROM suppliers WHERE id = ?').bind(id).first();
  return json({ ok: true, item: normalizeSupplier(created) }, { status: 201 });
}

async function handleUpdate(request, env, id) {
  const existing = await env.DB.prepare('SELECT * FROM suppliers WHERE id = ?').bind(id).first();
  if (!existing) return json({ ok: false, error: 'Supplier not found.' }, { status: 404 });

  const body = await readBody(request);
  const next = {
    name: hasText(body.name) ? String(body.name).trim() : existing.name,
    contact_name: typeof body.contactName === 'string' ? body.contactName.trim() : existing.contact_name,
    contact_phone: typeof body.contactPhone === 'string' ? body.contactPhone.trim() : existing.contact_phone,
    contact_email: typeof body.contactEmail === 'string' ? body.contactEmail.trim() : existing.contact_email,
    location: typeof body.location === 'string' ? body.location.trim() : existing.location,
    payment_terms: typeof body.paymentTerms === 'string' ? body.paymentTerms.trim() : existing.payment_terms,
    notes: typeof body.notes === 'string' ? body.notes.trim() : existing.notes,
    status: hasText(body.status) ? body.status : existing.status
  };

  await env.DB.prepare(`
    UPDATE suppliers
    SET name = ?, contact_name = ?, contact_phone = ?, contact_email = ?, location = ?, payment_terms = ?, notes = ?, status = ?, updated_at = ?
    WHERE id = ?
  `).bind(next.name, next.contact_name, next.contact_phone, next.contact_email, next.location, next.payment_terms, next.notes, next.status, nowIso(), id).run();

  return handleDetail(env, id);
}

// Suppliers are never hard-deleted (products/price tiers reference them) —
// this just flips status to 'inactive'.
async function handleDeactivate(env, id) {
  const existing = await env.DB.prepare('SELECT id FROM suppliers WHERE id = ?').bind(id).first();
  if (!existing) return json({ ok: false, error: 'Supplier not found.' }, { status: 404 });
  await env.DB.prepare('UPDATE suppliers SET status = ?, updated_at = ? WHERE id = ?').bind('inactive', nowIso(), id).run();
  return json({ ok: true });
}

async function handleListTiers(request, env, supplierId) {
  const url = new URL(request.url);
  const productId = String(url.searchParams.get('productId') || '').trim();
  let query = 'SELECT * FROM supplier_price_tiers WHERE supplier_id = ?';
  const bindings = [supplierId];
  if (productId) {
    query += ' AND product_id = ?';
    bindings.push(productId);
  }
  query += ' ORDER BY product_id ASC, min_qty ASC';
  const { results } = await env.DB.prepare(query).bind(...bindings).all();
  return json({ ok: true, items: (results || []).map(normalizeTier) });
}

async function handleCreateTier(request, env, supplierId) {
  const supplier = await env.DB.prepare('SELECT id FROM suppliers WHERE id = ?').bind(supplierId).first();
  if (!supplier) return json({ ok: false, error: 'Supplier not found.' }, { status: 404 });

  const body = await readBody(request);
  if (!hasText(body.productId)) return json({ ok: false, error: 'productId is required.' }, { status: 400 });
  const product = await env.DB.prepare('SELECT id FROM products WHERE id = ?').bind(body.productId).first();
  if (!product) return json({ ok: false, error: 'productId does not exist.' }, { status: 400 });

  const minQty = Number(body.minQty);
  if (!Number.isFinite(minQty) || minQty <= 0) {
    return json({ ok: false, error: 'minQty must be a positive number.' }, { status: 400 });
  }
  const unitCost = Number(body.unitCost);
  if (!Number.isFinite(unitCost) || unitCost <= 0) {
    return json({ ok: false, error: 'unitCost must be a positive number.' }, { status: 400 });
  }

  const id = newId('spt');
  const now = nowIso();
  await env.DB.prepare(`
    INSERT INTO supplier_price_tiers (id, supplier_id, product_id, min_qty, unit_cost, currency, valid_from, valid_until, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id,
    supplierId,
    body.productId,
    Math.round(minQty),
    unitCost,
    String(body.currency || 'CNY').trim().toUpperCase(),
    body.validFrom || null,
    body.validUntil || null,
    now,
    now
  ).run();

  const created = await env.DB.prepare('SELECT * FROM supplier_price_tiers WHERE id = ?').bind(id).first();
  return json({ ok: true, item: normalizeTier(created) }, { status: 201 });
}

async function handleDeleteTier(env, tierId) {
  const existing = await env.DB.prepare('SELECT id FROM supplier_price_tiers WHERE id = ?').bind(tierId).first();
  if (!existing) return json({ ok: false, error: 'Price tier not found.' }, { status: 404 });
  await env.DB.prepare('DELETE FROM supplier_price_tiers WHERE id = ?').bind(tierId).run();
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

  if (path === '/api/suppliers/export.csv' && request.method === 'GET') return handleExport(env);
  if (path === '/api/suppliers' && request.method === 'GET') return handleList(request, env);
  if (path === '/api/suppliers' && request.method === 'POST') return handleCreate(request, env);

  const tierCollectionMatch = path.match(/^\/api\/suppliers\/([^/]+)\/price-tiers$/);
  if (tierCollectionMatch) {
    const supplierId = decodeURIComponent(tierCollectionMatch[1]);
    if (request.method === 'GET') return handleListTiers(request, env, supplierId);
    if (request.method === 'POST') return handleCreateTier(request, env, supplierId);
  }

  const tierItemMatch = path.match(/^\/api\/suppliers\/[^/]+\/price-tiers\/([^/]+)$/);
  if (tierItemMatch && request.method === 'DELETE') {
    return handleDeleteTier(env, decodeURIComponent(tierItemMatch[1]));
  }

  const detailMatch = path.match(/^\/api\/suppliers\/([^/]+)$/);
  if (detailMatch) {
    const id = decodeURIComponent(detailMatch[1]);
    if (request.method === 'GET') return handleDetail(env, id);
    if (request.method === 'PATCH') return handleUpdate(request, env, id);
    if (request.method === 'DELETE') return handleDeactivate(env, id);
  }

  return json({ ok: false, error: 'Not found.' }, { status: 404 });
}
