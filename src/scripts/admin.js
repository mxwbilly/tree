const pageSize = 20;
const adminApiBase = '/api/admin';

const loginCard = document.getElementById('loginCard');
const dashboardCard = document.getElementById('dashboardCard');
const loginForm = document.getElementById('loginForm');
const loginFeedback = document.getElementById('loginFeedback');
const inquiryRows = document.getElementById('inquiryRows');
const refreshBtn = document.getElementById('refreshBtn');
const logoutBtn = document.getElementById('logoutBtn');
const exportCsvBtn = document.getElementById('exportCsvBtn');
const prevPageBtn = document.getElementById('prevPageBtn');
const nextPageBtn = document.getElementById('nextPageBtn');
const pageInfo = document.getElementById('pageInfo');
const statusFilter = document.getElementById('statusFilter');
const countryFilter = document.getElementById('countryFilter');
const productFilter = document.getElementById('productFilter');
const keywordFilter = document.getElementById('keywordFilter');
const rfqLevelFilter = document.getElementById('rfqLevelFilter');
const priorityFilter = document.getElementById('priorityFilter');
const slaFilter = document.getElementById('slaFilter');
const sortBySelect = document.getElementById('sortBySelect');
const applyFilterBtn = document.getElementById('applyFilterBtn');
const clearFilterBtn = document.getElementById('clearFilterBtn');
const summaryText = document.getElementById('summaryText');
const detailsPanel = document.getElementById('detailsPanel');
const detailMeta = document.getElementById('detailMeta');
const rfqScoreText = document.getElementById('rfqScoreText');
const priorityText = document.getElementById('priorityText');
const slaText = document.getElementById('slaText');
const rfqMissingList = document.getElementById('rfqMissingList');
const buildReminderBtn = document.getElementById('buildReminderBtn');
const copyReminderBtn = document.getElementById('copyReminderBtn');
const reminderPreview = document.getElementById('reminderPreview');
const detailMessage = document.getElementById('detailMessage');
const detailStatusSelect = document.getElementById('detailStatusSelect');
const detailAssigneeSelect = document.getElementById('detailAssigneeSelect');
const detailNoteInput = document.getElementById('detailNoteInput');
const saveStatusBtn = document.getElementById('saveStatusBtn');
const addNoteBtn = document.getElementById('addNoteBtn');
const timelineList = document.getElementById('timelineList');
const quotePriceInput = document.getElementById('quotePriceInput');
const quoteCurrencyInput = document.getElementById('quoteCurrencyInput');
const quoteMoqInput = document.getElementById('quoteMoqInput');
const quoteIncotermInput = document.getElementById('quoteIncotermInput');
const quoteValidityInput = document.getElementById('quoteValidityInput');
const quoteNoteInput = document.getElementById('quoteNoteInput');
const createQuoteBtn = document.getElementById('createQuoteBtn');
const quoteList = document.getElementById('quoteList');
const kpiTotal = document.getElementById('kpiTotal');
const kpi7d = document.getElementById('kpi7d');
const kpiQuoted = document.getElementById('kpiQuoted');
const kpiWon = document.getElementById('kpiWon');
const kpiPriorityHigh = document.getElementById('kpiPriorityHigh');
const kpiSlaBreached = document.getElementById('kpiSlaBreached');
const topCountriesList = document.getElementById('topCountriesList');
const highIntentPagesList = document.getElementById('highIntentPagesList');
const nextWeekPlanList = document.getElementById('nextWeekPlanList');
const notifyEmailInput = document.getElementById('notifyEmailInput');
const defaultAssigneeInput = document.getElementById('defaultAssigneeInput');
const saveSettingsBtn = document.getElementById('saveSettingsBtn');
const testMailBtn = document.getElementById('testMailBtn');
const mailStatusText = document.getElementById('mailStatusText');

let inquiryItems = [];
let selectedInquiryId = '';
let currentPage = 1;
let totalItems = 0;
let users = [];
let currentUser = null;
let selectedInquiry = null;

const statusLabelMap = {
    new: '新建',
    contacted: '已联系',
    quoted: '已报价',
    won: '已成交',
    lost: '已流失'
};

const productLabelMap = {
    'self-watering-double-layer': '双层自动浇水花盆',
    'root-control-gallon': '控根加仑育苗盆',
    'transparent-orchid': '透明兰花盆',
    'creative-shaped': '创意造型花盆',
    other: '其他/定制需求'
};

const rfqFieldLabelMap = {
    name: '姓名',
    email: '邮箱',
    country: '国家',
    company: '公司名称',
    phone: '联系电话',
    product: '产品',
    quantity: '采购数量',
    oem: 'OEM需求',
    port: '目的港',
    deadline: '交付时间',
    message: '需求描述'
};

function setAuthState(loggedIn) {
    loginCard.classList.toggle('hidden', loggedIn);
    dashboardCard.classList.toggle('hidden', !loggedIn);
    const tabNav = document.getElementById('tabNav');
    if (tabNav) tabNav.classList.toggle('hidden', !loggedIn);
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function getUserName(userId) {
    if (!userId) return '未分配';
    const user = users.find((item) => item.id === userId);
    return user ? user.name || user.email : userId;
}

function getStatusLabel(status) {
    return statusLabelMap[status] || status || '-';
}

function getProductLabel(product) {
    if (!product) return '-';
    return productLabelMap[product] || product;
}

function hasText(value) {
    return String(value || '').trim().length > 0;
}

function computeRfqCompleteness(item) {
    const messageLength = String(item?.message || '').trim().length;
    const rules = [
        { key: 'name', weight: 8, pass: hasText(item?.contact?.name) },
        { key: 'email', weight: 8, pass: hasText(item?.contact?.email) },
        { key: 'country', weight: 8, pass: hasText(item?.contact?.country) },
        { key: 'company', weight: 10, pass: hasText(item?.contact?.company) },
        { key: 'phone', weight: 10, pass: hasText(item?.contact?.phone) },
        { key: 'product', weight: 12, pass: hasText(item?.product) },
        { key: 'quantity', weight: 10, pass: hasText(item?.quantity) },
        { key: 'oem', weight: 6, pass: hasText(item?.oem) },
        { key: 'port', weight: 5, pass: hasText(item?.port) },
        { key: 'deadline', weight: 5, pass: hasText(item?.deadline) },
        { key: 'message', weight: 18, pass: messageLength >= 10 }
    ];
    const maxScore = rules.reduce((sum, rule) => sum + rule.weight, 0);
    let score = 0;
    for (const rule of rules) {
        if (rule.key === 'message') {
            if (messageLength >= 30) {
                score += rule.weight;
            } else if (messageLength >= 10) {
                score += 10;
            }
            continue;
        }
        if (rule.pass) {
            score += rule.weight;
        }
    }
    const percent = Math.round((score / maxScore) * 100);
    const level = percent >= 85 ? 'high' : percent >= 70 ? 'medium' : 'low';
    const missingFields = rules
        .filter((rule) => (rule.key === 'message' ? messageLength < 10 : !rule.pass))
        .map((rule) => rule.key);
    return { score, maxScore, percent, level, missingFields };
}

function getRfqCompleteness(item) {
    if (item?.rfqCompleteness && Number.isFinite(Number(item.rfqCompleteness.percent))) {
        return item.rfqCompleteness;
    }
    return computeRfqCompleteness(item);
}

function getRfqLevelLabel(level) {
    if (level === 'high') return '高';
    if (level === 'medium') return '中';
    return '低';
}

function getPriorityLabel(priority) {
    if (priority === 'high') return '高';
    if (priority === 'medium') return '中';
    return '低';
}

function getPriorityClass(priority) {
    if (priority === 'high') return 'priority-high';
    if (priority === 'medium') return 'priority-medium';
    return 'priority-low';
}

function getInquiryPriority(item) {
    if (item?.priority) return item.priority;
    return getRfqCompleteness(item).level;
}

function getInquirySla(item) {
    if (item?.sla && typeof item.sla.breached !== 'undefined') {
        return item.sla;
    }
    const status = String(item?.status || '');
    const isTerminal = status === 'won' || status === 'lost';
    if (isTerminal) return { breached: false, overdueHours: 0, thresholdHours: 24 };
    const anchorTs = new Date(item?.updatedAt || item?.createdAt || Date.now()).getTime();
    const elapsedHours = Math.max(0, (Date.now() - anchorTs) / (1000 * 60 * 60));
    return {
        breached: elapsedHours > 24,
        overdueHours: Math.max(0, Math.floor(elapsedHours - 24)),
        thresholdHours: 24
    };
}

function buildReminderMessage(item) {
    const rfq = getRfqCompleteness(item);
    const buyer = item?.contact?.name || '您好';
    if (!Array.isArray(rfq.missingFields) || rfq.missingFields.length === 0) {
        return `${buyer}，您好！当前询盘信息已经很完整，我们可直接进入报价与打样安排。若您有目标上架时间或包装细节更新，也欢迎补充。`;
    }
    const missingText = rfq.missingFields
        .map((field) => rfqFieldLabelMap[field] || field)
        .join('、');
    return `${buyer}，您好！为更快给您准确报价，请补充以下信息：${missingText}。收到后我们将在工作时间内优先处理并回复完整方案。`;
}

async function apiFetch(url, options = {}) {
    const headers = {
        'Content-Type': 'application/json',
        ...(options.headers || {})
    };
    const response = await fetch(url, { ...options, credentials: 'same-origin', headers });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        const detail = payload.error ?? payload.message ?? payload.item?.error;
        const text = typeof detail === 'string'
            ? detail
            : (detail?.message || (payload.item ? JSON.stringify(payload.item) : '') || `Request failed (${response.status})`);
        throw new Error(text);
    }
    return payload;
}

function updatePageControls() {
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    pageInfo.textContent = `第 ${currentPage} 页 / 共 ${totalPages} 页`;
    prevPageBtn.disabled = currentPage <= 1;
    nextPageBtn.disabled = currentPage >= totalPages;
}

function renderRows(items) {
    if (!Array.isArray(items) || items.length === 0) {
        inquiryRows.innerHTML = '<tr><td colspan="10">暂无询盘记录</td></tr>';
        summaryText.textContent = `当前 0 条（总计 ${totalItems} 条）`;
        return;
    }
    summaryText.textContent = `本页 ${items.length} 条（总计 ${totalItems} 条）`;
    inquiryRows.innerHTML = items.map((item) => {
        const rfq = getRfqCompleteness(item);
        const priority = getInquiryPriority(item);
        const sla = getInquirySla(item);
        return `
        <tr>
            <td>${new Date(item.createdAt).toLocaleString()}</td>
            <td><span class="status-pill">${getStatusLabel(item.status)}</span></td>
            <td>${escapeHtml(item.contact?.name || '')}</td>
            <td>${escapeHtml(item.contact?.email || '')}</td>
            <td>${escapeHtml(item.contact?.country || '')}</td>
            <td>${escapeHtml(getProductLabel(item.product))}</td>
            <td><span class="score-pill score-${escapeHtml(rfq.level || 'low')}">${escapeHtml(String(rfq.percent || 0))}% · ${getRfqLevelLabel(rfq.level)}</span></td>
            <td><span class="priority-pill ${getPriorityClass(priority)}">${getPriorityLabel(priority)}</span></td>
            <td><span class="sla-pill ${sla.breached ? 'sla-breached' : 'sla-ok'}">${sla.breached ? `超时 ${sla.overdueHours}h` : '正常'}</span></td>
            <td>
                <div class="row-actions">
                    <select data-role="row-status" data-id="${item.id}">
                        <option value="new" ${item.status === 'new' ? 'selected' : ''}>新建</option>
                        <option value="contacted" ${item.status === 'contacted' ? 'selected' : ''}>已联系</option>
                        <option value="quoted" ${item.status === 'quoted' ? 'selected' : ''}>已报价</option>
                        <option value="won" ${item.status === 'won' ? 'selected' : ''}>已成交</option>
                        <option value="lost" ${item.status === 'lost' ? 'selected' : ''}>已流失</option>
                    </select>
                    <button type="button" class="btn-compact" data-role="save-row-status" data-id="${item.id}">保存</button>
                    <button type="button" class="btn-compact btn-outline" data-role="open-detail" data-id="${item.id}">详情</button>
                </div>
            </td>
        </tr>
    `;
    }).join('');
}

function renderTimeline(item) {
    const timeline = Array.isArray(item.timeline) ? item.timeline : [];
    if (timeline.length === 0) {
        timelineList.innerHTML = '<li>暂无跟进记录</li>';
        return;
    }
    const sorted = [...timeline].sort((a, b) => new Date(b.at) - new Date(a.at));
    timelineList.innerHTML = sorted.map((entry) => `
        <li>
            <strong>${escapeHtml(entry.type || 'event')}</strong>
            <div>${new Date(entry.at).toLocaleString()}</div>
            <div>${escapeHtml(entry.note || '')}</div>
        </li>
    `).join('');
}

function fillAssigneeOptions() {
    const options = ['<option value="">未分配</option>'];
    users.forEach((user) => {
        options.push(`<option value="${escapeHtml(user.id)}">${escapeHtml(user.name || user.email)}</option>`);
    });
    detailAssigneeSelect.innerHTML = options.join('');
    defaultAssigneeInput.innerHTML = ['<option value="">默认负责人（不设置）</option>', ...options.slice(1)].join('');
}

function setSelectedInquiry(item) {
    if (!item) {
        selectedInquiryId = '';
        selectedInquiry = null;
        detailsPanel.classList.add('hidden');
        return;
    }
    selectedInquiryId = item.id;
    selectedInquiry = item;
    detailsPanel.classList.remove('hidden');
    const rfq = getRfqCompleteness(item);
    const priority = getInquiryPriority(item);
    const sla = getInquirySla(item);
    detailMeta.textContent = `#${item.id} · ${item.contact?.name || '-'} · ${item.contact?.email || '-'} · ${item.contact?.country || '-'} · 负责人：${getUserName(item.assigneeId)}`;
    rfqScoreText.textContent = `RFQ完整度：${rfq.percent || 0}%（${rfq.score || 0}/${rfq.maxScore || 100}，等级：${getRfqLevelLabel(rfq.level)}）`;
    priorityText.textContent = `优先级：${getPriorityLabel(priority)}（规则：高分询盘优先分配）`;
    slaText.textContent = sla.breached
        ? `SLA状态：已超时 ${sla.overdueHours} 小时（阈值 24h）`
        : 'SLA状态：正常（24h内有更新）';
    if (Array.isArray(rfq.missingFields) && rfq.missingFields.length > 0) {
        rfqMissingList.innerHTML = rfq.missingFields
            .map((field) => `<li>待补充：${escapeHtml(rfqFieldLabelMap[field] || field)}</li>`)
            .join('');
    } else {
        rfqMissingList.innerHTML = '<li>关键字段完整，可优先跟进报价。</li>';
    }
    detailMessage.textContent = item.message || '';
    detailStatusSelect.value = item.status || 'new';
    detailAssigneeSelect.value = item.assigneeId || '';
    detailNoteInput.value = '';
    renderTimeline(item);
    renderQuotes(item.quotes || []);
    quotePriceInput.value = '';
    quoteMoqInput.value = '';
    quoteIncotermInput.value = '';
    quoteValidityInput.value = '30';
    quoteNoteInput.value = '';
    reminderPreview.value = '';
}

function buildQueryFromFilters() {
    const params = new URLSearchParams();
    if (statusFilter.value) params.set('status', statusFilter.value);
    if (countryFilter.value.trim()) params.set('country', countryFilter.value.trim());
    if (productFilter.value.trim()) params.set('product', productFilter.value.trim());
    if (keywordFilter.value.trim()) params.set('q', keywordFilter.value.trim());
    if (rfqLevelFilter.value) params.set('rfqLevel', rfqLevelFilter.value);
    if (priorityFilter.value) params.set('priority', priorityFilter.value);
    if (slaFilter.value) params.set('sla', slaFilter.value);
    if (sortBySelect.value) params.set('sort', sortBySelect.value);
    params.set('pageSize', String(pageSize));
    params.set('page', String(currentPage));
    return params;
}

async function loadUsers() {
    const result = await apiFetch(`${adminApiBase}/users`);
    users = result.items || [];
    fillAssigneeOptions();
}

function renderQuotes(quotes) {
    if (!Array.isArray(quotes) || quotes.length === 0) {
        quoteList.innerHTML = '<li>暂无报价记录</li>';
        return;
    }
    const sorted = [...quotes].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    quoteList.innerHTML = sorted.map((quote) => `
        <li>
            <strong>${escapeHtml(quote.quoteNo)}</strong>
            <div>${escapeHtml(quote.currency)} ${escapeHtml(quote.unitPrice)} · MOQ ${escapeHtml(quote.moq || '-')} · ${escapeHtml(quote.incoterm || '-')}</div>
            <div>有效期：${escapeHtml(quote.validityDays)} 天 · ${new Date(quote.createdAt).toLocaleString()}</div>
            <div>${escapeHtml(quote.note || '')}</div>
        </li>
    `).join('');
}

function updateKpis(summary) {
    const byStatus = summary?.byStatus || {};
    const byPriority = summary?.byPriority || {};
    kpiTotal.textContent = String(summary?.total || 0);
    kpi7d.textContent = String(summary?.recent7d || 0);
    kpiQuoted.textContent = String(byStatus.quoted || 0);
    kpiWon.textContent = String(byStatus.won || 0);
    kpiPriorityHigh.textContent = String(byPriority.high || 0);
    kpiSlaBreached.textContent = String(summary?.slaBreachedOpen || 0);
}

function renderInsights(summary) {
    const countries = Array.isArray(summary?.topCountries) ? summary.topCountries : [];
    if (countries.length === 0) {
        topCountriesList.innerHTML = '<li>暂无数据</li>';
    } else {
        topCountriesList.innerHTML = countries
            .slice(0, 6)
            .map((item) => `<li>${escapeHtml(item.country)}：${escapeHtml(String(item.count || 0))} 条</li>`)
            .join('');
    }

    const highIntentPages = Array.isArray(summary?.highIntentPages) ? summary.highIntentPages : [];
    if (highIntentPages.length === 0) {
        highIntentPagesList.innerHTML = '<li>暂无高意向页面</li>';
    } else {
        highIntentPagesList.innerHTML = highIntentPages
            .slice(0, 5)
            .map((item) => `<li>${escapeHtml(item.page)}（询盘 ${escapeHtml(String(item.total || 0))} / 已报价 ${escapeHtml(String(item.quoted || 0))} / 已成交 ${escapeHtml(String(item.won || 0))}）</li>`)
            .join('');
    }

    const topProducts = Array.isArray(summary?.topProducts) ? summary.topProducts : [];
    const firstCountry = countries[0]?.country || '核心市场';
    const firstProduct = topProducts[0]?.product || '主力品类';
    const secondProduct = topProducts[1]?.product || firstProduct;
    const thirdProduct = topProducts[2]?.product || firstProduct;
    const plan = [
        `Buyer Guide 1：${firstCountry} 采购商如何评估 ${firstProduct} 的 MOQ 与交期`,
        `Buyer Guide 2：${secondProduct} OEM 打样到首柜出货流程与风险点`,
        `Buyer Guide 3：${thirdProduct} 报价模板（Incoterm、有效期、付款条款）`
    ];
    nextWeekPlanList.innerHTML = plan.map((item) => `<li>${escapeHtml(item)}</li>`).join('');
}

async function loadDashboardSummary() {
    const result = await apiFetch(`${adminApiBase}/dashboard/summary`);
    const summary = result.item || {};
    updateKpis(summary);
    renderInsights(summary);
}

async function loadSettings() {
    if (!currentUser || currentUser.role !== 'admin') {
        notifyEmailInput.value = '';
        defaultAssigneeInput.value = '';
        notifyEmailInput.disabled = true;
        defaultAssigneeInput.disabled = true;
        saveSettingsBtn.disabled = true;
        if (testMailBtn) testMailBtn.disabled = true;
        if (mailStatusText) mailStatusText.textContent = '';
        return;
    }
    notifyEmailInput.disabled = false;
    defaultAssigneeInput.disabled = false;
    saveSettingsBtn.disabled = false;
    if (testMailBtn) testMailBtn.disabled = false;
    const result = await apiFetch(`${adminApiBase}/settings`);
    notifyEmailInput.value = result.item?.notifyEmail || '';
    defaultAssigneeInput.value = result.item?.defaultAssigneeId || '';
    await loadMailStatus();
}

async function loadMailStatus() {
    if (!mailStatusText || !currentUser || currentUser.role !== 'admin') return;
    try {
        const result = await apiFetch(`${adminApiBase}/mail/status`);
        const item = result.item || {};
        const parts = [];
        parts.push(item.resendConfigured ? 'Resend 已配置' : 'Resend 未配置');
        parts.push(item.mailFrom ? `发件：${item.mailFrom}` : '发件地址未设置');
        parts.push(item.notifyEmail ? `通知：${item.notifyEmail}` : '通知邮箱未设置');
        mailStatusText.textContent = parts.join(' · ');
    } catch (error) {
        mailStatusText.textContent = `邮件状态读取失败：${error.message}`;
    }
}

async function loadInquiries() {
    try {
        const query = buildQueryFromFilters();
        const result = await apiFetch(`${adminApiBase}/inquiries?${query.toString()}`);
        inquiryItems = result.items || [];
        totalItems = Number(result.total || 0);
        renderRows(inquiryItems);
        updatePageControls();
        if (selectedInquiryId) {
            const selected = inquiryItems.find((item) => item.id === selectedInquiryId);
            if (selected) {
                setSelectedInquiry(selected);
            } else {
                const detailResult = await apiFetch(`${adminApiBase}/inquiries/${encodeURIComponent(selectedInquiryId)}`);
                setSelectedInquiry(detailResult.item);
            }
        }
        await loadDashboardSummary();
    } catch (error) {
        inquiryRows.innerHTML = `<tr><td colspan="10">${error.message}</td></tr>`;
        summaryText.textContent = '加载失败';
    }
}

async function patchInquiry(inquiryId, payload) {
    await apiFetch(`${adminApiBase}/inquiries/${encodeURIComponent(inquiryId)}`, {
        method: 'PATCH',
        body: JSON.stringify(payload)
    });
    await loadInquiries();
}

async function exportCsv() {
    const query = buildQueryFromFilters();
    query.delete('page');
    query.delete('pageSize');
    const response = await fetch(`${adminApiBase}/inquiries/export.csv?${query.toString()}`, {
        credentials: 'same-origin'
    });
    if (!response.ok) {
        throw new Error(`Export failed (${response.status})`);
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `inquiries-page-export-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

async function createQuote() {
    if (!selectedInquiryId) {
        alert('请先选择一条询盘。');
        return;
    }
    const payload = {
        unitPrice: Number(quotePriceInput.value),
        currency: String(quoteCurrencyInput.value || 'USD').trim().toUpperCase(),
        moq: quoteMoqInput.value.trim(),
        incoterm: quoteIncotermInput.value.trim().toUpperCase(),
        validityDays: Number(quoteValidityInput.value || 30),
        note: quoteNoteInput.value.trim()
    };
    await apiFetch(`${adminApiBase}/inquiries/${encodeURIComponent(selectedInquiryId)}/quotes`, {
        method: 'POST',
        body: JSON.stringify(payload)
    });
    await loadInquiries();
}

loginForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submitBtn = document.getElementById('loginBtn');
    submitBtn.disabled = true;
    loginFeedback.textContent = '登录中...';
    try {
        const formData = new FormData(loginForm);
        const payload = Object.fromEntries(formData.entries());
        const result = await apiFetch(`${adminApiBase}/auth/login`, {
            method: 'POST',
            body: JSON.stringify(payload)
        });
        currentUser = result.user || null;
        setAuthState(true);
        loginFeedback.textContent = '';
        await loadUsers();
        await loadSettings();
        await loadInquiries();
    } catch (error) {
        loginFeedback.textContent = error.message;
    } finally {
        submitBtn.disabled = false;
    }
});

refreshBtn?.addEventListener('click', async () => {
    await loadInquiries();
});

exportCsvBtn?.addEventListener('click', async () => {
    exportCsvBtn.disabled = true;
    try {
        await exportCsv();
    } catch (error) {
        alert(error.message);
    } finally {
        exportCsvBtn.disabled = false;
    }
});

applyFilterBtn?.addEventListener('click', async () => {
    currentPage = 1;
    await loadInquiries();
});

clearFilterBtn?.addEventListener('click', async () => {
    statusFilter.value = '';
    countryFilter.value = '';
    productFilter.value = '';
    keywordFilter.value = '';
    rfqLevelFilter.value = '';
    priorityFilter.value = '';
    slaFilter.value = '';
    sortBySelect.value = 'created_desc';
    currentPage = 1;
    await loadInquiries();
});

prevPageBtn?.addEventListener('click', async () => {
    if (currentPage <= 1) return;
    currentPage -= 1;
    await loadInquiries();
});

nextPageBtn?.addEventListener('click', async () => {
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    if (currentPage >= totalPages) return;
    currentPage += 1;
    await loadInquiries();
});

logoutBtn?.addEventListener('click', async () => {
    try {
        await apiFetch(`${adminApiBase}/auth/logout`, { method: 'POST' });
    } catch {
        // The local UI still clears when an expired session cannot be revoked.
    }
    setAuthState(false);
    inquiryRows.innerHTML = '';
    detailsPanel.classList.add('hidden');
    selectedInquiryId = '';
    selectedInquiry = null;
    reminderPreview.value = '';
    priorityText.textContent = '';
    slaText.textContent = '';
    topCountriesList.innerHTML = '';
    highIntentPagesList.innerHTML = '';
    nextWeekPlanList.innerHTML = '';
    users = [];
    currentUser = null;
});

inquiryRows?.addEventListener('click', async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const role = target.dataset.role;
    const inquiryId = target.dataset.id;
    if (!role || !inquiryId) return;

    if (role === 'open-detail') {
        const detailResult = await apiFetch(`${adminApiBase}/inquiries/${encodeURIComponent(inquiryId)}`);
        setSelectedInquiry(detailResult.item);
        return;
    }

    if (role === 'save-row-status') {
        const statusSelect = inquiryRows.querySelector(`select[data-role="row-status"][data-id="${inquiryId}"]`);
        if (!(statusSelect instanceof HTMLSelectElement)) return;
        target.setAttribute('disabled', 'disabled');
        try {
            await patchInquiry(inquiryId, { status: statusSelect.value });
        } catch (error) {
            alert(error.message);
        } finally {
            target.removeAttribute('disabled');
        }
    }
});

saveStatusBtn?.addEventListener('click', async () => {
    if (!selectedInquiryId) return;
    saveStatusBtn.disabled = true;
    try {
        await patchInquiry(selectedInquiryId, {
            status: detailStatusSelect.value,
            assigneeId: detailAssigneeSelect.value
        });
    } catch (error) {
        alert(error.message);
    } finally {
        saveStatusBtn.disabled = false;
    }
});

addNoteBtn?.addEventListener('click', async () => {
    if (!selectedInquiryId) return;
    const note = detailNoteInput.value.trim();
    if (!note) {
        alert('请先输入备注内容。');
        return;
    }
    addNoteBtn.disabled = true;
    try {
        await patchInquiry(selectedInquiryId, { note });
    } catch (error) {
        alert(error.message);
    } finally {
        addNoteBtn.disabled = false;
    }
});

createQuoteBtn?.addEventListener('click', async () => {
    createQuoteBtn.disabled = true;
    try {
        await createQuote();
    } catch (error) {
        alert(error.message);
    } finally {
        createQuoteBtn.disabled = false;
    }
});

buildReminderBtn?.addEventListener('click', () => {
    if (!selectedInquiry) {
        alert('请先打开一条询盘详情。');
        return;
    }
    reminderPreview.value = buildReminderMessage(selectedInquiry);
});

copyReminderBtn?.addEventListener('click', async () => {
    const text = reminderPreview.value.trim();
    if (!text) {
        alert('请先生成提醒文案。');
        return;
    }
    try {
        await navigator.clipboard.writeText(text);
        alert('提醒文案已复制。');
    } catch (error) {
        reminderPreview.focus();
        reminderPreview.select();
        alert('自动复制失败，已选中文案，请手动复制。');
    }
});

saveSettingsBtn?.addEventListener('click', async () => {
    if (!currentUser || currentUser.role !== 'admin') {
        alert('仅管理员可以修改系统设置。');
        return;
    }
    saveSettingsBtn.disabled = true;
    try {
        await apiFetch(`${adminApiBase}/settings`, {
            method: 'PATCH',
            body: JSON.stringify({
                notifyEmail: notifyEmailInput.value.trim(),
                defaultAssigneeId: defaultAssigneeInput.value
            })
        });
        await loadSettings();
        await loadInquiries();
    } catch (error) {
        alert(error.message);
    } finally {
        saveSettingsBtn.disabled = false;
    }
});

testMailBtn?.addEventListener('click', async () => {
    if (!currentUser || currentUser.role !== 'admin') {
        alert('仅管理员可以发送测试邮件。');
        return;
    }
    testMailBtn.disabled = true;
    try {
        const result = await apiFetch(`${adminApiBase}/mail/test`, { method: 'POST' });
        alert(result.message || '测试邮件已发送，请检查收件箱和垃圾箱。');
        await loadMailStatus();
    } catch (error) {
        alert(`测试邮件发送失败：${error.message}`);
        if (mailStatusText) {
            mailStatusText.textContent = `最近测试失败：${error.message}`;
        }
    } finally {
        testMailBtn.disabled = false;
    }
});

async function boot() {
    localStorage.removeItem('greensmart-admin-token');
    try {
        const me = await apiFetch(`${adminApiBase}/auth/me`);
        currentUser = me.user || null;
        setAuthState(true);
        await loadUsers();
        await loadSettings();
        await loadInquiries();
    } catch (error) {
        setAuthState(false);
    }
}

boot();
