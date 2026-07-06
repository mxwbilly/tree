import { json, newId, hasText, nowIso, readBody } from '../../_lib/http.js';
import { requireAuth } from '../../_lib/auth.js';

function normalizeRate(row) {
  if (!row) return null;
  return {
    id: row.id,
    originPort: row.origin_port,
    destinationPort: row.destination_port,
    containerType: row.container_type,
    rate: row.rate,
    currency: row.currency,
    forwarder: row.forwarder || '',
    validFrom: row.valid_from || null,
    validUntil: row.valid_until || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function handleList(request, env) {
  const url = new URL(request.url);
  const origin = String(url.searchParams.get('origin') || '').trim();
  const destination = String(url.searchParams.get('destination') || '').trim();
  const containerType = String(url.searchParams.get('containerType') || '').trim();

  let query = 'SELECT * FROM freight_rates';
  const conditions = [];
  const bindings = [];
  if (origin) { conditions.push('origin_port = ?'); bindings.push(origin); }
  if (destination) { conditions.push('destination_port = ?'); bindings.push(destination); }
  if (containerType) { conditions.push('container_type = ?'); bindings.push(containerType); }
  if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');
  query += ' ORDER BY created_at DESC';

  const { results } = await env.DB.prepare(query).bind(...bindings).all();
  return json({ ok: true, items: (results || []).map(normalizeRate) });
}

// The rate the Calculation Engine should use for a given route + container
// type: most recently created matching entry that's currently valid.
async function handleLatest(request, env) {
  const url = new URL(request.url);
  const origin = String(url.searchParams.get('origin') || '').trim();
  const destination = String(url.searchParams.get('destination') || '').trim();
  const containerType = String(url.searchParams.get('containerType') || '').trim();
  if (!origin || !destination || !containerType) {
    return json({ ok: false, error: 'origin, destination and containerType are required.' }, { status: 400 });
  }

  const today = nowIso().slice(0, 10);
  const row = await env.DB.prepare(`
    SELECT * FROM freight_rates
    WHERE origin_port = ? AND destination_port = ? AND container_type = ?
      AND (valid_from IS NULL OR valid_from <= ?)
      AND (valid_until IS NULL OR valid_until >= ?)
    ORDER BY created_at DESC LIMIT 1
  `).bind(origin, destination, containerType, today, today).first();

  if (!row) return json({ ok: false, error: `No freight rate found for ${origin}->${destination} (${containerType}).` }, { status: 404 });
  return json({ ok: true, item: normalizeRate(row) });
}

async function handleCreate(request, env) {
  const body = await readBody(request);
  if (!hasText(body.originPort)) return json({ ok: false, error: 'originPort is required.' }, { status: 400 });
  if (!hasText(body.destinationPort)) return json({ ok: false, error: 'destinationPort is required.' }, { status: 400 });
  if (!hasText(body.containerType)) return json({ ok: false, error: 'containerType is required.' }, { status: 400 });
  const rate = Number(body.rate);
  if (!Number.isFinite(rate) || rate <= 0) return json({ ok: false, error: 'rate must be a positive number.' }, { status: 400 });

  const id = newId('frt');
  const now = nowIso();
  await env.DB.prepare(`
    INSERT INTO freight_rates (id, origin_port, destination_port, container_type, rate, currency, forwarder, valid_from, valid_until, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id,
    String(body.originPort).trim(),
    String(body.destinationPort).trim(),
    String(body.containerType).trim(),
    rate,
    String(body.currency || 'USD').trim().toUpperCase(),
    String(body.forwarder || '').trim(),
    body.validFrom || null,
    body.validUntil || null,
    now,
    now
  ).run();

  const created = await env.DB.prepare('SELECT * FROM freight_rates WHERE id = ?').bind(id).first();
  return json({ ok: true, item: normalizeRate(created) }, { status: 201 });
}

async function handleUpdate(request, env, id) {
  const existing = await env.DB.prepare('SELECT * FROM freight_rates WHERE id = ?').bind(id).first();
  if (!existing) return json({ ok: false, error: 'Freight rate not found.' }, { status: 404 });

  const body = await readBody(request);
  const nextRate = body.rate !== undefined ? Number(body.rate) : existing.rate;
  if (!Number.isFinite(nextRate) || nextRate <= 0) {
    return json({ ok: false, error: 'rate must be a positive number.' }, { status: 400 });
  }

  await env.DB.prepare(`
    UPDATE freight_rates
    SET rate = ?, forwarder = ?, valid_from = ?, valid_until = ?, updated_at = ?
    WHERE id = ?
  `).bind(
    nextRate,
    typeof body.forwarder === 'string' ? body.forwarder.trim() : existing.forwarder,
    body.validFrom !== undefined ? body.validFrom : existing.valid_from,
    body.validUntil !== undefined ? body.validUntil : existing.valid_until,
    nowIso(),
    id
  ).run();

  const updated = await env.DB.prepare('SELECT * FROM freight_rates WHERE id = ?').bind(id).first();
  return json({ ok: true, item: normalizeRate(updated) });
}

async function handleDelete(env, id) {
  const existing = await env.DB.prepare('SELECT id FROM freight_rates WHERE id = ?').bind(id).first();
  if (!existing) return json({ ok: false, error: 'Freight rate not found.' }, { status: 404 });
  await env.DB.prepare('DELETE FROM freight_rates WHERE id = ?').bind(id).run();
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

  if (path === '/api/freight-rates/latest' && request.method === 'GET') return handleLatest(request, env);
  if (path === '/api/freight-rates' && request.method === 'GET') return handleList(request, env);
  if (path === '/api/freight-rates' && request.method === 'POST') return handleCreate(request, env);

  const detailMatch = path.match(/^\/api\/freight-rates\/([^/]+)$/);
  if (detailMatch) {
    const id = decodeURIComponent(detailMatch[1]);
    if (request.method === 'PATCH') return handleUpdate(request, env, id);
    if (request.method === 'DELETE') return handleDelete(env, id);
  }

  return json({ ok: false, error: 'Not found.' }, { status: 404 });
}
