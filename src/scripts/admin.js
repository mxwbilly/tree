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
const companyProfileInputs = {
    name: document.getElementById('companyNameInput'), legalName: document.getElementById('companyLegalNameInput'),
    email: document.getElementById('companyEmailInput'), phone: document.getElementById('companyPhoneInput'),
    website: document.getElementById('companyWebsiteInput'), registrationNo: document.getElementById('companyRegistrationInput'),
    taxId: document.getElementById('companyTaxIdInput'), exportId: document.getElementById('companyExportIdInput'),
    address: document.getElementById('companyAddressInput'), bankInfo: document.getElementById('companyBankInfoInput')
};
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

const adminErrorTranslations = {
    'Payment amount exceeds the order total.': '本次收款金额超过订单总额，请检查到账金额。',
    'Payment amount must be greater than zero.': '到账金额必须大于 0。',
    'Confirm the order before recording payment.': '请先确认订单，再登记收款。',
    'Received date is required.': '请选择到账日期。',
    'Invalid payment type.': '收款类型无效，请重新选择。',
    'Order not found.': '未找到该订单。',
    'Document not found.': '未找到该单据。',
    'Customer not found.': '未找到该客户。',
    'Product not found.': '未找到该产品。',
    'Supplier not found.': '未找到该供应商。',
    'Inquiry not found.': '未找到该询盘。',
    'Quote not found.': '未找到该报价记录。',
    'Freight rate not found.': '未找到该运费记录。',
    'Exchange rate not found.': '未找到该汇率记录。',
    'Price tier not found.': '未找到该价格阶梯。',
    'Invalid credentials.': '账号或密码不正确。',
    'Email and password are required.': '请输入账号和密码。',
    'Invalid notifyEmail format.': '通知邮箱格式不正确。',
    'Forbidden.': '没有权限执行此操作。',
    'Missing authorization token.': '登录状态已失效，请重新登录。',
    'Invalid or expired token.': '登录状态已过期，请重新登录。',
    'Server security configuration is incomplete.': '服务器安全配置不完整，请检查环境变量。',
    'Public security configuration is incomplete.': '前台安全验证配置不完整，请检查环境变量。',
    'Request protection is temporarily unavailable.': '请求安全保护暂时不可用，请稍后重试。',
    'Security verification is temporarily unavailable.': '安全验证服务暂时不可用，请稍后重试。',
    'Security verification failed. Please try again.': '安全验证失败，请重新完成验证后再试。',
    'Please complete the security verification.': '请先完成安全验证。',
    'D1 binding DB is not configured.': '数据库连接未配置，请检查本地或生产环境。',
    'Not found.': '未找到请求的内容。',
    'Customer email is missing. Update the customer profile before sending.': '客户邮箱未填写，请先在客户档案中补充邮箱后再发送。',
    'No notify email configured.': '尚未配置通知邮箱。',
    'origin, destination and containerType are required.': '请选择起运港、目的港和柜型。',
    'originPort is required.': '请选择起运港。',
    'destinationPort is required.': '请选择目的港。',
    'containerType is required.': '请选择柜型。',
    'rate must be a positive number.': '运费必须大于 0。',
    'base and quote currency are required.': '请选择基准货币和报价货币。',
    'baseCurrency is required.': '请输入基准货币。',
    'quoteCurrency is required.': '请输入报价货币。',
    'effectiveDate is required (YYYY-MM-DD).': '请选择汇率生效日期。',
    'baseCurrency must be a 3-letter code.': '基准货币必须是 3 位货币代码。',
    'Public exchange-rate source is temporarily unavailable.': '公开汇率服务暂时不可用，请稍后重试。',
    'Public exchange-rate source returned an error.': '公开汇率服务返回异常，请稍后重试。',
    'No valid public rates were returned.': '公开汇率服务未返回有效汇率。',
    'customerId is required.': '请选择客户。',
    'customerId does not exist.': '所选客户不存在。',
    'inquiryId is required.': '请选择询盘。',
    'inquiryId does not exist.': '所选询盘不存在。',
    'The selected inquiry does not belong to this customer.': '所选询盘不属于当前客户。',
    'The inquiry belongs to a different customer.': '该询盘属于其他客户，不能合并到当前报价。',
    'This inquiry is already linked to a quotation.': '该询盘已关联报价单。',
    'Only a quotation draft can accept another inquiry product.': '只有报价草稿可以合并其他询盘产品。',
    'lines must be a non-empty array.': '请至少添加一项产品。',
    'Each line requires a product and positive quantity.': '每一项都需要选择产品并填写大于 0 的数量。',
    'each line requires productId.': '请为每一项选择产品。',
    'each line requires a positive qty.': '产品数量必须大于 0。',
    'Fulfillment dates must use YYYY-MM-DD.': '交期或出运日期格式不正确，请重新选择日期。',
    'Invalid production status.': '请选择有效的生产状态。'
};

function localizeAdminMessage(message, status) {
    const source = String(message || '').trim();
    if (adminErrorTranslations[source]) return adminErrorTranslations[source];
    if (/^No exchange rate found for .+\.$/.test(source)) return '未找到所需货币的换算汇率，请先维护汇率。';
    if (/^Test email sent to .+\.$/.test(source)) return '测试邮件已发送，请检查收件箱和垃圾邮件。';
    if (/^No supplier price tier found for .+\.$/.test(source)) return '未找到满足当前数量的供应商价格阶梯，请先维护产品成本。';
    if (/^Cannot edit logistics for an order in .+ status\.$/.test(source)) return '当前订单状态不允许修改物流资料。';
    if (/^Cannot edit fulfillment for an order in .+ status\.$/.test(source)) return '当前订单已结案或已流失，履约资料只能查看，不能再修改。';
    if (status >= 200 && status < 300) return '操作已完成。';
    if (status === 401) return '登录状态已失效，请重新登录。';
    if (status === 403) return '没有权限执行此操作。';
    if (status >= 500) return '服务暂时不可用，请稍后重试。';
    return '操作未完成，请检查填写内容后重试。';
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
        console.warn('后台接口请求失败：', text);
        throw new Error(localizeAdminMessage(text, response.status));
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
                        <div class="quote-list">${renderFormalQuoteHtml(item.formalOrder, item.quotes || [])}</div>
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

function renderFormalQuoteHtml(order, legacyQuotes) {
    if (order) {
        const labels = {
            quoted: '已报价', pi_issued: '已出 PI', confirmed: '已确认', packing_ready: '已出装箱单',
            invoiced: '已出发票', paid: '已付款', closed: '已结案', lost: '已流失'
        };
        return `
            <strong>${escapeHtml(order.orderNo)}</strong>
            <div>${escapeHtml(order.currency)} ${Number(order.totalAmount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
            <div class="muted" style="margin:6px 0 0;">${new Date(order.createdAt).toLocaleString()} · 状态：${escapeHtml(labels[order.status] || order.status || '-')}</div>
        `;
    }
    const legacyCount = Array.isArray(legacyQuotes) ? legacyQuotes.length : 0;
    return `<p class="muted" style="margin:0;">暂无正式报价。${legacyCount ? `检测到 ${legacyCount} 条旧版报价历史，已设为只读。` : '可前往“报价与单据”创建。'}</p>`;
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
    const profile = result.item?.companyProfile || {};
    Object.entries(companyProfileInputs).forEach(([key, input]) => { if (input) input.value = profile[key] || ''; });
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
            detail: {
                inquiryId: item.id,
                customerId: item.customerId,
                customerName: item.contact?.name || '',
                customerEmail: item.contact?.email || '',
                country: item.contact?.country || '',
                product: item.product || '',
                quantity: item.quantity || ''
            }
        }));
        return;
    }

    if (role === 'save-row-status') {
        const statusSelect = inquiryRows.querySelector(`select[data-role="row-status"][data-id="${inquiryId}"]`);
        if (!(statusSelect instanceof HTMLSelectElement)) return;
        const nextStatus = statusSelect.value;
        if (nextStatus === 'won' || nextStatus === 'lost') {
            const hint = nextStatus === 'lost'
                ? '标记流失后，关联的未收款订单将一并标记为流失。此操作可逆。'
                : '确认将该询盘标记为已成交？';
            if (!confirm(hint)) return;
        }
        target.setAttribute('disabled', 'disabled');
        try {
            await patchInquiry(inquiryId, { status: nextStatus });
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
                notifyEmail: notifyEmailInput.value.trim(),
                companyProfile: Object.fromEntries(Object.entries(companyProfileInputs).map(([key, input]) => [key, input?.value.trim() || '']))
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
        alert(localizeAdminMessage(result.message, 200));
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
