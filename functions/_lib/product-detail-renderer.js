import { parseJson } from './http.js';

const SITE_URL = 'https://novagardenhome.com';
const WHATSAPP_URL = 'https://wa.me/8617602198979?text=Hi%2C%20I%27m%20interested%20in%20your%20planters';
const SUPPORTED_LANGS = ['en', 'vi', 'th', 'id'];

// 详情页 UI 外壳文案（固定短语），正文字段由产品配置里的译文驱动。
const UI_COPY = {
  en: {
    back: '← Back to Products',
    quote: 'Request Quote',
    whatsapp: 'WhatsApp Sales',
    procTitle: 'Procurement Quick Reference',
    procDesc: 'Check MOQ tiers and download the RFQ template to plan your order with confidence.',
    moqTitle: 'MOQ Ladder Reference',
    rfqTitle: 'RFQ Template Download',
    rfqRows: [
      'Includes key fields: product, size, quantity, destination port, timeline, packing, and terms.',
      'Fill in product, quantity, and destination port to receive a formal quote within one business day.',
      'Every quote reply includes packing details and a clear price validity period.'
    ],
    rfqCta: 'Download RFQ Template (CSV)',
    related: 'Related products'
  },
  vi: {
    back: '← Quay lại sản phẩm',
    quote: 'Yêu cầu báo giá',
    whatsapp: 'WhatsApp Bán hàng',
    procTitle: 'Thông tin tham khảo mua hàng nhanh',
    procDesc: 'Xem mốc MOQ và tải mẫu RFQ để lập kế hoạch đặt hàng một cách chủ động.',
    moqTitle: 'Mốc MOQ tham chiếu',
    rfqTitle: 'Tải mẫu RFQ',
    rfqRows: [
      'Đã gồm trường cột lõi: sản phẩm, kích thước, số lượng, cảng đích, tiến độ, đóng gói, và điều khoản.',
      'Điền sản phẩm, số lượng và cảng đích để nhận báo giá chính thức trong một ngày làm việc.',
      'Mỗi báo giá trả về đều kèm thông tin đóng gói và thời hạn hiệu lực giá rõ ràng.'
    ],
    rfqCta: 'Tải mẫu RFQ (CSV)',
    related: 'Sản phẩm liên quan'
  },
  th: {
    back: '← กลับไปที่สินค้า',
    quote: 'ขอใบเสนอราคา',
    whatsapp: 'WhatsApp ฝ่ายขาย',
    procTitle: 'ข้อมูลอ้างอิงการจัดซื้อสำหรับผู้ซื้อ',
    procDesc: 'ตรวจสอบช่วง MOQ และดาวน์โหลดเทมเพลต RFQ เพื่อวางแผนการสั่งซื้อได้อย่างมั่นใจ',
    moqTitle: 'ช่วง MOQ อ้างอิง',
    rfqTitle: 'ดาวน์โหลดเทมเพลต RFQ',
    rfqRows: [
      'มีฟิลด์สำคัญครบ: สินค้า, ขนาด, จำนวน, ท่าเรือปลายทาง, timeline, แพ็กกิ้ง และเงื่อนไข.',
      'กรอกสินค้า จำนวน และท่าเรือปลายทาง เพื่อรับใบเสนอราคาอย่างเป็นทางการภายในหนึ่งวันทำการ',
      'ใบเสนอราคาทุกฉบับระบุรายละเอียดการแพ็กและระยะเวลาอายุราคาชัดเจน'
    ],
    rfqCta: 'ดาวน์โหลดเทมเพลต RFQ (CSV)',
    related: 'สินค้าที่เกี่ยวข้อง'
  },
  id: {
    back: '← Kembali ke Produk',
    quote: 'Minta Penawaran',
    whatsapp: 'WhatsApp Penjualan',
    procTitle: 'Referensi Cepat Pengadaan',
    procDesc: 'Cek jenjang MOQ dan unduh template RFQ untuk merencanakan pesanan dengan percaya diri.',
    moqTitle: 'Referensi Tangga MOQ',
    rfqTitle: 'Unduh Template RFQ',
    rfqRows: [
      'Mencakup field inti: produk, ukuran, jumlah, pelabuhan tujuan, timeline, kemasan, dan ketentuan.',
      'Isi produk, jumlah, dan pelabuhan tujuan untuk menerima penawaran resmi dalam satu hari kerja.',
      'Setiap penawaran kami sertakan detail kemasan dan masa berlaku harga yang jelas.'
    ],
    rfqCta: 'Unduh Template RFQ (CSV)',
    related: 'Produk terkait'
  }
};

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function normalizeImage(value) {
  const raw = String(value || '').trim();
  if (!raw || /^(https?:)?\/\//i.test(raw)) return raw;
  return raw.startsWith('/') ? raw : `/${raw}`;
}

function langUrl(lang, slug) {
  return lang === 'en' ? `/products/${slug}` : `/${lang}/products/${slug}`;
}

// 按语言合并译文：优先取 translations[lang]，缺失字段 fallback 到英文顶层字段。
function resolveContent(detail, lang) {
  const translations = detail?.translations || {};
  const patch = lang && lang !== 'en' ? translations[lang] || {} : {};
  return { ...(detail || {}), ...patch };
}

function renderPicture(src, alt, { eager = false } = {}) {
  if (!src) return '';
  const path = normalizeImage(src);
  const attr = eager ? ' loading="eager" decoding="async" fetchpriority="high"' : ' loading="lazy" decoding="async"';
  const base = path.replace(/\.(jpe?g|png)$/i, '');
  const hasVariants = /\.(jpe?g|png)$/i.test(path);
  if (!hasVariants) {
    return `<img class="detail-image" src="${escapeHtml(path)}" alt="${escapeHtml(alt || '')}" width="960" height="720"${attr}>`;
  }
  return `<picture>
  <source srcset="${escapeHtml(`${base}.avif`)}" type="image/avif">
  <source srcset="${escapeHtml(`${base}.webp`)}" type="image/webp">
  <img class="detail-image" src="${escapeHtml(path)}" alt="${escapeHtml(alt || '')}" width="960" height="720"${attr}>
</picture>`;
}

function renderSpecsRows(specs) {
  if (!Array.isArray(specs) || !specs.length) return '';
  return specs.map((row) => {
    const label = Array.isArray(row) ? row[0] : '';
    const value = Array.isArray(row) ? row[1] : '';
    if (!label && !value) return '';
    return `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`;
  }).join('\n');
}

function renderWhyItems(items) {
  if (!Array.isArray(items) || !items.length) return '';
  return items.map((item) => (Array.isArray(item)
    ? `<li><strong>${escapeHtml(item[0])}:</strong> ${escapeHtml(item[1])}</li>`
    : `<li>${escapeHtml(item)}</li>`)).join('\n');
}

function renderFaq(items) {
  if (!Array.isArray(items) || !items.length) return '';
  return items.map((item) => (Array.isArray(item)
    ? `<li><strong>${escapeHtml(item[0])}</strong> ${escapeHtml(item[1])}</li>`
    : `<li>${escapeHtml(item)}</li>`)).join('\n');
}

function renderList(items) {
  if (!Array.isArray(items) || !items.length) return '';
  return items.map((item) => `<li>${escapeHtml(item)}</li>`).join('\n');
}

function renderLanguageSwitcher(detail, currentLang) {
  const langs = Array.isArray(detail.languages) && detail.languages.length
    ? detail.languages.filter((l) => SUPPORTED_LANGS.includes(l))
    : ['en'];
  if (!langs.includes('en')) langs.unshift('en');
  const labels = { en: 'EN', vi: 'VI', th: 'TH', id: 'ID' };
  const buttons = langs.map((l) => `<button type="button" class="lang-btn${l === currentLang ? ' active' : ''}" data-lang="${l}">${labels[l]}</button>`).join('');
  return `<div class="lang-switcher detail-lang-switcher">${buttons}</div>`;
}

function renderProductDetail(detail, relatedLinks, lang) {
  const d = resolveContent(detail, lang);
  const slug = d.slug || '';
  const url = `${SITE_URL}${langUrl(lang, slug)}`;
  const title = d.title || d.h1 || 'Product Detail';
  const h1 = d.h1 || d.title || 'Product Detail';
  const metaDescription = d.metaDescription || d.intro || '';
  const image = normalizeImage(d.image || '');
  const ogImage = image ? `${SITE_URL}${image}` : '';
  const ui = UI_COPY[lang] || UI_COPY.en;
  const htmlLang = lang || 'en';

  // hreflang：en 固定，其余按 detail.languages 勾选输出。
  const hreflangs = [lang === 'en' ? '' : `  <link rel="alternate" hreflang="en" href="${escapeHtml(`${SITE_URL}/products/${slug}`)}">`]
    .filter(Boolean)
    .join('\n');
  const altLangs = (Array.isArray(detail.languages) ? detail.languages : [])
    .filter((l) => ['vi', 'th', 'id'].includes(l))
    .map((l) => `  <link rel="alternate" hreflang="${l}" href="${escapeHtml(`${SITE_URL}/${l}/products/${slug}`)}">`)
    .join('\n');

  const points = (Array.isArray(d.points) ? d.points : []).map((p) => `<li><i class="fas fa-check-circle"></i> ${escapeHtml(p)}</li>`).join('\n');
  const quickSpecs = (Array.isArray(d.quickSpecs) ? d.quickSpecs : []).map((pair) => {
    const label = Array.isArray(pair) ? pair[0] : '';
    const value = Array.isArray(pair) ? pair[1] : '';
    return `<div class="spec-item"><span class="spec-label">${escapeHtml(label)}</span><span class="spec-value">${escapeHtml(value)}</span></div>`;
  }).join('\n');
  const gallery = (Array.isArray(d.gallery) ? d.gallery : []).map((item) => {
    const src = typeof item === 'string' ? item : item?.image;
    const caption = typeof item === 'string' ? '' : item?.caption;
    const img = renderPicture(src, caption || h1);
    return `<div>${img}${caption ? `<p class="gallery-caption">${escapeHtml(caption)}</p>` : ''}</div>`;
  }).join('\n');

  const specsRows = renderSpecsRows(d.specs);
  const specsBlock = specsRows
    ? `<div class="detail-card">
      <h2>${escapeHtml(d.specsTitle || 'Product specifications')}</h2>
      <table class="detail-spec-table">${specsRows}</table>
      ${(Array.isArray(d.designBadges) && d.designBadges.length) ? `<div style="margin-top:16px;">${d.designBadges.map((b) => `<span class="design-badge">${escapeHtml(b)}</span>`).join('')}</div>` : ''}
    </div>`
    : '';

  const buyerTags = (Array.isArray(d.buyerTags) ? d.buyerTags : []).map((t) => `<span>${escapeHtml(t)}</span>`).join('');
  const whyItems = renderWhyItems(d.whyItems);
  const hasBuyerCard = buyerTags || whyItems || d.buyerTitle || d.whyTitle;
  const buyerBlock = hasBuyerCard
    ? `<div class="detail-card">
      ${d.buyerTitle ? `<h3>${escapeHtml(d.buyerTitle)}</h3>` : ''}
      ${buyerTags ? `<div class="detail-tags">${buyerTags}</div>` : ''}
      ${d.whyTitle ? `<h3 style="margin-top:24px;">${escapeHtml(d.whyTitle)}</h3>` : ''}
      ${whyItems ? `<ul class="detail-mini-list">${whyItems}</ul>` : ''}
    </div>`
    : '';

  const detailSection = (specsBlock || buyerBlock)
    ? `<section class="detail-section">
  <div class="container detail-grid">${specsBlock}${buyerBlock}</div>
</section>`
    : '';

  const gallerySection = gallery
    ? `<section class="gallery-section">
  <div class="container">
    ${d.galleryTitle ? `<h2>${escapeHtml(d.galleryTitle)}</h2>` : ''}
    ${d.galleryNote ? `<p class="variant-note">${escapeHtml(d.galleryNote)}</p>` : ''}
    <div class="gallery-grid">${gallery}</div>
  </div>
</section>`
    : '';

  const faqItems = renderFaq(d.faq);
  const focusSection = faqItems
    ? `<section class="detail-focus">
  <div class="container detail-focus-grid">
    <div class="detail-card"><h3>${escapeHtml(d.faqTitle || 'Common buyer questions')}</h3><ul class="detail-mini-list">${faqItems}</ul></div>
  </div>
</section>`
    : '';

  const procurement = (Array.isArray(d.moqLadder) && d.moqLadder.length)
    ? `<section class="detail-procurement">
  <div class="container">
    <div class="section-header compact-header">
      <h2>${escapeHtml(ui.procTitle)}</h2>
      <p>${escapeHtml(ui.procDesc)}</p>
    </div>
    <div class="procurement-grid">
      <article class="detail-card"><h3>${escapeHtml(ui.moqTitle)}</h3><ul class="detail-mini-list">${renderList(d.moqLadder)}</ul></article>
      <article class="detail-card">
        <h3>${escapeHtml(ui.rfqTitle)}</h3>
        <ul class="detail-mini-list">${renderList(ui.rfqRows)}</ul>
        <a class="btn btn-primary" href="/rfq-template.csv" download>${escapeHtml(ui.rfqCta)}</a>
      </article>
    </div>
  </div>
</section>`
    : '';

  const relatedBlock = relatedLinks.length
    ? `<section class="detail-related">
  <div class="container">
    <h3>${escapeHtml(ui.related)}</h3>
    <div class="related-links">${relatedLinks.map((r) => `<a href="${escapeHtml(langUrl(lang, r.slug))}">${escapeHtml(r.name)}</a>`).join('\n')}</div>
  </div>
</section>`
    : '';

  const productSchema = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: h1,
    description: metaDescription,
    ...(image ? { image: `${SITE_URL}${image}` } : {}),
    url,
    brand: { '@type': 'Brand', name: 'GreenSmart' },
    category: d.category || 'Wholesale Planters'
  };
  const breadcrumbSchema = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE_URL}/` },
      { '@type': 'ListItem', position: 2, name: h1, item: url }
    ]
  };

  return `<!DOCTYPE html>
<html lang="${htmlLang}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="description" content="${escapeHtml(metaDescription)}">
<title>${escapeHtml(title)}</title>
<meta name="theme-color" content="#16a34a">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
<link rel="canonical" href="${escapeHtml(url)}">
<link rel="alternate" hreflang="x-default" href="${escapeHtml(`${SITE_URL}/products/${slug}`)}">
${lang === 'en' ? '' : `  <link rel="alternate" hreflang="en" href="${escapeHtml(`${SITE_URL}/products/${slug}`)}">`}
${altLangs}
<meta property="og:type" content="website">
<meta property="og:title" content="${escapeHtml(d.ogTitle || title)}">
<meta property="og:description" content="${escapeHtml(d.ogDescription || metaDescription)}">
<meta property="og:url" content="${escapeHtml(url)}">
${ogImage ? `<meta property="og:image" content="${escapeHtml(ogImage)}">` : ''}
<meta property="og:site_name" content="GreenSmart">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(metaDescription)}">
${ogImage ? `<meta name="twitter:image" content="${escapeHtml(ogImage)}">` : ''}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="preconnect" href="https://cdnjs.cloudflare.com">
<link rel="preload" href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" as="style" onload="this.onload=null;this.rel='stylesheet'">
<noscript><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap"></noscript>
<link rel="stylesheet" href="/src/styles/main.css">
<link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" rel="stylesheet">
<style>
.gallery-section { padding: 48px 0; background: #f9fafb; }
.gallery-section h2 { text-align: center; margin-bottom: 8px; font-size: 1.25rem; font-weight: 700; }
.gallery-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 12px; margin-top: 20px; }
.gallery-grid img { width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: 10px; border: 1px solid #e5e7eb; }
.gallery-caption { font-size: 0.78rem; color: #888; text-align: center; margin-top: 4px; }
.variant-note { text-align: center; font-size: 0.85rem; color: #666; margin-bottom: 0; }
.design-badge { display: inline-block; background: #fef9c3; color: #854d0e; border: 1px solid #fde68a; border-radius: 6px; font-size: 0.78rem; font-weight: 600; padding: 2px 8px; margin: 2px; }
.detail-lang-switcher { display: inline-flex; gap: 6px; margin-bottom: 16px; }
.detail-lang-switcher .lang-btn { background: #fff; border: 1px solid #d1d5db; color: #374151; border-radius: 6px; padding: 4px 10px; font-size: 0.8rem; font-weight: 600; cursor: pointer; }
.detail-lang-switcher .lang-btn.active { background: #16a34a; border-color: #16a34a; color: #fff; }
</style>
<script type="application/ld+json">${JSON.stringify(productSchema)}</script>
<script type="application/ld+json">${JSON.stringify(breadcrumbSchema)}</script>
</head>
<body>
<section class="detail-hero">
  <div class="container detail-layout">
    <div class="detail-copy">
      <a class="btn btn-secondary" href="${lang === 'en' ? '/#products' : `/${lang}/#products`}">${escapeHtml(ui.back)}</a>
      ${renderLanguageSwitcher(detail, lang)}
      <h1>${escapeHtml(h1)}</h1>
      ${d.intro ? `<p>${escapeHtml(d.intro)}</p>` : ''}
      ${points ? `<ul class="detail-points">${points}</ul>` : ''}
      <div class="detail-cta-bar">
        <a class="btn btn-primary" href="${lang === 'en' ? '/#contact' : `/${lang}/#contact`}">${escapeHtml(d.ctaPrimary || ui.quote)}</a>
        <a class="btn btn-whatsapp" href="${escapeHtml(WHATSAPP_URL)}" target="_blank">${escapeHtml(d.ctaWhatsapp || ui.whatsapp)}</a>
      </div>
      ${quickSpecs ? `<div class="quick-specs-bar">${quickSpecs}</div>` : ''}
    </div>
    ${renderPicture(d.image, d.imageAlt || h1, { eager: true })}
  </div>
</section>
${detailSection}
${gallerySection}
${focusSection}
${procurement}
${relatedBlock}
<script>
document.querySelectorAll('.detail-lang-switcher .lang-btn').forEach(function (btn) {
  btn.addEventListener('click', function () {
    var next = btn.getAttribute('data-lang');
    var slug = ${JSON.stringify(slug)};
    var path = next === 'en' ? '/products/' + slug : '/' + next + '/products/' + slug;
    window.location.href = path;
  });
});
</script>
</body>
</html>`;
}

function notFound(slug) {
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Product not found</title></head><body style="font-family:system-ui,sans-serif;padding:40px;text-align:center;"><h1>Product not found</h1><p>The product "${escapeHtml(slug)}" does not exist or is no longer available.</p><a href="/">← Back to home</a></body></html>`;
  return new Response(html, { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

export async function handleProductDetailRequest(env, slug, lang) {
  const cleanSlug = String(slug || '').trim();
  const cleanLang = SUPPORTED_LANGS.includes(lang) ? lang : 'en';
  if (!env.DB) {
    return new Response('Product catalog is unavailable.', { status: 503, headers: { 'Content-Type': 'text/plain' } });
  }
  if (!cleanSlug) return notFound(cleanSlug);

  const { results } = await env.DB.prepare('SELECT id, name, category, spec_json FROM products WHERE status = ?').bind('active').all();
  const bySlug = new Map();
  for (const row of results || []) {
    const spec = parseJson(row.spec_json, {});
    const detail = spec.detail || {};
    if (!detail.enabled || !detail.slug) continue;
    bySlug.set(String(detail.slug).trim(), {
      name: row.name,
      category: row.category || '',
      detail: { ...detail, category: row.category || detail.category || '' }
    });
  }

  const target = bySlug.get(cleanSlug);
  if (!target) return notFound(cleanSlug);

  const relatedLinks = (Array.isArray(target.detail.related) ? target.detail.related : [])
    .map((ref) => {
      const refSlug = typeof ref === 'string' ? ref : ref?.slug;
      const name = typeof ref === 'string' ? bySlug.get(ref)?.name : ref?.name || bySlug.get(refSlug)?.name;
      if (!refSlug || refSlug === cleanSlug) return null;
      return { slug: refSlug, name: name || refSlug };
    })
    .filter(Boolean);

  const html = renderProductDetail(target.detail, relatedLinks, cleanLang);
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=300'
    }
  });
}
