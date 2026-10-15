// Contacts: per-customer contact people with a role (purchasing/technical/
// finance/logistics/decision_maker/other). One company (customers row) can
// have multiple contacts, each with their own role.
import { json, newId, hasText, nowIso, readBody } from '../../_lib/http.js';
import { requireAuth } from '../../_lib/auth.js';

const CONTACT_ROLES = ['purchasing', 'technical', 'finance', 'logistics', 'decision_maker', 'other'];

function normalizeContact(row) {
  if (!row) return null;
  return {
    id: row.id,
    customerId: row.customer_id,
    name: row.name,
    email: row.email || '',
    phone: row.phone || '',
    role: row.role || '',
    isPrimary: Number(row.is_primary || 0) === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function listContacts(env, customerId) {
  const { results } = await env.DB.prepare(`
    SELECT * FROM contacts WHERE customer_id = ?
    ORDER BY is_primary DESC, created_at ASC
  `).bind(customerId).all();
  return (results || []).map(normalizeContact);
}

async function handleList(request, env) {
  const url = new URL(request.url);
  const customerId = String(url.searchParams.get('customerId') || '').trim();
  if (!customerId) return json({ ok: false, error: 'customerId is required.' }, { status: 400 });
  const items = await listContacts(env, customerId);
  return json({ ok: true, items });
}

async function handleCreate(request, env) {
  const body = await readBody(request);
  const customerId = String(body.customerId || '').trim();
  if (!customerId) return json({ ok: false, error: 'customerId is required.' }, { status: 400 });
  if (!hasText(body.name)) return json({ ok: false, error: 'name is required.' }, { status: 400 });

  const customer = await env.DB.prepare('SELECT id FROM customers WHERE id = ?').bind(customerId).first();
  if (!customer) return json({ ok: false, error: 'Customer not found.' }, { status: 404 });

  const role = String(body.role || '').trim();
  if (role && !CONTACT_ROLES.includes(role)) {
    return json({ ok: false, error: 'Invalid role.' }, { status: 400 });
  }

  const id = newId('ctc');
  const now = nowIso();
  const isPrimary = body.isPrimary === true || body.isPrimary === 1 || body.isPrimary === '1' ? 1 : 0;

  await env.DB.prepare(`
    INSERT INTO contacts (id, customer_id, name, email, phone, role, is_primary, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id,
    customerId,
    String(body.name).trim(),
    String(body.email || '').trim(),
    String(body.phone || '').trim(),
    role,
    isPrimary,
    now,
    now
  ).run();

  const created = await env.DB.prepare('SELECT * FROM contacts WHERE id = ?').bind(id).first();
  return json({ ok: true, item: normalizeContact(created) }, { status: 201 });
}

async function handleUpdate(request, env, id) {
  const existing = await env.DB.prepare('SELECT * FROM contacts WHERE id = ?').bind(id).first();
  if (!existing) return json({ ok: false, error: 'Contact not found.' }, { status: 404 });

  const body = await readBody(request);
  const name = hasText(body.name) ? String(body.name).trim() : existing.name;
  const email = typeof body.email === 'string' ? body.email.trim() : existing.email;
  const phone = typeof body.phone === 'string' ? body.phone.trim() : existing.phone;
  const role = typeof body.role === 'string' ? body.role.trim() : (existing.role || '');
  if (role && !CONTACT_ROLES.includes(role)) {
    return json({ ok: false, error: 'Invalid role.' }, { status: 400 });
  }
  const isPrimary = (body.isPrimary === true || body.isPrimary === 1 || body.isPrimary === '1')
    ? 1
    : (typeof body.isPrimary === 'undefined' ? Number(existing.is_primary || 0) : 0);

  await env.DB.prepare(`
    UPDATE contacts
    SET name = ?, email = ?, phone = ?, role = ?, is_primary = ?, updated_at = ?
    WHERE id = ?
  `).bind(name, email, phone, role, isPrimary, nowIso(), id).run();

  const updated = await env.DB.prepare('SELECT * FROM contacts WHERE id = ?').bind(id).first();
  return json({ ok: true, item: normalizeContact(updated) });
}

async function handleDelete(env, id) {
  const existing = await env.DB.prepare('SELECT * FROM contacts WHERE id = ?').bind(id).first();
  if (!existing) return json({ ok: false, error: 'Contact not found.' }, { status: 404 });
  await env.DB.prepare('DELETE FROM contacts WHERE id = ?').bind(id).run();
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

  if (path === '/api/contacts' && request.method === 'GET') return handleList(request, env);
  if (path === '/api/contacts' && request.method === 'POST') return handleCreate(request, env);

  const detailMatch = path.match(/^\/api\/contacts\/([^/]+)$/);
  if (detailMatch) {
    const id = decodeURIComponent(detailMatch[1]);
    if (request.method === 'PATCH') return handleUpdate(request, env, id);
    if (request.method === 'DELETE') return handleDelete(env, id);
  }

  return json({ ok: false, error: 'Not found.' }, { status: 404 });
}
