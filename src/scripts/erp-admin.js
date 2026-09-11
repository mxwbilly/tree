// ERP admin UI (Phase 1-4: master data, orders, calculations, dashboard).
// Loaded after admin.js — reuses its globals (apiFetch, getToken, escapeHtml)
// rather than redefining them, since both scripts share the same login/token.

// --- Tab switching -------------------------------------------------------
const settingsCard = document.getElementById('settingsCard');
if (settingsCard) document.getElementById('adminApp').appendChild(settingsCard);

const tabButtons = document.querySelectorAll('.tab-btn');
const tabSectionMap = {
    inquiries: 'dashboardCard',
    customers: 'customersCard',
    products: 'productsCard',
    suppliers: 'suppliersCard',
    rates: 'ratesCard',
    orders: 'ordersCard',
    erpDashboard: 'erpDashboardCard',
    settings: 'settingsCard'
};
let erpBooted = { customers: false, products: false, suppliers: false, rates: false, orders: false, erpDashboard: false, settings: true };

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
    if (tab === 'customers') loadCustomers();
    if (tab === 'products') { loadSuppliersForSelect(); loadProducts(); }
    if (tab === 'suppliers') { loadSuppliers(); }
    if (tab === 'rates') { loadFxRates(); loadFreightRates(); }
    if (tab === 'orders') { await loadProductsForOrderLines(); await loadOrderCustomers(); loadOrders(); addOrderLine(); }
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
    rows.innerHTML = '<tr><td colspan="8" class="muted">加载中...</td></tr>';
    try {
        const query = q ? `?q=${encodeURIComponent(q)}&pageSize=100` : '?pageSize=100';
        const res = await apiFetch(`/api/products${query}`);
        allProducts = res.items || [];
        if (!allProducts.length) {
            rows.innerHTML = '<tr><td colspan="8" class="muted">暂无产品</td></tr>';
            return;
        }
        rows.innerHTML = allProducts.map((p) => {
            const supplierName = allSuppliers.find((s) => s.id === p.defaultSupplierId)?.name || '-';
            const publicInfo = p.spec?.public || {};
            const packaging = p.packaging?.unitsPerCarton
                ? `${p.packaging.unitsPerCarton}/箱${p.packaging.cartonDimensionsCm ? ` (${p.packaging.cartonDimensionsCm.length}×${p.packaging.cartonDimensionsCm.width}×${p.packaging.cartonDimensionsCm.height}cm)` : ''}`
                : '未设置';
            return `<tr>
                <td>${escapeHtml(p.sku)}</td>
                <td>${escapeHtml(p.name)}</td>
                <td>${escapeHtml(p.category || '-')}</td>
                <td><span class="status-pill">${publicInfo.published ? '已发布' : '未发布'}</span></td>
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
        rows.innerHTML = `<tr><td colspan="8" class="muted">${escapeHtml(error.message)}</td></tr>`;
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

    const currentProduct = allProducts.find((product) => product.id === id);
    const splitHomepageLines = (id, limit) => document.getElementById(id).value
        .split(/\r?\n/)
        .map((value) => value.trim())
        .filter(Boolean)
        .slice(0, limit);
    const publicInfo = {
        published: document.getElementById('productPublishInput').checked,
        title: document.getElementById('productPublicTitleInput').value.trim(),
        imageUrl: document.getElementById('productPublicImageInput').value.trim(),
        secondaryImageUrl: document.getElementById('productPublicSecondaryImageInput').value.trim(),
        detailUrl: document.getElementById('productPublicDetailUrlInput').value.trim(),
        description: document.getElementById('productPublicDescriptionInput').value.trim(),
        badge: document.getElementById('productPublicBadgeInput').value.trim(),
        chip: document.getElementById('productPublicChipInput').value.trim(),
        highlights: splitHomepageLines('productPublicHighlightsInput', 3),
        meta: splitHomepageLines('productPublicMetaInput', 2),
        sortOrder: Number(document.getElementById('productPublicOrderInput').value || 0)
    };
    const body = {
        sku: document.getElementById('productSkuInput').value.trim(),
        name: document.getElementById('productNameInput').value.trim(),
        category: document.getElementById('productCategoryInput').value.trim(),
        spec: { ...(currentProduct?.spec || {}), note: document.getElementById('productSpecInput').value.trim(), public: publicInfo },
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
    document.getElementById('productPublishInput').checked = false;
    document.getElementById('productPublicTitleInput').value = '';
    document.getElementById('productPublicImageInput').value = '';
    document.getElementById('productPublicSecondaryImageInput').value = '';
    document.getElementById('productPublicDetailUrlInput').value = '';
    document.getElementById('productPublicOrderInput').value = '0';
    document.getElementById('productPublicDescriptionInput').value = '';
    document.getElementById('productPublicBadgeInput').value = '';
    document.getElementById('productPublicChipInput').value = '';
    document.getElementById('productPublicHighlightsInput').value = '';
    document.getElementById('productPublicMetaInput').value = '';
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
        document.getElementById('productSpecInput').value = p.spec?.note || '';
        document.getElementById('productPublishInput').checked = Boolean(p.spec?.public?.published);
        document.getElementById('productPublicTitleInput').value = p.spec?.public?.title || '';
        document.getElementById('productPublicImageInput').value = p.spec?.public?.imageUrl || '';
        document.getElementById('productPublicSecondaryImageInput').value = p.spec?.public?.secondaryImageUrl || '';
        document.getElementById('productPublicDetailUrlInput').value = p.spec?.public?.detailUrl || '';
        document.getElementById('productPublicOrderInput').value = p.spec?.public?.sortOrder ?? 0;
        document.getElementById('productPublicDescriptionInput').value = p.spec?.public?.description || '';
        document.getElementById('productPublicBadgeInput').value = p.spec?.public?.badge || '';
        document.getElementById('productPublicChipInput').value = p.spec?.public?.chip || '';
        document.getElementById('productPublicHighlightsInput').value = (p.spec?.public?.highlights || []).join('\n');
        document.getElementById('productPublicMetaInput').value = (p.spec?.public?.meta || []).join('\n');
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

// --- Customers ---------------------------------------------------------
let allCustomers = [];

async function loadCustomers(q) {
    const rows = document.getElementById('customerRows');
    rows.innerHTML = '<tr><td colspan="7" class="muted">加载中...</td></tr>';
    try {
        const query = q ? `?q=${encodeURIComponent(q)}&pageSize=100` : '?pageSize=100';
        const res = await apiFetch(`/api/customers${query}`);
        allCustomers = res.items || [];
        if (!allCustomers.length) {
            rows.innerHTML = '<tr><td colspan="7" class="muted">暂无客户</td></tr>';
            return;
        }
        rows.innerHTML = allCustomers.map((customer) => `<tr>
            <td><strong>${escapeHtml(customer.name)}</strong><br><span class="muted">${escapeHtml(customer.email)}</span></td>
            <td>${escapeHtml(customer.company || '-')}</td>
            <td>${escapeHtml(customer.country || '-')}</td>
            <td>${Number(customer.inquiryCount || 0)}</td>
            <td>${Number(customer.orderCount || 0)}</td>
            <td>${customer.lastInquiryAt ? new Date(customer.lastInquiryAt).toLocaleDateString() : '-'}</td>
            <td class="row-actions"><button type="button" class="btn-compact btn-outline" data-view-customer="${customer.id}">档案</button><button type="button" class="btn-compact btn-outline" data-edit-customer="${customer.id}">编辑</button></td>
        </tr><tr class="inline-editor-row hidden" data-customer-editor-row="${customer.id}"><td colspan="7"><div class="inline-editor-slot" data-customer-editor-slot="${customer.id}"></div></td></tr>`).join('');
    } catch (error) {
        rows.innerHTML = `<tr><td colspan="7" class="muted">${escapeHtml(error.message)}</td></tr>`;
    }
}

function resetCustomerForm() {
    const form = document.getElementById('customerForm');
    const parking = document.getElementById('customerEditorParking');
    form.reset();
    document.getElementById('customerIdInput').value = '';
    document.getElementById('customerEmailInput').disabled = false;
    document.getElementById('customerSubmitBtn').textContent = '新建客户';
    document.getElementById('customerCancelEditBtn').classList.add('hidden');
    parking.appendChild(form);
    form.classList.add('hidden');
}

function showCustomerForm(slot, customer) {
    const form = document.getElementById('customerForm');
    if (customer) fillCustomerForm(customer);
    else resetCustomerForm();
    slot.appendChild(form);
    form.classList.remove('hidden');
}

function fillCustomerForm(customer) {
    document.getElementById('customerIdInput').value = customer.id;
    document.getElementById('customerNameInput').value = customer.name || '';
    document.getElementById('customerEmailInput').value = customer.email || '';
    document.getElementById('customerEmailInput').disabled = true;
    document.getElementById('customerCompanyInput').value = customer.company || '';
    document.getElementById('customerCountryInput').value = customer.country || '';
    document.getElementById('customerPhoneInput').value = customer.phone || '';
    document.getElementById('customerSubmitBtn').textContent = '保存客户';
    document.getElementById('customerCancelEditBtn').classList.remove('hidden');
}

async function viewCustomer(id) {
    const result = await apiFetch(`/api/customers/${encodeURIComponent(id)}`);
    const customer = result.item;
    document.getElementById('customerDetailPanel').classList.remove('hidden');
    document.getElementById('customerDetailTitle').textContent = customer.name || '客户详情';
    document.getElementById('customerDetailMeta').textContent = [customer.company, customer.country, customer.phone, customer.email].filter(Boolean).join(' · ');
    const inquiries = customer.inquiries || [];
    document.getElementById('customerInquiryList').innerHTML = inquiries.length ? inquiries.map((item) => `<li><strong>${escapeHtml(item.product || '未填写产品')}</strong> · ${escapeHtml(item.status)} · 报价 ${item.quoteCount || 0} 份<br><span class="muted">${new Date(item.createdAt).toLocaleDateString()}</span></li>`).join('') : '<li>暂无询盘记录</li>';
    const orders = customer.orders || [];
    document.getElementById('customerOrderList').innerHTML = orders.length ? orders.map((item) => `<li><strong>${escapeHtml(item.orderNo)}</strong> · ${escapeHtml(item.status)} · ${escapeHtml(item.currency)} ${fmtMoney(item.totalAmount)}<br><span class="muted">${new Date(item.createdAt).toLocaleDateString()}</span></li>`).join('') : '<li>暂无订单记录</li>';
}

document.getElementById('customerForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const id = document.getElementById('customerIdInput').value;
    const body = {
        name: document.getElementById('customerNameInput').value.trim(),
        email: document.getElementById('customerEmailInput').value.trim(),
        company: document.getElementById('customerCompanyInput').value.trim(),
        country: document.getElementById('customerCountryInput').value.trim(),
        phone: document.getElementById('customerPhoneInput').value.trim()
    };
    try {
        if (id) await apiFetch(`/api/customers/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) });
        else await apiFetch('/api/customers', { method: 'POST', body: JSON.stringify(body) });
        resetCustomerForm();
        loadCustomers();
        loadOrderCustomers();
    } catch (error) {
        alert(error.message);
    }
});

document.getElementById('customerCancelEditBtn').addEventListener('click', resetCustomerForm);
document.getElementById('newCustomerBtn').addEventListener('click', () => {
    resetCustomerForm();
    showCustomerForm(document.getElementById('customerCreateSlot'));
});
document.getElementById('customerSearchBtn').addEventListener('click', () => loadCustomers(document.getElementById('customerSearchInput').value.trim()));
document.getElementById('customerRefreshBtn').addEventListener('click', () => loadCustomers());
document.getElementById('customerRows').addEventListener('click', async (event) => {
    const editId = event.target.dataset.editCustomer;
    const viewId = event.target.dataset.viewCustomer;
    if (editId) {
        const customer = allCustomers.find((item) => item.id === editId);
        const row = document.querySelector(`[data-customer-editor-row="${editId}"]`);
        const slot = document.querySelector(`[data-customer-editor-slot="${editId}"]`);
        if (customer && row && slot) {
            document.querySelectorAll('[data-customer-editor-row]').forEach((item) => item.classList.add('hidden'));
            row.classList.remove('hidden');
            showCustomerForm(slot, customer);
        }
    }
    if (viewId) {
        try { await viewCustomer(viewId); } catch (error) { alert(error.message); }
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
const fxPageSize = 3;
let fxCurrentPage = 1;
let fxTotal = 0;

function updateFxPageControls(page, pageSize, total) {
    fxCurrentPage = page;
    fxTotal = total;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    document.getElementById('fxSummaryText').textContent = `当前 ${total} 条汇率`;
    document.getElementById('fxPageInfo').textContent = `第 ${page} 页 / 共 ${totalPages} 页`;
    document.getElementById('fxPrevPageBtn').disabled = page <= 1;
    document.getElementById('fxNextPageBtn').disabled = page >= totalPages;
}

async function loadFxRates() {
    const rows = document.getElementById('fxRows');
    rows.innerHTML = '<tr><td colspan="4" class="muted">加载中...</td></tr>';
    try {
        const query = new URLSearchParams({ page: String(fxCurrentPage), pageSize: String(fxPageSize) });
        const keyword = document.getElementById('fxSearchInput').value.trim();
        if (keyword) query.set('q', keyword);
        const res = await apiFetch(`/api/exchange-rates?${query.toString()}`);
        const items = res.items || [];
        updateFxPageControls(res.page || 1, res.pageSize || fxPageSize, res.total || 0);
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
        updateFxPageControls(1, fxPageSize, 0);
    }
}

document.getElementById('fxSearchBtn').addEventListener('click', () => {
    fxCurrentPage = 1;
    loadFxRates();
});

document.getElementById('fxClearSearchBtn').addEventListener('click', () => {
    document.getElementById('fxSearchInput').value = '';
    fxCurrentPage = 1;
    loadFxRates();
});

document.getElementById('fxSearchInput').addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    fxCurrentPage = 1;
    loadFxRates();
});

document.getElementById('fxPrevPageBtn').addEventListener('click', () => {
    if (fxCurrentPage <= 1) return;
    fxCurrentPage -= 1;
    loadFxRates();
});

document.getElementById('fxNextPageBtn').addEventListener('click', () => {
    if (fxCurrentPage * fxPageSize >= fxTotal) return;
    fxCurrentPage += 1;
    loadFxRates();
});

document.getElementById('syncPublicFxBtn').addEventListener('click', async () => {
    const button = document.getElementById('syncPublicFxBtn');
    const status = document.getElementById('fxSyncStatus');
    button.disabled = true;
    status.textContent = '正在同步公开参考汇率...';
    try {
        const result = await apiFetch('/api/exchange-rates/public-sync', {
            method: 'POST',
            body: JSON.stringify({ baseCurrency: 'CNY' })
        });
        status.textContent = `已同步 ${result.created || 0} 条，跳过已有 ${result.skipped || 0} 条；汇率日期：${result.effectiveDate || '-'}。`;
        await loadFxRates();
    } catch (error) {
        status.textContent = `同步失败：${error.message}`;
    } finally {
        button.disabled = false;
    }
});

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
        fxCurrentPage = 1;
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

const INCOTERM_NOTE_TEMPLATES = {
    EXW: 'Trade term: EXW [Factory City], China. The quoted price excludes pickup, export customs clearance, and international freight. The buyer arranges collection and main carriage.',
    FCA: 'Trade term: FCA [Named Place], China. The quoted price includes export customs clearance and delivery to the named carrier. Main carriage, insurance, and destination charges are for the buyer.',
    FOB: 'Trade term: FOB [Port], China. The quoted price includes export customs clearance and loading on board. Ocean freight, insurance, and destination charges are for the buyer.',
    CFR: 'Trade term: CFR [Destination Port]. The quoted price includes ocean freight to the named destination port. Insurance, import customs clearance, duties, and local charges are for the buyer.',
    CIF: 'Trade term: CIF [Destination Port]. The quoted price includes ocean freight and marine insurance to the named destination port. Import customs clearance, duties, and local charges are for the buyer.',
    DAP: 'Trade term: DAP [Named Place]. The quoted price includes delivery to the named destination. Import customs clearance, duties, taxes, and unloading are for the buyer unless otherwise agreed.',
    DDP: 'Trade term: DDP [Named Place]. The quoted price includes delivery, import customs clearance, duties, and taxes to the named destination, subject to a confirmed delivery address and local import requirements.'
};

document.getElementById('orderIncotermInput').addEventListener('change', (event) => {
    const template = INCOTERM_NOTE_TEMPLATES[event.target.value];
    if (!template) return;
    const notes = document.getElementById('orderNotesInput');
    const current = notes.value.trim();
    const previousTemplate = Object.values(INCOTERM_NOTE_TEMPLATES).find((item) => current.includes(item));
    const remainder = previousTemplate ? current.replace(previousTemplate, '').trim() : current;
    notes.value = remainder ? `${template}\n\n${remainder}` : template;
});

let orderCustomers = [];
let allOrderCustomers = [];

function renderOrderCustomerOptions(selectedId) {
    const select = document.getElementById('orderCustomerSelect');
    const currentId = selectedId === undefined ? select.value : selectedId;
    select.innerHTML = '<option value="">选择客户</option>' +
        orderCustomers.map((customer) => `<option value="${customer.id}">${escapeHtml(customer.name)} (${escapeHtml(customer.email)})${customer.company ? ' — ' + escapeHtml(customer.company) : ''}</option>`).join('');
    if (currentId && orderCustomers.some((customer) => customer.id === currentId)) select.value = currentId;
}

function renderOrderCustomerFilter(selectedId) {
    const select = document.getElementById('orderCustomerFilter');
    const currentId = selectedId === undefined ? select.value : selectedId;
    select.innerHTML = '<option value="">全部客户</option>' +
        allOrderCustomers.map((customer) => `<option value="${customer.id}">${escapeHtml(customer.name)}${customer.company ? ' — ' + escapeHtml(customer.company) : ''}</option>`).join('');
    if (currentId && allOrderCustomers.some((customer) => customer.id === currentId)) select.value = currentId;
}

async function loadOrderCustomers(query = '') {
    try {
        const pageSize = 200;
        const first = await apiFetch(`/api/customers?q=${encodeURIComponent(query)}&pageSize=${pageSize}&page=1`);
        orderCustomers = first.items || [];
        const totalPages = Math.ceil(Number(first.total || 0) / pageSize);
        for (let page = 2; page <= totalPages; page += 1) {
            const next = await apiFetch(`/api/customers?q=${encodeURIComponent(query)}&pageSize=${pageSize}&page=${page}`);
            orderCustomers.push(...(next.items || []));
        }
        if (!query) allOrderCustomers = [...orderCustomers];
        renderOrderCustomerOptions();
        if (!query) renderOrderCustomerFilter();
    } catch (error) {
        console.error(error);
    }
}

document.getElementById('orderCustomerSearchInput').addEventListener('input', debounce((event) => {
    loadOrderCustomers(event.target.value.trim());
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
        notes: document.getElementById('orderNotesInput').value.trim(),
        lines
    };
    try {
        const result = await apiFetch('/api/orders', { method: 'POST', body: JSON.stringify(body) });
        document.getElementById('orderLinesContainer').innerHTML = '';
        orderLineCount = 0;
        document.getElementById('orderCustomerSearchInput').value = '';
        renderOrderCustomerOptions('');
        document.getElementById('orderIncotermInput').value = '';
        document.getElementById('orderNotesInput').value = '';
        addOrderLine();
        updateOrderTotalPreview();
        await loadOrders();
        await viewOrder(result.item.id);
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
        const customerId = document.getElementById('orderCustomerFilter').value;
        const query = new URLSearchParams({ pageSize: '100' });
        if (status) query.set('status', status);
        if (customerId) query.set('customerId', customerId);
        const res = await apiFetch(`/api/orders?${query.toString()}`);
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
document.getElementById('orderCustomerFilter').addEventListener('change', loadOrders);
document.getElementById('orderRefreshBtn').addEventListener('click', loadOrders);

window.addEventListener('greensmart:open-orders-for-customer', async (event) => {
    const customerId = event.detail?.customerId;
    if (!customerId) return;
    await loadOrderCustomers();
    document.getElementById('orderCustomerFilter').value = customerId;
    document.querySelector('.tab-btn[data-tab="orders"]')?.click();
    await loadOrders();
});

const DOCUMENT_TYPE_LABEL = { quote: '报价单', pi: '形式发票 (PI)', packing_list: '装箱单', invoice: '商业发票 (CI)' };
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
        document.getElementById('orderDetailTitle').textContent = `报价 / 订单 ${order.orderNo}`;
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
            <button type="button" class="btn-compact btn-outline" data-preview-doc="${doc.id}" data-doc-type="${escapeHtml(doc.type)}">预览</button>
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

async function openDocumentPreview(docId, docType) {
    if (!docId || !activeOrderId) return;
    const dialog = document.getElementById('documentPreviewDialog');
    const frame = document.getElementById('documentPreviewFrame');
    const title = DOCUMENT_TYPE_LABEL[docType] || '单据';
    document.getElementById('documentPreviewTitle').textContent = `${title}预览`;
    frame.srcdoc = '<!doctype html><html><body style="font-family:Arial,sans-serif;padding:32px;color:#64748b;">正在生成预览...</body></html>';
    if (!dialog.open) dialog.showModal();
    try {
        const response = await fetch(`/api/orders/${activeOrderId}/documents/${docId}/render`, {
            credentials: 'same-origin'
        });
        if (!response.ok) throw new Error(`渲染失败 (${response.status})`);
        frame.srcdoc = await response.text();
    } catch (error) {
        frame.srcdoc = `<!doctype html><html><body style="font-family:Arial,sans-serif;padding:32px;color:#b91c1c;">${escapeHtml(error.message)}</body></html>`;
    }
}

document.getElementById('orderDocList').addEventListener('click', async (event) => {
    const docId = event.target.dataset.previewDoc;
    if (docId) openDocumentPreview(docId, event.target.dataset.docType);
});

document.getElementById('documentPreviewPrintBtn').addEventListener('click', () => {
    const frame = document.getElementById('documentPreviewFrame');
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
});

document.getElementById('documentPreviewCloseBtn').addEventListener('click', () => {
    document.getElementById('documentPreviewDialog').close();
});

document.getElementById('documentPreviewDialog').addEventListener('close', () => {
    document.getElementById('documentPreviewFrame').srcdoc = '';
});

// --- ERP Dashboard -----------------------------------------------------
function erpDateRangeQuery() {
    const from = document.getElementById('erpDateFrom').value;
    const to = document.getElementById('erpDateTo').value;
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    return params.toString();
}

async function loadErpDashboard() {
    const range = erpDateRangeQuery();
    const withRange = (path, existingQuery) => {
        if (!range) return path;
        return `${path}${existingQuery ? '&' : '?'}${range}`;
    };

    try {
        const summary = await apiFetch(withRange('/api/dashboard/summary'));
        document.getElementById('erpKpiOrders').textContent = summary.committedOrderCount;
        document.getElementById('erpKpiRevenue').textContent = fmtMoney(summary.revenue);
        document.getElementById('erpKpiProfit').textContent = fmtMoney(summary.profit);
        document.getElementById('erpKpiMargin').textContent = fmtPercent(summary.marginPercent);
        document.getElementById('erpKpiWinRate').textContent = fmtPercent(summary.winRate);
        document.getElementById('erpKpiQuoted').textContent = summary.quotedCount || 0;
        document.getElementById('erpKpiPiIssued').textContent = summary.piIssuedCount || 0;
    } catch (error) {
        console.error(error);
    }

    try {
        const profit = await apiFetch(withRange('/api/dashboard/profit'));
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
        const customers = await apiFetch(withRange('/api/dashboard/customers?limit=10', true));
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
        const countries = await apiFetch(withRange('/api/dashboard/countries'));
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

    try {
        const products = await apiFetch(withRange('/api/dashboard/products'));
        const rows = document.getElementById('productAnalysisRows');
        const items = products.items || [];
        rows.innerHTML = items.length ? items.map((row) => `<tr>
            <td>${escapeHtml(row.productName)}</td>
            <td>${row.orderCount}</td>
            <td>${fmtMoney(row.revenue)}</td>
            <td>${fmtMoney(row.profit)}</td>
            <td>${fmtPercent(row.marginPercent)}</td>
        </tr>`).join('') : '<tr><td colspan="5" class="muted">暂无数据</td></tr>';
    } catch (error) {
        console.error(error);
    }
}

document.getElementById('erpDashboardRefreshBtn').addEventListener('click', loadErpDashboard);
document.getElementById('erpDateApplyBtn').addEventListener('click', loadErpDashboard);
document.getElementById('erpDateClearBtn').addEventListener('click', () => {
    document.getElementById('erpDateFrom').value = '';
    document.getElementById('erpDateTo').value = '';
    loadErpDashboard();
});
