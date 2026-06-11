# GreenSmart 全 Cloudflare 部署说明

## Pages 项目设置

- 架构预设：无
- 构建命令：`npm run build`
- 构建输出目录：`dist`
- 生产分支：`main`

## Pages Functions 绑定

在 Pages 项目 `设置 -> 绑定` 中确认：

| 类型 | 变量名称 | 资源 |
| --- | --- | --- |
| D1 数据库 | `DB` | `greensmart-prod` |
| KV 命名空间 | `RATE_LIMIT` | `greensmart-rate-limit` |

## 变量和密钥

在 Pages 项目 `设置 -> 变量和密钥` 中确认：

| 名称 | 类型 | 说明 |
| --- | --- | --- |
| `JWT_SECRET` | 密钥 | 后台登录 token 签名密钥 |
| `ADMIN_EMAIL` | 文本 | 默认后台管理员邮箱 |
| `ADMIN_PASSWORD` | 密钥 | 默认后台管理员密码 |
| `ADMIN_NAME` | 文本 | 默认后台管理员名称 |
| `NOTIFY_EMAIL` | 文本 | 接收询盘通知的邮箱 |
| `RESEND_API_KEY` | 密钥 | Resend API 密钥 |
| `MAIL_FROM` | 文本 | 发件地址，如 `GreenSmart <noreply@novagardenhome.com>` |

## 初始化 D1 数据库

首次部署前，需要在 Cloudflare D1 数据库 `greensmart-prod` 中执行 `schema.sql`。

方式一：Cloudflare 控制台

1. 进入 `Workers & Pages -> D1 -> greensmart-prod`
2. 打开 `Console / Query`
3. 复制 `schema.sql` 全部内容并执行

方式二：Wrangler

```bash
npx wrangler d1 execute greensmart-prod --file=./schema.sql
```

## 上线验证

部署完成后按顺序访问：

```text
https://novagardenhome.com/api/health
https://novagardenhome.com/admin.html
```

预期：

- `/api/health` 返回 `ok: true`
- 前台表单提交成功
- 后台使用 `ADMIN_EMAIL` / `ADMIN_PASSWORD` 登录成功
- D1 的 `inquiries` 表能看到新询盘
- `NOTIFY_EMAIL` 收到新询盘邮件通知

## 邮件通知

生产环境通过 [Resend](https://resend.com) HTTP API 发信，需配置：

- `RESEND_API_KEY`：Resend 控制台中的 API Key
- `MAIL_FROM`：已在 Resend 验证过的发件地址（格式：`名称 <email@domain.com>`）

触发场景：

- 前台提交新询盘 → 发送到 `NOTIFY_EMAIL`（或后台设置的通知邮箱）
- 询盘自动/手动分配负责人 → 同时通知负责人邮箱

若未配置 Resend 变量，询盘仍会正常入库，只是跳过邮件发送。

### Resend 常见失败原因

1. **域名未验证**：`MAIL_FROM` 使用 `@novagardenhome.com` 前，必须先在 Resend 添加并验证该域名（在 Cloudflare DNS 添加 Resend 提供的 SPF/DKIM 记录）。
2. **未验证域名时的限制**：只能使用 `onboarding@resend.dev` 发件，且收件人只能是 Resend 注册邮箱。
3. **变量环境不对**：`RESEND_API_KEY`、`MAIL_FROM` 必须配置在 **Production**，不是 Preview。
4. **通知邮箱未设置**：需配置 `NOTIFY_EMAIL`，或在后台设置里填写通知邮箱。

### 邮件测试接口（部署后）

后台管理员登录后，可在浏览器控制台执行：

```javascript
fetch('/api/admin/mail/status', { headers: { Authorization: 'Bearer ' + localStorage.getItem('adminToken') } }).then(r => r.json()).then(console.log)
fetch('/api/admin/mail/test', { method: 'POST', headers: { Authorization: 'Bearer ' + localStorage.getItem('adminToken') } }).then(r => r.json()).then(console.log)
```

若测试失败，返回的 `error` 字段会包含 Resend 的具体报错（如域名未验证）。
