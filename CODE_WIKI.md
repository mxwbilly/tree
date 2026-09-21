# GreenSmart 项目 Code Wiki

> **文档版本**: 1.0  
> **生成日期**: 2026-07-06  
> **项目名称**: GreenSmart - 智能自动浇水花盆官方网站  
> **项目类型**: B2B电商官网 + 后台管理系统  

---

## 📖 目录

1. [项目概述](#项目概述)
2. [整体架构](#整体架构)
3. [核心模块](#核心模块)
4. [数据模型](#数据模型)
5. [关键函数与算法](#关键函数与算法)
6. [API接口文档](#api接口文档)
7. [依赖关系](#依赖关系)
8. [运行与部署](#运行与部署)
9. [开发规范](#开发规范)
10. [扩展计划](#扩展计划)

---

## 项目概述

### 项目定位
GreenSmart 是面向东南亚进口商的B2B花盆批发平台,提供:
- **产品展示**: 自浇水花盆、控根育苗盆、透明兰花盆、创意造型花盆
- **询盘系统**: RFQ(报价请求)提交与管理
- **后台管理**: 询盘跟进、报价管理、客户关系管理
- **国际化**: 支持英语、越南语、泰语、印尼语

### 技术栈
- **前端**: HTML5 + CSS3 + JavaScript (ES6+)
- **后端**: Express.js (本地开发) / Cloudflare Pages Functions (生产部署)
- **数据存储**: JSON文件 (本地) / Cloudflare D1数据库 (生产)
- **认证**: JWT (JSON Web Token)
- **构建**: esbuild + 自定义构建脚本
- **邮件**: Resend API / SMTP

### 目录结构
```
d:\trae/
├── index.html              # 主页(产品展示+询盘表单)
├── admin.html              # 后台管理界面
├── server.js               # 本地开发服务器(Express)
├── build.js                # 构建脚本
├── package.json            # 项目配置
├── .env.example            # 环境变量模板
├── schema.sql              # D1数据库schema
├── src/
│   ├── scripts/
│   │   ├── main.js         # 前端主脚本(国际化+表单提交+趋势数据)
│   │   ├── admin.js        # 后台管理脚本(询盘列表+详情+报价)
│   │   ├── erp-admin.js    # ERP扩展脚本
│   │   └── detail-page.js  # 产品详情页脚本
│   ├── styles/
│   │   └── main.css        # 主样式文件
│   └── i18n/
│       ├── en.json         # 英语翻译
│       ├── vi.json         # 越南语翻译
│       ├── th.json         # 泰语翻译
│       └── id.json         # 印尼语翻译
├── functions/              # Cloudflare Pages Functions (API)
│   ├── api/
│   │   └── [[path]].js     # 主API路由(询盘+认证+管理)
│   └── _lib/
│       ├── auth.js         # 认证库(JWT+限流)
│       ├── http.js         # HTTP响应工具
│       ├── rates.js        # 汇率工具
│       └── calc-engine.js  # 计算引擎
├── articles/               # SEO文章页面
└── scripts/                # 脚本工具
    ├── fetch-trends.js     # 趋势数据抓取
    └── update-product-images.js
```

---

## 整体架构

### 架构设计图

```
┌─────────────────────────────────────────────────────────────┐
│                        用户界面层                            │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ index.html   │  │ admin.html   │  │ 产品详情页    │      │
│  │ (买家前端)   │  │ (后台管理)   │  │ (SEO页面)    │      │
│  └───────┬──────┘  └───────┬──────┘  └───────┬──────┘      │
└          │                  │                  │            │
└──────────┼──────────────────┼──────────────────┼────────────┘
           │                  │                  │
           ▼                  ▼                  ▼
┌─────────────────────────────────────────────────────────────┐
│                        业务逻辑层                            │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  API Gateway (functions/api/[[path]].js)            │   │
│  │  - 询盘处理 POST /api/inquiries                     │   │
│  │  - 认证登录 POST /api/admin/auth/login             │   │
│  │  - 询盘管理 GET /api/admin/inquiries               │   │
│  │  - 报价管理 POST /api/admin/inquiries/:id/quotes   │   │
│  │  - 系统设置 PATCH /api/admin/settings              │   │
│  └─────────────────────────────────────────────────────┘   │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                        数据持久层                            │
│  ┌──────────────┐          ┌──────────────┐               │
│  │ JSON Files   │ (本地)   │ D1 Database  │ (生产)        │
│  │ - users.json │          │ - users      │               │
│  │ - inquiries  │          │ - customers  │               │
│  │ - customers  │          │ - inquiries  │               │
│  │ - settings   │          │ - settings   │               │
│  │ - activity   │          │ - activity   │               │
│  └──────────────┘          └──────────────┘               │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                        支撑服务层                            │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ 认证服务     │  │ 邮件服务     │  │ 限流服务     │      │
│  │ (JWT Token) │  │ (Resend API) │  │ (KV Store)   │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
```

### 双环境架构

#### 本地开发环境
- **服务器**: Express.js (`server.js`)
- **数据库**: JSON文件 (`data/*.json`)
- **认证**: bcrypt密码哈希 + JWT
- **邮件**: SMTP (可选配置)

#### 生产环境(Cloudflare)
- **服务器**: Pages Functions (`functions/api/`)
- **数据库**: D1 (SQLite)
- **认证**: SHA-256密码哈希 + JWT (Web Crypto API)
- **邮件**: Resend API
- **限流**: KV Store (RATE_LIMIT绑定)

---

## 核心模块

### 1. 前端展示模块 (`src/scripts/main.js`)

#### 功能职责
- **国际化**: 多语言切换与自动检测
- **表单提交**: 询盘表单数据收集与提交
- **趋势数据**: Google Trends数据加载与展示
- **用户交互**: 导航、滚动、动画效果
- **事件追踪**: GA4事件上报

#### 关键代码结构

```javascript
// 国际化系统
async function loadDictionary(lang) {
  // 从 /src/i18n/${lang}.json 加载翻译
}

async function applyTranslations(lang) {
  // 应用翻译到DOM节点
  // 更新SEO meta标签
  // 更新FAQ结构化数据
}

// 地理语言检测
async function detectGeoLang() {
  // 调用 /api/geo 检测用户国家
  // 返回对应语言代码
}

// 询盘表单提交
contactForm.addEventListener('submit', async (e) => {
  // 数据收集
  // 产品多选验证
  // API提交
  // 成功/失败反馈
});
```

### 2. 后台管理模块 (`src/scripts/admin.js`)

#### 功能职责
- **登录认证**: JWT token获取与存储
- **询盘列表**: 分页、筛选、排序、导出CSV
- **询盘详情**: RFQ评分展示、优先级、SLA状态
- **状态管理**: 询盘状态流转(new→contacted→quoted→won/lost)
- **报价创建**: 报价记录生成与管理
- **数据看板**: KPI统计、趋势分析、高意向页面
- **系统设置**: 通知邮箱、默认负责人配置

#### 关键代码结构

```javascript
// 认证系统
async function apiFetch(url, options) {
  // 自动添加 Authorization: Bearer ${token}
  // 处理401/403响应
}

// RFQ完整度计算
function computeRfqCompleteness(item) {
  // 权重规则: name(8), email(8), country(8), company(10),
  //          phone(10), product(12), quantity(10), oem(6),
  //          port(5), deadline(5), message(18)
  // 计算百分比、等级(high/medium/low)、缺失字段列表
}

// SLA状态计算
function getInquirySla(item) {
  // 终态(won/lost): 不计算SLA
  // 开放态: 计算24小时阈值是否超时
}

// 提醒文案生成
function buildReminderMessage(item) {
  // 根据缺失字段生成买家提醒文案
}
```

### 3. API服务模块 (`functions/api/[[path]].js`)

#### 功能职责
- **路由分发**: RESTful API统一路由
- **询盘创建**: 客户去重、询盘入库、自动分配、邮件通知
- **认证授权**: JWT生成、角色权限验证
- **数据查询**: 询盘筛选、排序、分页
- **业务操作**: 状态更新、报价创建、备注添加
- **限流控制**: 登录限流(12次/15分钟)、询盘限流(40次/15分钟)

#### API路由表

| 路径 | 方法 | 权限 | 功能 |
|------|------|------|------|
| `/api/health` | GET | 公开 | 健康检查 |
| `/api/inquiries` | POST | 公开 | 创建询盘 |
| `/api/geo` | GET | 公开 | 地理检测 |
| `/api/admin/auth/login` | POST | 公开 | 用户登录 |
| `/api/admin/auth/me` | GET | 认证 | 获取当前用户 |
| `/api/admin/users` | GET | admin/sales | 用户列表 |
| `/api/admin/settings` | GET | admin | 获取系统设置 |
| `/api/admin/settings` | PATCH | admin | 更新系统设置 |
| `/api/admin/dashboard/summary` | GET | admin/sales | 看板摘要 |
| `/api/admin/inquiries` | GET | admin/sales | 询盘列表(筛选+分页) |
| `/api/admin/inquiries/export.csv` | GET | admin/sales | 导出CSV |
| `/api/admin/inquiries/:id` | GET | admin/sales | 询盘详情 |
| `/api/admin/inquiries/:id` | PATCH | admin/sales | 更新询盘状态/负责人/备注 |
| `/api/admin/inquiries/:id/quotes` | GET | admin/sales | 报价列表 |
| `/api/admin/inquiries/:id/quotes` | POST | admin/sales | 创建报价 |
| `/api/admin/mail/status` | GET | admin | 邮件配置状态 |
| `/api/admin/mail/test` | POST | admin | 发送测试邮件 |

### 4. 认证授权模块 (`functions/_lib/auth.js`)

#### JWT实现
- **算法**: HS256 (HMAC-SHA-256)
- **有效期**: 12小时
- **payload**: `{sub, role, email, name, exp}`
- **签名密钥**: `JWT_SECRET`环境变量

#### 密码哈希
- **本地环境**: bcrypt (Node.js)
- **生产环境**: SHA-256 (Web Crypto API)

#### 限流实现
- **存储**: Cloudflare KV Store
- **时间窗口**: 滑动窗口(按时间槽划分)
- **键格式**: `${bucket}:${ip}:${slot}`
- **过期时间**: windowSeconds + 60秒

```javascript
// JWT生成(生产环境)
async function createToken(payload, env) {
  const header = base64UrlEncodeText(JSON.stringify({alg:'HS256',typ:'JWT'}));
  const body = base64UrlEncodeText(JSON.stringify({...payload, exp:...}));
  const signature = await hmacSign(`${header}.${body}`, env.JWT_SECRET);
  return `${header}.${body}.${signature}`;
}

// 权限验证
async function requireAuth(request, env, roles) {
  const token = parseBearerToken(request);
  const auth = await verifyToken(token, env);
  if (roles.length && !roles.includes(auth.role)) {
    return {response: jsonForbidden()};
  }
  return {auth};
}
```

---

## 数据模型

### D1数据库Schema (`schema.sql`)

#### 核心表结构

#### 1. users (用户表)
```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,            -- user_xxxx
  email TEXT NOT NULL UNIQUE,     -- 登录邮箱
  name TEXT NOT NULL,             -- 用户姓名
  role TEXT NOT NULL DEFAULT 'sales', -- 角色(admin/sales)
  password_hash TEXT NOT NULL,    -- 密码哈希
  created_at TEXT NOT NULL,       -- 创建时间(ISO格式)
  updated_at TEXT NOT NULL        -- 更新时间
);
```

#### 2. customers (客户表)
```sql
CREATE TABLE customers (
  id TEXT PRIMARY KEY,            -- cust_xxxx
  email TEXT NOT NULL UNIQUE,     -- 客户邮箱(唯一标识)
  name TEXT NOT NULL,             -- 客户姓名
  phone TEXT,                     -- 电话
  company TEXT,                   -- 公司名称
  country TEXT,                   -- 国家
  source TEXT,                    -- 来源(website/referral)
  inquiry_count INTEGER DEFAULT 0, -- 询盘总数
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_inquiry_at TEXT            -- 最后询盘时间
);
```

#### 3. inquiries (询盘表)
```sql
CREATE TABLE inquiries (
  id TEXT PRIMARY KEY,            -- inq_xxxx
  customer_id TEXT,               -- 关联客户
  status TEXT NOT NULL DEFAULT 'new', -- 状态(new/contacted/quoted/won/lost)
  assignee_id TEXT,               -- 负责人ID
  lang TEXT,                      -- 语言(en/vi/th/id)
  source TEXT,                    -- 来源
  page_url TEXT,                  -- 提交页面URL
  product TEXT,                   -- 产品类型
  quantity TEXT,                  -- 数量
  oem TEXT,                       -- OEM需求
  port TEXT,                      -- 目的港
  deadline TEXT,                  -- 交付时间
  message TEXT NOT NULL,          -- 需求描述
  contact_json TEXT NOT NULL,     -- 联系信息JSON快照
  timeline_json TEXT DEFAULT '[]', -- 时间线JSON数组
  quotes_json TEXT DEFAULT '[]',   -- 报价记录JSON数组
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  FOREIGN KEY (assignee_id) REFERENCES users(id)
);
```

#### 4. settings (系统设置表)
```sql
CREATE TABLE settings (
  key TEXT PRIMARY KEY,           -- 配置键(notifyEmail/defaultAssigneeId)
  value TEXT,                     -- 配置值
  updated_at TEXT NOT NULL
);
```

#### 5. activity_logs (活动日志表)
```sql
CREATE TABLE activity_logs (
  id TEXT PRIMARY KEY,            -- log_xxxx
  type TEXT NOT NULL,             -- 类型(auth.login/inquiry.created/quote.created)
  actor_id TEXT,                  -- 操作人ID
  target_id TEXT,                 -- 目标对象ID
  payload_json TEXT DEFAULT '{}', -- 详细数据JSON
  created_at TEXT NOT NULL
);
```

#### 索引
```sql
CREATE INDEX idx_inquiries_created_at ON inquiries(created_at);
CREATE INDEX idx_inquiries_status ON inquiries(status);
CREATE INDEX idx_inquiries_product ON inquiries(product);
CREATE INDEX idx_inquiries_assignee_id ON inquiries(assignee_id);
CREATE INDEX idx_activity_logs_target_id ON activity_logs(target_id);
```

### JSON数据格式(本地环境)

#### inquiries.json
```json
[
  {
    "id": "inq_xxxx",
    "customerId": "cust_xxxx",
    "status": "new",
    "assigneeId": "user_xxxx",
    "lang": "en",
    "source": "website",
    "pageUrl": "https://novagardenhome.com/",
    "product": "self-watering",
    "quantity": "500 pcs",
    "oem": "Yes, OEM needed",
    "port": "Ho Chi Minh City",
    "deadline": "September 2026",
    "message": "Looking for self-watering planters...",
    "contact": {
      "name": "John Doe",
      "email": "john@company.com",
      "phone": "+84 12345678",
      "company": "ABC Trading",
      "country": "Vietnam"
    },
    "timeline": [
      {"at": "2026-07-06T10:00:00Z", "type": "created", "note": "..."},
      {"at": "2026-07-06T10:05:00Z", "type": "assigned", "note": "..."}
    ],
    "quotes": [],
    "createdAt": "2026-07-06T10:00:00Z",
    "updatedAt": "2026-07-06T10:00:00Z"
  }
]
```

#### users.json
```json
[
  {
    "id": "user_admin",
    "email": "admin@novagardenhome.com",
    "name": "Default Admin",
    "role": "admin",
    "passwordHash": "$2a$10$...", // bcrypt哈希(本地)
    "createdAt": "2026-01-01T00:00:00Z",
    "updatedAt": "2026-01-01T00:00:00Z"
  }
]
```

---

## 关键函数与算法

### 1. RFQ完整度评分算法

#### 算法目的
评估询盘信息完整性,辅助优先级判定和自动分配。

#### 权重规则表
| 字段 | 权重 | 条件 | 说明 |
|------|------|------|------|
| name | 8 | 非空 | 基础联系信息 |
| email | 8 | 非空 | 基础联系信息 |
| country | 8 | 非空 | 基础联系信息 |
| company | 10 | 非空 | 企业背景(权重更高) |
| phone | 10 | 非空 | 沟通渠道(权重更高) |
| product | 12 | 非空 | 核心需求(权重最高) |
| quantity | 10 | 非空 | 采购规模 |
| oem | 6 | 非空 | 定制需求 |
| port | 5 | 非空 | 物流信息 |
| deadline | 5 | 非空 | 时间约束 |
| message | 18 | ≥10字 | 详细描述(动态评分) |

#### 动态评分逻辑
- `message长度 ≥ 30字`: 获得18分(满分)
- `message长度 ≥ 10字`: 获得10分(部分分数)
- `message长度 < 10字`: 获得0分

#### 实现代码(server.js)
```javascript
function computeRfqCompleteness(inquiry) {
  const messageLength = String(inquiry?.message || '').trim().length;
  const rules = [
    {key: 'name', weight: 8, pass: hasText(inquiry?.contact?.name)},
    {key: 'email', weight: 8, pass: hasText(inquiry?.contact?.email)},
    // ... 其他规则
    {key: 'message', weight: 18, pass: messageLength >= 10}
  ];
  
  const maxScore = rules.reduce((sum, item) => sum + item.weight, 0);
  let score = 0;
  
  for (const item of rules) {
    if (item.key === 'message') {
      if (messageLength >= 30) score += item.weight;
      else if (messageLength >= 10) score += 10;
    } else if (item.pass) {
      score += item.weight;
    }
  }
  
  const percent = Math.round((score / maxScore) * 100);
  const level = percent >= 85 ? 'high' : percent >= 70 ? 'medium' : 'low';
  const missingFields = rules.filter(item => !item.pass).map(item => item.key);
  
  return {score, maxScore, percent, level, missingFields};
}
```

#### 业务应用
1. **自动分配**: high级别询盘自动分配给sales角色
2. **优先级标签**: 前端展示优先级徽章(high/medium/low)
3. **提醒生成**: 根据missingFields生成买家提醒文案

### 2. SLA状态监控算法

#### 算法目的
监控询盘响应时效,预警超时询盘。

#### 计算规则
- **阈值**: 24小时
- **基准时间**: updatedAt或createdAt
- **终态豁免**: won/lost状态不计算SLA
- **超时判定**: elapsedHours > 24

#### 实现代码
```javascript
function computeSlaState(inquiry, nowMs = Date.now()) {
  const terminal = new Set(['won', 'lost']);
  if (terminal.has(String(inquiry?.status || ''))) {
    return {breached: false, overdueHours: 0, thresholdHours: 24};
  }
  
  const parsedTs = new Date(inquiry?.updatedAt || inquiry?.createdAt).getTime();
  const anchorTs = Number.isFinite(parsedTs) ? parsedTs : nowMs;
  const elapsedHours = Math.max(0, (nowMs - anchorTs) / (1000 * 60 * 60));
  const overdueHours = Math.max(0, Math.floor(elapsedHours - 24));
  
  return {
    breached: elapsedHours > 24,
    overdueHours,
    thresholdHours: 24
  };
}
```

#### 业务应用
- 前端展示SLA超时徽章
- 看板统计slaBreachedOpen数量
- 筛选条件支持sla=breached查询

### 3. 询盘筛选与排序算法

#### 筛选支持字段
- `status`: 状态筛选(new/contacted/quoted/won/lost)
- `country`: 国家筛选(模糊匹配)
- `product`: 产品筛选(模糊匹配)
- `q`: 关键词搜索(全文检索)
- `rfqLevel`: RFQ等级筛选(high/medium/low)
- `priority`: 优先级筛选
- `sla`: SLA状态筛选(breached)
- `from/to`: 日期范围筛选

#### 排序支持字段
- `created_desc`: 创建时间倒序(默认)
- `created_asc`: 创建时间正序
- `rfq_desc`: RFQ完整度倒序
- `rfq_asc`: RFQ完整度正序
- `priority_desc`: 优先级倒序(high→medium→low)
- `sla_desc`: SLA超时优先

#### 实现代码(server.js)
```javascript
function applyInquiryFilters(inquiries, filters) {
  return inquiries.filter((item) => {
    if (statusFilter && item.status !== statusFilter) return false;
    if (countryFilter && !item.contact?.country?.toLowerCase().includes(countryFilter)) return false;
    // ... 其他筛选条件
    
    if (keywordFilter) {
      const targets = [
        item.id, item.contact?.name, item.contact?.email,
        item.product, item.message
      ].map(v => String(v || '').toLowerCase());
      return targets.some(entry => entry.includes(keywordFilter));
    }
    
    return true;
  });
}

function applyInquirySort(inquiries, sortBy) {
  const items = [...inquiries];
  
  if (sort === 'rfq_desc') {
    return items.sort((a, b) => {
      const diff = computeRfqCompleteness(b).percent - computeRfqCompleteness(a).percent;
      return diff !== 0 ? diff : new Date(b.createdAt) - new Date(a.createdAt);
    });
  }
  
  // ... 其他排序规则
  return items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}
```

### 4. 自动分配逻辑

#### 规则
1. **默认负责人**: 从settings.defaultAssigneeId读取
2. **高分自动分配**: RFQ等级为high且无默认负责人,自动分配给sales/admin角色
3. **时间线记录**: 分配事件写入timeline数组

#### 实现代码(server.js)
```javascript
let autoAssignedByPriority = false;
let autoAssignedAssigneeId = settings.defaultAssigneeId || null;

if (!autoAssignedAssigneeId && rfqPreview.level === 'high') {
  const candidate = users.find(user => user.role === 'sales') 
                    || users.find(user => user.role === 'admin');
  if (candidate) {
    autoAssignedAssigneeId = candidate.id;
    autoAssignedByPriority = true;
  }
}

// 时间线记录
if (inquiry.assigneeId) {
  inquiry.timeline.push({
    at: nowIso(),
    type: 'assigned',
    note: `Auto assigned to ${inquiry.assigneeId}.`
  });
}

if (rfqPreview.level === 'high') {
  inquiry.timeline.push({
    at: nowIso(),
    type: 'priority',
    note: autoAssignedByPriority 
      ? 'High-priority RFQ detected and auto-assigned by rule.'
      : 'High-priority RFQ detected.'
  });
}
```

---

## API接口文档

### 公开接口

#### POST /api/inquiries
创建询盘(无需认证)

**请求体**
```json
{
  "name": "John Doe",
  "email": "john@company.com",
  "phone": "+84 12345678",
  "company": "ABC Trading",
  "country": "Vietnam",
  "product": "self-watering,nursery-tray",
  "quantity": "500 pcs",
  "oem": "Yes, OEM needed",
  "port": "Ho Chi Minh City",
  "deadline": "September 2026",
  "message": "Looking for self-watering planters for our retail chain...",
  "lang": "en",
  "source": "website",
  "pageUrl": "https://novagardenhome.com/"
}
```

**响应体**
```json
{
  "ok": true,
  "inquiryId": "inq_xxxx",
  "status": "new",
  "message": "Inquiry received."
}
```

**限流**: 40次/15分钟

#### GET /api/geo
地理检测(返回用户国家代码)

**响应体**
```json
{
  "country": "VN"
}
```

### 认证接口

#### POST /api/admin/auth/login
用户登录

**请求体**
```json
{
  "email": "admin@novagardenhome.com",
  "password": "ChangeMe123!"
}
```

**响应体**
```json
{
  "ok": true,
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "user_admin",
    "email": "admin@novagardenhome.com",
    "role": "admin",
    "name": "Default Admin"
  }
}
```

**限流**: 12次/15分钟

### 管理接口(需要认证)

#### GET /api/admin/inquiries
询盘列表(支持筛选+分页+排序)

**查询参数**
- `page`: 页码(默认1)
- `pageSize`: 每页条数(默认20,最大100)
- `status`: 状态筛选
- `country`: 国家筛选
- `product`: 产品筛选
- `q`: 关键词搜索
- `rfqLevel`: RFQ等级筛选
- `priority`: 优先级筛选
- `sla`: SLA状态筛选
- `from/to`: 日期范围
- `sort`: 排序字段(created_desc/rfq_desc/priority_desc/sla_desc)

**响应体**
```json
{
  "ok": true,
  "items": [
    {
      "id": "inq_xxxx",
      "status": "new",
      "rfqCompleteness": {
        "score": 85,
        "maxScore": 100,
        "percent": 85,
        "level": "high",
        "missingFields": []
      },
      "priority": "high",
      "sla": {
        "breached": false,
        "overdueHours": 0,
        "thresholdHours": 24
      }
      // ... 其他字段
    }
  ],
  "page": 1,
  "pageSize": 20,
  "total": 150
}
```

#### PATCH /api/admin/inquiries/:id
更新询盘(状态/负责人/备注)

**请求体(状态更新)**
```json
{
  "status": "quoted"
}
```

**请求体(负责人更新)**
```json
{
  "assigneeId": "user_sales"
}
```

**请求体(备注添加)**
```json
{
  "note": "Follow-up call scheduled for next week."
}
```

**响应体**
```json
{
  "ok": true,
  "item": {
    "id": "inq_xxxx",
    "status": "quoted",
    "assigneeId": "user_sales",
    "timeline": [
      {"at": "2026-07-06T14:00:00Z", "type": "note", "actorId": "user_admin", "note": "..."}
    ],
    "updatedAt": "2026-07-06T14:00:00Z"
  }
}
```

#### POST /api/admin/inquiries/:id/quotes
创建报价

**请求体**
```json
{
  "unitPrice": 2.5,
  "currency": "USD",
  "moq": "500 pcs",
  "incoterm": "FOB",
  "validityDays": 30,
  "note": "Price valid for 30 days, FOB Shenzhen."
}
```

**响应体**
```json
{
  "ok": true,
  "item": {
    "id": "quote_xxxx",
    "quoteNo": "Q-20260706-1234",
    "currency": "USD",
    "unitPrice": 2.5,
    "moq": "500 pcs",
    "incoterm": "FOB",
    "validityDays": 30,
    "note": "...",
    "createdBy": "user_admin",
    "createdAt": "2026-07-06T14:00:00Z"
  }
}
```

#### GET /api/admin/dashboard/summary
看板摘要数据

**响应体**
```json
{
  "ok": true,
  "item": {
    "total": 150,
    "recent7d": 25,
    "recent30d": 80,
    "byStatus": {
      "new": 30,
      "contacted": 40,
      "quoted": 50,
      "won": 15,
      "lost": 15
    },
    "byPriority": {
      "high": 40,
      "medium": 60,
      "low": 50
    },
    "slaBreachedOpen": 12,
    "topCountries": [
      {"country": "Vietnam", "count": 50},
      {"country": "Thailand", "count": 30}
    ],
    "topProducts": [
      {"product": "self-watering", "count": 60}
    ],
    "highIntentPages": [
      {"page": "/self-watering-double-layer.html", "total": 30, "quoted": 15, "won": 5}
    ]
  }
}
```

---

## 依赖关系

### 生产依赖
```json
{
  "bcryptjs": "^2.4.3",         // 密码哈希(本地环境)
  "dotenv": "^16.6.1",          // 环境变量加载
  "express": "^4.21.2",         // Web服务器(本地环境)
  "google-trends-api": "^4.9.2", // 趋势数据抓取
  "jsonwebtoken": "^9.0.2",     // JWT生成(本地环境)
  "nodemailer": "^6.10.1"       // 邮件发送(本地SMTP)
}
```

### 开发依赖
```json
{
  "esbuild": "^0.28.1",         // JS/CSS压缩打包
  "http-server": "^14.1.1",     // 静态文件服务器
  "sharp": "^0.34.5"            // 图片处理(可选)
}
```

### 外部服务依赖
- **Cloudflare D1**: SQLite数据库服务
- **Cloudflare KV**: 限流状态存储
- **Resend API**: 生产环境邮件服务
- **Google Trends API**: 趋势数据抓取
- **Google Fonts**: Inter字体加载
- **Font Awesome**: 图标库
- **GA4**: Google Analytics 4事件追踪

---

## 运行与部署

### 本地开发

#### 1. 安装依赖
```bash
npm install
```

#### 2. 配置环境变量
```bash
cp .env.example .env
```

编辑`.env`文件:
```env
PORT=8000
HOST=0.0.0.0
STATIC_DIR=dist
DATA_DIR=data
JWT_SECRET=change-this-secret-before-production

ADMIN_EMAIL=admin@novagardenhome.com
ADMIN_PASSWORD=ChangeMe123!
ADMIN_NAME=Default Admin

# SMTP配置(可选)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-password
SMTP_FROM=GreenSmart <noreply@novagardenhome.com>
```

#### 3. 启动开发服务器
```bash
npm run dev
```

访问:
- 主页: http://localhost:8000
- 后台: http://localhost:8000/admin.html
- 健康检查: http://localhost:8000/api/health

#### 4. 构建生产版本
```bash
npm run build
```

构建产物生成在`dist/`目录:
- 压缩JS/CSS文件
- 复制静态资源
- 更新sitemap.xml lastmod日期

#### 5. QA检查
```bash
npm run qa:check
```

运行`qa-check.js`验证构建产物。

### 生产部署(Cloudflare)

#### 1. D1数据库配置
创建D1数据库:
```bash
wrangler d1 create greensmart-db
```

配置绑定(wrangler.toml):
```toml
[[d1_databases]]
binding = "DB"
database_name = "greensmart-db"
database_id = "xxxx-xxxx-xxxx"
```

执行schema:
```bash
wrangler d1 execute greensmart-db --file=./schema.sql
```

#### 2. KV存储配置(限流)
创建KV namespace:
```bash
wrangler kv:namespace create RATE_LIMIT
```

配置绑定:
```toml
[[kv_namespaces]]
binding = "RATE_LIMIT"
id = "xxxx"
```

#### 3. 环境变量配置
在Cloudflare Dashboard设置:
- `JWT_SECRET`: 生产密钥
- `ADMIN_EMAIL`: 管理员邮箱
- `ADMIN_PASSWORD`: 管理员密码
- `ADMIN_NAME`: 管理员姓名
- `RESEND_API_KEY`: Resend API密钥
- `MAIL_FROM`: 发件地址
- `NOTIFY_EMAIL`: 通知邮箱

#### 4. 部署Pages项目
```bash
wrangler pages project create greensmart
wrangler pages deploy dist
```

#### 5. 域名配置
绑定自定义域名:
```bash
wrangler pages deployment create greensmart --branch=main
```

在DNS设置添加CNAME记录指向Pages域名。

### Docker部署(可选)

#### Dockerfile
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm run build
EXPOSE 8000
CMD ["npm", "start"]
```

#### 构建与运行
```bash
docker build -t greensmart .
docker run -p 8000:8000 greensmart
```

---

## 开发规范

### 代码风格
- **JavaScript**: ES6+语法,async/await异步处理
- **命名**: 
  - 函数/变量: camelCase (`computeRfqCompleteness`)
  - 常量: UPPER_CASE (`TOKEN_EXPIRES_SECONDS`)
  - 文件: kebab-case (`auth.js`)
- **注释**: 关键算法添加注释说明

### 数据约定
- **ID格式**: `${prefix}_${uuid}` (如`inq_xxxx`)
- **时间格式**: ISO 8601 (`2026-07-06T10:00:00Z`)
- **JSON字段**: 后缀`_json` (如`contact_json`)
- **货币**: 3字母代码(USD/CNY)

### API规范
- **响应格式**: `{ok: boolean, ...data}`
- **错误格式**: `{ok: false, error: "message"}`
- **状态码**: 
  - 200: 成功
  - 201: 创建成功
  - 400: 参数错误
  - 401: 未认证
  - 403: 权限不足
  - 404: 未找到
  - 429: 限流
  - 500: 服务器错误

### 前端规范
- **SEO**: 每个页面包含完整meta标签
- **国际化**: 使用`data-i18n`属性标记翻译节点
- **表单验证**: 前端基础验证+后端业务验证
- **事件追踪**: GA4事件上报关键交互

---

## 扩展计划

### ERP扩展(Phase 1-2)

#### Phase 1: 主数据管理
**新增表**(已实现):
- `suppliers`: 供应商管理
- `products`: 产品SKU管理
- `supplier_price_tiers`: 供应商价格梯度
- `exchange_rates`: 汇率管理
- `freight_rates`: 运费卡管理

**新增API**:
- `/api/admin/suppliers`: 供应商CRUD
- `/api/admin/products`: 产品CRUD
- `/api/admin/exchange-rates`: 汇率管理
- `/api/admin/freight-rates`: 运费管理

#### Phase 2: 订单聚合
**新增表**:
- `sales_orders`: 订单聚合表
- `documents`: 单据快照表(quote/pi/packing_list/invoice)

**新增API**:
- `/api/admin/orders`: 订单管理
- `/api/admin/orders/:id/documents`: 单据生成

### 功能扩展路线图

#### 近期计划
- **报价模板**: 预设报价模板提高效率
- **批量操作**: 批量更新状态/负责人
- **邮件模板**: 自定义通知邮件模板
- **移动端适配**: 后台移动端优化

#### 中期计划
- **客户画像**: 客户购买历史分析
- **智能推荐**: 基于历史数据推荐产品
- **库存对接**: 实时库存查询
- **多语言管理后台**: 后台界面国际化

#### 远期计划
- **财务集成**: 与财务系统对接
- **CRM集成**: 与专业CRM系统对接
- **BI报表**: 商业智能分析报表
- **API开放**: 第三方系统集成API

---

## 附录

### 关键文件路径索引

| 文件 | 路径 | 说明 |
|------|------|------|
| 主页 | [index.html](file:///d:/trae/index.html) | 产品展示+询盘表单 |
| 后台 | [admin.html](file:///d:/trae/admin.html) | 管理界面 |
| 主API | [functions/api/[[path]].js](file:///d:/trae/functions/api/[[path]].js) | API路由 |
| 认证库 | [functions/_lib/auth.js](file:///d:/trae/functions/_lib/auth.js) | JWT+限流 |
| 前端脚本 | [src/scripts/main.js](file:///d:/trae/src/scripts/main.js) | 前端逻辑 |
| 后台脚本 | [src/scripts/admin.js](file:///d:/trae/src/scripts/admin.js) | 后台逻辑 |
| Schema | [schema.sql](file:///d:/trae/schema.sql) | D1数据库定义 |
| 构建脚本 | [build.js](file:///d:/trae/build.js) | 生产构建 |
| 本地服务器 | [server.js](file:///d:/trae/server.js) | Express开发服务器 |

### 常见问题排查

#### 1. 登录失败
- 检查`JWT_SECRET`是否配置
- 检查用户表是否存在默认admin用户
- 检查密码哈希方式(本地bcrypt vs 生产SHA-256)

#### 2. 邮件发送失败
- 检查SMTP配置或RESEND_API_KEY
- 检查MAIL_FROM和NOTIFY_EMAIL是否设置
- 查看activity_logs表中的邮件错误日志

#### 3. D1数据库错误
- 检查schema.sql是否执行
- 检查wrangler.toml中DB绑定
- 检查环境变量中数据库ID

#### 4. 限流误触发
- 检查KV namespace绑定
- 调整限流阈值(函数参数)
- 清理KV过期键

#### 5. 国际化不生效
- 检查`/src/i18n/${lang}.json`文件是否存在
- 检查`data-i18n`属性是否正确设置
- 检查浏览器localStorage中的语言设置

---

**文档维护**: 本文档应随项目迭代持续更新,建议在重大功能变更后同步更新Code Wiki。  
**反馈渠道**: 如发现文档与实际代码不符,请及时提issue或PR修正。