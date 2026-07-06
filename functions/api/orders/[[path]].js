import { json, newId, hasText, parseJson, nowIso, readBody } from '../../_lib/http.js';
import { requireAuth } from '../../_lib/auth.js';

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
  confirm: { allowedFrom: ['pi_issued'], nextStatus: 'confirmed', depositStatus: 'partial' },
  mark_paid: { allowedFrom: ['invoiced'], nextStatus: 'paid', depositStatus: 'paid' },
  close: { allowedFrom: ['paid'], nextStatus: 'closed' },
  mark_lost: { allowedFrom: ['quoted', 'pi_issued', 'confirmed', 'packing_ready', 'invoiced'], nextStatus: 'lost' }
};

const DOC_NO_PREFIX = { quote: 'QT', pi: 'PI', packing_list: 'PL', invoice: 'INV' };

function normalizeOrder(row) {
  if (!row) return null;
  return {
    id: row.id,
    orderNo: row.order_no,
    customerId: row.customer_id,
    status: row.status,
    currency: row.currency,
    lines: parseJson(row.current_lines_json, []),
    incoterm: row.incoterm || '',
    depositStatus: row.deposit_status,
    totalAmount: row.total_amount,
    notes: row.notes || '',
    createdBy: row.created_by || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
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
    issuedAt: row.issued_at
  };
}

function computeTotal(lines) {
  return (Array.isArray(lines) ? lines : []).reduce((sum, line) => {
    const qty = Number(line.qty) || 0;
    const unitPrice = Number(line.unitPrice) || 0;
    return sum + qty * unitPrice;
  }, 0);
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

  let query = 'SELECT * FROM sales_orders';
  const conditions = [];
  const bindings = [];
  if (status) { conditions.push('status = ?'); bindings.push(status); }
  if (customerId) { conditions.push('customer_id = ?'); bindings.push(customerId); }
  if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');
  query += ' ORDER BY created_at DESC';

  const { results } = await env.DB.prepare(query).bind(...bindings).all();
  const items = (results || []).map(normalizeOrder);
  const total = items.length;
  const offset = (page - 1) * pageSize;
  return json({ ok: true, items: items.slice(offset, offset + pageSize), page, pageSize, total });
}

async function handleOrderDetail(env, id) {
  const row = await env.DB.prepare('SELECT * FROM sales_orders WHERE id = ?').bind(id).first();
  if (!row) return json({ ok: false, error: 'Order not found.' }, { status: 404 });
  const { results: docRows } = await env.DB.prepare('SELECT * FROM documents WHERE order_id = ? ORDER BY issued_at ASC').bind(id).all();
  return json({ ok: true, item: { ...normalizeOrder(row), documents: (docRows || []).map(normalizeDocument) } });
}

// Creates the SalesOrder aggregate AND its first Document (type='quote') in
// one call — an order without at least a quote snapshot shouldn't exist.
async function handleCreateOrder(request, env, auth) {
  const body = await readBody(request);
  if (!hasText(body.customerId)) return json({ ok: false, error: 'customerId is required.' }, { status: 400 });
  const customer = await env.DB.prepare('SELECT id FROM customers WHERE id = ?').bind(body.customerId).first();
  if (!customer) return json({ ok: false, error: 'customerId does not exist.' }, { status: 400 });

  const lines = Array.isArray(body.lines) ? body.lines : [];
  if (!lines.length) return json({ ok: false, error: 'lines must be a non-empty array.' }, { status: 400 });
  for (const line of lines) {
    if (!hasText(line.productId)) return json({ ok: false, error: 'each line requires productId.' }, { status: 400 });
    if (!Number.isFinite(Number(line.qty)) || Number(line.qty) <= 0) {
      return json({ ok: false, error: 'each line requires a positive qty.' }, { status: 400 });
    }
  }

  const currency = String(body.currency || 'USD').trim().toUpperCase();
  const now = nowIso();
  const dateStr = now.slice(0, 10);
  const seq = await nextOrderSequence(env, dateStr);
  const orderNo = `SO-${dateStr.replace(/-/g, '')}-${String(seq).padStart(4, '0')}`;

  const id = newId('so');
  const currentLinesJson = JSON.stringify(lines);
  const totalAmount = computeTotal(lines);

  const docId = newId('doc');
  const docSeq = await nextDocumentSequence(env, 'quote', dateStr);
  const docNo = `${DOC_NO_PREFIX.quote}-${dateStr.replace(/-/g, '')}-${String(docSeq).padStart(4, '0')}`;

  // Order + its founding quote document are created atomically — an order
  // must never exist without at least one document snapshot.
  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO sales_orders (id, order_no, customer_id, status, currency, current_lines_json, incoterm, deposit_status, total_amount, notes, created_by, created_at, updated_at)
      VALUES (?, ?, ?, 'quoted', ?, ?, ?, 'unpaid', ?, ?, ?, ?, ?)
    `).bind(
      id, orderNo, body.customerId, currency, currentLinesJson,
      String(body.incoterm || '').trim(), totalAmount, String(body.notes || '').trim(),
      auth.sub, now, now
    ),
    env.DB.prepare(`
      INSERT INTO documents (id, order_id, type, version, doc_no, snapshot_json, issued_by, issued_at)
      VALUES (?, ?, 'quote', 1, ?, ?, ?, ?)
    `).bind(docId, id, docNo, JSON.stringify({ lines, currency, incoterm: body.incoterm || '', totalAmount }), auth.sub, now)
  ]);

  const { results: docRows } = await env.DB.prepare('SELECT * FROM documents WHERE order_id = ? ORDER BY issued_at ASC').bind(id).all();
  const createdOrder = await env.DB.prepare('SELECT * FROM sales_orders WHERE id = ?').bind(id).first();
  return json({ ok: true, item: { ...normalizeOrder(createdOrder), documents: (docRows || []).map(normalizeDocument) } }, { status: 201 });
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
  const snapshot = {
    lines,
    currency: order.currency,
    incoterm: order.incoterm,
    totalAmount: order.total_amount,
    notes: body.note || ''
  };

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

  const detailMatch = path.match(/^\/api\/orders\/([^/]+)$/);
  if (detailMatch) {
    const id = decodeURIComponent(detailMatch[1]);
    if (request.method === 'GET') return handleOrderDetail(env, id);
    if (request.method === 'PATCH') return handleUpdateOrder(request, env, id);
  }

  return json({ ok: false, error: 'Not found.' }, { status: 404 });
}
