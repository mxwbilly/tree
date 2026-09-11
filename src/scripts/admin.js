const pageSize = 20;
const adminApiBase = '/api/admin';

const loginCard = document.getElementById('loginCard');
const adminApp = document.getElementById('adminApp');
const dashboardCard = document.getElementById('dashboardCard');
const loginForm = document.getElementById('loginForm');
const loginFeedback = document.getElementById('loginFeedback');
const inquiryRows = document.getElementById('inquiryRows');
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
const kpiTotal = document.getElementById('kpiTotal');
const kpi7d = document.getElementById('kpi7d');
const kpiQuoted = document.getElementById('kpiQuoted');
const kpiWon = document.getElementById('kpiWon');
const kpiPriorityHigh = document.getElementById('kpiPriorityHigh');
const kpiSlaBreached = document.getElementById('kpiSlaBreached');
const topCountriesList = document.getElementById('topCountriesList');
const notifyEmailInput = document.getElementById('notifyEmailInput');
const saveSettingsBtn = document.getElementById('saveSettingsBtn');
const testMailBtn = document.getElementById('testMailBtn');
const mailStatusText = document.getElementById('mailStatusText');
const refreshMailLogsBtn = document.getElementById('refreshMailLogsBtn');
const mailLogList = document.getElementById('mailLogList');

let inquiryItems = [];
let selectedInquiryId = '';
let currentPage = 1;
let totalItems = 0;
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
    adminApp.classList.toggle('hidden', !loggedIn);
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
    const headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});
    const requestOptions = Object.assign({}, options, { credentials: 'same-origin', headers });
    const response = await fetch(url, requestOptions);
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
        inquiryRows.innerHTML = '<tr><td colspan="9">暂无询盘记录</td></tr>';
        summaryText.textContent = `当前 0 条（总计 ${totalItems} 条）`;
        return;
    }
    summaryText.textContent = `本页 ${items.length} 条（总计 ${totalItems} 条）`;
    inquiryRows.innerHTML = items.map((item) => {
        const rfq = getRfqCompleteness(item);
        const priority = getInquiryPriority(item);
        const sla = getInquirySla(item);
        const expandedItem = selectedInquiryId === item.id && selectedInquiry ? selectedInquiry : item;
        return `
        <tr>
            <td>${new Date(item.createdAt).toLocaleString()}</td>
            <td><span class="status-pill">${getStatusLabel(item.status)}</span></td>
            <td>${escapeHtml(item.contact?.name || '')}</td>
            <td>${escapeHtml(item.contact?.country || '')}</td>
            <td><span class="score-pill score-${escapeHtml(rfq.level || 'low')}">${escapeHtml(String(rfq.percent || 0))}% · ${getRfqLevelLabel(rfq.level)}</span></td>
            <td><span class="priority-pill ${getPriorityClass(priority)}">${getPriorityLabel(priority)}</span></td>
            <td><span class="sla-pill ${sla.breached ? 'sla-breached' : 'sla-ok'}">${sla.breached ? `超时 ${sla.overdueHours}h` : '正常'}</span></td>
            <td>
                <div class="row-status-control">
                    <select data-role="row-status" data-id="${item.id}">
                        <option value="new" ${item.status === 'new' ? 'selected' : ''}>新建</option>
                        <option value="contacted" ${item.status === 'contacted' ? 'selected' : ''}>已联系</option>
                        <option value="quoted" ${item.status === 'quoted' ? 'selected' : ''}>已报价</option>
                        <option value="won" ${item.status === 'won' ? 'selected' : ''}>已成交</option>
                        <option value="lost" ${item.status === 'lost' ? 'selected' : ''}>已流失</option>
                    </select>
                    <button type="button" class="btn-compact" data-role="save-row-status" data-id="${item.id}">保存</button>
                </div>
            </td>
            <td>
                <div class="row-actions">
                    <button type="button" class="btn-compact btn-outline" data-role="open-detail" data-id="${item.id}">详情</button>
                    <button type="button" class="btn-compact btn-outline" data-role="open-quote-workspace" data-id="${item.id}">报价与单据</button>
                    <button type="button" class="btn-compact btn-danger" data-role="delete-inquiry" data-id="${item.id}">删除</button>
                </div>
            </td>
        </tr>
        ${selectedInquiryId === item.id ? renderInquiryDetail(expandedItem) : ''}
    `;
    }).join('');
}

function renderInquiryTimeline(item) {
    const timeline = Array.isArray(item.timeline) ? [...item.timeline] : [];
    const sorted = timeline.sort((a, b) => new Date(b.at) - new Date(a.at));
    const items = sorted.length
        ? sorted.map((entry) => `<li><strong>${escapeHtml(entry.type || 'event')}</strong> · ${new Date(entry.at).toLocaleString()}<br>${escapeHtml(entry.note || '')}</li>`).join('')
        : '<li>暂无跟进记录</li>';
    return `<ul class="timeline-list inquiry-followup-list">${items}</ul>`;
}

function setSelectedInquiry(item) {
    if (!item) {
        selectedInquiryId = '';
        selectedInquiry = null;
        return;
    }
    selectedInquiryId = item.id;
    selectedInquiry = item;
}

function renderInquiryDetail(item) {
    const rfq = getRfqCompleteness(item);
    const priority = getInquiryPriority(item);
    const sla = getInquirySla(item);
    const missingFields = Array.isArray(rfq.missingFields) && rfq.missingFields.length > 0
        ? rfq.missingFields
            .map((field) => `<li>待补充：${escapeHtml(rfqFieldLabelMap[field] || field)}</li>`)
            .join('')
        : '<li>关键字段完整，可优先跟进报价。</li>';
    const contact = item.contact || {};
    const slaText = sla.breached ? `超时 ${sla.overdueHours} 小时` : '正常';
    return `<tr class="inquiry-detail-row">
        <td colspan="9">
            <section class="inquiry-record-detail">
                <div class="inquiry-record-detail-header">
                    <div>
                        <h3>询盘详情</h3>
                        <p class="muted">${escapeHtml(contact.name || '-')} · ${escapeHtml(contact.email || '-')} · ${escapeHtml(contact.company || '未填写公司')} · ${escapeHtml(contact.country || '-')}</p>
                    </div>
                </div>
                <div class="inquiry-record-summary">
                    <div>RFQ 完整度<strong>${escapeHtml(String(rfq.percent || 0))}% · ${getRfqLevelLabel(rfq.level)}</strong></div>
                    <div>优先级<strong>${getPriorityLabel(priority)}</strong></div>
                    <div>SLA<strong>${escapeHtml(slaText)}</strong></div>
                </div>
                <div class="inquiry-record-content">
                    <div class="inquiry-record-section">
                        <h4>采购需求</h4>
                        <div class="inquiry-request-meta">
                            <span>产品：<strong>${escapeHtml(getProductLabel(item.product) || '-')}</strong></span>
                            <span>数量：<strong>${escapeHtml(item.quantity || '-')}</strong></span>
                            <span>OEM：<strong>${escapeHtml(item.oem || '-')}</strong></span>
                            <span>目的港：<strong>${escapeHtml(item.port || '-')}</strong></span>
                            <span>交期：<strong>${escapeHtml(item.deadline || '-')}</strong></span>
                        </div>
                        <p style="white-space:pre-wrap;">${escapeHtml(item.message || '未填写需求说明。')}</p>
                        <h4>待补充信息</h4>
                        <ul class="timeline-list" style="max-height:120px;">${missingFields}</ul>
                        <div class="toolbar" style="margin-top:12px;">
                            <button type="button" class="btn-compact btn-outline" data-role="build-reminder" data-id="${item.id}">生成补全提醒</button>
                            <button type="button" class="btn-compact btn-outline" data-role="copy-reminder" data-id="${item.id}">复制提醒文案</button>
                        </div>
                        <textarea data-role="reminder-preview" data-id="${item.id}" placeholder="这里会生成针对缺失字段的客户补全提醒文案..." style="min-height:80px;"></textarea>
                    </div>
                    <div class="inquiry-record-section">
                        <h4>最新报价</h4>
                        <p class="muted">正式报价、PI 与出运单据统一在“报价与单据”中管理。</p>
                        <div class="quote-list">${renderLatestQuoteHtml(item.quotes || [])}</div>
                    </div>
                </div>
                <section class="inquiry-followup-section">
                    <h4>跟进记录</h4>
                    ${renderInquiryTimeline(item)}
                    <div class="inquiry-followup-composer">
                        <label for="detailNote-${escapeHtml(item.id)}">新增跟进备注</label>
                        <textarea id="detailNote-${escapeHtml(item.id)}" data-role="detail-note" data-id="${item.id}" placeholder="填写电话沟通结论、报价进展、下一步计划..."></textarea>
                        <button type="button" class="btn-compact" data-role="add-note" data-id="${item.id}">添加备注</button>
                    </div>
                </section>
            </section>
        </td>
    </tr>`;
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

function renderLatestQuoteHtml(quotes) {
    if (!Array.isArray(quotes) || quotes.length === 0) {
        return '<p class="muted" style="margin:0;">暂无历史报价。可前往“报价与单据”创建正式报价草案。</p>';
    }
    const sorted = [...quotes].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const quote = sorted[0];
    const labels = { draft: '草稿', sent: '已发送', follow_up: '跟进中', accepted: '已接受', rejected: '已拒绝', expired: '已过期' };
    return `
        <strong>${escapeHtml(quote.quoteNo)}</strong>
        <div>${escapeHtml(quote.currency)} ${escapeHtml(quote.unitPrice)} · MOQ ${escapeHtml(quote.moq || '-')} · ${escapeHtml(quote.incoterm || '-')}</div>
        <div class="muted" style="margin:6px 0 0;">有效期：${escapeHtml(quote.validityDays)} 天 · ${new Date(quote.createdAt).toLocaleString()} · 状态：${escapeHtml(labels[quote.trackingStatus] || labels.draft)}</div>
        ${quote.note ? `<div style="margin-top:6px;">${escapeHtml(quote.note)}</div>` : ''}
        ${sorted.length > 1 ? `<div class="muted" style="margin:6px 0 0;">另有 ${sorted.length - 1} 条历史报价。</div>` : ''}
    `;
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
        notifyEmailInput.disabled = true;
        saveSettingsBtn.disabled = true;
        if (testMailBtn) testMailBtn.disabled = true;
        if (mailStatusText) mailStatusText.textContent = '';
        return;
    }
    notifyEmailInput.disabled = false;
    saveSettingsBtn.disabled = false;
    if (testMailBtn) testMailBtn.disabled = false;
    const result = await apiFetch(`${adminApiBase}/settings`);
    notifyEmailInput.value = result.item?.notifyEmail || '';
    await loadMailStatus();
    await loadMailLogs();
}

async function loadMailStatus() {
    if (!mailStatusText || !currentUser || currentUser.role !== 'admin') return;
    try {
        const result = await apiFetch(`${adminApiBase}/mail/status`);
        const item = result.item || {};
        const parts = [];
        parts.push(item.resendConfigured ? 'Resend 已配置' : 'Resend 未配置');
        parts.push(item.webhookConfigured ? '送达追踪已配置' : '送达追踪待配置');
        parts.push(item.mailFrom ? `发件：${item.mailFrom}` : '发件地址未设置');
        parts.push(item.notifyEmail ? `通知：${item.notifyEmail}` : '通知邮箱未设置');
        mailStatusText.textContent = parts.join(' · ');
    } catch (error) {
        mailStatusText.textContent = `邮件状态读取失败：${error.message}`;
    }
}

function getMailLogLabel(type) {
    const labels = {
        'mail.test': '测试邮件',
        'mail.inquiry_notify': '新询盘通知',
        'mail.inquiry_assigned': '询盘分配通知'
    };
    return labels[type] || type || '邮件通知';
}

function getMailLogResult(payload) {
    const results = [payload?.notify, payload?.assignee, payload].filter(Boolean);
    if (results.some((item) => item?.ok === false)) return '发送失败';
    if (results.some((item) => item?.ok === true)) return '已发送';
    return '已记录';
}

function getDeliveryLabel(status) {
    const labels = { accepted: '已提交发送', sent: '已发送', delivered: '已送达', opened: '已打开', delayed: '投递延迟', failed: '投递失败' };
    return labels[status] || '等待送达状态';
}

async function loadMailLogs() {
    if (!mailLogList) return;
    if (!currentUser || currentUser.role !== 'admin') {
        mailLogList.innerHTML = '';
        return;
    }
    try {
        const result = await apiFetch(`${adminApiBase}/mail/logs`);
        const items = Array.isArray(result.items) ? result.items : [];
        if (!items.length) {
            mailLogList.innerHTML = '<li>暂无邮件通知记录</li>';
            return;
        }
        mailLogList.innerHTML = items.map((item) => {
            const payload = item.payload || {};
            const recipient = payload.notifyEmail || '-';
            const error = payload.error || payload.notify?.error || payload.assignee?.error || '';
            return `<li data-mail-log-id="${escapeHtml(item.id)}">
                <strong>${escapeHtml(getMailLogLabel(item.type))}</strong> · ${escapeHtml(getMailLogResult(payload))} · ${escapeHtml(getDeliveryLabel(item.deliveryStatus))}<br>
                <span class="muted">${escapeHtml(new Date(item.createdAt).toLocaleString())} · 收件：${escapeHtml(recipient)}${error ? ` · 原因：${escapeHtml(error)}` : ''}</span>
                <button type="button" class="btn-compact btn-outline mail-log-delete" data-mail-log-id="${escapeHtml(item.id)}" style="margin-left:8px;">删除</button>
            </li>`;
        }).join('');
    } catch (error) {
        mailLogList.innerHTML = `<li>邮件记录读取失败：${escapeHtml(error.message)}</li>`;
    }
}

async function loadInquiries() {
    try {
        const query = buildQueryFromFilters();
        const result = await apiFetch(`${adminApiBase}/inquiries?${query.toString()}`);
        inquiryItems = result.items || [];
        totalItems = Number(result.total || 0);
        if (selectedInquiryId) {
            try {
                const detailResult = await apiFetch(`${adminApiBase}/inquiries/${encodeURIComponent(selectedInquiryId)}`);
                setSelectedInquiry(detailResult.item);
            } catch {
                setSelectedInquiry(null);
            }
        }
        renderRows(inquiryItems);
        updatePageControls();
        await loadDashboardSummary();
    } catch (error) {
        inquiryRows.innerHTML = `<tr><td colspan="9">${error.message}</td></tr>`;
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

loginForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submitBtn = document.getElementById('loginBtn');
    submitBtn.disabled = true;
    loginFeedback.textContent = '登录中...';
    try {
        // Read the two fields directly so the login flow also works in local
        // preview runtimes that do not provide the browser FormData API.
        const payload = {
            email: document.getElementById('email').value.trim(),
            password: document.getElementById('password').value
        };
        const result = await apiFetch(`${adminApiBase}/auth/login`, {
            method: 'POST',
            body: JSON.stringify(payload)
        });
        currentUser = result.user || null;
        setAuthState(true);
        loginFeedback.textContent = '';
        await loadSettings();
        await loadInquiries();
    } catch (error) {
        loginFeedback.textContent = error.message;
    } finally {
        submitBtn.disabled = false;
    }
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
    selectedInquiryId = '';
    selectedInquiry = null;
    topCountriesList.innerHTML = '';
    currentUser = null;
});

inquiryRows?.addEventListener('click', async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const role = target.dataset.role;
    const inquiryId = target.dataset.id;
    if (!role || !inquiryId) return;

    if (role === 'open-detail') {
        if (selectedInquiryId === inquiryId) {
            setSelectedInquiry(null);
        } else {
            const detailResult = await apiFetch(`${adminApiBase}/inquiries/${encodeURIComponent(inquiryId)}`);
            setSelectedInquiry(detailResult.item);
        }
        renderRows(inquiryItems);
        return;
    }

    if (role === 'open-quote-workspace') {
        const cached = selectedInquiryId === inquiryId ? selectedInquiry : inquiryItems.find((item) => item.id === inquiryId);
        const item = cached?.customerId ? cached : (await apiFetch(`${adminApiBase}/inquiries/${encodeURIComponent(inquiryId)}`)).item;
        if (!item?.customerId) {
            alert('该询盘尚未关联客户，无法筛选报价记录。');
            return;
        }
        window.dispatchEvent(new CustomEvent('greensmart:open-orders-for-customer', {
            detail: { customerId: item.customerId, customerName: item.contact?.name || '' }
        }));
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

    if (role === 'delete-inquiry') {
        if (!confirm('删除这条询盘及其报价、跟进和关联通知记录？此操作无法恢复。')) return;
        target.setAttribute('disabled', 'disabled');
        try {
            await apiFetch(`${adminApiBase}/inquiries/${encodeURIComponent(inquiryId)}`, { method: 'DELETE' });
            if (selectedInquiryId === inquiryId) setSelectedInquiry(null);
            await loadInquiries();
        } catch (error) {
            alert(`删除失败：${error.message}`);
            target.removeAttribute('disabled');
        }
        return;
    }

    if (role === 'build-reminder') {
        const input = inquiryRows.querySelector(`textarea[data-role="reminder-preview"][data-id="${inquiryId}"]`);
        const item = selectedInquiryId === inquiryId ? selectedInquiry : null;
        if (input && item) input.value = buildReminderMessage(item);
        return;
    }

    if (role === 'copy-reminder') {
        const input = inquiryRows.querySelector(`textarea[data-role="reminder-preview"][data-id="${inquiryId}"]`);
        const text = input?.value.trim();
        if (!text) {
            alert('请先生成提醒文案。');
            return;
        }
        try {
            await navigator.clipboard.writeText(text);
            alert('提醒文案已复制。');
        } catch {
            input.focus();
            input.select();
            alert('自动复制失败，已选中文案，请手动复制。');
        }
        return;
    }

    if (role === 'add-note') {
        const input = inquiryRows.querySelector(`textarea[data-role="detail-note"][data-id="${inquiryId}"]`);
        const note = input?.value.trim();
        if (!note) {
            alert('请先输入备注内容。');
            return;
        }
        target.setAttribute('disabled', 'disabled');
        try {
            await patchInquiry(inquiryId, { note });
        } catch (error) {
            alert(error.message);
            target.removeAttribute('disabled');
        }
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
                notifyEmail: notifyEmailInput.value.trim()
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
        await loadMailLogs();
    } catch (error) {
        alert(`测试邮件发送失败：${error.message}`);
        if (mailStatusText) {
            mailStatusText.textContent = `最近测试失败：${error.message}`;
        }
    } finally {
        testMailBtn.disabled = false;
    }
});

refreshMailLogsBtn?.addEventListener('click', loadMailLogs);

mailLogList?.addEventListener('click', async (event) => {
    const button = event.target.closest('.mail-log-delete');
    if (!button) return;
    const id = button.dataset.mailLogId;
    if (!id || !confirm('删除这条邮件通知记录？已发送的邮件不会被撤回。')) return;
    button.disabled = true;
    try {
        await apiFetch(`${adminApiBase}/mail/logs/${encodeURIComponent(id)}`, { method: 'DELETE' });
        await loadMailLogs();
    } catch (error) {
        alert(`删除失败：${error.message}`);
        button.disabled = false;
    }
});

async function boot() {
    localStorage.removeItem('greensmart-admin-token');
    try {
        const me = await apiFetch(`${adminApiBase}/auth/me`);
        currentUser = me.user || null;
        setAuthState(true);
        await loadSettings();
        await loadInquiries();
    } catch (error) {
        setAuthState(false);
    } finally {
        document.body.classList.remove('auth-pending');
    }
}

boot();
