const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const root = __dirname;
const dist = path.join(root, 'dist');

// 需要直接复制的静态资源（不含 src 目录，JS/CSS 单独处理）
const staticEntries = [
  'index.html',
  'admin.html',
  '404.html',
  'privacy-policy.html',
  'self-watering-double-layer.html',
  'root-control-gallon-pot.html',
  'transparent-orchid-pot.html',
  'creative-shaped-planter.html',
  '_redirects',
  'wholesale-planters-singapore.html',
  'wholesale-planters-malaysia.html',
  'wholesale-planters-vietnam.html',
  'wholesale-planters-thailand.html',
  'wholesale-planters-indonesia.html',
  '_headers',
  'robots.txt',
  'sitemap.xml',
  'trend-data.json',
  'rfq-template.csv',
  'site.webmanifest',
  'favicon.svg',
  'favicon-32x32.png',
  'apple-touch-icon.png',
  'icon-192.png',
  'icon-512.png',
  'hero-southeast-asia-planters.avif',
  'hero-southeast-asia-planters.webp',
  'hero-southeast-asia-planters.jpg',
  'product-bamboo-fiber.avif',
  'product-bamboo-fiber.webp',
  'product-bamboo-fiber.jpg',
  'product-self-watering-ceramic.avif',
  'product-self-watering-ceramic.webp',
  'product-self-watering-ceramic.jpg',
  'product-stackable-seedling.avif',
  'product-stackable-seedling.webp',
  'product-stackable-seedling.jpg',
  'product-terracotta.avif',
  'product-terracotta.webp',
  'product-terracotta.jpg',
  'product-bamboo-fiber-2.avif',
  'product-bamboo-fiber-2.webp',
  'product-bamboo-fiber-2.jpg',
  'product-self-watering-ceramic-2.avif',
  'product-self-watering-ceramic-2.webp',
  'product-self-watering-ceramic-2.jpg',
  'product-stackable-seedling-2.avif',
  'product-stackable-seedling-2.webp',
  'product-stackable-seedling-2.jpg',
  'product-terracotta-2.avif',
  'product-terracotta-2.webp',
  'product-terracotta-2.jpg',
  'product-balcony-planter-box.avif',
  'product-balcony-planter-box.webp',
  'product-balcony-planter-box.jpg',
  'product-hanging-coir-basket.avif',
  'product-hanging-coir-basket.webp',
  'product-hanging-coir-basket.jpg',
];

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

async function build() {
  console.log('🔨 开始构建...\n');

  // 清空 dist
  fs.rmSync(dist, { recursive: true, force: true });
  fs.mkdirSync(dist, { recursive: true });

  // 1. 复制静态文件
  staticEntries.forEach(copyEntry);
  srcCopyDirs.forEach(copyEntry);
  console.log('✅ 静态文件复制完成');

  // 更新 dist/sitemap.xml 中的 lastmod 为当前构建日期
  const sitemapPath = path.join(dist, 'sitemap.xml');
  if (fs.existsSync(sitemapPath)) {
    const today = new Date().toISOString().slice(0, 10);
    const sitemapContent = fs.readFileSync(sitemapPath, 'utf8')
      .replace(/<lastmod>[^<]+<\/lastmod>/g, `<lastmod>${today}</lastmod>`);
    fs.writeFileSync(sitemapPath, sitemapContent, 'utf8');
    console.log(`✅ sitemap.xml lastmod → ${today}`);
  }

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

  console.log(`\n✅ 构建完成 → ${dist}`);
}

build().catch((err) => {
  console.error('构建失败:', err);
  process.exit(1);
});
