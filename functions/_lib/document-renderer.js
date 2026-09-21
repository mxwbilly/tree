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
    .terms-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px 18px; }
    .terms-grid div { min-width: 0; line-height: 1.45; }
    .terms-grid strong { color: #555; }
    .footer { margin-top: 40px; display: flex; justify-content: space-between; }
    .sign-box { width: 220px; border-top: 1px solid #999; margin-top: 50px; text-align: center; font-size: 12px; color: #555; padding-top: 6px; }
    .warning { color: #b45309; font-size: 12px; }
    .void-banner { border: 2px solid #dc2626; color: #b91c1c; background: #fef2f2; padding: 10px 14px; margin: 0 0 18px; font-weight: 700; font-size: 16px; text-align: center; }
    .void-banner small { display: block; margin-top: 5px; font-size: 12px; font-weight: 400; color: #7f1d1d; }
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
        ${company.legalName ? `${escapeHtml(company.legalName)}<br>` : ''}
        ${company.addressLines.map((line) => escapeHtml(line)).join('<br>')}
        ${company.addressLines.length ? '<br>' : ''}
        ${company.email ? `Email: ${escapeHtml(company.email)}<br>` : ''}
        ${company.phone ? `Tel: ${escapeHtml(company.phone)}<br>` : ''}
        ${company.registrationNo ? `Registration No: ${escapeHtml(company.registrationNo)}<br>` : ''}
        ${company.taxId ? `Tax ID: ${escapeHtml(company.taxId)}<br>` : ''}
        ${company.exportId ? `Export ID: ${escapeHtml(company.exportId)}<br>` : ''}
        ${company.website ? `${escapeHtml(company.website)}` : ''}
      </div>
      <div class="party-box">
        <h4>Buyer</h4>
        <strong>${escapeHtml(customer?.name || '-')}</strong><br>
        ${customer?.company ? `${escapeHtml(customer.company)}<br>` : ''}
        ${customer?.country ? `${escapeHtml(customer.country)}<br>` : ''}
        ${customer?.email ? `Email: ${escapeHtml(customer.email)}<br>` : ''}
        ${customer?.phone ? `Tel: ${escapeHtml(customer.phone)}<br>` : ''}
        ${customer?.shippingAddress ? `Address: ${escapeHtml(customer.shippingAddress)}<br>` : ''}
        ${customer?.billingAddress ? `Billing: ${escapeHtml(customer.billingAddress)}<br>` : ''}
        ${customer?.importerName ? `Importer: ${escapeHtml(customer.importerName)}${customer.importerId ? ` (${escapeHtml(customer.importerId)})` : ''}<br>` : ''}
        ${customer?.consigneeName ? `Consignee: ${escapeHtml(customer.consigneeName)}<br>` : ''}
        ${customer?.notifyPartyName ? `Notify Party: ${escapeHtml(customer.notifyPartyName)}<br>` : ''}
      </div>
    </div>
  `;
}

function productForLine(line, productMap) {
  return line?.product || productMap.get(line?.productId) || {};
}

function renderPricingTable(lines, productMap, currency) {
  const showTradeFields = lines.some((line) => {
    const product = productForLine(line, productMap);
    return product?.hsCode || product?.originCountry;
  });
  const rows = lines.map((line) => {
    const product = productForLine(line, productMap);
    const qty = Number(line.qty) || 0;
    const unitPrice = Number(line.unitPrice) || 0;
    const lineTotal = qty * unitPrice;
    return `<tr>
      <td>${escapeHtml(product?.sku || line.productId)}</td>
      <td>${escapeHtml(product?.name || '-')}</td>
      ${showTradeFields ? `<td>${escapeHtml(product?.hsCode || '-')}</td><td>${escapeHtml(product?.originCountry || '-')}</td>` : ''}
      <td class="num">${qty.toLocaleString('en-US')}</td>
      <td class="num">${fmt(unitPrice)}</td>
      <td class="num">${fmt(lineTotal)}</td>
    </tr>`;
  }).join('');
  return `
    <table class="lines">
      <thead><tr><th>SKU</th><th>Description</th>${showTradeFields ? '<th>HS Code</th><th>Origin</th>' : ''}<th class="num">Qty</th><th class="num">Unit Price (${escapeHtml(currency)})</th><th class="num">Amount (${escapeHtml(currency)})</th></tr></thead>
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
    const product = productForLine(line, productMap);
    const cbmLine = cbmByProduct.get(line.productId);
    const dimensions = product?.packaging?.cartonDimensionsCm;
    const cartonSize = dimensions && [dimensions.length, dimensions.width, dimensions.height].every((value) => Number(value) > 0)
      ? `${Number(dimensions.length)} x ${Number(dimensions.width)} x ${Number(dimensions.height)}`
      : '-';
    const qty = Number(line.qty) || 0;
    return `<tr>
      <td>${escapeHtml(product?.sku || line.productId)}</td>
      <td>${escapeHtml(product?.name || '-')}</td>
      <td class="num">${qty.toLocaleString('en-US')}</td>
      <td class="num">${cbmLine?.unitsPerCarton || '-'}</td>
      <td class="num">${cbmLine ? cbmLine.cartons : '-'}</td>
      <td class="num">${cartonSize}</td>
      <td class="num">${cbmLine ? cbmLine.lineCbm.toFixed(3) : '-'}</td>
    </tr>`;
  }).join('');
  const totalCartons = cbmResult?.ok
    ? cbmResult.lines.filter((line) => line.ok).reduce((sum, line) => sum + Number(line.cartons || 0), 0)
    : 0;
  const totalRow = cbmResult?.ok
    ? `<tr><td colspan="5" style="text-align:right;font-weight:700;">Total cartons / CBM</td><td class="num" style="font-weight:700;">${totalCartons}</td><td class="num" style="font-weight:700;">${cbmResult.totalCbm.toFixed(3)} m³</td></tr>`
    : '';
  const warning = cbmResult?.hasWarnings
    ? '<p class="warning">Some lines are missing carton packaging specs (units/carton or carton dimensions) — cartons/CBM could not be computed for them. Update the product\'s packaging info to include them.</p>'
    : '';
  const suggestion = cbmResult?.ok && cbmResult.suggestedContainers?.length
    ? `<p class="muted">Suggested container(s): ${cbmResult.suggestedContainers.join(' + ')}</p>`
    : '';
  return `
    <table class="lines">
      <thead><tr><th>SKU</th><th>Description</th><th class="num">Qty</th><th class="num">Units / carton</th><th class="num">Cartons</th><th class="num">Carton size (L x W x H cm)</th><th class="num">CBM (m³)</th></tr></thead>
      <tbody>${rows}${totalRow}</tbody>
    </table>
    ${warning}${suggestion}
  `;
}

function renderShippingBlock(shipping) {
  const details = [
    ['Forwarder', shipping?.forwarder],
    ['Forwarder Contact', shipping?.forwarderContact],
    ['Booking No.', shipping?.bookingNo],
    ['Booking Date', shipping?.bookingDate],
    ['Customs No.', shipping?.customsNo],
    ['Customs Date', shipping?.customsDate],
    ['Container', shipping?.containerType],
    ['Container No.', shipping?.containerNo],
    ['Seal No.', shipping?.sealNo],
    ['Vessel / Voyage', shipping?.vesselVoyage],
    ['Port of Loading', shipping?.originPort],
    ['Port of Discharge', shipping?.destinationPort],
    ['Actual Shipment Date', shipping?.actualShipmentDate],
    ['Freight', shipping?.freightAmount ? `${shipping.freightCurrency || ''} ${fmt(shipping.freightAmount)}`.trim() : ''],
    ['Freight Reference', shipping?.freightRef],
    ['Shipping Marks', shipping?.shippingMarks],
    ['Forwarder Note', shipping?.forwarderNote]
  ].filter(([, value]) => value);
  if (!details.length) return '<div class="section-box"><h4>Shipping Details</h4><span class="muted">Not specified</span></div>';
  return `<div class="section-box"><h4>Shipping Details</h4><div class="terms-grid">${details.map(([label, value]) => `<div><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</div>`).join('')}</div></div>`;
}

function renderTermsBlock(snapshot, buyer, shipping, isPackingList) {
  const order = snapshot.order || {};
  const details = [
    ['Incoterm', snapshot.incoterm || order.incoterm],
    ['Payment Terms', buyer?.paymentTerms],
    ['Expected Delivery', order.expectedDeliveryDate],
    ['Estimated Shipment', order.estimatedShipmentDate],
    ['Actual Shipment', order.actualShipmentDate],
    ...(!isPackingList ? [
      ['Port of Loading', shipping?.originPort],
      ['Port of Discharge', shipping?.destinationPort]
    ] : [])
  ].filter(([, value]) => value);
  if (!details.length) return '';
  return `<div class="section-box"><h4>Trade &amp; Delivery Terms</h4><div class="terms-grid">${details.map(([label, value]) => `<div><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</div>`).join('')}</div></div>`;
}

export function renderDocumentHtml({ order, doc, customer, productMap, company, cbmResult }) {
  const snapshot = doc.snapshot;
  const seller = snapshot.seller || company;
  const buyer = snapshot.buyer || customer;
  const title = DOC_TITLE[doc.type] || doc.type.toUpperCase();
  const isPackingList = doc.type === 'packing_list';
  const isInvoiceLike = doc.type === 'invoice' || doc.type === 'pi';

  const bodyTable = isPackingList
    ? renderPackingTable(snapshot.lines, productMap, snapshot.packing || cbmResult)
    : renderPricingTable(snapshot.lines, productMap, snapshot.currency);

  const totalsBlock = !isPackingList ? `
    <div class="totals">
      <table>
        <tr><td>Incoterm</td><td>${escapeHtml(snapshot.incoterm || '-')}</td></tr>
        <tr class="grand"><td>Total (${escapeHtml(snapshot.currency)})</td><td>${fmt(snapshot.totalAmount)}</td></tr>
      </table>
    </div>
  ` : '';

  const bankBlock = isInvoiceLike && seller.bankInfo.length ? `
    <div class="section-box">
      <h4>Payment Details</h4>
      ${seller.bankInfo.map((line) => escapeHtml(line)).join('<br>')}
    </div>
  ` : '';

  const termsBlock = renderTermsBlock(snapshot, buyer, snapshot.shipping, isPackingList);
  const shippingBlock = isPackingList ? renderShippingBlock(snapshot.shipping) : '';

  const notesBlock = snapshot.notes ? `
    <div class="section-box"><h4>Notes</h4>${escapeHtml(snapshot.notes)}</div>
  ` : '';
  const voidBanner = doc.status === 'voided' ? `
    <div class="void-banner">VOID / 已作废
      <small>作废时间：${escapeHtml(String(doc.voidedAt || '').slice(0, 16).replace('T', ' ') || '-')}<br>作废原因：${escapeHtml(doc.voidReason || '-')}</small>
    </div>
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
        <p class="company-name">${escapeHtml(seller.name)}</p>
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
    ${voidBanner}
    ${renderPartyBlock(seller, buyer)}
    ${termsBlock}
    ${shippingBlock}
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
