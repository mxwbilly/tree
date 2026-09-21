const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const esbuild = require('esbuild');

const root = __dirname;
const dist = path.join(root, 'dist');

// 固定部署文件；HTML 页面和其中引用的资源由 discoverStaticEntries 自动发现。
const infrastructureEntries = [
  '_redirects',
  '_headers',
  'robots.txt',
  'sitemap.xml',
  'trend-data.json',
  'rfq-template.csv',
  'site.webmanifest',
];

const excludedRootHtml = new Set(['candidate-preview.html']);

// 需要压缩的 JS 文件（源路径 -> 目标路径）
const jsEntries = [
  { src: 'src/scripts/main.js',        out: 'src/scripts/main.js' },
  { src: 'src/scripts/admin.js',       out: 'src/scripts/admin.js' },
  { src: 'src/scripts/erp-admin.js',   out: 'src/scripts/erp-admin.js' },
  { src: 'src/scripts/detail-page.js', out: 'src/scripts/detail-page.js' },
];

// 需要压缩的 CSS 文件
const cssEntries = [
  { src: 'src/styles/main.css', out: 'src/styles/main.css' },
];

// 其余 src 子目录直接复制（components、i18n 等）
const srcCopyDirs = [
  'src/assets',
  'src/components',
  'src/i18n',
  'articles',
];

function copyEntry(entry) {
  const source = path.join(root, entry);
  const target = path.join(dist, entry);
  if (!fs.existsSync(source)) return;
  fs.cpSync(source, target, { recursive: true });
}

function normalizeEntry(entry) {
  return entry.split(path.sep).join('/').replace(/^\.\//, '');
}

function localReference(owner, reference) {
  const value = String(reference || '').trim();
  if (!value || value.startsWith('#') || /^(?:[a-z]+:)?\/\//i.test(value) || /^(?:mailto|tel|data|javascript):/i.test(value)) {
    return '';
  }
  const withoutSuffix = value.split('#')[0].split('?')[0];
  if (!withoutSuffix) return '';
  const relative = withoutSuffix.startsWith('/')
    ? withoutSuffix.slice(1)
    : path.join(path.dirname(owner), withoutSuffix);
  const normalized = normalizeEntry(path.normalize(relative));
  if (normalized.startsWith('../') || normalized === '..') return '';
  return normalized;
}

function referencesFromFile(entry) {
  const absolute = path.join(root, entry);
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) return [];
  const text = fs.readFileSync(absolute, 'utf8');
  const extension = path.extname(entry).toLowerCase();
  const references = [];
  const patterns = [];

  if (extension === '.html') {
    patterns.push(/\b(?:src|srcset|href)=["']([^"']+)["']/gi);
  } else if (extension === '.css') {
    patterns.push(/url\(\s*["']?([^"')]+)["']?\s*\)/gi);
  } else if (extension === '.webmanifest' || extension === '.json') {
    patterns.push(/"src"\s*:\s*"([^"]+)"/gi);
  }

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const resolved = localReference(entry, match[1]);
      if (resolved) references.push(resolved);
    }
  }
  return references;
}

function discoverStaticEntries() {
  const entries = new Set(infrastructureEntries);
  const queue = [];
  const rootHtmlFiles = fs.readdirSync(root, { withFileTypes: true })
    .filter((item) => item.isFile()
      && item.name.endsWith('.html')
      && !item.name.startsWith('.')
      && !excludedRootHtml.has(item.name))
    .map((item) => item.name);

  for (const entry of [...rootHtmlFiles, 'site.webmanifest', ...cssEntries.map((item) => item.src)]) {
    entries.add(entry);
    queue.push(entry);
  }

  const scanned = new Set();
  while (queue.length) {
    const entry = queue.shift();
    if (scanned.has(entry)) continue;
    scanned.add(entry);
    for (const reference of referencesFromFile(entry)) {
      const absolute = path.join(root, reference);
      if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) continue;
      if (!entries.has(reference)) {
        entries.add(reference);
        if (['.html', '.css', '.json', '.webmanifest'].includes(path.extname(reference).toLowerCase())) {
          queue.push(reference);
        }
      }
    }
  }

  return [...entries].sort((a, b) => a.localeCompare(b));
}

async function minifyJs(entry) {
  const source = path.join(root, entry.src);
  const target = path.join(dist, entry.out);
  if (!fs.existsSync(source)) return;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmpOut = target + '.min.tmp';
  await esbuild.build({
    entryPoints: [source],
    outfile: tmpOut,
    bundle: false,
    minify: true,
    target: ['es2017'],
    write: true,
  });
  const before = fs.statSync(source).size;
  const after = fs.statSync(tmpOut).size;
  if (after < before) {
    fs.renameSync(tmpOut, target);
    console.log(`  JS  ${entry.src}: ${kb(before)} → ${kb(after)} (-${pct(before, after)}%)`);
  } else {
    fs.unlinkSync(tmpOut);
    fs.copyFileSync(source, target);
    console.log(`  JS  ${entry.src}: ${kb(before)} → 直接复制（压缩无收益）`);
  }
}

async function minifyCss(entry) {
  const source = path.join(root, entry.src);
  const target = path.join(dist, entry.out);
  if (!fs.existsSync(source)) return;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmpOut = target + '.min.tmp';
  await esbuild.build({
    entryPoints: [source],
    outfile: tmpOut,
    bundle: false,
    minify: true,
    write: true,
  });
  const before = fs.statSync(source).size;
  const after = fs.statSync(tmpOut).size;
  if (after < before) {
    fs.renameSync(tmpOut, target);
    console.log(`  CSS ${entry.src}: ${kb(before)} → ${kb(after)} (-${pct(before, after)}%)`);
  } else {
    fs.unlinkSync(tmpOut);
    fs.copyFileSync(source, target);
    console.log(`  CSS ${entry.src}: ${kb(before)} → 直接复制（压缩无收益）`);
  }
}

function kb(bytes) { return (bytes / 1024).toFixed(1) + 'KB'; }
function pct(before, after) { return (((before - after) / before) * 100).toFixed(0); }

function escapeAttribute(value) {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeText(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function replaceMetaContent(html, selector, content) {
  return html.replace(selector, (tag) => tag.replace(/content="[^"]*"/, `content="${escapeAttribute(content)}"`));
}

function preRenderTranslations(html, strings) {
  let translatedNodes = 0;
  let output = html.replace(
    /(<([a-z][\w:-]*)(?=[^>]*\bdata-i18n="([^"]+)")[^>]*>)([^<]*)(<\/\2>)/gi,
    (full, openTag, tagName, key, content, closeTag) => {
      if (!strings[key]) return full;
      translatedNodes += 1;
      return `${openTag}${escapeText(strings[key])}${closeTag}`;
    }
  );

  output = output.replace(/<[^>]+\bdata-i18n-placeholder="([^"]+)"[^>]*>/gi, (tag, key) => {
    if (!strings[key]) return tag;
    return tag.replace(/placeholder="[^"]*"/i, `placeholder="${escapeAttribute(strings[key])}"`);
  });

  output = output.replace(/<[^>]+\bdata-i18n-alt="([^"]+)"[^>]*>/gi, (tag, key) => {
    if (!strings[key]) return tag;
    return tag.replace(/alt="[^"]*"/i, `alt="${escapeAttribute(strings[key])}"`);
  });

  return { html: output, translatedNodes };
}

// 多语言页站内链接重写：把站内页面链接改为带语言前缀的绝对路径（如 /vi/self-watering-double-layer），
// 避免多语言页用户点击内链后掉回英文页。文章链接（articles/*）无多语言版本，保持英文指向不动。
const LOCALIZED_PAGE_SLUGS = [
  'self-watering-double-layer',
  'root-control-gallon-pot',
  'transparent-orchid-pot',
  'creative-shaped-planter',
];

function rewriteLocalizedLinks(html, lang) {
  const prefix = `/${lang}`;
  let count = 0;

  html = html.replace(/href="([^"]+)"/g, (full, href) => {
    const value = String(href || '');
    // 跳过绝对 URL、锚点、协议、以及 articles 文章链接
    if (!value || value.startsWith('#') || /^(?:[a-z]+:)?\/\//i.test(value) || /^(?:mailto|tel|data|javascript):/i.test(value)) {
      return full;
    }
    if (value.startsWith('articles/') || value.startsWith('/articles/')) return full;

    // 解析出 path 与 hash
    const hashIdx = value.indexOf('#');
    let pathPart = hashIdx >= 0 ? value.slice(0, hashIdx) : value;
    const hashPart = hashIdx >= 0 ? value.slice(hashIdx) : '';

    // 首页 / 根路径
    if (pathPart === '/' || pathPart === '') {
      count += 1;
      return `href="${prefix}/${hashPart}"`;
    }
    // 相对站内页面链接（无扩展名 slug）
    const clean = pathPart.replace(/^\.\//, '').replace(/\/$/, '');
    if (LOCALIZED_PAGE_SLUGS.includes(clean)) {
      count += 1;
      return `href="${prefix}/${clean}${hashPart}"`;
    }
    return full;
  });

  return { html, count };
}

function buildLocalizedHomepages() {
  const template = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const languagePaths = { en: '/', vi: '/vi/', th: '/th/', id: '/id/' };

  for (const lang of ['vi', 'th', 'id']) {
    const dictionaryText = fs.readFileSync(path.join(root, 'src', 'i18n', `${lang}.json`), 'utf8').replace(/^\uFEFF/, '');
    const dictionary = JSON.parse(dictionaryText);
    const pageUrl = `https://novagardenhome.com${languagePaths[lang]}`;
    let html = template
      .replace('<html lang="en" data-site-language="en">', `<html lang="${lang}" data-site-language="${lang}">`)
      .replace(/<title>[^<]*<\/title>/, `<title>${escapeAttribute(dictionary.title)}</title>`)
      .replace(/<link rel="canonical" href="[^"]*">/, `<link rel="canonical" href="${pageUrl}">`)
      .replace(/<meta property="og:url" content="[^"]*">/, `<meta property="og:url" content="${pageUrl}">`);

    html = replaceMetaContent(html, /<meta name="description"[^>]*>/, dictionary.description);
    html = replaceMetaContent(html, /<meta name="keywords"[^>]*>/, dictionary.keywords);
    html = replaceMetaContent(html, /<meta property="og:title"[^>]*>/, dictionary.title);
    html = replaceMetaContent(html, /<meta property="og:description"[^>]*>/, dictionary.description);
    html = replaceMetaContent(html, /<meta name="twitter:title"[^>]*>/, dictionary.title);
    html = replaceMetaContent(html, /<meta name="twitter:description"[^>]*>/, dictionary.description);
    const rendered = preRenderTranslations(html, dictionary.strings || {});
    html = rendered.html;

    // 站内链接加语言前缀，避免多语言页用户掉回英文
    const linkResult = rewriteLocalizedLinks(html, lang);
    html = linkResult.html;

    // 注入 <base href="/">，让图片/CSS/JS 等相对路径基于站点根解析（多语言页位于 /vi/ /th/ /id/ 子目录）。
    // 必须放在 rewriteLocalizedLinks 之后，避免 base 标签自身的 href="/" 被误加语言前缀成 /vi/。
    html = html.replace('<head>', '<head>\n    <base href="/">');

    const output = path.join(dist, lang, 'index.html');
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, html, 'utf8');
    console.log(`  ${lang}: 已预渲染 ${rendered.translatedNodes} 个文案节点`);
  }
  console.log('✅ 已生成静态语言首页：/vi/、/th/、/id/');
}

// 产品详情页多语言预渲染。
// 翻译范围：产品信息字段（h1/intro/points/quickSpecs/specs/tags/moq/lead/按钮）+ title/description 两个 meta。
// SEO 长文案（whyItems/FAQ/gallery/focus）保持英文，不做翻译。
const DETAIL_PAGES = [
  'self-watering-double-layer.html',
  'root-control-gallon-pot.html',
  'transparent-orchid-pot.html',
  'creative-shaped-planter.html',
];

function buildLocalizedDetailPages() {
  const languagePaths = { en: '/', vi: '/vi/', th: '/th/', id: '/id/' };
  let total = 0;

  for (const lang of ['vi', 'th', 'id']) {
    const dictionaryText = fs.readFileSync(path.join(root, 'src', 'i18n', `detail-${lang}.json`), 'utf8').replace(/^\uFEFF/, '');
    const dictionary = JSON.parse(dictionaryText);
    const ui = dictionary.ui || {};

    for (const page of DETAIL_PAGES) {
      const content = dictionary.pages?.[page];
      // 方案 A：该语言缺失该产品翻译时跳过，不生成空壳页。
      if (!content) {
        console.log(`  ⚠ ${lang} 缺 ${page} 翻译，跳过（保持英文）`);
        continue;
      }

      const templatePath = path.join(root, page);
      if (!fs.existsSync(templatePath)) continue;
      let html = fs.readFileSync(templatePath, 'utf8');

      const slug = page.replace(/\.html$/, '');
      const pageUrl = `https://novagardenhome.com${languagePaths[lang]}${slug}`;
      const enUrl = `https://novagardenhome.com/${slug}`;

      // 1. html lang + title + description（meta 随产品信息翻译）
      html = html.replace('<html lang="en">', `<html lang="${lang}" data-site-language="${lang}">`);
      if (content.title) html = html.replace(/<title>[^<]*<\/title>/, `<title>${escapeAttribute(content.title)}</title>`);
      if (content.description) html = replaceMetaContent(html, /<meta name="description"[^>]*>/, content.description);

      // 2. canonical + hreflang 改写为真实路径
      html = html.replace(/<link rel="canonical" href="[^"]*">/, `<link rel="canonical" href="${pageUrl}">`);
      html = html.replace(/<meta property="og:url" content="[^"]*">/, `<meta property="og:url" content="${pageUrl}">`);
      html = html.replace(/<link rel="alternate" hreflang="en" href="[^"]*" \/>/, `<link rel="alternate" hreflang="en" href="${enUrl}" />`);
      for (const l of ['vi', 'th', 'id']) {
        html = html.replace(
          new RegExp(`<link rel="alternate" hreflang="${l}" href="[^"]*" />`),
          `<link rel="alternate" hreflang="${l}" href="https://novagardenhome.com${languagePaths[l]}${slug}" />`
        );
      }

      // 3. h1 + intro
      if (content.h1) {
        html = html.replace(/<h1>[^<]*<\/h1>/, (tag) => tag.replace(/<h1>[^<]*<\/h1>/, `<h1>${escapeText(content.h1)}</h1>`));
      }
      if (content.intro) {
        html = html.replace(/<div class="detail-copy">[\s\S]*?<p>[\s\S]*?<\/p>/, (m) => {
          return m.replace(/<p>[\s\S]*?<\/p>/, `<p>${escapeText(content.intro)}</p>`);
        });
      }

      // 4. points（5 条，保留 <i> 图标）
      if (Array.isArray(content.points)) {
        const pointMatches = html.match(/<li><i class="fas fa-check-circle"><\/i>[^<]*<\/li>/g);
        if (pointMatches) {
          pointMatches.forEach((orig, index) => {
            if (content.points[index] === undefined) return;
            html = html.replace(orig, `<li><i class="fas fa-check-circle"></i> ${escapeText(content.points[index])}</li>`);
          });
        }
      }

      // 5. quick-specs（4 项 label/value）
      if (Array.isArray(content.quickSpecs)) {
        const specItems = html.match(/<span class="spec-label">[^<]*<\/span><span class="spec-value">[^<]*<\/span>/g);
        if (specItems) {
          specItems.forEach((orig, index) => {
            const pair = content.quickSpecs[index];
            if (!pair) return;
            html = html.replace(orig, `<span class="spec-label">${escapeText(pair[0])}</span><span class="spec-value">${escapeText(pair[1])}</span>`);
          });
        }
      }

      // 6. specs 标题 + 表格行
      if (content.specsTitle) {
        html = html.replace(/<h2>[^<]*<\/h2>/, `<h2>${escapeText(content.specsTitle)}</h2>`);
      }
      if (Array.isArray(content.specsRows)) {
        const rows = html.match(/<tr><th>[^<]*<\/th><td>[^<]*<\/td><\/tr>/g);
        if (rows) {
          rows.forEach((orig, index) => {
            const line = content.specsRows[index];
            if (!line) return;
            html = html.replace(orig, `<tr><th>${escapeText(line[0])}</th><td>${escapeText(line[1])}</td></tr>`);
          });
        }
      }

      // 7. buyerTitle + tags
      const gridHeadings = html.match(/<h3>[^<]*<\/h3>/g);
      if (gridHeadings && gridHeadings[0] && content.buyerTitle) {
        html = html.replace(gridHeadings[0], `<h3>${escapeText(content.buyerTitle)}</h3>`);
      }
      if (Array.isArray(content.tags)) {
        const tags = html.match(/<span>[^<]*<\/span>/g);
        if (tags) {
          // 只替换 detail-tags 容器内的 span；用顺序定位（detail-tags 是第一个含多个连续 span 的容器）
          const tagBlock = html.match(/<div class="detail-tags">[\s\S]*?<\/div>/);
          if (tagBlock) {
            let newBlock = tagBlock[0];
            const tagSpans = tagBlock[0].match(/<span>[^<]*<\/span>/g) || [];
            tagSpans.forEach((orig, index) => {
              if (content.tags[index] === undefined) return;
              newBlock = newBlock.replace(orig, `<span>${escapeText(content.tags[index])}</span>`);
            });
            html = html.replace(tagBlock[0], newBlock);
          }
        }
      }

      // 8. CTA 按钮 + back 按钮
      if (content.ctaPrimary) {
        html = html.replace(/>Request Quote<\/a>|>Request Catalogue<\/a>/, `>${escapeText(content.ctaPrimary)}</a>`);
      }
      if (content.ctaWhatsapp) {
        html = html.replace(/>WhatsApp Sales<\/a>|>WhatsApp for Latest Designs<\/a>/, `>${escapeText(content.ctaWhatsapp)}</a>`);
      }
      if (ui.backBtn) {
        html = html.replace(/>← Back to Products<\/a>/, `>${escapeText(ui.backBtn)}</a>`);
      }

      // 注意：whyTitle/whyItems/galleryTitle/galleryNote/galleryCaptions/focus(FAQ) 保持英文，不翻译。

      // 站内链接加语言前缀（related 产品、返回首页、CTA 等），避免掉回英文
      const linkResult = rewriteLocalizedLinks(html, lang);
      html = linkResult.html;

      // 注入 <base href="/">，让图片/CSS/JS 等相对路径基于站点根解析（多语言页位于 /vi/ /th/ /id/ 子目录）。
      // 必须放在 rewriteLocalizedLinks 之后，避免 base 标签自身的 href="/" 被误加语言前缀。
      html = html.replace('<head>', '<head>\n    <base href="/">');

      const output = path.join(dist, lang, page);
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.writeFileSync(output, html, 'utf8');
      total += 1;
      console.log(`  ${lang}/${page}: 已预渲染`);
    }
  }
  console.log(`✅ 已生成静态产品详情页：${total} 个（vi/th/id × 4 产品）`);
}

function pageSourcesForUrl(urlText) {
  const pathname = new URL(urlText).pathname;
  const localizedSources = {
    '/': ['index.html'],
    '/vi/': ['index.html', 'src/i18n/vi.json'],
    '/th/': ['index.html', 'src/i18n/th.json'],
    '/id/': ['index.html', 'src/i18n/id.json'],
  };
  if (localizedSources[pathname]) return localizedSources[pathname];

  const cleanPath = pathname.replace(/^\//, '').replace(/\/$/, '');
  if (!cleanPath) return [];
  const htmlEntry = `${cleanPath}.html`;
  return fs.existsSync(path.join(root, htmlEntry)) ? [htmlEntry] : [];
}

function gitPageDate(entries) {
  if (!entries.length) return '';
  const changed = spawnSync('git', ['status', '--porcelain', '--', ...entries], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (changed.status === 0 && changed.stdout.trim()) {
    return new Date().toISOString().slice(0, 10);
  }

  const committed = spawnSync('git', ['log', '-1', '--format=%cs', '--', ...entries], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  });
  return committed.status === 0 ? committed.stdout.trim().split(/\r?\n/)[0] : '';
}

function updateSitemapLastmod() {
  const sitemapPath = path.join(dist, 'sitemap.xml');
  if (!fs.existsSync(sitemapPath)) return;
  const original = fs.readFileSync(sitemapPath, 'utf8');
  let updatedCount = 0;
  const output = original.replace(/<url>([\s\S]*?)<\/url>/g, (block) => {
    const location = block.match(/<loc>([^<]+)<\/loc>/)?.[1];
    if (!location) return block;
    const date = gitPageDate(pageSourcesForUrl(location));
    if (!date || !/<lastmod>[^<]+<\/lastmod>/.test(block)) return block;
    const next = block.replace(/<lastmod>[^<]+<\/lastmod>/, `<lastmod>${date}</lastmod>`);
    if (next !== block) updatedCount += 1;
    return next;
  });
  fs.writeFileSync(sitemapPath, output, 'utf8');
  console.log(`✅ sitemap.xml 按页面实际变更时间更新（${updatedCount} 项变化）`);
}

function listDistFiles(directory, prefix = '') {
  const files = [];
  for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.isDirectory()) files.push(...listDistFiles(path.join(directory, item.name), relative));
    else files.push(relative);
  }
  return files.sort((a, b) => a.localeCompare(b));
}

function writeBuildManifest(staticEntries) {
  const manifestPath = path.join(dist, 'build-manifest.json');
  const files = listDistFiles(dist).filter((entry) => entry !== 'build-manifest.json');
  const manifest = {
    discoveredStaticEntries: staticEntries,
    localizedRoutes: ['/vi/', '/th/', '/id/'],
    outputFileCount: files.length,
    outputFiles: files,
  };
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(`✅ 构建清单已生成：${files.length} 个输出文件`);
}

async function build() {
  console.log('🔨 开始构建...\n');

  // 清空 dist
  fs.rmSync(dist, { recursive: true, force: true });
  fs.mkdirSync(dist, { recursive: true });

  // 1. 复制静态文件
  const staticEntries = discoverStaticEntries();
  staticEntries.forEach(copyEntry);
  srcCopyDirs.forEach(copyEntry);
  buildLocalizedHomepages();
  buildLocalizedDetailPages();
  console.log(`✅ 静态文件复制完成（自动发现 ${staticEntries.length} 项）`);

  updateSitemapLastmod();

  // 2. 压缩 JS
  console.log('\n📦 压缩 JS:');
  for (const entry of jsEntries) {
    await minifyJs(entry);
  }

  // 3. 压缩 CSS
  console.log('\n🎨 压缩 CSS:');
  for (const entry of cssEntries) {
    await minifyCss(entry);
  }

  writeBuildManifest(staticEntries);

  console.log(`\n✅ 构建完成 → ${dist}`);
}

build().catch((err) => {
  console.error('构建失败:', err);
  process.exit(1);
});
