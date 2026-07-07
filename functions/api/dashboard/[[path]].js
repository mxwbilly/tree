// Phase 4 — pure read model. No new tables: everything here is an
// aggregation over sales_orders/customers, reusing computeProfit from the
// Calculation Engine so "how is profit computed" stays defined in one place
// (see functions/_lib/calc-engine.js). Freight is omitted here since there is
// no persisted Shipment/booking record yet — dashboard profit is therefore a
// pre-freight figure, same as computeProfit's behavior when freightAmount is
// not supplied.
import { json } from '../../_lib/http.js';
import { requireAuth } from '../../_lib/auth.js';
import { computeProfit } from '../../_lib/calc-engine.js';

// Orders that have moved past the quoting stage — i.e. a deposit or firm
// commitment exists — count as real revenue/profit. 'quoted' and
// 'pi_issued' are still pipeline, not booked business; 'lost' is excluded.
const COMMITTED_STATUSES = ['confirmed', 'packing_ready', 'invoiced', 'paid', 'closed'];

// ?from=YYYY-MM-DD&to=YYYY-MM-DD, both optional and inclusive. Filters on
// sales_orders.created_at (when the deal entered the pipeline), not on
// document issue dates — a single, consistent "when did this order happen"
// axis across all 4 dashboard endpoints.
function getDateRange(request) {
  const url = new URL(request.url);
  const from = String(url.searchParams.get('from') || '').trim();
  const to = String(url.searchParams.get('to') || '').trim();
  const isValidDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value);
  return {
    from: isValidDate(from) ? from : null,
    to: isValidDate(to) ? to : null
  };
}

async function committedOrders(env, range) {
  const placeholders = COMMITTED_STATUSES.map(() => '?').join(',');
  const conditions = [`so.status IN (${placeholders})`];
  const bindings = [...COMMITTED_STATUSES];
  if (range.from) { conditions.push('so.created_at >= ?'); bindings.push(range.from); }
  if (range.to) { conditions.push('so.created_at <= ?'); bindings.push(`${range.to}T23:59:59.999Z`); }

  const { results } = await env.DB.prepare(`
    SELECT so.*, c.name AS customer_name, c.company AS customer_company, c.country AS customer_country
    FROM sales_orders so
    JOIN customers c ON c.id = so.customer_id
    WHERE ${conditions.join(' AND ')}
  `).bind(...bindings).all();
  return results || [];
}

async function handleSummary(request, env) {
  const range = getDateRange(request);
  const statusConditions = [];
  const statusBindings = [];
  if (range.from) { statusConditions.push('created_at >= ?'); statusBindings.push(range.from); }
  if (range.to) { statusConditions.push('created_at <= ?'); statusBindings.push(`${range.to}T23:59:59.999Z`); }
  const statusWhere = statusConditions.length ? `WHERE ${statusConditions.join(' AND ')}` : '';

  const { results: statusCounts } = await env.DB.prepare(`
    SELECT status, COUNT(*) AS count, SUM(total_amount) AS total FROM sales_orders ${statusWhere} GROUP BY status
  `).bind(...statusBindings).all();

  const orders = await committedOrders(env, range);
  let revenue = 0;
  let profit = 0;
  let hasWarnings = false;
  for (const order of orders) {
    revenue += order.total_amount;
    const result = await computeProfit(env, { orderId: order.id });
    if (result.ok) profit += result.profit;
    else hasWarnings = true;
  }

  const lostCount = (statusCounts || []).find((row) => row.status === 'lost')?.count || 0;
  const wonCount = orders.length;
  const winRate = wonCount + lostCount > 0 ? Math.round((wonCount / (wonCount + lostCount)) * 10000) / 100 : null;

  return json({
    ok: true,
    statusCounts: (statusCounts || []).map((row) => ({ status: row.status, count: row.count, totalAmount: row.total || 0 })),
    committedOrderCount: orders.length,
    revenue: Math.round(revenue * 100) / 100,
    profit: Math.round(profit * 100) / 100,
    marginPercent: revenue > 0 ? Math.round((profit / revenue) * 10000) / 100 : null,
    winRate,
    hasWarnings
  });
}

async function handleProfitTrend(request, env) {
  const orders = await committedOrders(env, getDateRange(request));
  const byMonth = new Map();

  for (const order of orders) {
    const month = String(order.created_at).slice(0, 7);
    if (!byMonth.has(month)) byMonth.set(month, { month, orderCount: 0, revenue: 0, cost: 0, profit: 0, hasWarnings: false });
    const bucket = byMonth.get(month);
    const result = await computeProfit(env, { orderId: order.id });
    bucket.orderCount += 1;
    bucket.revenue += order.total_amount;
    if (result.ok) {
      bucket.cost += result.totalCost;
      bucket.profit += result.profit;
    } else {
      bucket.hasWarnings = true;
    }
  }

  const items = Array.from(byMonth.values())
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((bucket) => ({
      ...bucket,
      revenue: Math.round(bucket.revenue * 100) / 100,
      cost: Math.round(bucket.cost * 100) / 100,
      profit: Math.round(bucket.profit * 100) / 100,
      marginPercent: bucket.revenue > 0 ? Math.round((bucket.profit / bucket.revenue) * 10000) / 100 : null
    }));

  return json({ ok: true, items });
}

async function handleCustomerAnalysis(request, env) {
  const url = new URL(request.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 10, 1), 100);

  const orders = await committedOrders(env, getDateRange(request));
  const byCustomer = new Map();

  for (const order of orders) {
    if (!byCustomer.has(order.customer_id)) {
      byCustomer.set(order.customer_id, {
        customerId: order.customer_id,
        customerName: order.customer_name,
        company: order.customer_company,
        country: order.customer_country,
        orderCount: 0,
        revenue: 0,
        profit: 0,
        hasWarnings: false
      });
    }
    const bucket = byCustomer.get(order.customer_id);
    const result = await computeProfit(env, { orderId: order.id });
    bucket.orderCount += 1;
    bucket.revenue += order.total_amount;
    if (result.ok) bucket.profit += result.profit;
    else bucket.hasWarnings = true;
  }

  const items = Array.from(byCustomer.values())
    .map((bucket) => ({
      ...bucket,
      revenue: Math.round(bucket.revenue * 100) / 100,
      profit: Math.round(bucket.profit * 100) / 100,
      marginPercent: bucket.revenue > 0 ? Math.round((bucket.profit / bucket.revenue) * 10000) / 100 : null
    }))
    .sort((a, b) => b.profit - a.profit)
    .slice(0, limit);

  return json({ ok: true, items });
}

async function handleCountryAnalysis(request, env) {
  const orders = await committedOrders(env, getDateRange(request));
  const byCountry = new Map();

  for (const order of orders) {
    const country = order.customer_country || 'Unknown';
    if (!byCountry.has(country)) {
      byCountry.set(country, { country, orderCount: 0, customerIds: new Set(), revenue: 0, profit: 0, hasWarnings: false });
    }
    const bucket = byCountry.get(country);
    const result = await computeProfit(env, { orderId: order.id });
    bucket.orderCount += 1;
    bucket.customerIds.add(order.customer_id);
    bucket.revenue += order.total_amount;
    if (result.ok) bucket.profit += result.profit;
    else bucket.hasWarnings = true;
  }

  const items = Array.from(byCountry.values())
    .map((bucket) => ({
      country: bucket.country,
      orderCount: bucket.orderCount,
      customerCount: bucket.customerIds.size,
      revenue: Math.round(bucket.revenue * 100) / 100,
      profit: Math.round(bucket.profit * 100) / 100,
      marginPercent: bucket.revenue > 0 ? Math.round((bucket.profit / bucket.revenue) * 10000) / 100 : null,
      hasWarnings: bucket.hasWarnings
    }))
    .sort((a, b) => b.revenue - a.revenue);

  return json({ ok: true, items });
}

export async function onRequest(context) {
  const { request, env } = context;
  if (!env.DB) return json({ ok: false, error: 'D1 binding DB is not configured.' }, { status: 500 });

  const authResult = await requireAuth(request, env, ['admin', 'sales']);
  if (authResult.response) return authResult.response;

  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  if (request.method !== 'GET') return json({ ok: false, error: 'Not found.' }, { status: 404 });

  if (path === '/api/dashboard/summary') return handleSummary(request, env);
  if (path === '/api/dashboard/profit') return handleProfitTrend(request, env);
  if (path === '/api/dashboard/customers') return handleCustomerAnalysis(request, env);
  if (path === '/api/dashboard/countries') return handleCountryAnalysis(request, env);

  return json({ ok: false, error: 'Not found.' }, { status: 404 });
}
