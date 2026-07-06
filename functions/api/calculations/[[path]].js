// Thin HTTP layer over functions/_lib/calc-engine.js — the engine itself is
// framework-agnostic and stateless, so any other server-side code (e.g. the
// orders domain, later) can import and call it directly without a round
// trip through this route.
import { json, readBody } from '../../_lib/http.js';
import { requireAuth } from '../../_lib/auth.js';
import { computeCost, computeQuotePrice, computeCbm, computeProfit } from '../../_lib/calc-engine.js';

export async function onRequest(context) {
  const { request, env } = context;
  if (!env.DB) {
    return json({ ok: false, error: 'D1 binding DB is not configured.' }, { status: 500 });
  }

  const authResult = await requireAuth(request, env, ['admin', 'sales']);
  if (authResult.response) return authResult.response;

  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  if (request.method !== 'POST') return json({ ok: false, error: 'Not found.' }, { status: 404 });

  const body = await readBody(request);

  if (path === '/api/calculations/cost') {
    const result = await computeCost(env, body);
    return json(result, { status: result.ok ? 200 : 400 });
  }
  if (path === '/api/calculations/quote-price') {
    const result = await computeQuotePrice(env, body);
    return json(result, { status: result.ok ? 200 : 400 });
  }
  if (path === '/api/calculations/cbm') {
    const result = await computeCbm(env, body);
    return json(result, { status: result.ok ? 200 : 400 });
  }
  if (path === '/api/calculations/profit') {
    const result = await computeProfit(env, body);
    return json(result, { status: result.ok ? 200 : 400 });
  }

  return json({ ok: false, error: 'Not found.' }, { status: 404 });
}
