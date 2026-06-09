const fs = require('fs');
const path = require('path');

const root = __dirname;
const dist = path.join(root, 'dist');

const entries = [
  'index.html',
  'admin.html',
  '404.html',
  'privacy-policy.html',
  'bamboo-fiber-planter.html',
  'self-watering-ceramic-planter.html',
  'stackable-nursery-tray.html',
  'terracotta-planter.html',
  'balcony-planter-box.html',
  'hanging-coir-basket.html',
  'src',
  '_headers',
  'robots.txt',
  'sitemap.xml',
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
  'product-balcony-planter-box.avif',
  'product-balcony-planter-box.webp',
  'product-balcony-planter-box.jpg',
  'product-hanging-coir-basket.avif',
  'product-hanging-coir-basket.webp',
  'product-hanging-coir-basket.jpg'
];

function copyEntry(entry) {
  const source = path.join(root, entry);
  const target = path.join(dist, entry);
  if (!fs.existsSync(source)) {
    return;
  }
  fs.cpSync(source, target, { recursive: true });
}

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });
entries.forEach(copyEntry);

console.log(`Static build written to ${dist}`);
