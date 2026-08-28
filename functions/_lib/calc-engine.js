import { parseJson } from './http.js';
import { getLatestExchangeRate } from './rates.js';

// Reference safe-loading volumes (m3) per container type. Real max capacity
// is higher; these are commonly-used conservative planning figures.
const CONTAINER_CAPACITY_M3 = { '20GP': 26, '40GP': 54, '40HQ': 64 };

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

// --- Cost calculation -------------------------------------------------
// Cost is never a self-maintained BOM calc — it is whichever supplier price
// tier applies for this product at this quantity. If no supplierId is given,
// falls back to the product's default_supplier_id; if that's also unset,
// picks the cheapest matching tier across all suppliers (and says so).
export async function computeCost(env, { productId, qty, supplierId }) {
  if (!productId) return { ok: false, error: 'productId is required.' };
  const quantity = Number(qty);
  if (!Number.isFinite(quantity) || quantity <= 0) return { ok: false, error: 'qty must be a positive number.' };

  const product = await env.DB.prepare('SELECT id, default_supplier_id FROM products WHERE id = ?').bind(productId).first();
  if (!product) return { ok: false, error: 'productId does not exist.' };

  const resolvedSupplierId = supplierId || product.default_supplier_id || null;
  let tier;
  let pickedCheapest = false;

  if (resolvedSupplierId) {
    tier = await env.DB.prepare(`
      SELECT * FROM supplier_price_tiers
      WHERE product_id = ? AND supplier_id = ? AND min_qty <= ?
      ORDER BY min_qty DESC LIMIT 1
    `).bind(productId, resolvedSupplierId, quantity).first();
  }
  if (!tier) {
    // No supplier specified/resolved, or that supplier has no matching tier
    // — fall back to the cheapest tier across all suppliers for this qty.
    tier = await env.DB.prepare(`
      SELECT * FROM supplier_price_tiers
      WHERE product_id = ? AND min_qty <= ?
      ORDER BY unit_cost ASC LIMIT 1
    `).bind(productId, quantity).first();
    pickedCheapest = true;
  }

  if (!tier) {
    return { ok: false, error: `No supplier price tier found for this product at qty ${quantity}.` };
  }

  return {
    ok: true,
    unitCost: tier.unit_cost,
    currency: tier.currency,
    totalCost: Math.round(tier.unit_cost * quantity * 100) / 100,
    supplierId: tier.supplier_id,
    tierId: tier.id,
    tierMinQty: tier.min_qty,
    pickedCheapestAcrossSuppliers: pickedCheapest
  };
}

// --- Quote price calculation -------------------------------------------
// unit price = cost (converted to targetCurrency) marked up by
// marginPercent (e.g. 20 => cost * 1.20) or a flat marginAmount per unit.
export async function computeQuotePrice(env, { productId, qty, supplierId, marginPercent, marginAmount, targetCurrency }) {
  const costResult = await computeCost(env, { productId, qty, supplierId });
  if (!costResult.ok) return costResult;

  const target = String(targetCurrency || costResult.currency).trim().toUpperCase();
  let unitCostInTarget = costResult.unitCost;
  let fxRate = 1;
  if (target !== costResult.currency) {
    const rate = await getLatestExchangeRate(env, costResult.currency, target, todayStr());
    if (!rate) {
      return { ok: false, error: `No exchange rate found for ${costResult.currency}->${target}.` };
    }
    fxRate = rate.rate;
    unitCostInTarget = Math.round(costResult.unitCost * fxRate * 10000) / 10000;
  }

  let unitPrice;
  if (marginPercent !== undefined && marginPercent !== null) {
    const pct = Number(marginPercent);
    if (!Number.isFinite(pct)) return { ok: false, error: 'marginPercent must be a number.' };
    unitPrice = unitCostInTarget * (1 + pct / 100);
  } else if (marginAmount !== undefined && marginAmount !== null) {
    const amt = Number(marginAmount);
    if (!Number.isFinite(amt)) return { ok: false, error: 'marginAmount must be a number.' };
    unitPrice = unitCostInTarget + amt;
  } else {
    return { ok: false, error: 'Provide marginPercent or marginAmount.' };
  }

  unitPrice = Math.round(unitPrice * 10000) / 10000;
  const qty2 = Number(qty);
  return {
    ok: true,
    unitCost: costResult.unitCost,
    costCurrency: costResult.currency,
    unitCostInTargetCurrency: unitCostInTarget,
    fxRate,
    unitPrice,
    currency: target,
    totalPrice: Math.round(unitPrice * qty2 * 100) / 100,
    supplierId: costResult.supplierId,
    tierId: costResult.tierId
  };
}

// --- CBM / container-load calculation -----------------------------------
// packaging_json is expected to look like:
//   { unitsPerCarton: number, cartonDimensionsCm: { length, width, height } }
// Lines with an incomplete packaging spec are reported individually rather
// than failing the whole request.
export async function computeCbm(env, { lines }) {
  if (!Array.isArray(lines) || !lines.length) return { ok: false, error: 'lines must be a non-empty array.' };

  const lineResults = [];
  let totalCbm = 0;
  let hasWarnings = false;

  for (const line of lines) {
    const productId = line.productId;
    const qty = Number(line.qty);
    if (!productId || !Number.isFinite(qty) || qty <= 0) {
      lineResults.push({ productId: productId || null, ok: false, warning: 'Invalid productId or qty.' });
      hasWarnings = true;
      continue;
    }
    const product = await env.DB.prepare('SELECT id, sku, packaging_json FROM products WHERE id = ?').bind(productId).first();
    if (!product) {
      lineResults.push({ productId, ok: false, warning: 'Product not found.' });
      hasWarnings = true;
      continue;
    }
    const packaging = parseJson(product.packaging_json, {});
    const unitsPerCarton = Number(packaging.unitsPerCarton);
    const dims = packaging.cartonDimensionsCm;
    if (!Number.isFinite(unitsPerCarton) || unitsPerCarton <= 0 || !dims || !dims.length || !dims.width || !dims.height) {
      lineResults.push({ productId, sku: product.sku, ok: false, warning: 'Product packaging spec is incomplete (need unitsPerCarton + cartonDimensionsCm).' });
      hasWarnings = true;
      continue;
    }
    const cartons = Math.ceil(qty / unitsPerCarton);
    const cartonVolumeM3 = (Number(dims.length) * Number(dims.width) * Number(dims.height)) / 1_000_000;
    const lineCbm = Math.round(cartons * cartonVolumeM3 * 10000) / 10000;
    totalCbm += lineCbm;
    lineResults.push({ productId, sku: product.sku, qty, unitsPerCarton, cartons, cartonVolumeM3, lineCbm, ok: true });
  }

  totalCbm = Math.round(totalCbm * 10000) / 10000;

  let suggestedContainers = [];
  let remaining = totalCbm;
  const order = ['40HQ', '40GP', '20GP'];
  for (const type of order) {
    const cap = CONTAINER_CAPACITY_M3[type];
    while (remaining > cap * 0.6 && remaining > 0) {
      // Prefer fewer, larger containers once a line is worth more than
      // ~60% of a container's capacity; otherwise leave it to the smallest box.
      if (remaining <= cap) {
        suggestedContainers.push(type);
        remaining = 0;
      } else {
        suggestedContainers.push(type);
        remaining -= cap;
      }
    }
  }
  if (remaining > 0) suggestedContainers.push('20GP');

  return {
    ok: true,
    lines: lineResults,
    totalCbm,
    suggestedContainers,
    hasWarnings
  };
}

// --- Profit calculation --------------------------------------------------
// revenue comes from the SalesOrder's own total_amount (its currency is the
// reporting currency); cost is re-derived per line via computeCost and
// converted into the order's currency; freight is caller-supplied since
// there is no Shipment/booking aggregate yet (Logistics stays calculation-only).
export async function computeProfit(env, { orderId, freightAmount, freightCurrency }) {
  if (!orderId) return { ok: false, error: 'orderId is required.' };
  const order = await env.DB.prepare('SELECT * FROM sales_orders WHERE id = ?').bind(orderId).first();
  if (!order) return { ok: false, error: 'Order not found.' };

  return computeProfitForOrder(env, order, { freightAmount, freightCurrency });
}

// Dashboard read models already loaded the order rows in one query. Reusing
// that row avoids one extra D1 query for every order without duplicating the
// profit rules used by the order-detail API.
export async function computeProfitForOrder(env, order, { freightAmount, freightCurrency, cache } = {}) {
  if (!order?.id) return { ok: false, error: 'Order is required.' };

  const lines = parseJson(order.current_lines_json, []);
  if (!lines.length) return { ok: false, error: 'Order has no lines.' };

  let totalCostInOrderCurrency = 0;
  const lineCosts = [];
  for (const line of lines) {
    const costKey = `${line.productId || ''}|${Number(line.qty) || ''}|${line.supplierId || ''}`;
    if (cache?.costs && !cache.costs.has(costKey)) {
      cache.costs.set(costKey, computeCost(env, { productId: line.productId, qty: line.qty, supplierId: line.supplierId }));
    }
    const costResult = cache?.costs ? await cache.costs.get(costKey) : await computeCost(env, { productId: line.productId, qty: line.qty, supplierId: line.supplierId });
    if (!costResult.ok) {
      lineCosts.push({ productId: line.productId, ok: false, warning: costResult.error });
      continue;
    }
    let costInOrderCurrency = costResult.totalCost;
    if (costResult.currency !== order.currency) {
      const rateKey = `${costResult.currency}|${order.currency}`;
      if (cache?.rates && !cache.rates.has(rateKey)) {
        cache.rates.set(rateKey, getLatestExchangeRate(env, costResult.currency, order.currency, todayStr()));
      }
      const rate = cache?.rates ? await cache.rates.get(rateKey) : await getLatestExchangeRate(env, costResult.currency, order.currency, todayStr());
      if (!rate) {
        lineCosts.push({ productId: line.productId, ok: false, warning: `No exchange rate ${costResult.currency}->${order.currency}.` });
        continue;
      }
      costInOrderCurrency = Math.round(costResult.totalCost * rate.rate * 100) / 100;
    }
    totalCostInOrderCurrency += costInOrderCurrency;
    lineCosts.push({ productId: line.productId, qty: line.qty, unitCost: costResult.unitCost, costCurrency: costResult.currency, costInOrderCurrency, ok: true });
  }

  let freightInOrderCurrency = 0;
  if (freightAmount !== undefined && freightAmount !== null) {
    const amt = Number(freightAmount);
    if (!Number.isFinite(amt) || amt < 0) return { ok: false, error: 'freightAmount must be a non-negative number.' };
    const fCurrency = String(freightCurrency || order.currency).trim().toUpperCase();
    if (fCurrency !== order.currency) {
      const rateKey = `${fCurrency}|${order.currency}`;
      if (cache?.rates && !cache.rates.has(rateKey)) {
        cache.rates.set(rateKey, getLatestExchangeRate(env, fCurrency, order.currency, todayStr()));
      }
      const rate = cache?.rates ? await cache.rates.get(rateKey) : await getLatestExchangeRate(env, fCurrency, order.currency, todayStr());
      if (!rate) return { ok: false, error: `No exchange rate found for ${fCurrency}->${order.currency}.` };
      freightInOrderCurrency = Math.round(amt * rate.rate * 100) / 100;
    } else {
      freightInOrderCurrency = amt;
    }
  }

  const revenue = order.total_amount;
  const profit = Math.round((revenue - totalCostInOrderCurrency - freightInOrderCurrency) * 100) / 100;
  const marginPercent = revenue > 0 ? Math.round((profit / revenue) * 10000) / 100 : null;

  return {
    ok: true,
    orderId: order.id,
    currency: order.currency,
    revenue,
    totalCost: Math.round(totalCostInOrderCurrency * 100) / 100,
    freight: freightInOrderCurrency,
    profit,
    marginPercent,
    lineCosts,
    hasWarnings: lineCosts.some((item) => !item.ok)
  };
}
