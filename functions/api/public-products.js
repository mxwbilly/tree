import { json, parseJson } from '../_lib/http.js';

const INITIAL_PRODUCTS = [
  {
    id: 'prod_gs_swp_001', sku: 'GS-SWP-001', name: 'Double-Layer Self-Watering Planters', category: 'Self-watering planters', sortOrder: 10,
    imageUrl: '/product-self-watering-ceramic.jpg',
    secondaryImageUrl: '/product-self-watering-ceramic-2.jpg',
    detailUrl: '/self-watering-double-layer.html',
    badge: 'Trend leader', chip: '2026 new colors', chipIcon: 'fa-star',
    description: 'A bottom reservoir helps maintain moisture for balcony, office, and indoor retail plants. Available with a water-level window, OEM colors, and gift-ready packaging.',
    highlights: ['Bottom reservoir, 150-1,200 ml', 'Optional water-level window', 'OEM colors + gift-box packaging'],
    meta: ['MOQ: 50 pcs', 'Use: indoor retail / gifting / balcony planting']
  },
  {
    id: 'prod_gs_nursery_001', sku: 'GS-NP-001', name: 'Root Control & Gallon Nursery Pots', category: 'Nursery pots', sortOrder: 20,
    imageUrl: '/product-stackable-seedling.jpg',
    secondaryImageUrl: '/product-stackable-seedling-2.jpg',
    detailUrl: '/root-control-gallon-pot.html',
    badge: 'Wholesale favorite', chip: 'Samples ready to ship', chipIcon: 'fa-check-circle',
    description: 'Air-pruning side walls prevent root spiralling. 1-10 gallon range for commercial nurseries, fruit farms, and agri-supply chains in Vietnam and Indonesia.',
    highlights: ['Air-pruning perforated sides', 'Stackable, 1-10 gal range', 'BPA-free PP, UV-stable, RCEP Form E'],
    meta: ['MOQ: 500 pcs', 'Use: nurseries / farms / agri supply']
  },
  {
    id: 'prod_gs_orchid_001', sku: 'GS-OP-001', name: 'Transparent Orchid Pots & Seedling Cups', category: 'Orchid pots', sortOrder: 30,
    imageUrl: '/product-bamboo-fiber.jpg',
    secondaryImageUrl: '/product-bamboo-fiber-2.jpg',
    detailUrl: '/transparent-orchid-pot.html',
    badge: 'Orchid growers pick', chip: 'Samples ready to ship', chipIcon: 'fa-check-circle',
    description: 'Clear PET/PS walls make roots and growing media easier to inspect, while side slots improve drainage and airflow. Suitable for orchid growing, propagation, and garden retail.',
    highlights: ['Clear PET/PS, 5.5-15 cm diameter', 'Side drainage slots for air pruning', 'Sleeve-stack, low CBM per unit'],
    meta: ['MOQ: 200 pcs', 'Use: orchid farms / propagation / TH-VN']
  },
  {
    id: 'prod_gs_creative_001', sku: 'GS-CP-001', name: 'Creative & Novelty Shaped Planters', category: 'Creative planters', sortOrder: 40,
    imageUrl: '/product-terracotta.jpg',
    secondaryImageUrl: '/product-terracotta-2.jpg',
    detailUrl: '/creative-shaped-planter.html',
    badge: 'Viral gift item', chip: '2026 new designs', chipIcon: 'fa-star',
    description: 'Animal, expression-face, faux-stone, and dinosaur-egg designs for gift stores, home decor, seasonal displays, and content-commerce assortments.',
    highlights: ['50+ designs: animal / face / dino egg', 'Gift-box packaging, OEM hang tag', 'Resin / MGO, 8-25 cm range'],
    meta: ['MOQ: 50 pcs/design', 'Use: gift shops / home decor / retail display']
  }
];

async function ensureInitialProducts(env) {
  const marker = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind('product_seed_version').first();
  if (marker?.value === '2') return;

  const now = new Date().toISOString();
  const statements = INITIAL_PRODUCTS.map((product) => {
    const spec = {
      note: product.description,
      public: {
        homepageVersion: 2,
        published: true,
        title: product.name,
        imageUrl: product.imageUrl,
        secondaryImageUrl: product.secondaryImageUrl,
        detailUrl: product.detailUrl,
        badge: product.badge,
        chip: product.chip,
        chipIcon: product.chipIcon,
        description: product.description,
        highlights: product.highlights,
        meta: product.meta,
        sortOrder: product.sortOrder
      }
    };
    return env.DB.prepare(`
      INSERT INTO products (id, sku, name, category, spec_json, packaging_json, default_supplier_id, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, '{}', NULL, 'active', ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        sku = excluded.sku,
        name = excluded.name,
        category = excluded.category,
        spec_json = excluded.spec_json,
        status = 'active',
        updated_at = excluded.updated_at
    `).bind(product.id, product.sku, product.name, product.category, JSON.stringify(spec), now, now);
  });
  statements.push(env.DB.prepare(`
    INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('product_seed_version', '2', ?)
  `).bind(now));
  await env.DB.batch(statements);
}

function safeImageUrl(value) {
  const url = String(value || '').trim();
  return /^(https?:\/\/|\/)/i.test(url) ? url : '';
}

export async function onRequestGet(context) {
  const { env } = context;
  if (!env.DB) return json({ ok: false, error: 'Product catalog is unavailable.' }, { status: 503 });
  await ensureInitialProducts(env);

  const { results } = await env.DB.prepare(`
    SELECT id, sku, name, category, spec_json
    FROM products
    WHERE status = 'active'
    ORDER BY created_at DESC
  `).all();

  const items = (results || []).map((row) => {
    const spec = parseJson(row.spec_json, {});
    const publicInfo = spec.public || {};
    if (!publicInfo.published) return null;
    return {
      id: row.id,
      sku: row.sku,
      name: row.name,
      category: row.category || '',
      title: String(publicInfo.title || row.name).trim(),
      description: String(publicInfo.description || spec.note || '').trim(),
      imageUrl: safeImageUrl(publicInfo.imageUrl),
      secondaryImageUrl: safeImageUrl(publicInfo.secondaryImageUrl),
      detailUrl: safeImageUrl(publicInfo.detailUrl),
      badge: String(publicInfo.badge || '').trim(),
      chip: String(publicInfo.chip || '').trim(),
      chipIcon: String(publicInfo.chipIcon || '').trim(),
      highlights: Array.isArray(publicInfo.highlights) ? publicInfo.highlights.map((value) => String(value || '').trim()).filter(Boolean).slice(0, 3) : [],
      meta: Array.isArray(publicInfo.meta) ? publicInfo.meta.map((value) => String(value || '').trim()).filter(Boolean).slice(0, 2) : [],
      sortOrder: Number(publicInfo.sortOrder || 0)
    };
  }).filter(Boolean).sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title));

  return json({ ok: true, items }, { headers: { 'Cache-Control': 'public, max-age=300' } });
}
