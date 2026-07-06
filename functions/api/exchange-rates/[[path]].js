import { json, newId, hasText, nowIso, readBody } from '../../_lib/http.js';
import { requireAuth } from '../../_lib/auth.js';
import { getLatestExchangeRate } from '../../_lib/rates.js';

function normalizeRate(row) {
  if (!row) return null;
  return {
    id: row.id,
    baseCurrency: row.base_currency,
    quoteCurrency: row.quote_currency,
    rate: row.rate,
    effectiveDate: row.effective_date,
    createdAt: row.created_at
  };
}

async function handleList(request, env) {
  const url = new URL(request.url);
  const base = String(url.searchParams.get('base') || '').trim().toUpperCase();
  const quote = String(url.searchParams.get('quote') || '').trim().toUpperCase();

  let query = 'SELECT * FROM exchange_rates';
  const conditions = [];
  const bindings = [];
  if (base) { conditions.push('base_currency = ?'); bindings.push(base); }
  if (quote) { conditions.push('quote_currency = ?'); bindings.push(quote); }
  if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');
  query += ' ORDER BY effective_date DESC';

  const { results } = await env.DB.prepare(query).bind(...bindings).all();
  return json({ ok: true, items: (results || []).map(normalizeRate) });
}

// The rate the Calculation Engine should actually use: most recent entry
// on or before today for this currency pair.
async function handleLatest(request, env) {
  const url = new URL(request.url);
  const base = String(url.searchParams.get('base') || '').trim().toUpperCase();
  const quote = String(url.searchParams.get('quote') || '').trim().toUpperCase();
  if (!base || !quote) return json({ ok: false, error: 'base and quote currency are required.' }, { status: 400 });

  const rate = await getLatestExchangeRate(env, base, quote, nowIso().slice(0, 10));
  if (!rate) return json({ ok: false, error: `No exchange rate found for ${base}->${quote}.` }, { status: 404 });
  return json({ ok: true, item: rate });
}

async function handleCreate(request, env) {
  const body = await readBody(request);
  if (!hasText(body.baseCurrency)) return json({ ok: false, error: 'baseCurrency is required.' }, { status: 400 });
  if (!hasText(body.quoteCurrency)) return json({ ok: false, error: 'quoteCurrency is required.' }, { status: 400 });
  const rate = Number(body.rate);
  if (!Number.isFinite(rate) || rate <= 0) return json({ ok: false, error: 'rate must be a positive number.' }, { status: 400 });
  if (!hasText(body.effectiveDate)) return json({ ok: false, error: 'effectiveDate is required (YYYY-MM-DD).' }, { status: 400 });

  const id = newId('fx');
  await env.DB.prepare(`
    INSERT INTO exchange_rates (id, base_currency, quote_currency, rate, effective_date, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(
    id,
    String(body.baseCurrency).trim().toUpperCase(),
    String(body.quoteCurrency).trim().toUpperCase(),
    rate,
    String(body.effectiveDate).trim(),
    nowIso()
  ).run();

  const created = await env.DB.prepare('SELECT * FROM exchange_rates WHERE id = ?').bind(id).first();
  return json({ ok: true, item: normalizeRate(created) }, { status: 201 });
}

async function handleDelete(env, id) {
  const existing = await env.DB.prepare('SELECT id FROM exchange_rates WHERE id = ?').bind(id).first();
  if (!existing) return json({ ok: false, error: 'Exchange rate not found.' }, { status: 404 });
  await env.DB.prepare('DELETE FROM exchange_rates WHERE id = ?').bind(id).run();
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

  if (path === '/api/exchange-rates/latest' && request.method === 'GET') return handleLatest(request, env);
  if (path === '/api/exchange-rates' && request.method === 'GET') return handleList(request, env);
  if (path === '/api/exchange-rates' && request.method === 'POST') return handleCreate(request, env);

  const detailMatch = path.match(/^\/api\/exchange-rates\/([^/]+)$/);
  if (detailMatch && request.method === 'DELETE') {
    return handleDelete(env, decodeURIComponent(detailMatch[1]));
  }

  return json({ ok: false, error: 'Not found.' }, { status: 404 });
}
