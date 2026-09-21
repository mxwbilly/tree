# GreenSmart / NovaGardenHome 独立站优化审计

审计日期：2026-09-20
审计范围：`D:\trae`（Cloudflare Pages + Pages Functions + D1）
站点定位：面向东南亚（VN / TH / ID / MY / SG）的批发花盆与自动浇水花盆出口站，B2B 询盘导向

---

## 一、环境状态：健康

| 项目 | 状态 |
| --- | --- |
| Node / npm | v22.22.2 / 10.9.7 |
| 依赖 | esbuild 0.28.1、sharp 0.35.4、wrangler 4.126.0、google-trends-api 4.9.2 — 均已安装 |
| 源码校验 | PASS，28 个 HTML |
| 构建 | 成功，dist 输出 83 个文件 |
| 产物校验 | PASS，31 个 HTML |
| D1 Schema | PASS，14 张核心表 + 写入校验 |
| 压缩收益 | main.js -42%、erp-admin.js -19%、detail-page.js -25%、main.css -30% |

**已确认做得很好的部分**（不必再动）：

- **多语言词条对齐完美**：en / vi / th / id 各 280 条，0 缺失、0 多余，顶层字段齐平。这种整齐度在手工维护的项目里很少见。
- **每页恰好 1 个 `<h1>`**，canonical 全站齐备且指向正确。
- **安全响应头齐全**：HSTS、CSP（含 nonce 哈希白名单）、`X-Frame-Options: DENY`、Referrer-Policy、Permissions-Policy。
- **API 已鉴权**：`functions/api/**` 7 个子路由全部经 `requireAuth(request, env, ['admin','sales'])`，另有 webhook 签名校验。
- **图片标签规范**：width/height/loading/decoding/fetchpriority 都写了，CLS 基础扎实。
- **敏感文件未入库**：`.env`、`data/*.json`、`dist/`、`wrangler.jsonc` 均在 `.gitignore` 内。
- **404 / admin 均已 `noindex,nofollow`**，admin 未进 sitemap。

---

## 二、P0：直接影响收录与首屏性能

### P0-1　响应式图片缺失，全部 AVIF / WebP 素材闲置

**证据**

- 首页 9 张主图只用 `<img src="xxx.jpg">`，无 `<picture>`、无 `srcset`／`sizes`。
- 全站检索 `src/styles/main.css` 与 `src/scripts/*.js`：**0 处**引用 `.avif` / `.webp` / `image-set` / `srcset`。
- 仓库里 AVIF 和 WebP 版本一应俱全，但没有任何代码使用它们。

**代价**

| 资源 | 当前（JPG） | 已有 AVIF | 可省 |
| --- | --- | --- | --- |
| 首页 9 张主图合计 | ≈ 986 KB | ≈ 487 KB | **≈ 499 KB（-51%）** |
| hero 单图 | 144 KB | 45 KB | -99 KB |

**同时还有一处反效果**：`index.html:33-34` 预加载了 AVIF 和 WebP

```html
<link rel="preload" as="image" href="hero-southeast-asia-planters.avif" type="image/avif">
<link rel="preload" as="image" href="hero-southeast-asia-planters.webp" type="image/webp" media="not all and (min-resolution: 0.001dpcm)">
```

浏览器会真的下载 AVIF（45KB）和 WebP（83KB），但页面上没有任何地方消费它们；紧接着 `<img src="...jpg">` 又下载 144KB。**首屏在英雄图上白跑约 128KB**，还占用了 preload 的优先级带宽。

**修复**

1. 改用 `<picture>`，按 AVIF → WebP → JPG 顺序给源，并配 `srcset`／`sizes` 按视口出图。
2. 预加载只保留真正会被用到的那一个格式（或干脆去掉，交给 `<picture>`）。
3. 顺带为移动端出更小尺寸（当前产品图统一 960×720，移动端实际显示宽度远小于此）。

---

### P0-2　产品详情页的多语言靠 JS 运行时注入，vi / th / id 没有任何可收录 URL

**证据**

- `src/scripts/detail-page.js:95`
  ```js
  const res = await fetch(`/src/i18n/detail-${langKey}.json`);
  ```
  取回词典后在浏览器里重写 DOM。
- 产品页 HTML 本身**只有英文**；`detail-vi.json`（16.7KB）、`detail-th.json`（31.5KB）、`detail-id.json`（17.7KB）**不对应任何 URL**。
- 对比：首页已经由 `build.js` 在构建期预渲染出 `/vi/`、`/th/`、`/id/` 三个真实页面（`buildLocalizedHomepages()`）。**同一个问题，首页解决了，产品页没解决。**

**代价（这是全站最大的 SEO 缺口）**

- 越南、泰国、印尼买家搜母语产品词（如 `chậu hoa sỉ`、`กระถางต้นไม้ราคาส่ง`、`pot bunga grosir`）时，没有任何母语落地页可被索引。
- 首页有 `/vi/` 等 URL，产品页没有，所以 `hreflang` 在详情页无处可指——多语言信号是断的。
- 语言切换只存 localStorage、不改 URL，用户无法分享"越南语版本的产品页"。

**修复**：把 `detail-*.json` 也纳入 `build.js` 的构建期预渲染，产出 `/vi/transparent-orchid-pot` 这类真实路径，并补齐这三个页面组之间的 `hreflang` 互指。可以复用 `buildLocalizedHomepages()` 的同一套写法。

---

### P0-3　每次访问都重复拉取 i18n 词典

**证据**

- `src/scripts/main.js:302-307`
  ```js
  const [bundle, fallback] = await Promise.all([
      loadDictionary(lang),
      loadDictionary('en')
  ]);
  ```
- 泰语首页的内容**已经由构建期预渲染成泰文 HTML**，但页面加载后仍会额外请求 `th.json`（36.9KB）+ `en.json`（19.7KB）≈ **56.6KB 未压缩**，然后全量重写一遍 DOM。

**代价**：在越南/泰国/印尼的移动网络下，这 57KB 约等于整个图片预算，且引入一次额外的关键路径往返与内容重绘。

**修复**：预渲染页面直接跳过 `applyTranslations`（用 `data-site-language` 作为"已翻译"标记），仅用户手动切换语言时才按需加载对应词典。

---

## 三、P1：影响转化与长期维护

### P1-1　全站零统计、零转化追踪

- 检索 `googletagmanager` / `gtag(` / `clarity` / `facebook.net` / `hotjar`：**首页与所有页面 0 处命中**。
- 但 `privacy-policy.html:68` 写明："We may use analytics tools (such as GA4) to measure interactions like product-detail clicks, inquiry submissions, and contact-button clicks."
- `_headers:8` 的 CSP 也已放行 `https://www.googletagmanager.com`、`https://www.google-analytics.com`。

**结论**：位置留好了、隐私政策写好了、代码没装。当前无法回答"哪个国家带来的询盘最多""产品详情页点击率如何""WhatsApp 与表单哪个转化高"。

**修复**：优先装 GA4（或 Cloudflare Web Analytics，隐私友好且无需 Cookie 同意弹窗），并把询盘提交、WhatsApp 点击、详情页 CTA 打上转化事件。CSP 已就绪，无需改动。

---

### P1-2　内链 URL 形态与 canonical 不一致（全站约 60+ 处）

- canonical 与 sitemap 统一使用**无扩展名**：`https://novagardenhome.com/transparent-orchid-pot`
- 但站内链接大量写成 `.html`：

| 文件 | `.html` 内链数 |
| --- | --- |
| index.html | 14 |
| articles/thailand-wholesale-flower-pots-guide.html | 9 |
| articles/trending-planters-southeast-asia-2026.html | 8 |
| articles/planter-retail-display-guide.html | 6 |
| wholesale-planters-singapore.html | 6 |
| wholesale-planters-malaysia.html | 6 |

**代价**：爬虫从 `.html` 变体进入，再被 canonical 归并到无扩展名版本 —— 白走一跳，权重传递被稀释，且两套 URL 长期并存。

**修复**：内链统一改成无扩展名形式；如担心外部已收录 `.html`，在 `_redirects` 里对现有页面的 `.html` 版本补 301。

---

### P1-3　国家落地页偏薄、内链不均衡

| 页面 | 词数 | 站内 `.html` 内链 |
| --- | --- | --- |
| wholesale-planters-thailand | **299** | **1** |
| wholesale-planters-indonesia | 546 | **1** |
| wholesale-planters-singapore | 624 | 9 |
| wholesale-planters-malaysia | 651 | 9 |
| wholesale-planters-vietnam | 764 | **1** |

- 泰国页只有 299 词，是四个目标市场里最薄的。
- 泰 / 越 / 印尼三个页面各自只有 **1 条**内链，而马来西亚 / 新加坡有 9 条 —— 你最想主攻的三个市场，恰恰拿不到站内权重。
- Malaysia 与 Singapore 页 5-gram 文本重合度 **30.1%**，有同质化倾向。

**建议**：每页补上本地化采购信息（当地认证要求、主要进口港、关税与清关要点、旺季节奏、本地产品种类偏好），并把 `wholesale-planters-*` 五页与对应语种首页、相关产品页、相关文章互链起来。

---

### P1-4　部分 title / description 超长会被截断

**title > 60 字符**（SERP 会截断）

- transparent-orchid-pot-wholesale-guide：88
- creative-shaped-planter：81
- wholesale-planters-singapore：78
- wholesale-planters-malaysia：77
- planter-retail-display-guide：76
- vietnam-wholesale-nursery-trays-guide：75
- trending-planters-southeast-asia-2026：74
- index：72

**description > 160 字符**

- wholesale-planters-malaysia：289
- wholesale-planters-singapore：251
- wholesale-planters-vietnam：225
- index：215
- wholesale-planters-indonesia：212

---

### P1-5　Font Awesome 全量引入

- `index.html:124` 引入 cdnjs 的完整 `all.min.css`，会连带拉取 `fa-solid` 字体（约 150KB，含数千字形）。
- 首页实际只用到 **36 个不同图标**（已去重统计）。

**修复**：改用 SVG sprite 或按需子集化自托管，可省下绝大部分字体体积。

---

## 四、P2：加固与整洁

### P2-1　`/admin` 与 10 个临时后台页暴露在公网

- `admin.html` 会被打入 `dist/`，可在 `https://novagardenhome.com/admin` 直接打开（有 `noindex`，但那不阻止访问）。
- 数据安全靠 API 层 `requireAuth` 兜住（已验证有效），但后台入口本身建议挂 **Cloudflare Access**，从网络层挡掉。
- 同类问题：10 个 `.temp-*-admin.html` 也在 `dist/` 里（上次已报，根因是 `build.js` 扫描根目录全部 HTML）。

### P2-2　静态资源无指纹，缓存策略难以生效

- `main.css`、`main.js` 文件名固定不哈希，`_headers` 只给 `admin.js` / `erp-admin.js` 设了 `no-store`。
- 图片也没有 `Cache-Control`。
- **修复**：给 CSS/JS 加内容哈希，并设 `Cache-Control: public, max-age=31536000, immutable`；图片同样设长缓存。

### P2-3　API 层存在重复实现

- `functions/_lib/auth.js` 已有 `verifyToken`（:65）和 `requireAuth`（:105），被 7 个子路由 import。
- `functions/api/[[path]].js` 里**又重复实现了一套**（`verifyToken` :148、`requireAuth` :188）。
- 该 catch-all 文件 1100+ 行，两套鉴权逻辑并存 —— 将来改一处漏一处只是时间问题。
- **修复**：统一走 `_lib/auth.js`，并把 catch-all 按业务域拆分。

### P2-4　品牌与信任信号

- 站内品牌名统一为 **GreenSmart**，但域名是 **novagardenhome.com** —— 品牌词与域名对不上，logo / OG / manifest 全部用 GreenSmart。
- `index.html:49` 的 Organization schema 里邮箱是个人 Gmail（`yy664355061@gmail.com`）。B2B 询盘场景下，用域名邮箱（如 `sales@novagardenhome.com`）会明显更可信。

### P2-5　首屏动画依赖 JS，失败即不可见

- `src/scripts/main.js:750-755` 先把 `.product-card` / `.feature-card` / `.review-card` / `.proof-card` / `.market-card` 统一设为 `opacity: 0`，再由 IntersectionObserver 显示。
- 若 JS 报错或被禁用，这一整块内容**永久不可见**；同时未处理 `prefers-reduced-motion`。
- **修复**：改为 CSS 侧的渐进增强（默认可见，JS 可用时才加动画），并尊重 `prefers-reduced-motion`。

### P2-6　未使用素材与残留文件

- `hero-planter-sea-generated-v1.png`：**2.6 MB**，未部署（正确），但长期占仓库体积。
- 已无页面引用的三组图：`product-balcony-planter-box.*`、`product-hanging-coir-basket.*`、`product-bamboo-fiber-test.*`，共 9 个文件约 **700 KB**。
- 55 个 `.temp-*` 临时文件仍堆在根目录。

---

## 五、建议执行顺序

| 顺序 | 事项 | 预期收益 | 改动范围 |
| --- | --- | --- | --- |
| 1 | P0-1 换 `<picture>` + 清理无效 preload | 首屏图片减半，LCP 明显改善 | `index.html`、`build.js` |
| 2 | P0-3 预渲染页跳过词典拉取 | 省 57KB/次，减少一次关键往返 | `main.js` |
| 3 | P1-1 装分析工具 + 转化事件 | 拿到转化数据，后续优化才有依据 | `index.html`、`build.js` |
| 4 | P0-2 产品页多语言预渲染 | 打开越/泰/印尼自然流量入口 | `build.js`、`detail-page.js` |
| 5 | P1-2 内链统一无扩展名 | 收敛 URL 形态，改善抓取 | 全站 `*.html` |
| 6 | P1-3 补厚国家页 + 补内链 | 提升三个主攻市场的排名能力 | 5 个国家页 |
| 7 | P2-1 后台挂 Cloudflare Access + 修 `.temp` 泄漏 | 关闭后台暴露面 | `build.js`、Cloudflare 配置 |
| 8 | P2-2 资源指纹 + 缓存头 | 二次访问大幅提速 | `build.js`、`_headers` |
| 9 | P1-4 / P1-5 / P2-3~P2-6 | 细节打磨与清理 | 分散 |

---

## 附：本次审计的验证方法

- 环境：`qa-check.js --source` / `build.js` / `qa-check.js --dist` / `schema-check.js` 四项全跑
- 性能：统计根目录与 `dist/` 全部资源体积，并按引用关系判断素材是否真正被使用（检索 `avif` / `webp` / `srcset` / `image-set` 在 CSS 与 JS 中的出现次数）
- SEO：提取每页 title / description / h1 / 内链数量；对 5 个国家页与 4 个产品页计算 5-gram Jaccard 重合度
- 多语言：程序化比对 en/vi/th/id 的 280 条词条与顶层字段差异
- 安全：核对 `_headers` 全部响应头，并检索 `functions/` 下 `requireAuth` / 401 / 签名校验的覆盖情况
- 追踪：检索 `googletagmanager` / `gtag(` / `clarity` / `facebook.net` / `hotjar`

> 注：本轮为只读审计，未修改任何项目文件。
