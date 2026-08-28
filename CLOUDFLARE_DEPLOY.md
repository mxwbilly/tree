# GreenSmart 全 Cloudflare 部署说明

## Pages 项目设置

- 架构预设：无
- 构建命令：`npm run build`
- 构建输出目录：`dist`
- 生产分支：`main`

仓库中的 `wrangler.example.jsonc` 仅用于本地模拟。实际本地文件 `wrangler.jsonc` 已被 Git 忽略，不会覆盖本页面中的生产变量和绑定；生产环境仍以 Cloudflare 控制台配置为准。

本地变量使用 `.dev.vars`：从 `.dev.vars.example` 复制后填写，文件已被 Git 忽略。不要把生产密钥写入仓库或提交到 Git。

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
| `JWT_SECRET` | 密钥（必填） | 至少 32 位的后台登录 token 签名密钥，不得使用示例值 |
| `ADMIN_EMAIL` | 文本（必填） | 实际后台管理员邮箱，不得使用示例默认邮箱 |
| `ADMIN_PASSWORD` | 密钥（必填） | 至少 12 位的强密码，不得使用示例默认密码 |
| `ADMIN_NAME` | 文本 | 默认后台管理员名称 |
| `TURNSTILE_SITE_KEY` | 文本（必填） | Cloudflare Turnstile 小组件的 Site Key，可公开给浏览器 |
| `TURNSTILE_SECRET_KEY` | 密钥（必填） | Cloudflare Turnstile 的 Secret Key，仅供 Pages Function 校验 |
| `NOTIFY_EMAIL` | 文本 | 接收询盘通知的邮箱 |
| `RESEND_API_KEY` | 密钥 | Resend API 密钥 |
| `MAIL_FROM` | 文本 | 发件地址，如 `GreenSmart <noreply@novagardenhome.com>` |

可在本地生成随机 `JWT_SECRET`：

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

代码不会为以上三项提供默认值。缺失、长度不足或仍使用旧示例值时，API 会返回配置错误，避免后台以弱凭据运行。

### 管理员凭据更新顺序

1. 先在 Cloudflare Pages 的生产环境中设置新的 `JWT_SECRET`、`ADMIN_EMAIL` 和 `ADMIN_PASSWORD`。
2. 再部署本次代码。
3. 使用新邮箱和新密码登录后台；登录前系统会将这组管理员凭据同步到 D1 的 `user_admin` 记录。
4. 更换 `JWT_SECRET` 后，原有后台登录 token 会全部失效，需要重新登录。

### 询盘防刷配置

1. 在 Cloudflare `Turnstile -> Add widget` 创建受管控小组件，添加 `novagardenhome.com` 和 `www.novagardenhome.com` 作为允许主机名。
2. 将 Site Key 填入 Pages 的生产环境文本变量 `TURNSTILE_SITE_KEY`，将 Secret Key 填入生产环境密钥 `TURNSTILE_SECRET_KEY`。
3. 在 `Pages 项目 -> 设置 -> 绑定` 中创建或绑定 KV 命名空间 `greensmart-rate-limit`，变量名必须为 `RATE_LIMIT`。
4. 部署后提交一条真实测试询盘；确认表单出现验证组件、询盘写入 D1，并在 Turnstile Analytics 中看到请求。

若 `RATE_LIMIT`、Turnstile Site Key 或 Secret Key 缺失，表单提交会明确失败，不会以未受保护状态继续接收询盘。

## 初始化 D1 数据库

首次部署前，需要在 Cloudflare D1 数据库 `greensmart-prod` 中执行 `schema.sql`。

方式一：Cloudflare 控制台

1. 进入 `Workers & Pages -> D1 -> greensmart-prod`
2. 打开 `Console / Query`
3. 复制 `schema.sql` 全部内容并执行

方式二：Wrangler

```bash
npx wrangler d1 execute greensmart-prod --remote --file=./schema.sql
```

必须在项目根目录执行以上命令；`--remote` 明确表示操作 Cloudflare 的生产 D1。省略 `--remote` 只会操作本地模拟数据库。`schema.sql` 使用 `CREATE ... IF NOT EXISTS`，可用于补齐既有表和索引；每次数据库结构改动仍应先在本地执行 `npm run verify`。

## 每次发布流程

1. 本地执行 `npm run verify`，确认构建、页面检查和隔离 D1 测试全部通过。
2. 仅当 `schema.sql` 有变化时，确认目标数据库为 `greensmart-prod` 后执行上述带 `--remote` 的 D1 命令。
3. 在 Cloudflare Pages 确认生产变量与 `DB`、`RATE_LIMIT` 绑定完整。
4. 获得业务确认后，才推送 `main` 分支；Cloudflare Pages 会执行 `npm run build` 并发布 `dist/`。
5. 完成下方“上线验证”。如出现问题，在 Pages 的“部署”页面选择上一个成功部署并执行回滚；数据库数据不会随 Pages 回滚而自动恢复。

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

同时在浏览器 Network 中确认前台询盘接口返回成功，后台列表能读取新询盘。上线后至少保留一次真实询盘或后台记录作为 D1 连通性证据。

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
const token = localStorage.getItem('greensmart-admin-token');
fetch('/api/admin/mail/status', { headers: { Authorization: 'Bearer ' + token } }).then(r => r.json()).then(console.log);
fetch('/api/admin/mail/test', { method: 'POST', headers: { Authorization: 'Bearer ' + token } }).then(r => r.json()).then(console.log);
```

若测试失败，返回的 `error` 字段会包含 Resend 的具体报错（如域名未验证）。
