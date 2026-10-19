// 汇率自动同步 Worker（独立部署，不占用 Pages Functions 路由）。
// 每日定时从 frankfurter.dev 拉取 CNY 基准汇率，幂等写入生产 D1 的 exchange_rates 表。
// 报价单出具时通过 rates.js 的 getLatestExchangeRate 以 CNY 为桥接货币换算任意货币对。

const PUBLIC_RATE_API = 'https://api.frankfurter.dev/v2/rates';
const SYNC_BASE = 'CNY';

function isCurrencyCode(value) {
  return /^[A-Z]{3}$/.test(value);
}

async function syncFxRates(env) {
  let response;
  try {
    response = await fetch(`${PUBLIC_RATE_API}?base=${SYNC_BASE}`, {
      headers: { Accept: 'application/json' }
    });
  } catch (error) {
    throw new Error(`rate source unreachable: ${error.message}`);
  }
  if (!response.ok) throw new Error(`rate source returned ${response.status}`);
  const rows = await response.json();
  if (!Array.isArray(rows) || !rows.length) {
    return { ok: false, created: 0, skipped: 0, reason: 'empty payload' };
  }

  const now = new Date().toISOString();
  const statements = [];
  for (const row of rows) {
    const base = String(row.base || '').trim().toUpperCase();
    const quote = String(row.quote || '').trim().toUpperCase();
    const rate = Number(row.rate);
    const date = String(row.date || '').slice(0, 10);
    if (!isCurrencyCode(base) || !isCurrencyCode(quote) || base === quote) continue;
    if (!Number.isFinite(rate) || rate <= 0) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    statements.push(env.DB.prepare(`
      INSERT INTO exchange_rates (id, base_currency, quote_currency, rate, effective_date, created_at)
      SELECT ?, ?, ?, ?, ?, ?
      WHERE NOT EXISTS (
        SELECT 1 FROM exchange_rates
        WHERE base_currency = ? AND quote_currency = ? AND effective_date = ?
      )
    `).bind(
      `fx_${crypto.randomUUID()}`,
      base, quote, rate, date, now,
      base, quote, date
    ));
  }

  if (!statements.length) return { ok: true, created: 0, skipped: rows.length, reason: 'no valid rows' };

  const writes = await env.DB.batch(statements);
  const created = writes.reduce((total, result) => total + Number(result?.meta?.changes || 0), 0);
  return { ok: true, created, skipped: statements.length - created, base: SYNC_BASE };
}

export default {
  // 定时触发（cron 在 wrangler.jsonc 的 triggers.crons 配置）。
  async scheduled(controller, env, ctx) {
    const result = await syncFxRates(env);
    console.log('[fx-sync] scheduled run', JSON.stringify(result));
    return result;
  },

  // HTTP 入口：便于手动触发（GET /sync）与健康检查（GET /）。
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/sync') {
      try {
        const result = await syncFxRates(env);
        return new Response(JSON.stringify(result), {
          status: result.ok === false ? 502 : 200,
          headers: { 'Content-Type': 'application/json; charset=utf-8' }
        });
      } catch (error) {
        return new Response(JSON.stringify({ ok: false, error: error.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json; charset=utf-8' }
        });
      }
    }
    return new Response('greensmart-fx-sync worker is running.', { status: 200 });
  }
};
