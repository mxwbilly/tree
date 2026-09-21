#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = __dirname;
const wranglerBin = path.join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const configPath = path.join(root, 'wrangler.example.jsonc');
const dataPath = path.join(root, '.wrangler', 'qa-schema');
const requiredTables = [
    'users', 'customers', 'inquiries', 'settings', 'activity_logs', 'suppliers',
    'products', 'supplier_price_tiers', 'exchange_rates', 'freight_rates',
    'sales_orders', 'payments', 'sales_order_inquiries', 'documents'
];

function runWrangler(args) {
    const result = spawnSync(process.execPath, [wranglerBin, ...args], {
        cwd: root,
        encoding: 'utf8',
        windowsHide: true,
        env: { ...process.env, XDG_CONFIG_HOME: path.join(root, '.wrangler-config') }
    });
    if (result.status !== 0) throw new Error((result.stderr || result.stdout || 'Wrangler command failed.').trim());
    return `${result.stdout}\n${result.stderr}`;
}

function assertContains(text, expected, label) {
    if (!text.includes(expected)) throw new Error(`${label}: missing ${expected}`);
}

try {
    fs.rmSync(dataPath, { recursive: true, force: true });
    const commonArgs = ['d1', 'execute', 'DB', '--local', '--persist-to', dataPath, '--config', configPath];
    runWrangler([...commonArgs, '--file', path.join(root, 'schema.sql')]);

    const tableOutput = runWrangler([...commonArgs, '--command', "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name;"]);
    requiredTables.forEach((table) => assertContains(tableOutput, `"name": "${table}"`, 'schema table check'));
    const orderColumns = runWrangler([...commonArgs, '--command', 'PRAGMA table_info(sales_orders);']);
    ['expected_delivery_date', 'estimated_shipment_date', 'actual_shipment_date', 'production_status']
        .forEach((column) => assertContains(orderColumns, `"name": "${column}"`, 'order fulfillment column check'));
    assertContains(orderColumns, '"name": "fulfillment_timeline_json"', 'fulfillment timeline column check');
    ['actual_product_cost', 'actual_freight', 'bank_fee', 'other_fee', 'financial_currency', 'financial_locked_at']
        .forEach((column) => assertContains(orderColumns, `"name": "${column}"`, 'order financial column check'));
    const documentColumns = runWrangler([...commonArgs, '--command', 'PRAGMA table_info(documents);']);
    ['status', 'voided_at', 'voided_by', 'void_reason']
        .forEach((column) => assertContains(documentColumns, `"name": "${column}"`, 'document void column check'));
    ['mail_attempted_at', 'mail_error']
        .forEach((column) => assertContains(documentColumns, `"name": "${column}"`, 'document mail tracking column check'));

    const seedSql = [
        "INSERT INTO customers (id, email, name, inquiry_count, created_at, updated_at) VALUES ('qa_customer', 'qa@example.test', 'QA Buyer', 0, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');",
        "INSERT INTO inquiries (id, customer_id, status, lang, source, page_url, product, message, contact_json, timeline_json, quotes_json, created_at, updated_at) VALUES ('qa_inquiry', 'qa_customer', 'new', 'en', 'qa', '/qa', 'qa-product', 'QA inquiry', '{}', '[]', '[]', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');",
        "INSERT INTO inquiries (id, customer_id, status, lang, source, page_url, product, message, contact_json, timeline_json, quotes_json, created_at, updated_at) VALUES ('qa_inquiry_2', 'qa_customer', 'new', 'en', 'qa', '/qa', 'qa-product-2', 'QA second inquiry', '{}', '[]', '[]', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');",
        "INSERT INTO sales_orders (id, order_no, customer_id, status, currency, current_lines_json, deposit_status, total_amount, created_at, updated_at) VALUES ('qa_order', 'SO-QA-0001', 'qa_customer', 'quoted', 'USD', '[]', 'unpaid', 0, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');",
        "INSERT INTO sales_order_inquiries (order_id, inquiry_id, created_at) VALUES ('qa_order', 'qa_inquiry', '2026-01-01T00:00:00.000Z');",
        "INSERT INTO sales_order_inquiries (order_id, inquiry_id, created_at) VALUES ('qa_order', 'qa_inquiry_2', '2026-01-01T00:00:00.000Z');"
    ].join(' ');
    runWrangler([...commonArgs, '--command', seedSql]);
    const inquiryOutput = runWrangler([...commonArgs, '--command', "SELECT COUNT(*) AS inquiry_count FROM inquiries WHERE id = 'qa_inquiry';"]);
    assertContains(inquiryOutput, '"inquiry_count": 1', 'schema inquiry write check');
    const linkedOrderOutput = runWrangler([...commonArgs, '--command', "SELECT COUNT(*) AS linked_inquiry_count FROM sales_order_inquiries WHERE order_id = 'qa_order';"]);
    assertContains(linkedOrderOutput, '"linked_inquiry_count": 2', 'schema consolidated inquiry/order relation check');
    console.log(`[QA] PASS - D1 schema created ${requiredTables.length} core tables and accepted a consolidated inquiry/order write.`);
} catch (error) {
    console.error(`[QA] FAIL - D1 schema check failed: ${error.message}`);
    process.exitCode = 1;
} finally {
    fs.rmSync(dataPath, { recursive: true, force: true });
}
