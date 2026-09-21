// Phase 4 — pure read model. No new tables: everything here is an
// aggregation over sales_orders/customers, reusing computeProfit from the
// Calculation Engine so "how is profit computed" stays defined in one place
// (see functions/_lib/calc-engine.js). Actual freight saved in the order's
// logistics profile is included in the shared calculation.
import { json, parseJson } from '../../_lib/http.js';
import { requireAuth } from '../../_lib/auth.js';
import { computeProfitForOrder } from '../../_lib/calc-engine.js';
import { getLatestExchangeRate } from '../../_lib/rates.js';

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

function getReportingCurrency(request) {
  const value = String(new URL(request.url).searchParams.get('currency') || 'USD').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(value) ? value : 'USD';
}

async function committedOrders(env, range) {
  const placeholders = COMMITTED_STATUSES.map(() => '?').join(',');
  const conditions = [`so.status IN (${placeholders})`];
  const bindings = [...COMMITTED_STATUSES];
  if (range.from) { conditions.push('so.created_at >= ?'); bindings.push(range.from); }
  if (range.to) { conditions.push('so.created_at <= ?'); bindings.push(`${range.to}T23:59:59.999Z`); }

  const { results } = await env.DB.prepare(`
    SELECT so.id, so.customer_id, so.status, so.currency, so.current_lines_json, so.shipping_json, so.total_amount, so.created_at,
      so.actual_product_cost, so.actual_freight, so.bank_fee, so.other_fee, so.financial_currency, so.financial_note, so.financial_locked_at,
      COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.order_id = so.id), 0) AS received_amount,
      (SELECT COUNT(*) FROM payments p WHERE p.order_id = so.id) AS payment_count,
      c.name AS customer_name, c.company AS customer_company, c.country AS customer_country
    FROM sales_orders so
    JOIN customers c ON c.id = so.customer_id
    WHERE ${conditions.join(' AND ')}
  `).bind(...bindings).all();
  return results || [];
}

// A dashboard request often contains many orders using the same product,
// quantity and supplier. Cache those D1-backed cost and FX lookups for the
// lifetime of this one request while preserving the shared profit engine.
function createProfitCalculator(env, reportingCurrency) {
  const profitCache = new Map();
  const calculationCache = { costs: new Map(), rates: new Map() };
  return async (order) => {
    const key = order.id;
    if (!profitCache.has(key)) {
      profitCache.set(key, (async () => {
        const result = await computeProfitForOrder(env, order, { cache: calculationCache });
        if (!result.ok) return { ...result, code: 'profit_calculation' };
        const sourceCurrency = String(order.currency || '').trim().toUpperCase();
        const isCompleted = ['paid', 'closed'].includes(order.status);
        const paymentCount = Number(order.payment_count || 0);
        if (isCompleted && paymentCount === 0) {
          return { ok: false, code: 'missing_payment', error: 'Completed order has no recorded payment.' };
        }
        const agreedRateDate = String(order.created_at || '').slice(0, 10);
        const rate = await getLatestExchangeRate(env, sourceCurrency, reportingCurrency, agreedRateDate);
        if (!rate) {
          return { ok: false, code: 'missing_agreed_rate', error: `No agreed exchange rate found for ${sourceCurrency}->${reportingCurrency} on ${agreedRateDate}.` };
        }
        const revenueInOrderCurrency = isCompleted ? Number(order.received_amount || 0) : Number(result.revenue || 0);
        const profitInOrderCurrency = revenueInOrderCurrency - Number(result.totalCost || 0) - Number(result.freight || 0) - Number(result.bankFee || 0) - Number(result.otherFee || 0);
        const convert = (value) => Math.round(Number(value || 0) * rate.rate * 100) / 100;
        return {
          ...result,
          sourceCurrency,
          currency: reportingCurrency,
          conversionRate: rate.rate,
          agreedRateDate,
          revenueType: isCompleted ? 'actual_payment' : 'agreed_order_value',
          revenue: convert(revenueInOrderCurrency),
          totalCost: convert(result.totalCost),
          freight: convert(result.freight),
          bankFee: convert(result.bankFee),
          otherFee: convert(result.otherFee),
          profit: convert(profitInOrderCurrency),
          marginPercent: revenueInOrderCurrency > 0 ? Math.round((profitInOrderCurrency / revenueInOrderCurrency) * 10000) / 100 : null
        };
      })());
    }
    return profitCache.get(key);
  };
}

async function handleSummary(request, env) {
  const range = getDateRange(request);
  const reportingCurrency = getReportingCurrency(request);
  const statusConditions = [];
  const statusBindings = [];
  if (range.from) { statusConditions.push('created_at >= ?'); statusBindings.push(range.from); }
  if (range.to) { statusConditions.push('created_at <= ?'); statusBindings.push(`${range.to}T23:59:59.999Z`); }
  const statusWhere = statusConditions.length ? `WHERE ${statusConditions.join(' AND ')}` : '';

  const { results: statusCounts } = await env.DB.prepare(`
    SELECT status, COUNT(*) AS count, SUM(total_amount) AS total FROM sales_orders ${statusWhere} GROUP BY status
  `).bind(...statusBindings).all();

  const orders = await committedOrders(env, range);
  const calculateProfit = createProfitCalculator(env, reportingCurrency);
  let revenue = 0;
  let profit = 0;
  let freight = 0;
  let excludedOrderCount = 0;
  let missingPaymentCount = 0;
  let missingRateCount = 0;
  let hasWarnings = false;
  for (const order of orders) {
    const result = await calculateProfit(order);
    if (result.ok) {
      revenue += result.revenue;
      profit += result.profit;
      freight += result.freight;
      if (result.hasWarnings) hasWarnings = true;
    }
    else {
      hasWarnings = true;
      excludedOrderCount += 1;
      if (result.code === 'missing_payment') missingPaymentCount += 1;
      if (result.code === 'missing_agreed_rate') missingRateCount += 1;
    }
  }

  const lostCount = (statusCounts || []).find((row) => row.status === 'lost')?.count || 0;
  const quotedCount = (statusCounts || []).find((row) => row.status === 'quoted')?.count || 0;
  const piIssuedCount = (statusCounts || []).find((row) => row.status === 'pi_issued')?.count || 0;
  const wonCount = orders.length;
  const winRate = wonCount + lostCount > 0 ? Math.round((wonCount / (wonCount + lostCount)) * 10000) / 100 : null;

  return json({
    ok: true,
    statusCounts: (statusCounts || []).map((row) => ({ status: row.status, count: row.count, totalAmount: row.total || 0 })),
    committedOrderCount: orders.length,
    reportingCurrency,
    includedOrderCount: orders.length - excludedOrderCount,
    excludedOrderCount,
    missingPaymentCount,
    missingRateCount,
    revenue: Math.round(revenue * 100) / 100,
    freight: Math.round(freight * 100) / 100,
    profit: Math.round(profit * 100) / 100,
    marginPercent: revenue > 0 ? Math.round((profit / revenue) * 10000) / 100 : null,
    winRate,
    quotedCount,
    piIssuedCount,
    hasWarnings
  });
}

async function handleProfitTrend(request, env) {
  const orders = await committedOrders(env, getDateRange(request));
  const reportingCurrency = getReportingCurrency(request);
  const calculateProfit = createProfitCalculator(env, reportingCurrency);
  const byMonth = new Map();

  for (const order of orders) {
    const month = String(order.created_at).slice(0, 7);
    if (!byMonth.has(month)) byMonth.set(month, { month, orderCount: 0, excludedOrderCount: 0, revenue: 0, cost: 0, freight: 0, fees: 0, profit: 0, hasWarnings: false });
    const bucket = byMonth.get(month);
    const result = await calculateProfit(order);
    bucket.orderCount += 1;
    if (result.ok) {
      bucket.revenue += result.revenue;
      bucket.cost += result.totalCost;
      bucket.freight += result.freight;
      bucket.fees += Number(result.bankFee || 0) + Number(result.otherFee || 0);
      bucket.profit += result.profit;
      if (result.hasWarnings) bucket.hasWarnings = true;
    } else {
      bucket.hasWarnings = true;
      bucket.excludedOrderCount += 1;
    }
  }

  const items = Array.from(byMonth.values())
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((bucket) => ({
      ...bucket,
      revenue: Math.round(bucket.revenue * 100) / 100,
      cost: Math.round(bucket.cost * 100) / 100,
      freight: Math.round(bucket.freight * 100) / 100,
      fees: Math.round(bucket.fees * 100) / 100,
      profit: Math.round(bucket.profit * 100) / 100,
      marginPercent: bucket.revenue > 0 ? Math.round((bucket.profit / bucket.revenue) * 10000) / 100 : null
    }));

  return json({ ok: true, reportingCurrency, items });
}

async function handleCustomerAnalysis(request, env) {
  const url = new URL(request.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 10, 1), 100);

  const orders = await committedOrders(env, getDateRange(request));
  const reportingCurrency = getReportingCurrency(request);
  const calculateProfit = createProfitCalculator(env, reportingCurrency);
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
    const result = await calculateProfit(order);
    bucket.orderCount += 1;
    if (result.ok) {
      bucket.revenue += result.revenue;
      bucket.profit += result.profit;
      if (result.hasWarnings) bucket.hasWarnings = true;
    } else bucket.hasWarnings = true;
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

  return json({ ok: true, reportingCurrency, items });
}

async function handleCountryAnalysis(request, env) {
  const orders = await committedOrders(env, getDateRange(request));
  const reportingCurrency = getReportingCurrency(request);
  const calculateProfit = createProfitCalculator(env, reportingCurrency);
  const byCountry = new Map();

  for (const order of orders) {
    const country = order.customer_country || 'Unknown';
    if (!byCountry.has(country)) {
      byCountry.set(country, { country, orderCount: 0, customerIds: new Set(), revenue: 0, profit: 0, hasWarnings: false });
    }
    const bucket = byCountry.get(country);
    const result = await calculateProfit(order);
    bucket.orderCount += 1;
    bucket.customerIds.add(order.customer_id);
    if (result.ok) {
      bucket.revenue += result.revenue;
      bucket.profit += result.profit;
      if (result.hasWarnings) bucket.hasWarnings = true;
    } else bucket.hasWarnings = true;
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

  return json({ ok: true, reportingCurrency, items });
}

async function handleProductAnalysis(request, env) {
  const orders = await committedOrders(env, getDateRange(request));
  const reportingCurrency = getReportingCurrency(request);
  const calculateProfit = createProfitCalculator(env, reportingCurrency);
  const byProduct = new Map();
  const productNameCache = new Map();
  for (const order of orders) {
    const lines = parseJson(order.current_lines_json, []);
    const result = await calculateProfit(order);
    if (!result.ok) continue;
    const orderProfit = result.profit;
    const orderAmount = Number(order.total_amount || 0);
    for (const line of Array.isArray(lines) ? lines : []) {
      const quantity = Math.max(Number(line.qty || 0), 0);
      const amount = Number(line.unitPrice || 0) * quantity;
      const share = orderAmount > 0 ? amount / orderAmount : 0;
      const key = line.productId || 'unknown';
      if (!productNameCache.has(key)) {
        const product = key === 'unknown' ? null : await env.DB.prepare('SELECT name FROM products WHERE id = ?').bind(key).first();
        productNameCache.set(key, product?.name || key);
      }
      if (!byProduct.has(key)) byProduct.set(key, { productName: productNameCache.get(key), orderCount: 0, revenue: 0, profit: 0 });
      const bucket = byProduct.get(key);
      bucket.orderCount += 1;
      bucket.revenue += result.revenue * share;
      bucket.profit += orderProfit * share;
    }
  }
  const items = Array.from(byProduct.values()).map((item) => ({
    ...item,
    revenue: Math.round(item.revenue * 100) / 100,
    profit: Math.round(item.profit * 100) / 100,
    marginPercent: item.revenue > 0 ? Math.round((item.profit / item.revenue) * 10000) / 100 : null
  })).sort((a, b) => b.revenue - a.revenue);
  return json({ ok: true, reportingCurrency, items });
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
  if (path === '/api/dashboard/products') return handleProductAnalysis(request, env);

  return json({ ok: false, error: 'Not found.' }, { status: 404 });
}
