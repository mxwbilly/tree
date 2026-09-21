import { json, newId, hasText, parseJson, nowIso, readBody } from '../../_lib/http.js';
import { requireAuth } from '../../_lib/auth.js';
import { getCompanyInfo, getConfiguredCompanyInfo } from '../../_lib/company.js';
import { renderDocumentHtml } from '../../_lib/document-renderer.js';
import { computeCbm, computeProfitForOrder } from '../../_lib/calc-engine.js';
import { sendEmailViaResend } from '../../_lib/mailer.js';

// Issuing a document of `type` is only allowed while the order is in one of
// `allowedFrom`. First issuance advances status to `nextStatus`; issuing
// again while already at `nextStatus` is treated as a revision (status
// unchanged, version bumped).
const DOCUMENT_RULES = {
  quote: { allowedFrom: ['quoted'], nextStatus: 'quoted' },
  pi: { allowedFrom: ['quoted', 'pi_issued'], nextStatus: 'pi_issued' },
  packing_list: { allowedFrom: ['confirmed', 'packing_ready'], nextStatus: 'packing_ready' },
  invoice: { allowedFrom: ['packing_ready', 'invoiced'], nextStatus: 'invoiced' }
};

// Business events that are not document issuance (deposit received, balance
// paid, closing the deal, or losing it at any open stage).
const ACTION_RULES = {
  confirm: { allowedFrom: ['pi_issued'], nextStatus: 'confirmed' },
  close: { allowedFrom: ['paid'], nextStatus: 'closed' },
  mark_lost: { allowedFrom: ['quoted', 'pi_issued', 'confirmed', 'packing_ready', 'invoiced'], nextStatus: 'lost' }
};

const DOC_NO_PREFIX = { quote: 'QT', pi: 'PI', packing_list: 'PL', invoice: 'INV' };
const PRODUCTION_STATUSES = new Set(['not_started', 'in_production', 'quality_inspection', 'ready_to_ship', 'shipped']);
const FULFILLMENT_TIMELINE_NODES = ['production', 'inspection', 'booking', 'customs', 'shipped'];

function normalizeOptionalDate(value) {
  const text = String(value ?? '').trim();
  return text || '';
}

function readFulfillment(input, fallback = {}) {
  const expectedDeliveryDate = normalizeOptionalDate(input.expectedDeliveryDate ?? fallback.expected_delivery_date);
  const estimatedShipmentDate = normalizeOptionalDate(input.estimatedShipmentDate ?? fallback.estimated_shipment_date);
  const actualShipmentDate = normalizeOptionalDate(input.actualShipmentDate ?? fallback.actual_shipment_date);
  const productionStatus = String(input.productionStatus ?? fallback.production_status ?? 'not_started').trim();
  const dates = [expectedDeliveryDate, estimatedShipmentDate, actualShipmentDate];
  if (dates.some((value) => value && !/^\d{4}-\d{2}-\d{2}$/.test(value))) {
    return { error: 'Fulfillment dates must use YYYY-MM-DD.' };
  }
  if (!PRODUCTION_STATUSES.has(productionStatus)) return { error: 'Invalid production status.' };
  return { expectedDeliveryDate, estimatedShipmentDate, actualShipmentDate, productionStatus };
}

function normalizeOrder(row) {
  if (!row) return null;
  const inquiryIds = String(row.inquiry_ids || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  return {
    id: row.id,
    orderNo: row.order_no,
    customerId: row.customer_id,
    inquiryId: inquiryIds[0] || null,
    inquiryIds,
    status: row.status,
    currency: row.currency,
    lines: parseJson(row.current_lines_json, []),
    shipping: parseJson(row.shipping_json, {}),
    expectedDeliveryDate: row.expected_delivery_date || '',
    estimatedShipmentDate: row.estimated_shipment_date || '',
    actualShipmentDate: row.actual_shipment_date || '',
    productionStatus: row.production_status || 'not_started',
    fulfillmentTimeline: parseJson(row.fulfillment_timeline_json, {}),
    incoterm: row.incoterm || '',
    depositStatus: row.deposit_status,
    totalAmount: row.total_amount,
    notes: row.notes || '',
    createdBy: row.created_by || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

const ORDER_WITH_INQUIRIES_SELECT = `
  SELECT sales_orders.*, GROUP_CONCAT(sales_order_inquiries.inquiry_id) AS inquiry_ids
  FROM sales_orders
  LEFT JOIN sales_order_inquiries ON sales_order_inquiries.order_id = sales_orders.id
`;

async function getOrderWithInquiries(env, id) {
  return env.DB.prepare(`${ORDER_WITH_INQUIRIES_SELECT}
    WHERE sales_orders.id = ?
    GROUP BY sales_orders.id
  `).bind(id).first();
}

function normalizeDocument(row) {
  if (!row) return null;
  return {
    id: row.id,
    orderId: row.order_id,
    type: row.type,
    version: row.version,
    docNo: row.doc_no,
    snapshot: parseJson(row.snapshot_json, {}),
    issuedBy: row.issued_by || null,
    issuedAt: row.issued_at,
    mailTo: row.mail_to || '',
    mailStatus: row.mail_status || 'not_sent',
    mailSentAt: row.mail_sent_at || null,
    mailMessageId: row.mail_message_id || null,
    mailAttemptedAt: row.mail_attempted_at || null,
    mailError: row.mail_error || '',
    status: row.status || 'active',
    voidedAt: row.voided_at || null,
    voidedBy: row.voided_by || null,
    voidReason: row.void_reason || ''
  };
}

function normalizePayment(row) {
  if (!row) return null;
  return { id: row.id, orderId: row.order_id, type: row.payment_type, amount: Number(row.amount || 0), currency: row.currency, receivedAt: row.received_at, referenceNo: row.reference_no || '', note: row.note || '', createdAt: row.created_at };
}

function normalizeFinancial(row) {
  return {
    actualProductCost: row.actual_product_cost === null || row.actual_product_cost === undefined ? null : Number(row.actual_product_cost),
    actualFreight: row.actual_freight === null || row.actual_freight === undefined ? null : Number(row.actual_freight),
    bankFee: row.bank_fee === null || row.bank_fee === undefined ? null : Number(row.bank_fee),
    otherFee: row.other_fee === null || row.other_fee === undefined ? null : Number(row.other_fee),
    currency: row.financial_currency || row.currency || '',
    note: row.financial_note || '',
    lockedAt: row.financial_locked_at || null,
    lockedBy: row.financial_locked_by || null
  };
}

function computeTotal(lines) {
  return (Array.isArray(lines) ? lines : []).reduce((sum, line) => {
    const qty = Number(line.qty) || 0;
    const unitPrice = Number(line.unitPrice) || 0;
    return sum + qty * unitPrice;
  }, 0);
}

function freezeSeller(company) {
  return {
    name: String(company?.name || ''),
    legalName: String(company?.legalName || ''),
    addressLines: Array.isArray(company?.addressLines) ? company.addressLines.map((item) => String(item)) : [],
    email: String(company?.email || ''),
    phone: String(company?.phone || ''),
    website: String(company?.website || ''),
    registrationNo: String(company?.registrationNo || ''),
    taxId: String(company?.taxId || ''),
    exportId: String(company?.exportId || ''),
    bankInfo: Array.isArray(company?.bankInfo) ? company.bankInfo.map((item) => String(item)) : []
  };
}

function freezeBuyer(customer) {
  return {
    name: String(customer?.name || ''),
    company: String(customer?.company || ''),
    country: String(customer?.country || ''),
    email: String(customer?.email || ''),
    phone: String(customer?.phone || ''),
    shippingAddress: String(customer?.shipping_address || customer?.shippingAddress || ''),
    billingAddress: String(customer?.billing_address || customer?.billingAddress || ''),
    importerName: String(customer?.importer_name || customer?.importerName || ''),
    importerId: String(customer?.importer_id || customer?.importerId || ''),
    consigneeName: String(customer?.consignee_name || customer?.consigneeName || ''),
    consigneeAddress: String(customer?.consignee_address || customer?.consigneeAddress || ''),
    notifyPartyName: String(customer?.notify_party_name || customer?.notifyPartyName || ''),
    notifyPartyAddress: String(customer?.notify_party_address || customer?.notifyPartyAddress || ''),
    paymentTerms: String(customer?.payment_terms || customer?.paymentTerms || '')
  };
}

function freezeProduct(product, productId) {
  return {
    id: String(product?.id || productId || ''),
    sku: String(product?.sku || productId || ''),
    name: String(product?.name || productId || ''),
    category: String(product?.category || ''),
    hsCode: String(parseJson(product?.spec_json, product?.spec || {})?.hsCode || ''),
    originCountry: String(parseJson(product?.spec_json, product?.spec || {})?.originCountry || ''),
    unit: String(parseJson(product?.spec_json, product?.spec || {})?.unit || ''),
    packaging: parseJson(product?.packaging_json, product?.packaging || {})
  };
}

async function loadSnapshotProducts(env, lines) {
  const products = new Map();
  for (const productId of [...new Set((lines || []).map((line) => line.productId).filter(Boolean))]) {
    const product = await env.DB.prepare('SELECT id, sku, name, category, spec_json, packaging_json FROM products WHERE id = ?').bind(productId).first();
    if (product) products.set(productId, product);
  }
  return products;
}

async function buildDocumentSnapshot(env, { order, customer, type, lines, notes = '' }) {
  const liveLines = Array.isArray(lines) ? lines : [];
  const products = await loadSnapshotProducts(env, liveLines);
  const frozenLines = liveLines.map((line) => ({
    productId: line.productId,
    qty: Number(line.qty) || 0,
    unitPrice: Number(line.unitPrice) || 0,
    product: freezeProduct(products.get(line.productId), line.productId)
  }));
  const shipping = parseJson(order.shipping_json, {});
  const packing = type === 'packing_list'
    ? await computeCbm(env, { lines: liveLines.map((line) => ({ productId: line.productId, qty: line.qty })) })
    : null;
  return {
    snapshotVersion: 2,
    seller: freezeSeller(await getConfiguredCompanyInfo(env)),
    buyer: freezeBuyer(customer),
    order: {
      orderNo: String(order.order_no || ''),
      currency: String(order.currency || ''),
      incoterm: String(order.incoterm || ''),
      expectedDeliveryDate: String(order.expected_delivery_date || ''),
      estimatedShipmentDate: String(order.estimated_shipment_date || ''),
      actualShipmentDate: String(order.actual_shipment_date || '')
    },
    lines: frozenLines,
    currency: String(order.currency || ''),
    incoterm: String(order.incoterm || ''),
    totalAmount: Number(order.total_amount || 0),
    shipping,
    packing,
    notes: String(notes || '')
  };
}

async function buildDocumentRenderData(env, order, doc) {
  const snapshot = doc.snapshot || {};
  const lines = snapshot.lines || [];
  const productMap = new Map();
  lines.forEach((line) => {
    if (line?.product) productMap.set(line.productId, line.product);
  });

  // Legacy records did not contain full snapshots. Keep them readable while
  // all documents issued from snapshotVersion 2 onward remain self-contained.
  const needsCustomerFallback = !snapshot.buyer;
  const needsProductFallback = lines.some((line) => !line.product);
  const customer = needsCustomerFallback
    ? await env.DB.prepare('SELECT * FROM customers WHERE id = ?').bind(order.customer_id).first()
    : null;
  if (needsProductFallback) {
    const fallbackProducts = await loadSnapshotProducts(env, lines);
    fallbackProducts.forEach((product, id) => productMap.set(id, { ...product, packaging: parseJson(product.packaging_json, {}) }));
  }
  const cbmResult = doc.type === 'packing_list' && !snapshot.packing
    ? await computeCbm(env, { lines: lines.map((line) => ({ productId: line.productId, qty: line.qty })) })
    : null;
  return {
    customer: snapshot.buyer || (customer ? freezeBuyer(customer) : null),
    productMap,
    company: snapshot.seller || freezeSeller(getCompanyInfo(env)),
    cbmResult
  };
}

async function nextOrderSequence(env, dateStr) {
  const { results } = await env.DB.prepare(
    "SELECT COUNT(*) as count FROM sales_orders WHERE substr(order_no, 1, 2) = 'SO' AND substr(created_at, 1, 10) = ?"
  ).bind(dateStr).all();
  return (results?.[0]?.count || 0) + 1;
}

async function nextDocumentSequence(env, type, dateStr) {
  const { results } = await env.DB.prepare(
    'SELECT COUNT(*) as count FROM documents WHERE type = ? AND substr(issued_at, 1, 10) = ?'
  ).bind(type, dateStr).all();
  return (results?.[0]?.count || 0) + 1;
}

async function handleListOrders(request, env) {
  const url = new URL(request.url);
  const params = url.searchParams;
  const page = Math.max(1, Number.parseInt(params.get('page') || '1', 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(params.get('pageSize') || '20', 10) || 20));
  const status = String(params.get('status') || '').trim();
  const customerId = String(params.get('customerId') || '').trim();
  const inquiryId = String(params.get('inquiryId') || '').trim();

  const conditions = [];
  const bindings = [];
  if (status) { conditions.push('sales_orders.status = ?'); bindings.push(status); }
  if (customerId) { conditions.push('sales_orders.customer_id = ?'); bindings.push(customerId); }
  if (inquiryId) {
    conditions.push('EXISTS (SELECT 1 FROM sales_order_inquiries soi WHERE soi.order_id = sales_orders.id AND soi.inquiry_id = ?)');
    bindings.push(inquiryId);
  }
  const where = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';
  const totalRow = await env.DB.prepare(`SELECT COUNT(*) AS total FROM sales_orders${where}`).bind(...bindings).first();
  const offset = (page - 1) * pageSize;
  const { results } = await env.DB.prepare(`
    ${ORDER_WITH_INQUIRIES_SELECT}${where}
    GROUP BY sales_orders.id
    ORDER BY sales_orders.created_at DESC
    LIMIT ? OFFSET ?
  `).bind(...bindings, pageSize, offset).all();
  return json({ ok: true, items: (results || []).map(normalizeOrder), page, pageSize, total: Number(totalRow?.total || 0) });
}

async function handleOrderDetail(env, id) {
  const row = await getOrderWithInquiries(env, id);
  if (!row) return json({ ok: false, error: 'Order not found.' }, { status: 404 });
  const { results: docRows } = await env.DB.prepare('SELECT * FROM documents WHERE order_id = ? ORDER BY issued_at ASC').bind(id).all();
  const { results: paymentRows } = await env.DB.prepare('SELECT * FROM payments WHERE order_id = ? ORDER BY received_at DESC, created_at DESC').bind(id).all();
  const profit = await computeProfitForOrder(env, row);
  return json({ ok: true, item: {
    ...normalizeOrder(row),
    financial: normalizeFinancial(row),
    profit: profit.ok ? profit : null,
    documents: (docRows || []).map(normalizeDocument),
    payments: (paymentRows || []).map(normalizePayment)
  } });
}

// Creates the SalesOrder aggregate AND its first Document (type='quote') in
// one call — an order without at least a quote snapshot shouldn't exist.
async function handleCreateOrder(request, env, auth) {
  const body = await readBody(request);
  if (!hasText(body.customerId)) return json({ ok: false, error: 'customerId is required.' }, { status: 400 });
  const customer = await env.DB.prepare('SELECT * FROM customers WHERE id = ?').bind(body.customerId).first();
  if (!customer) return json({ ok: false, error: 'customerId does not exist.' }, { status: 400 });

  const inquiryIds = [...new Set((Array.isArray(body.inquiryIds) ? body.inquiryIds : [body.inquiryId])
    .map((id) => String(id || '').trim())
    .filter(Boolean))];
  const inquiries = [];
  for (const inquiryId of inquiryIds) {
    const inquiry = await env.DB.prepare('SELECT id, customer_id, status, timeline_json FROM inquiries WHERE id = ?').bind(inquiryId).first();
    if (!inquiry) return json({ ok: false, error: 'inquiryId does not exist.' }, { status: 400 });
    if (inquiry.customer_id !== body.customerId) {
      return json({ ok: false, error: 'The selected inquiry does not belong to this customer.' }, { status: 400 });
    }
    const linkedOrder = await env.DB.prepare(`
      SELECT sales_orders.id, sales_orders.order_no
      FROM sales_order_inquiries
      JOIN sales_orders ON sales_orders.id = sales_order_inquiries.order_id
      WHERE sales_order_inquiries.inquiry_id = ?
    `).bind(inquiryId).first();
    if (linkedOrder) {
      return json({ ok: false, error: `Inquiry already has linked quote ${linkedOrder.order_no}.`, orderId: linkedOrder.id }, { status: 409 });
    }
    inquiries.push(inquiry);
  }

  const lines = Array.isArray(body.lines) ? body.lines : [];
  if (!lines.length) return json({ ok: false, error: 'lines must be a non-empty array.' }, { status: 400 });
  for (const line of lines) {
    if (!hasText(line.productId)) return json({ ok: false, error: 'each line requires productId.' }, { status: 400 });
    if (!Number.isFinite(Number(line.qty)) || Number(line.qty) <= 0) {
      return json({ ok: false, error: 'each line requires a positive qty.' }, { status: 400 });
    }
  }

  const currency = String(body.currency || 'USD').trim().toUpperCase();
  const fulfillment = readFulfillment(body);
  if (fulfillment.error) return json({ ok: false, error: fulfillment.error }, { status: 400 });
  const now = nowIso();
  const dateStr = now.slice(0, 10);
  const seq = await nextOrderSequence(env, dateStr);
  const orderNo = `SO-${dateStr.replace(/-/g, '')}-${String(seq).padStart(4, '0')}`;

  const id = newId('so');
  const currentLinesJson = JSON.stringify(lines);
  const totalAmount = computeTotal(lines);
  const orderForSnapshot = {
    order_no: orderNo,
    currency,
    incoterm: String(body.incoterm || '').trim(),
    total_amount: totalAmount,
    shipping_json: '{}',
    expected_delivery_date: fulfillment.expectedDeliveryDate,
    estimated_shipment_date: fulfillment.estimatedShipmentDate,
    actual_shipment_date: fulfillment.actualShipmentDate
  };
  const quoteSnapshot = await buildDocumentSnapshot(env, {
    order: orderForSnapshot,
    customer,
    type: 'quote',
    lines,
    notes: String(body.notes || '').trim()
  });

  const docId = newId('doc');
  const docSeq = await nextDocumentSequence(env, 'quote', dateStr);
  const docNo = `${DOC_NO_PREFIX.quote}-${dateStr.replace(/-/g, '')}-${String(docSeq).padStart(4, '0')}`;

  // Order + its founding quote document are created atomically — an order
  // must never exist without at least one document snapshot.
  const statements = [
    env.DB.prepare(`
      INSERT INTO sales_orders (id, order_no, customer_id, status, currency, current_lines_json, expected_delivery_date, estimated_shipment_date, actual_shipment_date, production_status, incoterm, deposit_status, total_amount, notes, created_by, created_at, updated_at)
      VALUES (?, ?, ?, 'quoted', ?, ?, ?, ?, ?, ?, ?, 'unpaid', ?, ?, ?, ?, ?)
    `).bind(
      id, orderNo, body.customerId, currency, currentLinesJson,
      fulfillment.expectedDeliveryDate || null, fulfillment.estimatedShipmentDate || null, fulfillment.actualShipmentDate || null, fulfillment.productionStatus,
      String(body.incoterm || '').trim(), totalAmount, String(body.notes || '').trim(),
      auth.sub, now, now
    ),
    env.DB.prepare(`
      INSERT INTO documents (id, order_id, type, version, doc_no, snapshot_json, issued_by, issued_at)
      VALUES (?, ?, 'quote', 1, ?, ?, ?, ?)
    `).bind(docId, id, docNo, JSON.stringify(quoteSnapshot), auth.sub, now)
  ];

  for (const inquiry of inquiries) {
    const timeline = parseJson(inquiry.timeline_json, []);
    timeline.push({ at: now, type: 'quote', actorId: auth.sub, note: `Formal quote ${docNo} created and linked to ${orderNo}.` });
    const inquiryStatus = ['new', 'contacted'].includes(inquiry.status) ? 'quoted' : inquiry.status;
    statements.push(
      env.DB.prepare('INSERT INTO sales_order_inquiries (order_id, inquiry_id, created_at) VALUES (?, ?, ?)')
        .bind(id, inquiry.id, now),
      env.DB.prepare('UPDATE inquiries SET status = ?, timeline_json = ?, updated_at = ? WHERE id = ?')
        .bind(inquiryStatus, JSON.stringify(timeline), now, inquiry.id),
      env.DB.prepare(`
        INSERT INTO activity_logs (id, type, actor_id, target_id, payload_json, created_at)
        VALUES (?, 'order.created_from_inquiry', ?, ?, ?, ?)
      `).bind(newId('log'), auth.sub, inquiry.id, JSON.stringify({ orderId: id, orderNo, docId, docNo }), now)
    );
  }

  await env.DB.batch(statements);

  const { results: docRows } = await env.DB.prepare('SELECT * FROM documents WHERE order_id = ? ORDER BY issued_at ASC').bind(id).all();
  const createdOrder = await getOrderWithInquiries(env, id);
  return json({ ok: true, item: { ...normalizeOrder(createdOrder), documents: (docRows || []).map(normalizeDocument) } }, { status: 201 });
}

async function handleAttachInquiryToOrder(request, env, auth, orderId) {
  const order = await getOrderWithInquiries(env, orderId);
  if (!order) return json({ ok: false, error: 'Order not found.' }, { status: 404 });
  if (order.status !== 'quoted') {
    return json({ ok: false, error: 'Only a quotation draft can accept another inquiry product.' }, { status: 409 });
  }

  const body = await readBody(request);
  const inquiryId = String(body.inquiryId || '').trim();
  if (!inquiryId) return json({ ok: false, error: 'inquiryId is required.' }, { status: 400 });
  const inquiry = await env.DB.prepare('SELECT id, customer_id, status, timeline_json FROM inquiries WHERE id = ?').bind(inquiryId).first();
  if (!inquiry) return json({ ok: false, error: 'Inquiry not found.' }, { status: 404 });
  if (inquiry.customer_id !== order.customer_id) {
    return json({ ok: false, error: 'The inquiry belongs to a different customer.' }, { status: 400 });
  }
  const existingLink = await env.DB.prepare('SELECT order_id FROM sales_order_inquiries WHERE inquiry_id = ?').bind(inquiryId).first();
  if (existingLink) {
    return json({ ok: false, error: 'This inquiry is already linked to a quotation.', orderId: existingLink.order_id }, { status: 409 });
  }

  const lines = Array.isArray(body.lines) ? body.lines : [];
  if (!lines.length) return json({ ok: false, error: 'lines must be a non-empty array.' }, { status: 400 });
  for (const line of lines) {
    if (!hasText(line.productId) || !Number.isFinite(Number(line.qty)) || Number(line.qty) <= 0) {
      return json({ ok: false, error: 'Each line requires a product and positive quantity.' }, { status: 400 });
    }
  }

  const now = nowIso();
  const nextLines = [...parseJson(order.current_lines_json, []), ...lines];
  const timeline = parseJson(inquiry.timeline_json, []);
  timeline.push({ at: now, type: 'quote', actorId: auth.sub, note: `Product line added to formal quote ${order.order_no}.` });
  const inquiryStatus = ['new', 'contacted'].includes(inquiry.status) ? 'quoted' : inquiry.status;
  await env.DB.batch([
    env.DB.prepare('INSERT INTO sales_order_inquiries (order_id, inquiry_id, created_at) VALUES (?, ?, ?)')
      .bind(orderId, inquiryId, now),
    env.DB.prepare('UPDATE sales_orders SET current_lines_json = ?, total_amount = ?, updated_at = ? WHERE id = ?')
      .bind(JSON.stringify(nextLines), computeTotal(nextLines), now, orderId),
    env.DB.prepare('UPDATE inquiries SET status = ?, timeline_json = ?, updated_at = ? WHERE id = ?')
      .bind(inquiryStatus, JSON.stringify(timeline), now, inquiryId),
    env.DB.prepare(`
      INSERT INTO activity_logs (id, type, actor_id, target_id, payload_json, created_at)
      VALUES (?, 'order.inquiry_attached', ?, ?, ?, ?)
    `).bind(newId('log'), auth.sub, inquiryId, JSON.stringify({ orderId, orderNo: order.order_no, lineCount: lines.length }), now)
  ]);
  return handleOrderDetail(env, orderId);
}

async function handleUpdateOrder(request, env, id) {
  const existing = await env.DB.prepare('SELECT * FROM sales_orders WHERE id = ?').bind(id).first();
  if (!existing) return json({ ok: false, error: 'Order not found.' }, { status: 404 });
  if (['paid', 'closed', 'lost'].includes(existing.status)) {
    return json({ ok: false, error: `Cannot edit an order in "${existing.status}" status.` }, { status: 409 });
  }

  const body = await readBody(request);
  const nextLines = Array.isArray(body.lines) ? body.lines : parseJson(existing.current_lines_json, []);
  const nextIncoterm = typeof body.incoterm === 'string' ? body.incoterm.trim() : existing.incoterm;
  const nextNotes = typeof body.notes === 'string' ? body.notes.trim() : existing.notes;
  const totalAmount = computeTotal(nextLines);

  await env.DB.prepare(`
    UPDATE sales_orders
    SET current_lines_json = ?, incoterm = ?, notes = ?, total_amount = ?, updated_at = ?
    WHERE id = ?
  `).bind(JSON.stringify(nextLines), nextIncoterm, nextNotes, totalAmount, nowIso(), id).run();

  return handleOrderDetail(env, id);
}

function normalizeShipping(input) {
  const value = input && typeof input === 'object' ? input : {};
  const freightAmount = String(value.freightAmount ?? '').trim();
  const dates = ['bookingDate', 'customsDate', 'actualShipmentDate'];
  if (dates.some((key) => value[key] && !/^\d{4}-\d{2}-\d{2}$/.test(String(value[key])))) return { error: '货代节点日期必须使用 YYYY-MM-DD。' };
  return {
    forwarder: String(value.forwarder || '').trim(),
    forwarderContact: String(value.forwarderContact || '').trim(),
    bookingNo: String(value.bookingNo || '').trim(),
    bookingDate: String(value.bookingDate || '').trim(),
    containerType: String(value.containerType || '').trim(),
    containerNo: String(value.containerNo || '').trim(),
    sealNo: String(value.sealNo || '').trim(),
    vesselVoyage: String(value.vesselVoyage || '').trim(),
    customsNo: String(value.customsNo || '').trim(),
    customsDate: String(value.customsDate || '').trim(),
    originPort: String(value.originPort || '').trim(),
    destinationPort: String(value.destinationPort || '').trim(),
    shippingMarks: String(value.shippingMarks || '').trim(),
    actualShipmentDate: String(value.actualShipmentDate || '').trim(),
    freightAmount: freightAmount !== '' && Number.isFinite(Number(freightAmount)) && Number(freightAmount) >= 0 ? Number(freightAmount) : null,
    freightCurrency: String(value.freightCurrency || '').trim().toUpperCase().slice(0, 3),
    freightRef: String(value.freightRef || '').trim(),
    forwarderNote: String(value.forwarderNote || '').trim()
  };
}

async function handleUpdateShipping(request, env, id) {
  const existing = await env.DB.prepare('SELECT * FROM sales_orders WHERE id = ?').bind(id).first();
  if (!existing) return json({ ok: false, error: 'Order not found.' }, { status: 404 });
  if (['closed', 'lost'].includes(existing.status)) {
    return json({ ok: false, error: `Cannot edit logistics for an order in "${existing.status}" status.` }, { status: 409 });
  }
  const body = await readBody(request);
  const shipping = normalizeShipping(body.shipping);
  if (shipping.error) return json({ ok: false, error: shipping.error }, { status: 400 });
  const actualShipmentDate = shipping.actualShipmentDate || null;
  await env.DB.prepare('UPDATE sales_orders SET shipping_json = ?, updated_at = ? WHERE id = ?')
    .bind(JSON.stringify(shipping), nowIso(), id).run();
  await env.DB.prepare('UPDATE sales_orders SET actual_shipment_date = ?, production_status = CASE WHEN ? IS NOT NULL THEN \'shipped\' ELSE production_status END, updated_at = ? WHERE id = ?')
    .bind(actualShipmentDate, actualShipmentDate, nowIso(), id).run();
  return handleOrderDetail(env, id);
}

async function handleUpdateFulfillment(request, env, id) {
  const existing = await env.DB.prepare('SELECT * FROM sales_orders WHERE id = ?').bind(id).first();
  if (!existing) return json({ ok: false, error: 'Order not found.' }, { status: 404 });
  if (['closed', 'lost'].includes(existing.status)) {
    return json({ ok: false, error: `Cannot edit fulfillment for an order in "${existing.status}" status.` }, { status: 409 });
  }
  const body = await readBody(request);
  const fulfillment = readFulfillment(body, existing);
  if (fulfillment.error) return json({ ok: false, error: fulfillment.error }, { status: 400 });
  await env.DB.prepare(`
    UPDATE sales_orders
    SET expected_delivery_date = ?, estimated_shipment_date = ?, actual_shipment_date = ?, production_status = ?, updated_at = ?
    WHERE id = ?
  `).bind(
    fulfillment.expectedDeliveryDate || null, fulfillment.estimatedShipmentDate || null,
    fulfillment.actualShipmentDate || null, fulfillment.productionStatus, nowIso(), id
  ).run();
  return handleOrderDetail(env, id);
}

function normalizeFulfillmentTimeline(input) {
  const source = input && typeof input === 'object' ? input : {};
  const timeline = {};
  for (const node of FULFILLMENT_TIMELINE_NODES) {
    const item = source[node] && typeof source[node] === 'object' ? source[node] : {};
    const date = normalizeOptionalDate(item.date);
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: '履约节点日期必须使用 YYYY-MM-DD。' };
    timeline[node] = { date, note: String(item.note || '').trim().slice(0, 500) };
  }
  return timeline;
}

async function handleUpdateFulfillmentTimeline(request, env, id) {
  const existing = await env.DB.prepare('SELECT * FROM sales_orders WHERE id = ?').bind(id).first();
  if (!existing) return json({ ok: false, error: 'Order not found.' }, { status: 404 });
  if (['closed', 'lost'].includes(existing.status)) {
    return json({ ok: false, error: `Cannot edit fulfillment timeline for an order in "${existing.status}" status.` }, { status: 409 });
  }
  const body = await readBody(request);
  const timeline = normalizeFulfillmentTimeline(body.timeline);
  if (timeline.error) return json({ ok: false, error: timeline.error }, { status: 400 });
  await env.DB.prepare('UPDATE sales_orders SET fulfillment_timeline_json = ?, updated_at = ? WHERE id = ?')
    .bind(JSON.stringify(timeline), nowIso(), id).run();
  return handleOrderDetail(env, id);
}

async function handleTransition(request, env, id) {
  const existing = await env.DB.prepare('SELECT * FROM sales_orders WHERE id = ?').bind(id).first();
  if (!existing) return json({ ok: false, error: 'Order not found.' }, { status: 404 });

  const body = await readBody(request);
  const action = String(body.action || '').trim();
  const rule = ACTION_RULES[action];
  if (!rule) return json({ ok: false, error: `Unknown action "${action}".` }, { status: 400 });
  if (!rule.allowedFrom.includes(existing.status)) {
    return json({ ok: false, error: `Action "${action}" is not allowed from status "${existing.status}".` }, { status: 409 });
  }

  const now = nowIso();
  if (rule.depositStatus) {
    await env.DB.prepare('UPDATE sales_orders SET status = ?, deposit_status = ?, updated_at = ? WHERE id = ?')
      .bind(rule.nextStatus, rule.depositStatus, now, id).run();
  } else {
    await env.DB.prepare('UPDATE sales_orders SET status = ?, updated_at = ? WHERE id = ?')
      .bind(rule.nextStatus, now, id).run();
  }

  return handleOrderDetail(env, id);
}

async function handleCreatePayment(request, env, auth, orderId) {
  const order = await env.DB.prepare('SELECT * FROM sales_orders WHERE id = ?').bind(orderId).first();
  if (!order) return json({ ok: false, error: 'Order not found.' }, { status: 404 });
  if (!['confirmed', 'packing_ready', 'invoiced', 'paid'].includes(order.status)) {
    return json({ ok: false, error: 'Confirm the order before recording payment.' }, { status: 409 });
  }
  const body = await readBody(request);
  const type = String(body.type || '').trim();
  const amount = Number(body.amount);
  const receivedAt = String(body.receivedAt || '').trim();
  if (!['deposit', 'balance', 'full'].includes(type)) return json({ ok: false, error: 'Invalid payment type.' }, { status: 400 });
  if (!Number.isFinite(amount) || amount <= 0) return json({ ok: false, error: 'Payment amount must be greater than zero.' }, { status: 400 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(receivedAt)) return json({ ok: false, error: 'Received date is required.' }, { status: 400 });

  const paidRow = await env.DB.prepare('SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE order_id = ?').bind(orderId).first();
  const paidBefore = Number(paidRow?.total || 0);
  if (paidBefore + amount > Number(order.total_amount || 0) + 0.0001) {
    return json({ ok: false, error: 'Payment amount exceeds the order total.' }, { status: 409 });
  }
  const now = nowIso();
  const receivedTotal = paidBefore + amount;
  const isFullyPaid = receivedTotal + 0.0001 >= Number(order.total_amount || 0);
  const nextStatus = isFullyPaid && order.status === 'invoiced' ? 'paid' : order.status;
  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO payments (id, order_id, payment_type, amount, currency, received_at, reference_no, note, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(newId('pay'), orderId, type, amount, order.currency, receivedAt, String(body.referenceNo || '').trim(), String(body.note || '').trim(), auth.sub, now),
    env.DB.prepare('UPDATE sales_orders SET status = ?, deposit_status = ?, updated_at = ? WHERE id = ?')
      .bind(nextStatus, isFullyPaid ? 'paid' : 'partial', now, orderId)
  ]);
  return handleOrderDetail(env, orderId);
}

async function handleLockFinancials(request, env, auth, orderId) {
  const order = await env.DB.prepare('SELECT * FROM sales_orders WHERE id = ?').bind(orderId).first();
  if (!order) return json({ ok: false, error: 'Order not found.' }, { status: 404 });
  if (!['paid', 'closed'].includes(order.status)) {
    return json({ ok: false, error: '请在订单收清后再锁定实际成本与费用。' }, { status: 409 });
  }
  if (order.financial_locked_at) return json({ ok: false, error: '该订单的实际成本与费用已锁定。' }, { status: 409 });
  const body = await readBody(request);
  const actualProductCost = Number(body.actualProductCost);
  const actualFreight = Number(body.actualFreight || 0);
  const bankFee = Number(body.bankFee || 0);
  const otherFee = Number(body.otherFee || 0);
  const values = [actualProductCost, actualFreight, bankFee, otherFee];
  if (values.some((value) => !Number.isFinite(value) || value < 0)) {
    return json({ ok: false, error: '实际成本、运费和费用必须是大于或等于 0 的数字。' }, { status: 400 });
  }
  const now = nowIso();
  await env.DB.batch([
    env.DB.prepare(`
      UPDATE sales_orders
      SET actual_product_cost = ?, actual_freight = ?, bank_fee = ?, other_fee = ?, financial_currency = ?, financial_note = ?, financial_locked_at = ?, financial_locked_by = ?, updated_at = ?
      WHERE id = ?
    `).bind(actualProductCost, actualFreight, bankFee, otherFee, order.currency, String(body.note || '').trim(), now, auth.sub, now, orderId),
    env.DB.prepare('INSERT INTO activity_logs (id, type, actor_id, target_id, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(newId('log'), 'order.financials_locked', auth.sub, orderId, JSON.stringify({
        orderNo: order.order_no, actualProductCost, actualFreight, bankFee, otherFee, currency: order.currency, note: String(body.note || '').trim()
      }), now)
  ]);
  return handleOrderDetail(env, orderId);
}

async function handleListDocuments(env, orderId) {
  const order = await env.DB.prepare('SELECT id FROM sales_orders WHERE id = ?').bind(orderId).first();
  if (!order) return json({ ok: false, error: 'Order not found.' }, { status: 404 });
  const { results } = await env.DB.prepare('SELECT * FROM documents WHERE order_id = ? ORDER BY issued_at ASC').bind(orderId).all();
  return json({ ok: true, items: (results || []).map(normalizeDocument) });
}

async function handleDocumentDetail(env, orderId, docId) {
  const row = await env.DB.prepare('SELECT * FROM documents WHERE id = ? AND order_id = ?').bind(docId, orderId).first();
  if (!row) return json({ ok: false, error: 'Document not found.' }, { status: 404 });
  return json({ ok: true, item: normalizeDocument(row) });
}

// Print-friendly HTML for a single document snapshot — the v1 "PDF" path
// (browser Print to PDF), since Workers has no filesystem/Puppeteer. Shares
// the Calculation Engine's computeCbm for packing lists rather than
// re-deriving cartons/CBM here.
async function handleRenderDocument(env, orderId, docId) {
  const order = await env.DB.prepare('SELECT * FROM sales_orders WHERE id = ?').bind(orderId).first();
  if (!order) return new Response('Order not found.', { status: 404 });
  const docRow = await env.DB.prepare('SELECT * FROM documents WHERE id = ? AND order_id = ?').bind(docId, orderId).first();
  if (!docRow) return new Response('Document not found.', { status: 404 });
  const doc = normalizeDocument(docRow);

  const renderData = await buildDocumentRenderData(env, order, doc);

  const html = renderDocumentHtml({
    order: normalizeOrder(order),
    doc,
    ...renderData
  });

  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

async function handleSendDocument(env, auth, orderId, docId) {
  const order = await env.DB.prepare('SELECT * FROM sales_orders WHERE id = ?').bind(orderId).first();
  if (!order) return json({ ok: false, error: 'Order not found.' }, { status: 404 });
  const docRow = await env.DB.prepare('SELECT * FROM documents WHERE id = ? AND order_id = ?').bind(docId, orderId).first();
  if (!docRow) return json({ ok: false, error: 'Document not found.' }, { status: 404 });
  const doc = normalizeDocument(docRow);
  if (doc.status === 'voided') return json({ ok: false, error: '已作废单据不可发送邮件。' }, { status: 409 });
  if (doc.mailStatus === 'sending') return json({ ok: false, error: '该单据正在发送中，请稍后刷新查看结果。' }, { status: 409 });
  const renderData = await buildDocumentRenderData(env, order, doc);
  const recipient = String(renderData.customer?.email || '').trim();
  if (!recipient) return json({ ok: false, error: 'Customer email is missing. Update the customer profile before sending.' }, { status: 409 });
  const html = renderDocumentHtml({
    order: normalizeOrder(order), doc,
    ...renderData
  });
  const label = { quote: 'Quotation', pi: 'Proforma Invoice', packing_list: 'Packing List', invoice: 'Commercial Invoice' }[doc.type] || 'Document';
  const attemptAt = nowIso();
  await env.DB.prepare('UPDATE documents SET mail_to = ?, mail_status = ?, mail_attempted_at = ?, mail_error = ? WHERE id = ?')
    .bind(recipient, 'sending', attemptAt, null, docId)
    .run();
  const result = await sendEmailViaResend(env, {
    to: recipient,
    subject: `[GreenSmart] ${label} ${doc.docNo}`,
    text: `Dear ${renderData.customer?.name || 'Customer'},\n\nPlease find ${label} ${doc.docNo} below.\n\nBest regards,\nGreenSmart`,
    html
  });
  const now = nowIso();
  const status = result.ok ? 'accepted' : 'failed';
  await env.DB.batch([
    env.DB.prepare('UPDATE documents SET mail_to = ?, mail_status = ?, mail_sent_at = ?, mail_attempted_at = ?, mail_error = ?, mail_message_id = ? WHERE id = ?')
      .bind(recipient, status, result.ok ? now : doc.mailSentAt, now, result.ok ? null : (result.error || '邮件服务未接受本次发送。'), result.id || null, docId),
    env.DB.prepare('INSERT INTO activity_logs (id, type, actor_id, target_id, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(newId('log'), 'mail.document_send', auth.sub, docId, JSON.stringify({
        id: result.id || null, ok: result.ok, error: result.error || null, recipient,
        orderId, orderNo: order.order_no, docId, docNo: doc.docNo, documentType: doc.type
      }), now)
  ]);
  if (!result.ok) return json({ ok: false, error: result.error || 'Document email was not accepted.' }, { status: 502 });
  const updated = await env.DB.prepare('SELECT * FROM documents WHERE id = ?').bind(docId).first();
  return json({ ok: true, item: normalizeDocument(updated) });
}

// Documents are never deleted: the number and snapshot remain auditable.
// Only documents that have not reached the customer can be voided.
async function handleVoidDocument(request, env, auth, orderId, docId) {
  const order = await env.DB.prepare('SELECT id, order_no FROM sales_orders WHERE id = ?').bind(orderId).first();
  if (!order) return json({ ok: false, error: 'Order not found.' }, { status: 404 });
  const row = await env.DB.prepare('SELECT * FROM documents WHERE id = ? AND order_id = ?').bind(docId, orderId).first();
  if (!row) return json({ ok: false, error: 'Document not found.' }, { status: 404 });
  const doc = normalizeDocument(row);
  if (doc.status === 'voided') return json({ ok: false, error: '该单据已作废。' }, { status: 409 });
  if (['sent', 'accepted'].includes(doc.mailStatus)) {
    return json({ ok: false, error: '该单据已发送给客户，不能直接作废。请出具修订版本并与客户确认。' }, { status: 409 });
  }
  const body = await readBody(request);
  const reason = String(body.reason || '').trim();
  if (!reason) return json({ ok: false, error: '请填写作废原因。' }, { status: 400 });
  const now = nowIso();
  await env.DB.batch([
    env.DB.prepare('UPDATE documents SET status = ?, voided_at = ?, voided_by = ?, void_reason = ? WHERE id = ?')
      .bind('voided', now, auth.sub, reason, docId),
    env.DB.prepare('INSERT INTO activity_logs (id, type, actor_id, target_id, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(newId('log'), 'document.voided', auth.sub, docId, JSON.stringify({
        orderId, orderNo: order.order_no, docId, docNo: doc.docNo, documentType: doc.type, reason
      }), now)
  ]);
  const updated = await env.DB.prepare('SELECT * FROM documents WHERE id = ?').bind(docId).first();
  return json({ ok: true, item: normalizeDocument(updated) });
}

// The core Document-snapshot operation: freeze the order's current lines
// into an immutable record, auto-advance the order's status per
// DOCUMENT_RULES, and compute the next version/doc number.
async function handleIssueDocument(request, env, auth, orderId) {
  const order = await env.DB.prepare('SELECT * FROM sales_orders WHERE id = ?').bind(orderId).first();
  if (!order) return json({ ok: false, error: 'Order not found.' }, { status: 404 });

  const body = await readBody(request);
  const type = String(body.type || '').trim();
  const rule = DOCUMENT_RULES[type];
  if (!rule) return json({ ok: false, error: `Unknown document type "${type}".` }, { status: 400 });
  if (!rule.allowedFrom.includes(order.status)) {
    return json({ ok: false, error: `Cannot issue "${type}" while order status is "${order.status}".` }, { status: 409 });
  }

  const { results: existingOfType } = await env.DB.prepare(
    'SELECT version FROM documents WHERE order_id = ? AND type = ? ORDER BY version DESC LIMIT 1'
  ).bind(orderId, type).all();
  const version = (existingOfType?.[0]?.version || 0) + 1;

  const lines = parseJson(order.current_lines_json, []);
  const customer = await env.DB.prepare('SELECT * FROM customers WHERE id = ?').bind(order.customer_id).first();
  const snapshot = await buildDocumentSnapshot(env, {
    order,
    customer,
    type,
    lines,
    notes: String(body.note || '')
  });

  const now = nowIso();
  const dateStr = now.slice(0, 10);
  const docSeq = await nextDocumentSequence(env, type, dateStr);
  const docNo = `${DOC_NO_PREFIX[type]}-${dateStr.replace(/-/g, '')}-${String(docSeq).padStart(4, '0')}`;

  const docId = newId('doc');
  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO documents (id, order_id, type, version, doc_no, snapshot_json, issued_by, issued_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(docId, orderId, type, version, docNo, JSON.stringify(snapshot), auth.sub, now),
    env.DB.prepare('UPDATE sales_orders SET status = ?, updated_at = ? WHERE id = ?')
      .bind(rule.nextStatus, now, orderId)
  ]);

  const created = await env.DB.prepare('SELECT * FROM documents WHERE id = ?').bind(docId).first();
  return json({ ok: true, item: normalizeDocument(created) }, { status: 201 });
}

export async function onRequest(context) {
  const { request, env } = context;
  if (!env.DB) {
    return json({ ok: false, error: 'D1 binding DB is not configured.' }, { status: 500 });
  }

  const authResult = await requireAuth(request, env, ['admin', 'sales']);
  if (authResult.response) return authResult.response;
  const auth = authResult.auth;

  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';

  if (path === '/api/orders' && request.method === 'GET') return handleListOrders(request, env);
  if (path === '/api/orders' && request.method === 'POST') return handleCreateOrder(request, env, auth);

  const transitionMatch = path.match(/^\/api\/orders\/([^/]+)\/transition$/);
  if (transitionMatch && request.method === 'POST') {
    return handleTransition(request, env, decodeURIComponent(transitionMatch[1]));
  }

  const paymentCollectionMatch = path.match(/^\/api\/orders\/([^/]+)\/payments$/);
  if (paymentCollectionMatch && request.method === 'POST') {
    return handleCreatePayment(request, env, auth, decodeURIComponent(paymentCollectionMatch[1]));
  }

  const financialLockMatch = path.match(/^\/api\/orders\/([^/]+)\/financials\/lock$/);
  if (financialLockMatch && request.method === 'POST') {
    return handleLockFinancials(request, env, auth, decodeURIComponent(financialLockMatch[1]));
  }

  const shippingMatch = path.match(/^\/api\/orders\/([^/]+)\/shipping$/);
  if (shippingMatch && request.method === 'POST') {
    return handleUpdateShipping(request, env, decodeURIComponent(shippingMatch[1]));
  }

  const fulfillmentMatch = path.match(/^\/api\/orders\/([^/]+)\/fulfillment$/);
  if (fulfillmentMatch && request.method === 'POST') {
    return handleUpdateFulfillment(request, env, decodeURIComponent(fulfillmentMatch[1]));
  }

  const fulfillmentTimelineMatch = path.match(/^\/api\/orders\/([^/]+)\/fulfillment-timeline$/);
  if (fulfillmentTimelineMatch && request.method === 'POST') {
    return handleUpdateFulfillmentTimeline(request, env, decodeURIComponent(fulfillmentTimelineMatch[1]));
  }

  const inquiryCollectionMatch = path.match(/^\/api\/orders\/([^/]+)\/inquiries$/);
  if (inquiryCollectionMatch && request.method === 'POST') {
    return handleAttachInquiryToOrder(request, env, auth, decodeURIComponent(inquiryCollectionMatch[1]));
  }

  const docCollectionMatch = path.match(/^\/api\/orders\/([^/]+)\/documents$/);
  if (docCollectionMatch) {
    const orderId = decodeURIComponent(docCollectionMatch[1]);
    if (request.method === 'GET') return handleListDocuments(env, orderId);
    if (request.method === 'POST') return handleIssueDocument(request, env, auth, orderId);
  }

  const docItemMatch = path.match(/^\/api\/orders\/([^/]+)\/documents\/([^/]+)$/);
  if (docItemMatch && request.method === 'GET') {
    return handleDocumentDetail(env, decodeURIComponent(docItemMatch[1]), decodeURIComponent(docItemMatch[2]));
  }

  const docRenderMatch = path.match(/^\/api\/orders\/([^/]+)\/documents\/([^/]+)\/render$/);
  if (docRenderMatch && request.method === 'GET') {
    return handleRenderDocument(env, decodeURIComponent(docRenderMatch[1]), decodeURIComponent(docRenderMatch[2]));
  }

  const docSendMatch = path.match(/^\/api\/orders\/([^/]+)\/documents\/([^/]+)\/send$/);
  if (docSendMatch && request.method === 'POST') {
    return handleSendDocument(env, auth, decodeURIComponent(docSendMatch[1]), decodeURIComponent(docSendMatch[2]));
  }

  const docVoidMatch = path.match(/^\/api\/orders\/([^/]+)\/documents\/([^/]+)\/void$/);
  if (docVoidMatch && request.method === 'POST') {
    return handleVoidDocument(request, env, auth, decodeURIComponent(docVoidMatch[1]), decodeURIComponent(docVoidMatch[2]));
  }

  const detailMatch = path.match(/^\/api\/orders\/([^/]+)$/);
  if (detailMatch) {
    const id = decodeURIComponent(detailMatch[1]);
    if (request.method === 'GET') return handleOrderDetail(env, id);
    if (request.method === 'PATCH') return handleUpdateOrder(request, env, id);
  }

  return json({ ok: false, error: 'Not found.' }, { status: 404 });
}
