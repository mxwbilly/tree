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
    const netWeight = document.getElementById('productNetWeightInput').value;
    const grossWeight = document.getElementById('productGrossWeightInput').value;
    packaging.packageType = document.getElementById('productPackageTypeInput').value.trim();
    if (netWeight) packaging.netWeightKg = Number(netWeight);
    if (grossWeight) packaging.grossWeightKg = Number(grossWeight);

    const currentProduct = allProducts.find((product) => product.id === id);
    const splitHomepageLines = (id, limit) => document.getElementById(id).value
        .split(/\r?\n/)
        .map((value) => value.trim())
        .filter(Boolean)
        .slice(0, limit);
    const normalizePublicImagePath = (value) => {
        const path = String(value || '').trim();
        if (!path || /^(https?:)?\/\//i.test(path) || path.startsWith('/')) return path;
        return `/${path}`;
    };
    const publicInfo = {
        published: document.getElementById('productPublishInput').checked,
        title: document.getElementById('productPublicTitleInput').value.trim(),
        imageUrl: normalizePublicImagePath(document.getElementById('productPublicImageInput').value),
        secondaryImageUrl: normalizePublicImagePath(document.getElementById('productPublicSecondaryImageInput').value),
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
        spec: { ...(currentProduct?.spec || {}), note: document.getElementById('productSpecInput').value.trim(), public: publicInfo,
            hsCode: document.getElementById('productHsCodeInput').value.trim(),
            originCountry: document.getElementById('productOriginCountryInput').value.trim(),
            unit: document.getElementById('productUnitInput').value.trim() },
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
    document.getElementById('productHsCodeInput').value = '';
    document.getElementById('productOriginCountryInput').value = '';
    document.getElementById('productUnitInput').value = '';
    document.getElementById('productPackageTypeInput').value = '';
    document.getElementById('productNetWeightInput').value = '';
    document.getElementById('productGrossWeightInput').value = '';
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
        document.getElementById('productHsCodeInput').value = p.spec?.hsCode || '';
        document.getElementById('productOriginCountryInput').value = p.spec?.originCountry || '';
        document.getElementById('productUnitInput').value = p.spec?.unit || '';
        document.getElementById('productPackageTypeInput').value = p.packaging?.packageType || '';
        document.getElementById('productNetWeightInput').value = p.packaging?.netWeightKg || '';
        document.getElementById('productGrossWeightInput').value = p.packaging?.grossWeightKg || '';
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
        rows.innerHTML = allCustomers.map((customer) => `<tr data-view-customer="${customer.id}" class="clickable-row">
            <td><strong>${escapeHtml(customer.name)}</strong><br><span class="muted">${escapeHtml(customer.email)}</span></td>
            <td>${escapeHtml(customer.company || '-')}</td>
            <td>${escapeHtml(customer.country || '-')}</td>
            <td>${Number(customer.inquiryCount || 0)}</td>
            <td>${Number(customer.orderCount || 0)}</td>
            <td>${customer.lastInquiryAt ? new Date(customer.lastInquiryAt).toLocaleDateString() : '-'}</td>
            <td class="row-actions"><button type="button" class="btn-compact btn-outline" data-edit-customer="${customer.id}">编辑</button></td>
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
    document.getElementById('customerCurrencyInput').value = customer.defaultCurrency || 'USD';
    document.getElementById('customerIncotermInput').value = customer.defaultIncoterm || '';
    document.getElementById('customerPaymentTermsInput').value = customer.paymentTerms || '';
    document.getElementById('customerPortInput').value = customer.defaultPort || '';
    document.getElementById('customerAddressInput').value = customer.shippingAddress || '';
    document.getElementById('customerBillingAddressInput').value = customer.billingAddress || '';
    document.getElementById('customerImporterNameInput').value = customer.importerName || '';
    document.getElementById('customerImporterIdInput').value = customer.importerId || '';
    document.getElementById('customerConsigneeNameInput').value = customer.consigneeName || '';
    document.getElementById('customerConsigneeAddressInput').value = customer.consigneeAddress || '';
    document.getElementById('customerNotifyPartyNameInput').value = customer.notifyPartyName || '';
    document.getElementById('customerNotifyPartyAddressInput').value = customer.notifyPartyAddress || '';
    document.getElementById('customerNotesInput').value = customer.internalNotes || '';
    document.getElementById('customerSubmitBtn').textContent = '保存客户';
    document.getElementById('customerCancelEditBtn').classList.remove('hidden');
}

async function viewCustomer(id) {
    const result = await apiFetch(`/api/customers/${encodeURIComponent(id)}`);
    const customer = result.item;
    document.getElementById('customerDetailPanel').classList.remove('hidden');
    document.getElementById('customerDetailTitle').textContent = customer.name || '客户详情';
    document.getElementById('customerDetailMeta').textContent = [customer.company, customer.country, customer.phone, customer.email].filter(Boolean).join(' · ');
    const tradeItems = [
        ['默认币种', customer.defaultCurrency || 'USD'],
        ['贸易条款', customer.defaultIncoterm || '-'],
        ['付款条款', customer.paymentTerms || '-'],
        ['目的港', customer.defaultPort || '-'],
        ['收货地址', customer.shippingAddress || '-'],
        ['内部备注', customer.internalNotes || '-']
    ];
    document.getElementById('customerTradeProfile').innerHTML = tradeItems.map(([label, value]) => `<div><span class="muted">${label}</span><strong>${escapeHtml(value)}</strong></div>`).join('');
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
        phone: document.getElementById('customerPhoneInput').value.trim(),
        defaultCurrency: document.getElementById('customerCurrencyInput').value.trim(),
        defaultIncoterm: document.getElementById('customerIncotermInput').value,
        paymentTerms: document.getElementById('customerPaymentTermsInput').value.trim(),
        defaultPort: document.getElementById('customerPortInput').value.trim(),
        shippingAddress: document.getElementById('customerAddressInput').value.trim(),
        billingAddress: document.getElementById('customerBillingAddressInput').value.trim(),
        importerName: document.getElementById('customerImporterNameInput').value.trim(),
        importerId: document.getElementById('customerImporterIdInput').value.trim(),
        consigneeName: document.getElementById('customerConsigneeNameInput').value.trim(),
        consigneeAddress: document.getElementById('customerConsigneeAddressInput').value.trim(),
        notifyPartyName: document.getElementById('customerNotifyPartyNameInput').value.trim(),
        notifyPartyAddress: document.getElementById('customerNotifyPartyAddressInput').value.trim(),
        internalNotes: document.getElementById('customerNotesInput').value.trim()
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
    const target = event.target;
    const editButton = target.closest('[data-edit-customer]');
    const row = target.closest('tr[data-view-customer]');
    const editId = editButton?.dataset.editCustomer;
    const viewId = row?.dataset.viewCustomer;
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
    if (viewId && !editId) {
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
    rows.innerHTML = '<tr><td colspan="5" class="muted">加载中...</td></tr>';
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
            rows.innerHTML = '<tr><td colspan="5" class="muted">暂无运费记录</td></tr>';
            return;
        }
        rows.innerHTML = items.map((r) => `<tr>
            <td>${escapeHtml(r.originPort)} → ${escapeHtml(r.destinationPort)}</td>
            <td>${escapeHtml(r.containerType)}</td>
            <td>${fmtMoney(r.rate)} ${escapeHtml(r.currency)}</td>
            <td>${escapeHtml(r.validFrom || '-')}</td>
            <td><button type="button" class="btn-compact btn-muted" data-delete-freight="${r.id}">删除</button></td>
        </tr>`).join('');
    } catch (error) {
        rows.innerHTML = `<tr><td colspan="5" class="muted">${escapeHtml(error.message)}</td></tr>`;
    }
}

document.getElementById('freightForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const body = {
        originPort: document.getElementById('freightOriginInput').value.trim(),
        destinationPort: document.getElementById('freightDestInput').value.trim(),
        containerType: document.getElementById('freightContainerSelect').value,
        rate: Number(document.getElementById('freightRateInput').value),
        currency: document.getElementById('freightCurrencyInput').value.trim() || 'USD',
        validFrom: document.getElementById('freightValidFromInput').value
    };
    try {
        await apiFetch('/api/freight-rates', { method: 'POST', body: JSON.stringify(body) });
        document.getElementById('freightForm').reset();
        document.getElementById('freightValidFromInput').value = new Date().toISOString().slice(0, 10);
        loadFreightRates();
    } catch (error) {
        alert(error.message);
    }
});

document.getElementById('freightValidFromInput').value = new Date().toISOString().slice(0, 10);

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
let pendingInquiryForOrder = null;
let mergeTargetOrder = null;

async function loadProductsForOrderLines() {
    if (!allProducts.length) await loadProducts();
    orderProducts = allProducts;
}

function addOrderLine(initial = {}) {
    orderLineCount += 1;
    const idx = orderLineCount;
    const container = document.getElementById('orderLinesContainer');
    const row = document.createElement('div');
    row.className = 'line-row';
    row.dataset.lineIndex = idx;
    row.innerHTML = `
        <select data-line-product="${idx}">
            <option value="">选择产品</option>
            ${orderProducts.map((p) => `<option value="${p.id}" ${p.id === initial.productId ? 'selected' : ''}>${escapeHtml(p.sku)} — ${escapeHtml(p.name)}</option>`).join('')}
        </select>
        <input type="number" min="1" step="1" placeholder="数量" data-line-qty="${idx}" value="${escapeHtml(initial.qty || '')}">
        <input type="number" min="0" step="0.01" placeholder="单价" data-line-price="${idx}" value="${escapeHtml(initial.unitPrice || '')}">
        <button type="button" class="btn-compact btn-muted" data-remove-line="${idx}">移除</button>
    `;
    container.appendChild(row);
}

document.getElementById('orderLinesContainer').addEventListener('input', updateOrderTotalPreview);

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

function compactInquiryRef(inquiryId) {
    const value = String(inquiryId || '');
    return value.length > 18 ? `#${value.slice(0, 8)}…${value.slice(-6)}` : `#${value}`;
}

function parseInquiryQuantity(value) {
    const match = String(value || '').replace(/,/g, '').match(/\d+/);
    return match ? Number(match[0]) : '';
}

function findInquiryProduct(value) {
    const needle = String(value || '').trim().toLowerCase();
    if (!needle) return null;
    const exactMatch = orderProducts.find((product) => {
        const candidates = [product.id, product.sku, product.name].map((item) => String(item || '').trim().toLowerCase()).filter(Boolean);
        return candidates.some((candidate) => candidate === needle || needle.includes(candidate) || candidate.includes(needle));
    });
    if (exactMatch) return exactMatch;

    const ignoredWords = new Set(['and', 'the', 'for', 'with', 'pot', 'pots', 'planter', 'planters', 'flower', 'flowers']);
    const tokenize = (text) => new Set(String(text || '').toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .split(' ')
        .map((word) => word.replace(/s$/, ''))
        .filter((word) => word.length >= 3 && !ignoredWords.has(word)));
    const inquiryTokens = tokenize(needle);
    if (inquiryTokens.size < 2) return null;

    let bestMatch = null;
    let bestScore = 0;
    orderProducts.forEach((product) => {
        const productTokens = tokenize(`${product.sku || ''} ${product.name || ''} ${product.category || ''}`);
        const overlap = [...inquiryTokens].filter((word) => productTokens.has(word)).length;
        const coverage = overlap / inquiryTokens.size;
        const score = overlap + coverage;
        if (overlap >= 2 && score > bestScore) {
            bestMatch = product;
            bestScore = score;
        }
    });
    return bestMatch;
}

function clearOrderInquiryContext() {
    document.getElementById('orderInquiryIdInput').value = '';
    document.getElementById('orderInquiryContext').classList.add('hidden');
    document.getElementById('orderInquiryRef').textContent = '';
    document.getElementById('orderInquiryMeta').textContent = '';
    document.getElementById('orderCustomerSearchInput').disabled = false;
    document.getElementById('orderCustomerSelect').disabled = false;
    document.getElementById('createOrderBtn').disabled = false;
    document.getElementById('orderMergeContext').classList.add('hidden');
    document.getElementById('orderMergeLabel').textContent = '';
    pendingInquiryForOrder = null;
    mergeTargetOrder = null;
}

function setOrderInquiryContext(detail, linkedOrder = null) {
    const inquiryId = detail.inquiryId || '';
    pendingInquiryForOrder = detail;
    document.getElementById('orderInquiryIdInput').value = inquiryId;
    document.getElementById('orderInquiryRef').textContent = compactInquiryRef(inquiryId);
    const parts = [detail.customerName, detail.country, detail.product, detail.quantity].filter(Boolean);
    if (linkedOrder) parts.push(`已关联 ${linkedOrder.orderNo}`);
    document.getElementById('orderInquiryMeta').textContent = parts.join(' · ');
    document.getElementById('orderInquiryContext').classList.remove('hidden');
    document.getElementById('orderCustomerSearchInput').disabled = true;
    document.getElementById('orderCustomerSelect').disabled = true;
    document.getElementById('createOrderBtn').disabled = Boolean(linkedOrder);
}

function setOrderMergeTarget(order) {
    mergeTargetOrder = order || null;
    const context = document.getElementById('orderMergeContext');
    if (!order) {
        context.classList.add('hidden');
        return;
    }
    document.getElementById('orderMergeLabel').textContent = `该客户已有报价草案 ${order.orderNo}，可将当前产品加入同一份报价。`;
    context.classList.remove('hidden');
}

function renderOrderCustomerOptions(selectedId) {
    const select = document.getElementById('orderCustomerSelect');
    const currentId = selectedId === undefined ? select.value : selectedId;
    select.innerHTML = '<option value="">选择客户</option>' +
        orderCustomers.map((customer) => `<option value="${customer.id}">${escapeHtml(customer.name)} (${escapeHtml(customer.email)})${customer.company ? ' — ' + escapeHtml(customer.company) : ''}</option>`).join('');
    if (currentId && orderCustomers.some((customer) => customer.id === currentId)) select.value = currentId;
    updateOrderCustomerEmail();
}

function updateOrderCustomerEmail() {
    const customerId = document.getElementById('orderCustomerSelect').value;
    const customer = orderCustomers.find((item) => item.id === customerId);
    document.getElementById('orderCustomerEmail').value = customer?.email || '';
    if (!customer) return;
    document.getElementById('orderCurrencyInput').value = customer.defaultCurrency || 'USD';
    document.getElementById('orderIncotermInput').value = customer.defaultIncoterm || '';
    const defaultNotes = [
        customer.paymentTerms ? `付款条款：${customer.paymentTerms}` : '',
        customer.defaultPort ? `目的港：${customer.defaultPort}` : '',
        customer.shippingAddress ? `收货地址：${customer.shippingAddress}` : ''
    ].filter(Boolean).join('\n');
    if (defaultNotes) document.getElementById('orderNotesInput').value = defaultNotes;
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

document.getElementById('orderCustomerSelect').addEventListener('change', updateOrderCustomerEmail);

function debounce(fn, wait) {
    let timer;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), wait);
    };
}

function collectOrderLines() {
    const lines = [];
    document.querySelectorAll('#orderLinesContainer .line-row').forEach((row) => {
        const idx = row.dataset.lineIndex;
        const productId = document.querySelector(`[data-line-product="${idx}"]`)?.value;
        const qty = Number(document.querySelector(`[data-line-qty="${idx}"]`)?.value);
        const unitPrice = Number(document.querySelector(`[data-line-price="${idx}"]`)?.value);
        if (productId && qty > 0) lines.push({ productId, qty, unitPrice: unitPrice || 0 });
    });
    return lines;
}

function resetOrderDraft() {
    document.getElementById('orderLinesContainer').innerHTML = '';
    orderLineCount = 0;
    document.getElementById('orderCustomerSearchInput').value = '';
    clearOrderInquiryContext();
    renderOrderCustomerOptions('');
    updateOrderCustomerEmail();
    document.getElementById('orderIncotermInput').value = '';
    document.getElementById('orderCurrencyInput').value = 'USD';
    document.getElementById('orderExpectedDeliveryInput').value = '';
    document.getElementById('orderNotesInput').value = '';
    addOrderLine();
    updateOrderTotalPreview();
}

document.getElementById('createOrderBtn').addEventListener('click', async () => {
    const customerId = document.getElementById('orderCustomerSelect').value;
    if (!customerId) return alert('请先选择客户。');
    const lines = collectOrderLines();
    if (!lines.length) return alert('请至少添加一行有效的产品行。');

    const body = {
        inquiryIds: document.getElementById('orderInquiryIdInput').value ? [document.getElementById('orderInquiryIdInput').value] : [],
        customerId,
        currency: document.getElementById('orderCurrencyInput').value.trim() || 'USD',
        incoterm: document.getElementById('orderIncotermInput').value.trim(),
        expectedDeliveryDate: document.getElementById('orderExpectedDeliveryInput').value,
        notes: document.getElementById('orderNotesInput').value.trim(),
        lines
    };
    try {
        const result = await apiFetch('/api/orders', { method: 'POST', body: JSON.stringify(body) });
        resetOrderDraft();
        await loadOrders();
        await viewOrder(result.item.id);
    } catch (error) {
        alert(error.message);
    }
});

document.getElementById('attachInquiryToOrderBtn').addEventListener('click', async () => {
    const inquiryId = document.getElementById('orderInquiryIdInput').value;
    const lines = collectOrderLines();
    if (!mergeTargetOrder || !inquiryId) return;
    if (!lines.length) return alert('请至少添加一行有效的产品行。');
    const button = document.getElementById('attachInquiryToOrderBtn');
    button.disabled = true;
    try {
        const result = await apiFetch(`/api/orders/${encodeURIComponent(mergeTargetOrder.id)}/inquiries`, {
            method: 'POST', body: JSON.stringify({ inquiryId, lines })
        });
        resetOrderDraft();
        await loadOrders();
        await viewOrder(result.item.id);
    } catch (error) {
        alert(error.message);
    } finally {
        button.disabled = false;
    }
});

const orderStatusLabel = {
    quoted: '已报价', pi_issued: '已出PI', confirmed: '已确认', packing_ready: '已出装箱单',
    invoiced: '已出发票', paid: '已付款', closed: '已结案', lost: '已流失'
};

const PRODUCTION_STATUS_LABEL = {
    not_started: '未排产', in_production: '生产中', quality_inspection: '质检中',
    ready_to_ship: '待出运', shipped: '已出运'
};

function fulfillmentState(order) {
    if (order.actualShipmentDate || order.productionStatus === 'shipped') return { label: '已出运', className: 'fulfillment-shipped' };
    if (!order.expectedDeliveryDate) return { label: '待设置', className: 'fulfillment-pending' };
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const due = new Date(`${order.expectedDeliveryDate}T00:00:00`);
    const days = Math.ceil((due - today) / 86400000);
    if (days < 0) return { label: `已延期 ${Math.abs(days)} 天`, className: 'fulfillment-overdue' };
    if (days <= 7) return { label: `${days === 0 ? '今日交期' : `${days} 天内交期`}`, className: 'fulfillment-due' };
    return { label: order.expectedDeliveryDate, className: 'fulfillment-normal' };
}

function setFulfillmentFeedback(message = '') {
    const feedback = document.getElementById('orderFulfillmentFeedback');
    feedback.textContent = message;
    feedback.classList.toggle('hidden', !message);
}

const ORDER_ACTION_SHORT_LABEL = {
    confirm: '确认',
    mark_paid: '收款',
    close: '结案',
    mark_lost: '流失'
};

const DOCUMENT_ACTION_SHORT_LABEL = {
    pi: '出 PI',
    packing_list: '出装箱单',
    invoice: '出 CI'
};

function documentActionLabel(type, status) {
    if (type === 'pi' && status === 'pi_issued') return '更新 PI';
    if (type === 'packing_list' && status === 'packing_ready') return '更新装箱单';
    if (type === 'invoice' && status === 'invoiced') return '更新 CI';
    return DOCUMENT_ACTION_SHORT_LABEL[type];
}

async function loadOrders() {
    const rows = document.getElementById('orderRows');
        rows.innerHTML = '<tr><td colspan="8" class="muted">加载中...</td></tr>';
    try {
        const status = document.getElementById('orderStatusFilter').value;
        const customerId = document.getElementById('orderCustomerFilter').value;
        const query = new URLSearchParams({ pageSize: '100' });
        if (status) query.set('status', status);
        if (customerId) query.set('customerId', customerId);
        const res = await apiFetch(`/api/orders?${query.toString()}`);
        allOrders = res.items || [];
        if (!allOrders.length) {
            rows.innerHTML = '<tr><td colspan="8" class="muted">暂无订单</td></tr>';
            return;
        }
        rows.innerHTML = allOrders.map((o) => {
            const fulfillment = fulfillmentState(o);
            return `<tr data-order-id="${o.id}">
            <td>${escapeHtml(o.orderNo)}</td>
            <td>${o.inquiryIds?.length ? (o.inquiryIds.length === 1 ? escapeHtml(compactInquiryRef(o.inquiryIds[0])) : `${o.inquiryIds.length} 条询盘`) : '<span class="muted">手动创建</span>'}</td>
            <td><span class="status-pill">${escapeHtml(orderStatusLabel[o.status] || o.status)}</span></td>
            <td><span class="fulfillment-pill ${fulfillment.className}">${escapeHtml(fulfillment.label)}</span></td>
            <td>${escapeHtml(o.currency)}</td>
            <td>${fmtMoney(o.totalAmount)}</td>
            <td>${escapeHtml(String(o.createdAt).slice(0, 16).replace('T', ' '))}</td>
            <td>${renderOrderRowActions(o)}</td>
        </tr>`;
        }).join('');
    } catch (error) {
        rows.innerHTML = `<tr><td colspan="8" class="muted">${escapeHtml(error.message)}</td></tr>`;
    }
}

document.getElementById('orderStatusFilter').addEventListener('change', loadOrders);
document.getElementById('orderCustomerFilter').addEventListener('change', loadOrders);
document.getElementById('orderRefreshBtn').addEventListener('click', loadOrders);

window.addEventListener('greensmart:open-orders-for-customer', async (event) => {
    const inquiryId = event.detail?.inquiryId;
    const customerId = event.detail?.customerId;
    if (!customerId) return;
    document.querySelector('.tab-btn[data-tab="orders"]')?.click();
    await loadProductsForOrderLines();
    await loadOrderCustomers();
    document.getElementById('orderCustomerSelect').value = customerId;
    updateOrderCustomerEmail();
    document.getElementById('orderCustomerFilter').value = customerId;
    await loadOrders();
    const existing = inquiryId
        ? await apiFetch(`/api/orders?inquiryId=${encodeURIComponent(inquiryId)}&pageSize=1`)
        : { items: [] };
    const linkedOrder = existing.items?.[0] || null;
    setOrderInquiryContext(event.detail, linkedOrder);
    if (linkedOrder) {
        await viewOrder(linkedOrder.id);
        return;
    }
    const product = findInquiryProduct(event.detail?.product);
    const qty = parseInquiryQuantity(event.detail?.quantity);
    document.getElementById('orderLinesContainer').innerHTML = '';
    orderLineCount = 0;
    addOrderLine({ productId: product?.id || '', qty });
    updateOrderTotalPreview();
    setOrderMergeTarget(allOrders.find((order) => order.status === 'quoted') || null);
});

const DOCUMENT_TYPE_LABEL = { quote: '报价单', pi: '形式发票 (PI)', packing_list: '装箱单', invoice: '商业发票 (CI)' };
const ACTION_LABEL = { confirm: '确认订单', close: '结案', mark_lost: '标记流失' };
// Mirrors the backend's DOCUMENT_RULES/ACTION_RULES in functions/api/orders —
// kept here only to decide which buttons to show; the server re-validates.
const DOC_ALLOWED_FROM = {
    pi: ['quoted', 'pi_issued'], invoice: ['packing_ready', 'invoiced']
};
const ACTION_ALLOWED_FROM = {
    confirm: ['pi_issued'], close: ['paid'],
    mark_lost: ['quoted', 'pi_issued', 'confirmed', 'packing_ready', 'invoiced']
};

let activeOrderId = '';

function renderOrderRowActions(order) {
    const actions = Object.keys(ACTION_LABEL)
        .filter((action) => ACTION_ALLOWED_FROM[action].includes(order.status))
        .map((action) => `<button type="button" class="btn-compact" data-order-action="${action}" data-order-id="${order.id}">${ORDER_ACTION_SHORT_LABEL[action]}</button>`);
    const documents = Object.keys(DOCUMENT_ACTION_SHORT_LABEL)
        .filter((type) => DOC_ALLOWED_FROM[type]?.includes(order.status))
        .map((type) => `<button type="button" class="btn-compact btn-outline" data-issue-doc="${type}" data-order-id="${order.id}">${documentActionLabel(type, order.status)}</button>`);
    return actions.length || documents.length ? `<div class="row-actions">${actions.join('')}${documents.join('')}</div>` : '<span class="muted">-</span>';
}

function documentMailSummary(doc) {
    const attempted = doc.mailAttemptedAt ? String(doc.mailAttemptedAt).slice(0, 16).replace('T', ' ') : '';
    const accepted = doc.mailSentAt ? String(doc.mailSentAt).slice(0, 16).replace('T', ' ') : '';
    if (doc.mailStatus === 'sending') return '<span class="muted mail-status-sending">发送中' + (attempted ? ' · 最近尝试 ' + escapeHtml(attempted) : '') + '</span>';
    if (doc.mailStatus === 'accepted' || doc.mailStatus === 'sent') return '<span class="muted mail-status-accepted">邮件服务已接受 · ' + escapeHtml(doc.mailTo || '未记录收件人') + (accepted ? ' · ' + escapeHtml(accepted) : '') + '</span>';
    if (doc.mailStatus === 'failed') return '<span class="muted mail-status-failed">发送失败' + (doc.mailError ? '：' + escapeHtml(doc.mailError) : '') + (attempted ? ' · 最近尝试 ' + escapeHtml(attempted) : '') + '</span>';
    return '<span class="muted">未发送</span>';
}

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
            `${order.inquiryIds?.length ? `来源询盘：${order.inquiryIds.length === 1 ? compactInquiryRef(order.inquiryIds[0]) : `${order.inquiryIds.length} 条`} | ` : ''}状态：${orderStatusLabel[order.status] || order.status} | 币种：${order.currency} | 总额：${fmtMoney(order.totalAmount)} | 行数：${order.lines.length}`;

        document.getElementById('fulfillmentProductionStatusInput').value = order.productionStatus || 'not_started';
        document.getElementById('fulfillmentExpectedDeliveryInput').value = order.expectedDeliveryDate || '';
        document.getElementById('fulfillmentEstimatedShipmentInput').value = order.estimatedShipmentDate || '';
        document.getElementById('fulfillmentActualShipmentInput').value = order.actualShipmentDate || '';
        const fulfillment = fulfillmentState(order);
        const fulfillmentReadOnly = ['closed', 'lost'].includes(order.status);
        document.getElementById('orderFulfillmentHint').innerHTML = fulfillmentReadOnly
            ? `<span class="fulfillment-pill ${fulfillment.className}">${escapeHtml(fulfillment.label)}</span> · 已结案/已流失订单仅供查看`
            : `<span class="fulfillment-pill ${fulfillment.className}">${escapeHtml(fulfillment.label)}</span> · ${escapeHtml(PRODUCTION_STATUS_LABEL[order.productionStatus] || '未排产')}`;
        document.getElementById('orderFulfillmentForm').classList.toggle('hidden', fulfillmentReadOnly);
        setFulfillmentFeedback('');

        const payments = order.payments || [];
        const receivedTotal = payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
        document.getElementById('orderPaymentForm').dataset.orderTotal = String(Number(order.totalAmount || 0));
        document.getElementById('orderPaymentSummary').textContent = `已收 ${order.currency} ${fmtMoney(receivedTotal)} · 未收 ${order.currency} ${fmtMoney(Math.max(0, Number(order.totalAmount || 0) - receivedTotal))}`;
        document.getElementById('orderPaymentList').innerHTML = payments.length ? payments.map((payment) => `<li><strong>${payment.type === 'deposit' ? '定金' : payment.type === 'balance' ? '尾款' : '全款'} · ${escapeHtml(payment.currency)} ${fmtMoney(payment.amount)}</strong> · ${escapeHtml(payment.receivedAt)}${payment.referenceNo ? ` · ${escapeHtml(payment.referenceNo)}` : ''}${payment.note ? `<br><span class="muted">${escapeHtml(payment.note)}</span>` : ''}</li>`).join('') : '<li class="muted">暂无收款记录</li>';
        const paymentForm = document.getElementById('orderPaymentForm');
        const canRecordPayment = ['confirmed', 'packing_ready', 'invoiced', 'paid'].includes(order.status) && receivedTotal < Number(order.totalAmount || 0);
        paymentForm.classList.toggle('hidden', !canRecordPayment);
        document.getElementById('orderPaymentHint').textContent = canRecordPayment
            ? '按实际到账登记定金、尾款或全款；系统会自动汇总未收金额。'
            : receivedTotal >= Number(order.totalAmount || 0)
                ? '该订单已收清，无需继续登记。'
                : '请先确认订单，再登记定金或后续收款。';
        if (canRecordPayment) document.getElementById('paymentDateInput').value = new Date().toISOString().slice(0, 10);

        const financial = order.financial || {};
        const profit = order.profit;
        const financialLocked = Boolean(financial.lockedAt);
        const canLockFinancials = ['paid', 'closed'].includes(order.status) && !financialLocked;
        const financialForm = document.getElementById('orderFinancialForm');
        const financeInputs = [
            'financialProductCostInput', 'financialFreightInput', 'financialBankFeeInput',
            'financialOtherFeeInput', 'financialNoteInput'
        ];
        const fillValue = (value) => value === null || value === undefined ? '' : Number(value).toFixed(2);
        document.getElementById('financialProductCostInput').value = fillValue(financialLocked ? financial.actualProductCost : profit?.totalCost);
        document.getElementById('financialFreightInput').value = fillValue(financialLocked ? financial.actualFreight : profit?.freight);
        document.getElementById('financialBankFeeInput').value = fillValue(financialLocked ? financial.bankFee : 0);
        document.getElementById('financialOtherFeeInput').value = fillValue(financialLocked ? financial.otherFee : 0);
        document.getElementById('financialNoteInput').value = financial.note || '';
        financeInputs.forEach((id) => { document.getElementById(id).disabled = financialLocked; });
        financialForm.querySelector('button[type="submit"]').disabled = financialLocked;
        financialForm.classList.toggle('hidden', !canLockFinancials && !financialLocked);
        const financialSummary = document.getElementById('orderFinancialSummary');
        financialSummary.textContent = profit?.ok
            ? `${financialLocked ? '已锁定实际利润' : '当前预计利润'}：${order.currency} ${fmtMoney(profit.profit)} · 利润率 ${profit.marginPercent ?? '-'}%`
            : '成本数据不完整，暂无法计算利润';
        document.getElementById('orderFinancialHint').textContent = financialLocked
            ? `已于 ${String(financial.lockedAt).slice(0, 16).replace('T', ' ')} 锁定实际成本与费用；统计看板将固定采用该数据。`
            : canLockFinancials
                ? `请核对实际产品成本、运费、银行手续费与其他费用（均为 ${order.currency}），锁定后不可直接修改。`
                : '订单收清后可录入并锁定实际成本与费用；当前显示的是供应商价目和物流资料的动态估算。';

        const shipping = order.shipping || {};
        document.getElementById('shippingForwarderInput').value = shipping.forwarder || '';
        document.getElementById('shippingForwarderContactInput').value = shipping.forwarderContact || '';
        document.getElementById('shippingBookingNoInput').value = shipping.bookingNo || '';
        document.getElementById('shippingBookingDateInput').value = shipping.bookingDate || '';
        document.getElementById('shippingContainerTypeInput').value = shipping.containerType || '';
        document.getElementById('shippingContainerNoInput').value = shipping.containerNo || '';
        document.getElementById('shippingSealNoInput').value = shipping.sealNo || '';
        document.getElementById('shippingVesselVoyageInput').value = shipping.vesselVoyage || '';
        document.getElementById('shippingCustomsNoInput').value = shipping.customsNo || '';
        document.getElementById('shippingCustomsDateInput').value = shipping.customsDate || '';
        document.getElementById('shippingOriginPortInput').value = shipping.originPort || '';
        document.getElementById('shippingDestinationPortInput').value = shipping.destinationPort || '';
        document.getElementById('shippingMarksInput').value = shipping.shippingMarks || '';
        document.getElementById('shippingActualShipmentDateInput').value = shipping.actualShipmentDate || order.actualShipmentDate || '';
        document.getElementById('shippingFreightAmountInput').value = shipping.freightAmount ?? '';
        document.getElementById('shippingFreightCurrencyInput').value = shipping.freightCurrency || order.currency || 'USD';
        document.getElementById('shippingFreightRefInput').value = shipping.freightRef || '';
        document.getElementById('shippingForwarderNoteInput').value = shipping.forwarderNote || '';
        await loadShippingPortOptions(shipping.originPort, shipping.destinationPort);
        const shippingReadOnly = ['closed', 'lost'].includes(order.status);
        document.getElementById('orderShippingForm').classList.toggle('hidden', shippingReadOnly);
        const canIssuePackingList = ['confirmed', 'packing_ready'].includes(order.status);
        document.getElementById('issuePackingListBtn').classList.toggle('hidden', !canIssuePackingList);
        document.getElementById('orderShippingHint').textContent = shippingReadOnly
            ? '已结案/已流失订单仅供查看，物流资料不能再修改。'
            : canIssuePackingList
                ? '保存后将固定写入下一版装箱单。'
                : '确认订单后可出具装箱单；产品包装规格仅在装箱单中使用。';

        const docList = document.getElementById('orderDocList');
        docList.innerHTML = (order.documents || []).map((doc) => `<li>
            <span class="doc-badge">${escapeHtml(DOCUMENT_TYPE_LABEL[doc.type] || doc.type)}</span>
            ${Number(doc.snapshot?.snapshotVersion || 0) >= 2 ? '<span class="doc-badge doc-badge-frozen">资料已冻结</span>' : ''}
            ${doc.status === 'voided' ? '<span class="doc-badge doc-badge-voided">已作废</span>' : ''}
            ${escapeHtml(doc.docNo)} · v${doc.version} · ${escapeHtml(String(doc.issuedAt).slice(0, 16).replace('T', ' '))}
            <span class="muted">${doc.status === 'voided'
                ? `作废原因：${escapeHtml(doc.voidReason || '-')} · ${escapeHtml(String(doc.voidedAt || '').slice(0, 16).replace('T', ' '))}`
                : documentMailSummary(doc)}</span>
            <button type="button" class="btn-compact btn-outline" data-preview-doc="${doc.id}" data-doc-type="${escapeHtml(doc.type)}">预览</button>
            ${doc.status === 'voided' ? '' : `<button type="button" class="btn-compact" data-send-doc="${doc.id}" ${doc.mailStatus === 'sending' ? 'disabled' : ''}>${['sent', 'accepted'].includes(doc.mailStatus) ? '再次发送' : '发送邮件'}</button>`}
            ${doc.status === 'active' && !['sent', 'accepted', 'sending'].includes(doc.mailStatus) ? `<button type="button" class="btn-compact btn-danger" data-void-doc="${doc.id}">作废</button>` : ''}
        </li>`).join('') || '<li class="muted">暂无文档</li>';
    } catch (error) {
        document.getElementById('orderDetailTitle').textContent = '加载失败';
        document.getElementById('orderDetailMeta').textContent = error.message;
    }
}

document.getElementById('orderRows').addEventListener('click', async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const actionButton = target.closest('button[data-order-action], button[data-issue-doc]');
    const row = target.closest('tr[data-order-id]');
    const orderId = actionButton?.dataset.orderId || row?.dataset.orderId;
    if (!orderId) return;
    if (!actionButton) {
        viewOrder(orderId);
        return;
    }
    try {
        if (actionButton.dataset.orderAction) {
            const action = actionButton.dataset.orderAction;
            if (action === 'mark_lost') {
                if (!confirm('标记流失后，关联的未成交询盘将一并标记为流失。确认继续？')) return;
            } else if (action === 'close') {
                if (!confirm('结案后订单进入终态，不能再修改或发出新单据，但可继续查看详情与历史单据。确认结案？')) return;
            }
            await apiFetch(`/api/orders/${orderId}/transition`, { method: 'POST', body: JSON.stringify({ action }) });
        } else if (actionButton.dataset.issueDoc) {
            await apiFetch(`/api/orders/${orderId}/documents`, { method: 'POST', body: JSON.stringify({ type: actionButton.dataset.issueDoc }) });
        }
        await viewOrder(orderId);
        await loadOrders();
    } catch (error) {
        alert(error.message);
    }
});

document.getElementById('orderPaymentForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!activeOrderId) return;
    try {
        await apiFetch(`/api/orders/${activeOrderId}/payments`, {
            method: 'POST',
            body: JSON.stringify({
                type: document.getElementById('paymentTypeInput').value,
                amount: document.getElementById('paymentAmountInput').value,
                receivedAt: document.getElementById('paymentDateInput').value,
                referenceNo: document.getElementById('paymentReferenceInput').value.trim(),
                note: document.getElementById('paymentNoteInput').value.trim()
            })
        });
        document.getElementById('orderPaymentForm').reset();
        await viewOrder(activeOrderId);
        await loadOrders();
    } catch (error) {
        alert(error.message);
    }
});

document.getElementById('orderFinancialForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!activeOrderId) return;
    if (!window.confirm('锁定后将作为该订单的实际利润依据，不能直接修改。确认锁定吗？')) return;
    try {
        await apiFetch(`/api/orders/${activeOrderId}/financials/lock`, {
            method: 'POST',
            body: JSON.stringify({
                actualProductCost: document.getElementById('financialProductCostInput').value,
                actualFreight: document.getElementById('financialFreightInput').value,
                bankFee: document.getElementById('financialBankFeeInput').value,
                otherFee: document.getElementById('financialOtherFeeInput').value,
                note: document.getElementById('financialNoteInput').value.trim()
            })
        });
        await viewOrder(activeOrderId);
        await loadOrders();
    } catch (error) {
        alert(error.message);
    }
});

document.getElementById('orderFulfillmentForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!activeOrderId) return;
    try {
        await apiFetch(`/api/orders/${activeOrderId}/fulfillment`, {
            method: 'POST',
            body: JSON.stringify({
                productionStatus: document.getElementById('fulfillmentProductionStatusInput').value,
                expectedDeliveryDate: document.getElementById('fulfillmentExpectedDeliveryInput').value,
                estimatedShipmentDate: document.getElementById('fulfillmentEstimatedShipmentInput').value,
                actualShipmentDate: document.getElementById('fulfillmentActualShipmentInput').value
            })
        });
        await viewOrder(activeOrderId);
        await loadOrders();
    } catch (error) {
        setFulfillmentFeedback(error.message || '履约节点保存失败，请检查后重试。');
    }
});

document.getElementById('orderPaymentForm').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-payment-percent]');
    if (!button) return;
    const total = Number(document.getElementById('orderPaymentForm').dataset.orderTotal || 0);
    const percent = Number(button.dataset.paymentPercent || 0);
    if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(percent) || percent <= 0) return;
    document.getElementById('paymentAmountInput').value = (total * percent / 100).toFixed(2);
});

function getShippingPayload() {
    return {
        forwarder: document.getElementById('shippingForwarderInput').value.trim(),
        forwarderContact: document.getElementById('shippingForwarderContactInput').value.trim(),
        bookingNo: document.getElementById('shippingBookingNoInput').value.trim(),
        bookingDate: document.getElementById('shippingBookingDateInput').value,
        containerType: document.getElementById('shippingContainerTypeInput').value,
        containerNo: document.getElementById('shippingContainerNoInput').value.trim(),
        sealNo: document.getElementById('shippingSealNoInput').value.trim(),
        vesselVoyage: document.getElementById('shippingVesselVoyageInput').value.trim(),
        customsNo: document.getElementById('shippingCustomsNoInput').value.trim(),
        customsDate: document.getElementById('shippingCustomsDateInput').value,
        originPort: document.getElementById('shippingOriginPortInput').value.trim(),
        destinationPort: document.getElementById('shippingDestinationPortInput').value.trim(),
        shippingMarks: document.getElementById('shippingMarksInput').value.trim(),
        actualShipmentDate: document.getElementById('shippingActualShipmentDateInput').value,
        freightAmount: document.getElementById('shippingFreightAmountInput').value,
        freightCurrency: document.getElementById('shippingFreightCurrencyInput').value.trim(),
        freightRef: document.getElementById('shippingFreightRefInput').value.trim(),
        forwarderNote: document.getElementById('shippingForwarderNoteInput').value.trim()
    };
}

async function saveOrderShipping() {
    if (!activeOrderId) return;
    await apiFetch(`/api/orders/${activeOrderId}/shipping`, { method: 'POST', body: JSON.stringify({ shipping: getShippingPayload() }) });
}

async function loadShippingPortOptions(selectedOrigin = '', selectedDestination = '') {
    const renderOptions = (id, ports, selectedValue, placeholder) => {
        const values = [...new Set([...ports, selectedValue].filter(Boolean))]
            .sort((a, b) => a.localeCompare(b));
        const select = document.getElementById(id);
        select.innerHTML = `<option value="">${placeholder}</option>${values
            .map((port) => `<option value="${escapeHtml(port)}">${escapeHtml(port)}</option>`)
            .join('')}`;
        select.value = selectedValue || '';
    };
    try {
        const result = await apiFetch('/api/freight-rates');
        const rates = result.items || [];
        renderOptions('shippingOriginPortInput', rates.map((rate) => rate.originPort), selectedOrigin, '起运港（可选）');
        renderOptions('shippingDestinationPortInput', rates.map((rate) => rate.destinationPort), selectedDestination, '目的港（可选）');
    } catch {
        // Keep saved values usable when the freight-rate list is unavailable.
        renderOptions('shippingOriginPortInput', [], selectedOrigin, '起运港（可选）');
        renderOptions('shippingDestinationPortInput', [], selectedDestination, '目的港（可选）');
    }
}

document.getElementById('orderShippingForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
        await saveOrderShipping();
        await viewOrder(activeOrderId);
    } catch (error) {
        alert(error.message);
    }
});

document.getElementById('issuePackingListBtn').addEventListener('click', async () => {
    if (!activeOrderId) return;
    try {
        await saveOrderShipping();
        await apiFetch(`/api/orders/${activeOrderId}/documents`, { method: 'POST', body: JSON.stringify({ type: 'packing_list' }) });
        await viewOrder(activeOrderId);
        await loadOrders();
    } catch (error) {
        alert(error.message);
    }
});

document.getElementById('loadFreightRateBtn').addEventListener('click', async () => {
    const origin = document.getElementById('shippingOriginPortInput').value.trim();
    const destination = document.getElementById('shippingDestinationPortInput').value.trim();
    const containerType = document.getElementById('shippingContainerTypeInput').value;
    if (!origin || !destination || !containerType) {
        alert('请先填写起运港、目的港并选择柜型。');
        return;
    }
    try {
        const result = await apiFetch(`/api/freight-rates/latest?origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&containerType=${encodeURIComponent(containerType)}`);
        document.getElementById('shippingFreightAmountInput').value = Number(result.item.rate).toFixed(2);
        document.getElementById('shippingFreightCurrencyInput').value = result.item.currency || 'USD';
    } catch (error) {
        alert(`未找到可用的参考运费：${error.message}`);
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
    const target = event.target;
    const previewDocId = target.dataset.previewDoc;
    const sendDocId = target.dataset.sendDoc;
    const voidDocId = target.dataset.voidDoc;
    if (previewDocId) openDocumentPreview(previewDocId, target.dataset.docType);
    if (sendDocId) {
        try {
            await apiFetch(`/api/orders/${activeOrderId}/documents/${sendDocId}/send`, { method: 'POST' });
            await viewOrder(activeOrderId);
        } catch (error) {
            alert(error.message);
        }
    }
    if (voidDocId) {
        const reason = window.prompt('请输入作废原因（必填）：');
        if (reason === null) return;
        if (!reason.trim()) {
            alert('请填写作废原因。');
            return;
        }
        if (!window.confirm('作废后保留编号和历史快照，可预览但不能发送邮件。确认作废吗？')) return;
        try {
            await apiFetch(`/api/orders/${activeOrderId}/documents/${voidDocId}/void`, {
                method: 'POST',
                body: JSON.stringify({ reason: reason.trim() })
            });
            await viewOrder(activeOrderId);
        } catch (error) {
            alert(error.message);
        }
    }
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
    params.set('currency', document.getElementById('erpReportingCurrency').value || 'USD');
    return params.toString();
}

function fmtReportMoney(value, currency) {
    return `${currency || 'USD'} ${fmtMoney(value)}`;
}

async function loadErpDashboard() {
    const range = erpDateRangeQuery();
    const withRange = (path, existingQuery) => {
        if (!range) return path;
        return `${path}${existingQuery ? '&' : '?'}${range}`;
    };

    try {
        const summary = await apiFetch(withRange('/api/dashboard/summary'));
        const currency = summary.reportingCurrency || document.getElementById('erpReportingCurrency').value || 'USD';
        document.getElementById('erpKpiOrders').textContent = summary.committedOrderCount;
        document.getElementById('erpKpiRevenue').textContent = fmtReportMoney(summary.revenue, currency);
        document.getElementById('erpKpiFreight').textContent = fmtReportMoney(summary.freight || 0, currency);
        document.getElementById('erpKpiProfit').textContent = fmtReportMoney(summary.profit, currency);
        document.getElementById('erpKpiRevenueLabel').textContent = `总收入（${currency}）`;
        document.getElementById('erpKpiFreightLabel').textContent = `实际运费（${currency}）`;
        document.getElementById('erpKpiProfitLabel').textContent = `总利润（${currency}）`;
        const exclusions = [];
        if (summary.missingPaymentCount) exclusions.push(`${summary.missingPaymentCount} 张已完成订单未登记收款`);
        if (summary.missingRateCount) exclusions.push(`${summary.missingRateCount} 张订单缺少约定汇率`);
        document.getElementById('erpDashboardNotice').textContent = exclusions.length
            ? `已按 ${currency} 统计；${exclusions.join('，')}，暂未计入金额合计。`
            : `已按 ${currency} 统一统计金额与利润：已完成订单取实际收款，进行中订单取约定汇率。`;
        document.getElementById('erpKpiMargin').textContent = fmtPercent(summary.marginPercent);
        document.getElementById('erpKpiWinRate').textContent = fmtPercent(summary.winRate);
        document.getElementById('erpKpiQuoted').textContent = summary.quotedCount || 0;
        document.getElementById('erpKpiPiIssued').textContent = summary.piIssuedCount || 0;
    } catch (error) {
        console.error(error);
    }

    try {
        const profit = await apiFetch(withRange('/api/dashboard/profit'));
        const currency = profit.reportingCurrency || document.getElementById('erpReportingCurrency').value || 'USD';
        const rows = document.getElementById('profitTrendRows');
        const items = profit.items || [];
        rows.innerHTML = items.length ? items.map((row) => `<tr>
            <td>${escapeHtml(row.month)}</td>
            <td>${row.orderCount}</td>
            <td>${fmtReportMoney(row.revenue, currency)}</td>
            <td>${fmtReportMoney(row.cost, currency)}</td>
            <td>${fmtReportMoney(row.freight || 0, currency)}</td>
            <td>${fmtReportMoney(row.fees || 0, currency)}</td>
            <td>${fmtReportMoney(row.profit, currency)}</td>
            <td>${fmtPercent(row.marginPercent)}</td>
        </tr>`).join('') : '<tr><td colspan="8" class="muted">暂无数据</td></tr>';
    } catch (error) {
        console.error(error);
    }

    try {
        const customers = await apiFetch(withRange('/api/dashboard/customers?limit=10', true));
        const currency = customers.reportingCurrency || document.getElementById('erpReportingCurrency').value || 'USD';
        const rows = document.getElementById('customerAnalysisRows');
        const items = customers.items || [];
        rows.innerHTML = items.length ? items.map((row) => `<tr>
            <td>${escapeHtml(row.customerName)}${row.company ? ` (${escapeHtml(row.company)})` : ''}</td>
            <td>${escapeHtml(row.country || '-')}</td>
            <td>${row.orderCount}</td>
            <td>${fmtReportMoney(row.revenue, currency)}</td>
            <td>${fmtReportMoney(row.profit, currency)}</td>
        </tr>`).join('') : '<tr><td colspan="5" class="muted">暂无数据</td></tr>';
    } catch (error) {
        console.error(error);
    }

    try {
        const countries = await apiFetch(withRange('/api/dashboard/countries'));
        const currency = countries.reportingCurrency || document.getElementById('erpReportingCurrency').value || 'USD';
        const rows = document.getElementById('countryAnalysisRows');
        const items = countries.items || [];
        rows.innerHTML = items.length ? items.map((row) => `<tr>
            <td>${escapeHtml(row.country)}</td>
            <td>${row.customerCount}</td>
            <td>${row.orderCount}</td>
            <td>${fmtReportMoney(row.revenue, currency)}</td>
            <td>${fmtReportMoney(row.profit, currency)}</td>
            <td>${fmtPercent(row.marginPercent)}</td>
        </tr>`).join('') : '<tr><td colspan="6" class="muted">暂无数据</td></tr>';
    } catch (error) {
        console.error(error);
    }

    try {
        const products = await apiFetch(withRange('/api/dashboard/products'));
        const currency = products.reportingCurrency || document.getElementById('erpReportingCurrency').value || 'USD';
        const rows = document.getElementById('productAnalysisRows');
        const items = products.items || [];
        rows.innerHTML = items.length ? items.map((row) => `<tr>
            <td>${escapeHtml(row.productName)}</td>
            <td>${row.orderCount}</td>
            <td>${fmtReportMoney(row.revenue, currency)}</td>
            <td>${fmtReportMoney(row.profit, currency)}</td>
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
