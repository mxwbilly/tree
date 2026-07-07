// Renders a Document snapshot (quote/pi/packing_list/invoice) as a
// print-friendly HTML page. No PDF library is used — Cloudflare Workers has
// no filesystem/browser sandbox for Puppeteer-style rendering, so the v1
// path is: clean HTML + the browser's own "Print to PDF". One template
// shared across all 4 document types (a `type` switch inside), per the
// original DocumentRenderer design — not four separate implementations.
const DOC_TITLE = {
  quote: 'QUOTATION',
  pi: 'PROFORMA INVOICE',
  packing_list: 'PACKING LIST',
  invoice: 'COMMERCIAL INVOICE'
};

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmt(value) {
  return Number(value ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function baseStyles() {
  return `
    * { box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; color: #1a1a1a; margin: 0; padding: 32px; font-size: 13px; }
    .sheet { max-width: 780px; margin: 0 auto; }
    .header { display: flex; justify-content: space-between; border-bottom: 3px solid #16a34a; padding-bottom: 16px; margin-bottom: 20px; }
    .company-name { font-size: 20px; font-weight: 700; color: #16a34a; margin: 0 0 6px; }
    .muted { color: #555; line-height: 1.5; }
    .doc-title { font-size: 22px; font-weight: 700; text-align: right; margin: 0 0 6px; letter-spacing: 1px; }
    .doc-meta { text-align: right; font-size: 12px; color: #555; line-height: 1.6; }
    .parties { display: flex; justify-content: space-between; gap: 24px; margin-bottom: 20px; }
    .party-box { flex: 1; border: 1px solid #ddd; border-radius: 6px; padding: 10px 14px; }
    .party-box h4 { margin: 0 0 6px; font-size: 11px; text-transform: uppercase; color: #16a34a; letter-spacing: 0.5px; }
    table.lines { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
    table.lines th, table.lines td { border: 1px solid #ddd; padding: 8px 10px; font-size: 12.5px; text-align: left; }
    table.lines th { background: #f4f6f8; }
    table.lines td.num, table.lines th.num { text-align: right; }
    .totals { display: flex; justify-content: flex-end; margin-bottom: 20px; }
    .totals table { border-collapse: collapse; }
    .totals td { padding: 6px 12px; font-size: 13px; }
    .totals tr.grand td { font-weight: 700; font-size: 15px; border-top: 2px solid #16a34a; }
    .section-box { border: 1px solid #ddd; border-radius: 6px; padding: 12px 14px; margin-bottom: 16px; }
    .section-box h4 { margin: 0 0 6px; font-size: 12px; color: #16a34a; }
    .footer { margin-top: 40px; display: flex; justify-content: space-between; }
    .sign-box { width: 220px; border-top: 1px solid #999; margin-top: 50px; text-align: center; font-size: 12px; color: #555; padding-top: 6px; }
    .warning { color: #b45309; font-size: 12px; }
    @media print {
      body { padding: 0; }
      .no-print { display: none; }
    }
    .print-bar { text-align: center; margin-bottom: 20px; }
    .print-bar button { background: #16a34a; color: #fff; border: none; border-radius: 8px; padding: 8px 18px; font-size: 14px; cursor: pointer; }
  `;
}

function renderPartyBlock(company, customer) {
  return `
    <div class="parties">
      <div class="party-box">
        <h4>Seller</h4>
        <strong>${escapeHtml(company.name)}</strong><br>
        ${company.addressLines.map((line) => escapeHtml(line)).join('<br>')}
        ${company.addressLines.length ? '<br>' : ''}
        ${company.email ? `Email: ${escapeHtml(company.email)}<br>` : ''}
        ${company.phone ? `Tel: ${escapeHtml(company.phone)}<br>` : ''}
        ${company.website ? `${escapeHtml(company.website)}` : ''}
      </div>
      <div class="party-box">
        <h4>Buyer</h4>
        <strong>${escapeHtml(customer?.name || '-')}</strong><br>
        ${customer?.company ? `${escapeHtml(customer.company)}<br>` : ''}
        ${customer?.country ? `${escapeHtml(customer.country)}<br>` : ''}
        ${customer?.email ? `Email: ${escapeHtml(customer.email)}<br>` : ''}
        ${customer?.phone ? `Tel: ${escapeHtml(customer.phone)}` : ''}
      </div>
    </div>
  `;
}

function renderPricingTable(lines, productMap, currency) {
  const rows = lines.map((line) => {
    const product = productMap.get(line.productId);
    const qty = Number(line.qty) || 0;
    const unitPrice = Number(line.unitPrice) || 0;
    const lineTotal = qty * unitPrice;
    return `<tr>
      <td>${escapeHtml(product?.sku || line.productId)}</td>
      <td>${escapeHtml(product?.name || '-')}</td>
      <td class="num">${qty.toLocaleString('en-US')}</td>
      <td class="num">${fmt(unitPrice)}</td>
      <td class="num">${fmt(lineTotal)}</td>
    </tr>`;
  }).join('');
  return `
    <table class="lines">
      <thead><tr><th>SKU</th><th>Description</th><th class="num">Qty</th><th class="num">Unit Price (${escapeHtml(currency)})</th><th class="num">Amount (${escapeHtml(currency)})</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function renderPackingTable(lines, productMap, cbmResult) {
  const cbmByProduct = new Map();
  if (cbmResult?.ok) {
    for (const line of cbmResult.lines) {
      if (line.ok) cbmByProduct.set(line.productId, line);
    }
  }
  const rows = lines.map((line) => {
    const product = productMap.get(line.productId);
    const cbmLine = cbmByProduct.get(line.productId);
    const qty = Number(line.qty) || 0;
    return `<tr>
      <td>${escapeHtml(product?.sku || line.productId)}</td>
      <td>${escapeHtml(product?.name || '-')}</td>
      <td class="num">${qty.toLocaleString('en-US')}</td>
      <td class="num">${cbmLine ? cbmLine.cartons : '-'}</td>
      <td class="num">${cbmLine ? cbmLine.lineCbm.toFixed(3) : '-'}</td>
    </tr>`;
  }).join('');
  const totalRow = cbmResult?.ok
    ? `<tr><td colspan="4" style="text-align:right;font-weight:700;">Total CBM</td><td class="num" style="font-weight:700;">${cbmResult.totalCbm.toFixed(3)} m³</td></tr>`
    : '';
  const warning = cbmResult?.hasWarnings
    ? '<p class="warning">Some lines are missing carton packaging specs (units/carton or carton dimensions) — cartons/CBM could not be computed for them. Update the product\'s packaging info to include them.</p>'
    : '';
  const suggestion = cbmResult?.ok && cbmResult.suggestedContainers?.length
    ? `<p class="muted">Suggested container(s): ${cbmResult.suggestedContainers.join(' + ')}</p>`
    : '';
  return `
    <table class="lines">
      <thead><tr><th>SKU</th><th>Description</th><th class="num">Qty</th><th class="num">Cartons</th><th class="num">CBM (m³)</th></tr></thead>
      <tbody>${rows}${totalRow}</tbody>
    </table>
    ${warning}${suggestion}
  `;
}

export function renderDocumentHtml({ order, doc, customer, productMap, company, cbmResult }) {
  const snapshot = doc.snapshot;
  const title = DOC_TITLE[doc.type] || doc.type.toUpperCase();
  const isPackingList = doc.type === 'packing_list';
  const isInvoiceLike = doc.type === 'invoice' || doc.type === 'pi';

  const bodyTable = isPackingList
    ? renderPackingTable(snapshot.lines, productMap, cbmResult)
    : renderPricingTable(snapshot.lines, productMap, snapshot.currency);

  const totalsBlock = !isPackingList ? `
    <div class="totals">
      <table>
        <tr><td>Incoterm</td><td>${escapeHtml(snapshot.incoterm || '-')}</td></tr>
        <tr class="grand"><td>Total (${escapeHtml(snapshot.currency)})</td><td>${fmt(snapshot.totalAmount)}</td></tr>
      </table>
    </div>
  ` : '';

  const bankBlock = isInvoiceLike && company.bankInfo.length ? `
    <div class="section-box">
      <h4>Payment Details</h4>
      ${company.bankInfo.map((line) => escapeHtml(line)).join('<br>')}
    </div>
  ` : '';

  const notesBlock = snapshot.notes ? `
    <div class="section-box"><h4>Notes</h4>${escapeHtml(snapshot.notes)}</div>
  ` : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${escapeHtml(title)} ${escapeHtml(doc.docNo)}</title>
<style>${baseStyles()}</style>
</head>
<body>
  <div class="print-bar no-print"><button onclick="window.print()">Print / Save as PDF</button></div>
  <div class="sheet">
    <div class="header">
      <div>
        <p class="company-name">${escapeHtml(company.name)}</p>
        <p class="muted">Order: ${escapeHtml(order.orderNo)}</p>
      </div>
      <div>
        <p class="doc-title">${escapeHtml(title)}</p>
        <p class="doc-meta">
          No: ${escapeHtml(doc.docNo)}${doc.version > 1 ? ` (Rev.${doc.version})` : ''}<br>
          Date: ${escapeHtml(String(doc.issuedAt).slice(0, 10))}
        </p>
      </div>
    </div>
    ${renderPartyBlock(company, customer)}
    ${bodyTable}
    ${totalsBlock}
    ${bankBlock}
    ${notesBlock}
    <div class="footer">
      <div class="sign-box">Seller Signature</div>
      <div class="sign-box">Buyer Acknowledgement</div>
    </div>
  </div>
</body>
</html>`;
}
