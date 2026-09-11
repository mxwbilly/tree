import { json, newId, hasText, nowIso, readBody } from '../../_lib/http.js';
import { requireAuth } from '../../_lib/auth.js';
import { getLatestExchangeRate } from '../../_lib/rates.js';

const PUBLIC_RATE_API = 'https://api.frankfurter.dev/v2/rates';

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
  const q = String(url.searchParams.get('q') || '').trim().toUpperCase();
  const requestedPage = Math.max(1, Number.parseInt(url.searchParams.get('page') || '1', 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(url.searchParams.get('pageSize') || '20', 10) || 20));

  let query = 'SELECT * FROM exchange_rates';
  let countQuery = 'SELECT COUNT(*) AS total FROM exchange_rates';
  const conditions = [];
  const bindings = [];
  if (base) { conditions.push('base_currency = ?'); bindings.push(base); }
  if (quote) { conditions.push('quote_currency = ?'); bindings.push(quote); }
  if (q) { conditions.push('(base_currency LIKE ? OR quote_currency LIKE ?)'); bindings.push(`%${q}%`, `%${q}%`); }
  if (conditions.length) {
    const where = ' WHERE ' + conditions.join(' AND ');
    query += where;
    countQuery += where;
  }
  const totalRow = await env.DB.prepare(countQuery).bind(...bindings).first();
  const total = Number(totalRow?.total || 0);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requestedPage, totalPages);
  // Keep the currencies used most often for export quoting at the top of the default list.
  const priorityOrder = `CASE quote_currency
    WHEN 'USD' THEN 1 WHEN 'EUR' THEN 2 WHEN 'GBP' THEN 3
    WHEN 'THB' THEN 4 WHEN 'VND' THEN 5 WHEN 'IDR' THEN 6
    WHEN 'MYR' THEN 7 WHEN 'SGD' THEN 8 WHEN 'PHP' THEN 9
    ELSE 99 END`;
  query += ` ORDER BY ${priorityOrder} ASC, effective_date DESC, base_currency ASC, quote_currency ASC LIMIT ? OFFSET ?`;

  const { results } = await env.DB.prepare(query).bind(...bindings, pageSize, (page - 1) * pageSize).all();
  return json({ ok: true, items: (results || []).map(normalizeRate), page, pageSize, total });
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

function isCurrencyCode(value) {
  return /^[A-Z]{3}$/.test(value);
}

function normalizePublicRates(payload, fallbackBase) {
  const rows = Array.isArray(payload) ? payload : (Array.isArray(payload?.rates) ? payload.rates : []);
  return rows.map((row) => ({
    base: String(row.base || fallbackBase || '').trim().toUpperCase(),
    quote: String(row.quote || row.currency || '').trim().toUpperCase(),
    rate: Number(row.rate),
    effectiveDate: String(row.date || '').slice(0, 10)
  })).filter((row) => (
    isCurrencyCode(row.base) && isCurrencyCode(row.quote) && row.base !== row.quote &&
    Number.isFinite(row.rate) && row.rate > 0 && /^\d{4}-\d{2}-\d{2}$/.test(row.effectiveDate)
  ));
}

async function handlePublicSync(request, env) {
  const body = await readBody(request);
  const base = String(body.baseCurrency || 'CNY').trim().toUpperCase();
  if (!isCurrencyCode(base)) return json({ ok: false, error: 'baseCurrency must be a 3-letter code.' }, { status: 400 });

  let response;
  try {
    response = await fetch(`${PUBLIC_RATE_API}?base=${encodeURIComponent(base)}`, {
      headers: { Accept: 'application/json' }
    });
  } catch {
    return json({ ok: false, error: 'Public exchange-rate source is temporarily unavailable.' }, { status: 502 });
  }
  if (!response.ok) return json({ ok: false, error: 'Public exchange-rate source returned an error.' }, { status: 502 });

  const rates = normalizePublicRates(await response.json(), base);
  if (!rates.length) return json({ ok: false, error: 'No valid public rates were returned.' }, { status: 502 });
  const effectiveDate = rates[0].effectiveDate;
  const now = nowIso();
  const writes = await env.DB.batch(rates.map((row) => env.DB.prepare(`
    INSERT INTO exchange_rates (id, base_currency, quote_currency, rate, effective_date, created_at)
    SELECT ?, ?, ?, ?, ?, ?
    WHERE NOT EXISTS (
      SELECT 1 FROM exchange_rates
      WHERE base_currency = ? AND quote_currency = ? AND effective_date = ?
    )
  `).bind(
    newId('fx'), row.base, row.quote, row.rate, row.effectiveDate, now,
    row.base, row.quote, row.effectiveDate
  )));
  const created = (writes || []).reduce((total, result) => total + Number(result?.meta?.changes || 0), 0);
  return json({ ok: true, baseCurrency: base, effectiveDate, created, skipped: rates.length - created });
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
  if (path === '/api/exchange-rates/public-sync' && request.method === 'POST') {
    if (authResult.auth.role !== 'admin') return json({ ok: false, error: 'Forbidden.' }, { status: 403 });
    return handlePublicSync(request, env);
  }

  const detailMatch = path.match(/^\/api\/exchange-rates\/([^/]+)$/);
  if (detailMatch && request.method === 'DELETE') {
    return handleDelete(env, decodeURIComponent(detailMatch[1]));
  }

  return json({ ok: false, error: 'Not found.' }, { status: 404 });
}
