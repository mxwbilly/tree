# GreenSmart 花盆外贸独立站

GreenSmart 是面向东南亚进口商、经销商和零售买家的询盘型独立站。生产环境统一运行在 Cloudflare Pages，后端使用 Pages Functions，数据存储使用 D1，接口限流使用 KV。

## 架构

- HTML、CSS、JavaScript：前台静态页面与多语言交互
- Cloudflare Pages Functions：询盘、后台和业务 API
- Cloudflare D1：询盘、客户、产品、供应商和订单数据
- Cloudflare KV：登录与询盘接口限流
- Wrangler：本地模拟 Pages、D1 和 KV

`server.js`、Express 和 JSON Data Store 已不再使用。本地与线上执行同一套 Functions 代码，避免两套接口行为不一致。

## 目录结构

```text
├── index.html                 # 首页
├── admin.html                 # 询盘与业务后台
├── functions/                 # Cloudflare Pages Functions
│   ├── _lib/                  # 认证、计算和文档共享逻辑
│   └── api/                   # API 路由
├── src/                       # 前端脚本、样式和多语言资源
├── articles/                  # SEO 文章
├── schema.sql                 # D1 数据库结构
├── build.js                   # 生产构建
├── qa-check.js                # 页面与资源检查
├── wrangler.example.jsonc     # 本地 Cloudflare 配置模板
└── CLOUDFLARE_DEPLOY.md       # 线上部署说明
```

## 本地运行

安装依赖：

```powershell
npm ci
```

首次运行时创建本地变量和 Wrangler 配置：

```powershell
Copy-Item .dev.vars.example .dev.vars
Copy-Item wrangler.example.jsonc wrangler.jsonc
```

在 `.dev.vars` 中填写以下必填项：

```text
JWT_SECRET=至少32位随机字符串
ADMIN_EMAIL=实际管理员邮箱
ADMIN_PASSWORD=至少12位强密码
```

初始化本地 D1，然后启动完整网站：

```powershell
npm run dev:init
npm run dev
```

默认地址：

- 网站：http://localhost:8788/
- 后台：http://localhost:8788/admin.html
- 健康检查：http://localhost:8788/api/health

Wrangler 默认使用 `.wrangler/` 中的本地 D1 和 KV 数据，不会连接生产数据库。`.dev.vars` 与 `wrangler.jsonc` 都只用于本地且不会提交，Cloudflare 生产环境继续使用控制台中的变量和绑定。

## 构建与检查

```powershell
npm run verify
```

该命令依次检查全部正式源码页面、生成 `dist/`、检查实际发布页面，再用隔离的本地 D1 数据库执行 `schema.sql` 并写入一条测试询盘。候选页面不会参与检查，D1 测试库会在检查结束后自动清理。构建器会自动发现根目录中的正式 HTML 页面，并递归复制页面、样式和站点清单实际引用的本地资源；`candidate-preview.html` 等候选内容不会进入发布目录。每次构建还会生成 `dist/build-manifest.json`，用于核对最终输出文件。

`sitemap.xml` 的 `lastmod` 在构建时按对应页面的实际 Git 变更日期生成。未修改的页面会保留自己的历史日期，不会因为重新构建而全部变成当天。Cloudflare Pages 的构建命令仍为 `npm run build`，输出目录仍为 `dist`。

## 生产部署

生产环境通过 Git 仓库连接 Cloudflare Pages。推送生产分支后由 Cloudflare 自动构建和部署，不再使用 rsync、Nginx、Docker 或本地 Node.js 服务器。数据库结构发生变化时，先按部署文档单独执行 D1 更新；网站代码须经确认后才推送生产分支。

生产变量、D1/KV 绑定、管理员凭据更新顺序和上线检查见 `CLOUDFLARE_DEPLOY.md`。
