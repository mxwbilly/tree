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
    .filter((item) => item.isFile() && item.name.endsWith('.html') && !excludedRootHtml.has(item.name))
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

function buildLocalizedHomepages() {
  const template = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const languagePaths = { en: '/', vi: '/vi/', th: '/th/', id: '/id/' };

  for (const lang of ['vi', 'th', 'id']) {
    const dictionaryText = fs.readFileSync(path.join(root, 'src', 'i18n', `${lang}.json`), 'utf8').replace(/^\uFEFF/, '');
    const dictionary = JSON.parse(dictionaryText);
    const pageUrl = `https://novagardenhome.com${languagePaths[lang]}`;
    let html = template
      .replace('<html lang="en" data-site-language="en">', `<html lang="${lang}" data-site-language="${lang}">`)
      .replace('<head>', '<head>\n    <base href="/">')
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

    const output = path.join(dist, lang, 'index.html');
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, html, 'utf8');
    console.log(`  ${lang}: 已预渲染 ${rendered.translatedNodes} 个文案节点`);
  }
  console.log('✅ 已生成静态语言首页：/vi/、/th/、/id/');
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
