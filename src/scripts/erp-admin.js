// ERP admin UI (Phase 1-4: master data, orders, calculations, dashboard).
// Loaded after admin.js — reuses its globals (apiFetch, getToken, escapeHtml)
// rather than redefining them, since both scripts share the same login/token.

// --- Tab switching -------------------------------------------------------
const tabButtons = document.querySelectorAll('.tab-btn');
const tabSectionMap = {
    inquiries: 'dashboardCard',
    products: 'productsCard',
    suppliers: 'suppliersCard',
    rates: 'ratesCard',
    orders: 'ordersCard',
    erpDashboard: 'erpDashboardCard'
};
let erpBooted = { products: false, suppliers: false, rates: false, orders: false, erpDashboard: false };

tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
        tabButtons.forEach((b) => b.classList.toggle('active', b === btn));
        Object.values(tabSectionMap).forEach((id) => document.getElementById(id).classList.add('hidden'));
        const tab = btn.dataset.tab;
        document.getElementById(tabSectionMap[tab]).classList.remove('hidden');
        bootTab(tab);
    });
});

async function bootTab(tab) {
    if (erpBooted[tab]) return;
    erpBooted[tab] = true;
    if (tab === 'products') { loadSuppliersForSelect(); loadProducts(); }
    if (tab === 'suppliers') { loadSuppliers(); }
    if (tab === 'rates') { loadFxRates(); loadFreightRates(); }
    if (tab === 'orders') { await loadProductsForOrderLines(); loadOrders(); addOrderLine(); }
    if (tab === 'erpDashboard') { loadErpDashboard(); }
}

function fmtMoney(value) {
    return Number(value ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtPercent(value) {
    return value === null || value === undefined ? '-' : `${value}%`;
}

// --- Products --------------------------------------------------------------
let allSuppliers = [];
let allProducts = [];

async function loadSuppliersForSelect() {
    try {
        const res = await apiFetch('/api/suppliers?pageSize=100&status=active');
        allSuppliers = res.items || [];
        const select = document.getElementById('productSupplierSelect');
        select.innerHTML = '<option value="">默认供应商（可选）</option>' +
            allSuppliers.map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('');
    } catch (error) {
        console.error(error);
    }
}

async function loadProducts(q) {
    const rows = document.getElementById('productRows');
    rows.innerHTML = '<tr><td colspan="7" class="muted">加载中...</td></tr>';
    try {
        const query = q ? `?q=${encodeURIComponent(q)}&pageSize=100` : '?pageSize=100';
        const res = await apiFetch(`/api/products${query}`);
        allProducts = res.items || [];
        if (!allProducts.length) {
            rows.innerHTML = '<tr><td colspan="7" class="muted">暂无产品</td></tr>';
            return;
        }
        rows.innerHTML = allProducts.map((p) => {
            const supplierName = allSuppliers.find((s) => s.id === p.defaultSupplierId)?.name || '-';
            const packaging = p.packaging?.unitsPerCarton
                ? `${p.packaging.unitsPerCarton}/箱${p.packaging.cartonDimensionsCm ? ` (${p.packaging.cartonDimensionsCm.length}×${p.packaging.cartonDimensionsCm.width}×${p.packaging.cartonDimensionsCm.height}cm)` : ''}`
                : '未设置';
            return `<tr>
                <td>${escapeHtml(p.sku)}</td>
                <td>${escapeHtml(p.name)}</td>
                <td>${escapeHtml(p.category || '-')}</td>
                <td>${escapeHtml(supplierName)}</td>
                <td>${escapeHtml(packaging)}</td>
                <td><span class="status-pill">${escapeHtml(p.status)}</span></td>
                <td class="row-actions">
                    <button type="button" class="btn-compact btn-outline" data-edit-product="${p.id}">编辑</button>
                    ${p.status === 'active' ? `<button type="button" class="btn-compact btn-muted" data-discontinue-product="${p.id}">停用</button>` : ''}
                </td>
            </tr>`;
        }).join('');
    } catch (error) {
        rows.innerHTML = `<tr><td colspan="7" class="muted">${escapeHtml(error.message)}</td></tr>`;
    }
}

document.getElementById('productForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const id = document.getElementById('productIdInput').value;
    const packaging = {};
    const unitsPerCarton = document.getElementById('productUnitsPerCartonInput').value;
    const l = document.getElementById('productCartonLInput').value;
    const w = document.getElementById('productCartonWInput').value;
    const h = document.getElementById('productCartonHInput').value;
    if (unitsPerCarton) packaging.unitsPerCarton = Number(unitsPerCarton);
    if (l && w && h) packaging.cartonDimensionsCm = { length: Number(l), width: Number(w), height: Number(h) };

    const body = {
        sku: document.getElementById('productSkuInput').value.trim(),
        name: document.getElementById('productNameInput').value.trim(),
        category: document.getElementById('productCategoryInput').value.trim(),
        defaultSupplierId: document.getElementById('productSupplierSelect').value || null,
        packaging
    };
    try {
        if (id) {
            await apiFetch(`/api/products/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
        } else {
            await apiFetch('/api/products', { method: 'POST', body: JSON.stringify(body) });
        }
        resetProductForm();
        loadProducts();
    } catch (error) {
        alert(error.message);
    }
});

function resetProductForm() {
    document.getElementById('productForm').reset();
    document.getElementById('productIdInput').value = '';
    document.getElementById('productSubmitBtn').textContent = '新建产品';
    document.getElementById('productCancelEditBtn').classList.add('hidden');
}

document.getElementById('productCancelEditBtn').addEventListener('click', resetProductForm);
document.getElementById('productSearchBtn').addEventListener('click', () => loadProducts(document.getElementById('productSearchInput').value.trim()));
document.getElementById('productRefreshBtn').addEventListener('click', () => loadProducts());

document.getElementById('productRows').addEventListener('click', async (event) => {
    const editId = event.target.dataset.editProduct;
    const discontinueId = event.target.dataset.discontinueProduct;
    if (editId) {
        const p = allProducts.find((item) => item.id === editId);
        if (!p) return;
        document.getElementById('productIdInput').value = p.id;
        document.getElementById('productSkuInput').value = p.sku;
        document.getElementById('productNameInput').value = p.name;
        document.getElementById('productCategoryInput').value = p.category || '';
        document.getElementById('productSupplierSelect').value = p.defaultSupplierId || '';
        document.getElementById('productUnitsPerCartonInput').value = p.packaging?.unitsPerCarton || '';
        document.getElementById('productCartonLInput').value = p.packaging?.cartonDimensionsCm?.length || '';
        document.getElementById('productCartonWInput').value = p.packaging?.cartonDimensionsCm?.width || '';
        document.getElementById('productCartonHInput').value = p.packaging?.cartonDimensionsCm?.height || '';
        document.getElementById('productSubmitBtn').textContent = '保存修改';
        document.getElementById('productCancelEditBtn').classList.remove('hidden');
    }
    if (discontinueId) {
        if (!confirm('确认停用该产品？（不会删除历史数据）')) return;
        try {
            await apiFetch(`/api/products/${discontinueId}`, { method: 'DELETE' });
            loadProducts();
        } catch (error) {
            alert(error.message);
        }
    }
});

// --- Suppliers ---------------------------------------------------------
let allSuppliersFull = [];
let activeSupplierTierId = '';

async function loadSuppliers(q) {
    const rows = document.getElementById('supplierRows');
    rows.innerHTML = '<tr><td colspan="5" class="muted">加载中...</td></tr>';
    try {
        const query = q ? `?q=${encodeURIComponent(q)}&pageSize=100` : '?pageSize=100';
        const res = await apiFetch(`/api/suppliers${query}`);
        allSuppliersFull = res.items || [];
        if (!allSuppliersFull.length) {
            rows.innerHTML = '<tr><td colspan="5" class="muted">暂无供应商</td></tr>';
            return;
        }
        rows.innerHTML = allSuppliersFull.map((s) => `<tr>
            <td>${escapeHtml(s.name)}</td>
            <td>${escapeHtml(s.contactName || '-')}</td>
            <td>${escapeHtml(s.location || '-')}</td>
            <td><span class="status-pill">${escapeHtml(s.status)}</span></td>
            <td class="row-actions">
                <button type="button" class="btn-compact btn-outline" data-edit-supplier="${s.id}">编辑</button>
                <button type="button" class="btn-compact btn-outline" data-tiers-supplier="${s.id}">价格阶梯</button>
                ${s.status === 'active' ? `<button type="button" class="btn-compact btn-muted" data-deactivate-supplier="${s.id}">停用</button>` : ''}
            </td>
        </tr>`).join('');
    } catch (error) {
        rows.innerHTML = `<tr><td colspan="5" class="muted">${escapeHtml(error.message)}</td></tr>`;
    }
    loadSuppliersForSelect();
}

document.getElementById('supplierForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const id = document.getElementById('supplierIdInput').value;
    const body = {
        name: document.getElementById('supplierNameInput').value.trim(),
        contactName: document.getElementById('supplierContactNameInput').value.trim(),
        contactPhone: document.getElementById('supplierContactPhoneInput').value.trim(),
        contactEmail: document.getElementById('supplierContactEmailInput').value.trim(),
        location: document.getElementById('supplierLocationInput').value.trim(),
        paymentTerms: document.getElementById('supplierPaymentTermsInput').value.trim()
    };
    try {
        if (id) {
            await apiFetch(`/api/suppliers/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
        } else {
            await apiFetch('/api/suppliers', { method: 'POST', body: JSON.stringify(body) });
        }
        resetSupplierForm();
        loadSuppliers();
    } catch (error) {
        alert(error.message);
    }
});

function resetSupplierForm() {
    document.getElementById('supplierForm').reset();
    document.getElementById('supplierIdInput').value = '';
    document.getElementById('supplierSubmitBtn').textContent = '新建供应商';
    document.getElementById('supplierCancelEditBtn').classList.add('hidden');
}

document.getElementById('supplierCancelEditBtn').addEventListener('click', resetSupplierForm);
document.getElementById('supplierSearchBtn').addEventListener('click', () => loadSuppliers(document.getElementById('supplierSearchInput').value.trim()));
document.getElementById('supplierRefreshBtn').addEventListener('click', () => loadSuppliers());

document.getElementById('supplierRows').addEventListener('click', async (event) => {
    const editId = event.target.dataset.editSupplier;
    const deactivateId = event.target.dataset.deactivateSupplier;
    const tiersId = event.target.dataset.tiersSupplier;
    if (editId) {
        const s = allSuppliersFull.find((item) => item.id === editId);
        if (!s) return;
        document.getElementById('supplierIdInput').value = s.id;
        document.getElementById('supplierNameInput').value = s.name;
        document.getElementById('supplierContactNameInput').value = s.contactName || '';
        document.getElementById('supplierContactPhoneInput').value = s.contactPhone || '';
        document.getElementById('supplierContactEmailInput').value = s.contactEmail || '';
        document.getElementById('supplierLocationInput').value = s.location || '';
        document.getElementById('supplierPaymentTermsInput').value = s.paymentTerms || '';
        document.getElementById('supplierSubmitBtn').textContent = '保存修改';
        document.getElementById('supplierCancelEditBtn').classList.remove('hidden');
    }
    if (deactivateId) {
        if (!confirm('确认停用该供应商？')) return;
        try {
            await apiFetch(`/api/suppliers/${deactivateId}`, { method: 'DELETE' });
            loadSuppliers();
        } catch (error) {
            alert(error.message);
        }
    }
    if (tiersId) {
        activeSupplierTierId = tiersId;
        const s = allSuppliersFull.find((item) => item.id === tiersId);
        document.getElementById('tierSupplierName').textContent = s ? s.name : '';
        document.getElementById('tierPanel').classList.remove('hidden');
        const productSelect = document.getElementById('tierProductSelect');
        if (!allProducts.length) await loadProducts();
        productSelect.innerHTML = allProducts.map((p) => `<option value="${p.id}">${escapeHtml(p.sku)} — ${escapeHtml(p.name)}</option>`).join('');
        loadTiers(tiersId);
    }
});

async function loadTiers(supplierId) {
    const rows = document.getElementById('tierRows');
    rows.innerHTML = '<tr><td colspan="5" class="muted">加载中...</td></tr>';
    try {
        const res = await apiFetch(`/api/suppliers/${supplierId}/price-tiers`);
        const items = res.items || [];
        if (!items.length) {
            rows.innerHTML = '<tr><td colspan="5" class="muted">暂无价格阶梯</td></tr>';
            return;
        }
        rows.innerHTML = items.map((t) => {
            const product = allProducts.find((p) => p.id === t.productId);
            return `<tr>
                <td>${escapeHtml(product ? product.sku : t.productId)}</td>
                <td>${t.minQty}</td>
                <td>${fmtMoney(t.unitCost)}</td>
                <td>${escapeHtml(t.currency)}</td>
                <td><button type="button" class="btn-compact btn-muted" data-delete-tier="${t.id}">删除</button></td>
            </tr>`;
        }).join('');
    } catch (error) {
        rows.innerHTML = `<tr><td colspan="5" class="muted">${escapeHtml(error.message)}</td></tr>`;
    }
}

document.getElementById('tierForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const body = {
        productId: document.getElementById('tierProductSelect').value,
        minQty: Number(document.getElementById('tierMinQtyInput').value),
        unitCost: Number(document.getElementById('tierUnitCostInput').value),
        currency: document.getElementById('tierCurrencyInput').value.trim() || 'CNY'
    };
    try {
        await apiFetch(`/api/suppliers/${activeSupplierTierId}/price-tiers`, { method: 'POST', body: JSON.stringify(body) });
        document.getElementById('tierMinQtyInput').value = '';
        document.getElementById('tierUnitCostInput').value = '';
        loadTiers(activeSupplierTierId);
    } catch (error) {
        alert(error.message);
    }
});

document.getElementById('tierRows').addEventListener('click', async (event) => {
    const tierId = event.target.dataset.deleteTier;
    if (!tierId) return;
    if (!confirm('确认删除该价格阶梯？')) return;
    try {
        await apiFetch(`/api/suppliers/${activeSupplierTierId}/price-tiers/${tierId}`, { method: 'DELETE' });
        loadTiers(activeSupplierTierId);
    } catch (error) {
        alert(error.message);
    }
});

// --- Rates ---------------------------------------------------------------
async function loadFxRates() {
    const rows = document.getElementById('fxRows');
    rows.innerHTML = '<tr><td colspan="4" class="muted">加载中...</td></tr>';
    try {
        const res = await apiFetch('/api/exchange-rates');
        const items = res.items || [];
        if (!items.length) {
            rows.innerHTML = '<tr><td colspan="4" class="muted">暂无汇率记录</td></tr>';
            return;
        }
        rows.innerHTML = items.map((r) => `<tr>
            <td>${escapeHtml(r.baseCurrency)}→${escapeHtml(r.quoteCurrency)}</td>
            <td>${r.rate}</td>
            <td>${escapeHtml(r.effectiveDate)}</td>
            <td><button type="button" class="btn-compact btn-muted" data-delete-fx="${r.id}">删除</button></td>
        </tr>`).join('');
    } catch (error) {
        rows.innerHTML = `<tr><td colspan="4" class="muted">${escapeHtml(error.message)}</td></tr>`;
    }
}

document.getElementById('fxForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const body = {
        baseCurrency: document.getElementById('fxBaseInput').value.trim(),
        quoteCurrency: document.getElementById('fxQuoteInput').value.trim(),
        rate: Number(document.getElementById('fxRateInput').value),
        effectiveDate: document.getElementById('fxDateInput').value
    };
    try {
        await apiFetch('/api/exchange-rates', { method: 'POST', body: JSON.stringify(body) });
        document.getElementById('fxForm').reset();
        loadFxRates();
    } catch (error) {
        alert(error.message);
    }
});

document.getElementById('fxRows').addEventListener('click', async (event) => {
    const id = event.target.dataset.deleteFx;
    if (!id) return;
    if (!confirm('确认删除该汇率记录？')) return;
    try {
        await apiFetch(`/api/exchange-rates/${id}`, { method: 'DELETE' });
        loadFxRates();
    } catch (error) {
        alert(error.message);
    }
});

async function loadFreightRates() {
    const rows = document.getElementById('freightRows');
    rows.innerHTML = '<tr><td colspan="4" class="muted">加载中...</td></tr>';
    try {
        const res = await apiFetch('/api/freight-rates');
        const items = res.items || [];
        if (!items.length) {
            rows.innerHTML = '<tr><td colspan="4" class="muted">暂无运费记录</td></tr>';
            return;
        }
        rows.innerHTML = items.map((r) => `<tr>
            <td>${escapeHtml(r.originPort)} → ${escapeHtml(r.destinationPort)}</td>
            <td>${escapeHtml(r.containerType)}</td>
            <td>${fmtMoney(r.rate)} ${escapeHtml(r.currency)}</td>
            <td><button type="button" class="btn-compact btn-muted" data-delete-freight="${r.id}">删除</button></td>
        </tr>`).join('');
    } catch (error) {
        rows.innerHTML = `<tr><td colspan="4" class="muted">${escapeHtml(error.message)}</td></tr>`;
    }
}

document.getElementById('freightForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const body = {
        originPort: document.getElementById('freightOriginInput').value.trim(),
        destinationPort: document.getElementById('freightDestInput').value.trim(),
        containerType: document.getElementById('freightContainerSelect').value,
        rate: Number(document.getElementById('freightRateInput').value),
        currency: document.getElementById('freightCurrencyInput').value.trim() || 'USD'
    };
    try {
        await apiFetch('/api/freight-rates', { method: 'POST', body: JSON.stringify(body) });
        document.getElementById('freightForm').reset();
        loadFreightRates();
    } catch (error) {
        alert(error.message);
    }
});

document.getElementById('freightRows').addEventListener('click', async (event) => {
    const id = event.target.dataset.deleteFreight;
    if (!id) return;
    if (!confirm('确认删除该运费记录？')) return;
    try {
        await apiFetch(`/api/freight-rates/${id}`, { method: 'DELETE' });
        loadFreightRates();
    } catch (error) {
        alert(error.message);
    }
});

// --- Orders ----------------------------------------------------------------
let orderProducts = [];
let allOrders = [];
let orderLineCount = 0;

async function loadProductsForOrderLines() {
    if (!allProducts.length) await loadProducts();
    orderProducts = allProducts;
}

function addOrderLine() {
    orderLineCount += 1;
    const idx = orderLineCount;
    const container = document.getElementById('orderLinesContainer');
    const row = document.createElement('div');
    row.className = 'line-row';
    row.dataset.lineIndex = idx;
    row.innerHTML = `
        <select data-line-product="${idx}">
            <option value="">选择产品</option>
            ${orderProducts.map((p) => `<option value="${p.id}">${escapeHtml(p.sku)} — ${escapeHtml(p.name)}</option>`).join('')}
        </select>
        <input type="number" min="1" step="1" placeholder="数量" data-line-qty="${idx}">
        <input type="number" min="0" step="0.01" placeholder="单价" data-line-price="${idx}">
        <button type="button" class="btn-compact btn-muted" data-remove-line="${idx}">移除</button>
    `;
    container.appendChild(row);
    container.addEventListener('input', updateOrderTotalPreview);
}

document.getElementById('orderLinesContainer').addEventListener('click', (event) => {
    const idx = event.target.dataset.removeLine;
    if (!idx) return;
    event.target.closest('.line-row').remove();
    updateOrderTotalPreview();
});

function updateOrderTotalPreview() {
    const rows = document.querySelectorAll('#orderLinesContainer .line-row');
    let total = 0;
    rows.forEach((row) => {
        const idx = row.dataset.lineIndex;
        const qty = Number(document.querySelector(`[data-line-qty="${idx}"]`)?.value) || 0;
        const price = Number(document.querySelector(`[data-line-price="${idx}"]`)?.value) || 0;
        total += qty * price;
    });
    document.getElementById('orderTotalPreview').textContent = `预计总额：${fmtMoney(total)}`;
}

document.getElementById('addOrderLineBtn').addEventListener('click', addOrderLine);

let orderCustomers = [];
document.getElementById('orderCustomerSearchInput').addEventListener('input', debounce(async (event) => {
    const q = event.target.value.trim();
    try {
        const res = await apiFetch(`/api/customers?q=${encodeURIComponent(q)}&limit=30`);
        orderCustomers = res.items || [];
        const select = document.getElementById('orderCustomerSelect');
        select.innerHTML = '<option value="">选择客户</option>' +
            orderCustomers.map((c) => `<option value="${c.id}">${escapeHtml(c.name)} (${escapeHtml(c.email)})${c.company ? ' — ' + escapeHtml(c.company) : ''}</option>`).join('');
    } catch (error) {
        console.error(error);
    }
}, 300));

function debounce(fn, wait) {
    let timer;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), wait);
    };
}

document.getElementById('createOrderBtn').addEventListener('click', async () => {
    const customerId = document.getElementById('orderCustomerSelect').value;
    if (!customerId) return alert('请先选择客户。');
    const lines = [];
    document.querySelectorAll('#orderLinesContainer .line-row').forEach((row) => {
        const idx = row.dataset.lineIndex;
        const productId = document.querySelector(`[data-line-product="${idx}"]`)?.value;
        const qty = Number(document.querySelector(`[data-line-qty="${idx}"]`)?.value);
        const unitPrice = Number(document.querySelector(`[data-line-price="${idx}"]`)?.value);
        if (productId && qty > 0) lines.push({ productId, qty, unitPrice: unitPrice || 0 });
    });
    if (!lines.length) return alert('请至少添加一行有效的产品行。');

    const body = {
        customerId,
        currency: document.getElementById('orderCurrencyInput').value.trim() || 'USD',
        incoterm: document.getElementById('orderIncotermInput').value.trim(),
        lines
    };
    try {
        await apiFetch('/api/orders', { method: 'POST', body: JSON.stringify(body) });
        document.getElementById('orderLinesContainer').innerHTML = '';
        orderLineCount = 0;
        addOrderLine();
        updateOrderTotalPreview();
        loadOrders();
    } catch (error) {
        alert(error.message);
    }
});

const orderStatusLabel = {
    quoted: '已报价', pi_issued: '已出PI', confirmed: '已确认', packing_ready: '已出装箱单',
    invoiced: '已出发票', paid: '已付款', closed: '已结案', lost: '已流失'
};

async function loadOrders() {
    const rows = document.getElementById('orderRows');
    rows.innerHTML = '<tr><td colspan="6" class="muted">加载中...</td></tr>';
    try {
        const status = document.getElementById('orderStatusFilter').value;
        const query = status ? `?status=${status}&pageSize=100` : '?pageSize=100';
        const res = await apiFetch(`/api/orders${query}`);
        allOrders = res.items || [];
        if (!allOrders.length) {
            rows.innerHTML = '<tr><td colspan="6" class="muted">暂无订单</td></tr>';
            return;
        }
        rows.innerHTML = allOrders.map((o) => `<tr>
            <td>${escapeHtml(o.orderNo)}</td>
            <td><span class="status-pill">${escapeHtml(orderStatusLabel[o.status] || o.status)}</span></td>
            <td>${escapeHtml(o.currency)}</td>
            <td>${fmtMoney(o.totalAmount)}</td>
            <td>${escapeHtml(String(o.createdAt).slice(0, 16).replace('T', ' '))}</td>
            <td><button type="button" class="btn-compact btn-outline" data-view-order="${o.id}">详情</button></td>
        </tr>`).join('');
    } catch (error) {
        rows.innerHTML = `<tr><td colspan="6" class="muted">${escapeHtml(error.message)}</td></tr>`;
    }
}

document.getElementById('orderStatusFilter').addEventListener('change', loadOrders);
document.getElementById('orderRefreshBtn').addEventListener('click', loadOrders);

const DOCUMENT_TYPE_LABEL = { quote: '报价单', pi: 'PI', packing_list: '装箱单', invoice: '发票' };
const ACTION_LABEL = { confirm: '确认订单（收定金）', mark_paid: '标记全款已付', close: '结案', mark_lost: '标记流失' };
// Mirrors the backend's DOCUMENT_RULES/ACTION_RULES in functions/api/orders —
// kept here only to decide which buttons to show; the server re-validates.
const DOC_ALLOWED_FROM = {
    quote: ['quoted'], pi: ['quoted', 'pi_issued'], packing_list: ['confirmed', 'packing_ready'], invoice: ['packing_ready', 'invoiced']
};
const ACTION_ALLOWED_FROM = {
    confirm: ['pi_issued'], mark_paid: ['invoiced'], close: ['paid'],
    mark_lost: ['quoted', 'pi_issued', 'confirmed', 'packing_ready', 'invoiced']
};

let activeOrderId = '';

async function viewOrder(orderId) {
    activeOrderId = orderId;
    const panel = document.getElementById('orderDetailPanel');
    panel.classList.remove('hidden');
    document.getElementById('orderDetailTitle').textContent = '加载中...';
    try {
        const res = await apiFetch(`/api/orders/${orderId}`);
        const order = res.item;
        document.getElementById('orderDetailTitle').textContent = `订单 ${order.orderNo}`;
        document.getElementById('orderDetailMeta').textContent =
            `状态：${orderStatusLabel[order.status] || order.status} | 币种：${order.currency} | 总额：${fmtMoney(order.totalAmount)} | 行数：${order.lines.length}`;

        const actionButtons = Object.keys(ACTION_LABEL)
            .filter((action) => ACTION_ALLOWED_FROM[action].includes(order.status))
            .map((action) => `<button type="button" class="btn-compact" data-order-action="${action}">${ACTION_LABEL[action]}</button>`)
            .join('');
        document.getElementById('orderActionButtons').innerHTML = actionButtons || '<span class="muted">当前状态无可执行操作</span>';

        const docButtons = Object.keys(DOCUMENT_TYPE_LABEL)
            .filter((type) => DOC_ALLOWED_FROM[type].includes(order.status))
            .map((type) => `<button type="button" class="btn-compact btn-outline" data-issue-doc="${type}">出具${DOCUMENT_TYPE_LABEL[type]}</button>`)
            .join('');
        document.getElementById('orderDocButtons').innerHTML = docButtons || '<span class="muted">当前状态无可出具文档</span>';

        const docList = document.getElementById('orderDocList');
        docList.innerHTML = (order.documents || []).map((doc) => `<li>
            <span class="doc-badge">${escapeHtml(DOCUMENT_TYPE_LABEL[doc.type] || doc.type)}</span>
            ${escapeHtml(doc.docNo)} · v${doc.version} · ${escapeHtml(String(doc.issuedAt).slice(0, 16).replace('T', ' '))}
        </li>`).join('') || '<li class="muted">暂无文档</li>';
    } catch (error) {
        document.getElementById('orderDetailTitle').textContent = '加载失败';
        document.getElementById('orderDetailMeta').textContent = error.message;
    }
}

document.getElementById('orderRows').addEventListener('click', (event) => {
    const id = event.target.dataset.viewOrder;
    if (id) viewOrder(id);
});

document.getElementById('orderActionButtons').addEventListener('click', async (event) => {
    const action = event.target.dataset.orderAction;
    if (!action || !activeOrderId) return;
    try {
        await apiFetch(`/api/orders/${activeOrderId}/transition`, { method: 'POST', body: JSON.stringify({ action }) });
        viewOrder(activeOrderId);
        loadOrders();
    } catch (error) {
        alert(error.message);
    }
});

document.getElementById('orderDocButtons').addEventListener('click', async (event) => {
    const type = event.target.dataset.issueDoc;
    if (!type || !activeOrderId) return;
    try {
        await apiFetch(`/api/orders/${activeOrderId}/documents`, { method: 'POST', body: JSON.stringify({ type }) });
        viewOrder(activeOrderId);
        loadOrders();
    } catch (error) {
        alert(error.message);
    }
});

// --- ERP Dashboard -----------------------------------------------------
async function loadErpDashboard() {
    try {
        const summary = await apiFetch('/api/dashboard/summary');
        document.getElementById('erpKpiOrders').textContent = summary.committedOrderCount;
        document.getElementById('erpKpiRevenue').textContent = fmtMoney(summary.revenue);
        document.getElementById('erpKpiProfit').textContent = fmtMoney(summary.profit);
        document.getElementById('erpKpiMargin').textContent = fmtPercent(summary.marginPercent);
        document.getElementById('erpKpiWinRate').textContent = fmtPercent(summary.winRate);
    } catch (error) {
        console.error(error);
    }

    try {
        const profit = await apiFetch('/api/dashboard/profit');
        const rows = document.getElementById('profitTrendRows');
        const items = profit.items || [];
        rows.innerHTML = items.length ? items.map((row) => `<tr>
            <td>${escapeHtml(row.month)}</td>
            <td>${row.orderCount}</td>
            <td>${fmtMoney(row.revenue)}</td>
            <td>${fmtMoney(row.cost)}</td>
            <td>${fmtMoney(row.profit)}</td>
            <td>${fmtPercent(row.marginPercent)}</td>
        </tr>`).join('') : '<tr><td colspan="6" class="muted">暂无数据</td></tr>';
    } catch (error) {
        console.error(error);
    }

    try {
        const customers = await apiFetch('/api/dashboard/customers?limit=10');
        const rows = document.getElementById('customerAnalysisRows');
        const items = customers.items || [];
        rows.innerHTML = items.length ? items.map((row) => `<tr>
            <td>${escapeHtml(row.customerName)}${row.company ? ` (${escapeHtml(row.company)})` : ''}</td>
            <td>${escapeHtml(row.country || '-')}</td>
            <td>${row.orderCount}</td>
            <td>${fmtMoney(row.revenue)}</td>
            <td>${fmtMoney(row.profit)}</td>
        </tr>`).join('') : '<tr><td colspan="5" class="muted">暂无数据</td></tr>';
    } catch (error) {
        console.error(error);
    }

    try {
        const countries = await apiFetch('/api/dashboard/countries');
        const rows = document.getElementById('countryAnalysisRows');
        const items = countries.items || [];
        rows.innerHTML = items.length ? items.map((row) => `<tr>
            <td>${escapeHtml(row.country)}</td>
            <td>${row.customerCount}</td>
            <td>${row.orderCount}</td>
            <td>${fmtMoney(row.revenue)}</td>
            <td>${fmtMoney(row.profit)}</td>
            <td>${fmtPercent(row.marginPercent)}</td>
        </tr>`).join('') : '<tr><td colspan="6" class="muted">暂无数据</td></tr>';
    } catch (error) {
        console.error(error);
    }
}

document.getElementById('erpDashboardRefreshBtn').addEventListener('click', loadErpDashboard);
