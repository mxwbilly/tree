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

## 当前限制

Cloudflare Workers / Pages Functions 不支持传统 `nodemailer + SMTP` 直连发信。
当前版本先完成询盘入库和后台管理，邮件通知后续建议接入 Resend / SendGrid / Postmark API。
