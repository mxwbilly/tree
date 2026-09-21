const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const jobs = [
  {
    input: path.join(ROOT, '_candidates', 'candidate-self-watering-natural.jpg'),
    outputBase: path.join(ROOT, 'product-self-watering-ceramic'),
    width: 960,
    height: 720,
    position: { left: 0, top: 62, width: 500, height: 375 }
  },
  {
    input: path.join(ROOT, '_candidates', 'candidate-root-control.jpg'),
    outputBase: path.join(ROOT, 'product-stackable-seedling'),
    width: 960,
    height: 720,
    position: { left: 0, top: 62, width: 500, height: 375 }
  },
  {
    input: path.join(ROOT, '_candidates', 'candidate-orchid.jpg'),
    outputBase: path.join(ROOT, 'product-bamboo-fiber'),
    width: 960,
    height: 720,
    afterExtract: addOrchidMask,
    position: { left: 245, top: 90, width: 240, height: 180 }
  },
  {
    input: path.join(ROOT, '_candidates', 'candidate-creative-natural.jpg'),
    outputBase: path.join(ROOT, 'product-terracotta'),
    width: 960,
    height: 720,
    position: { left: 0, top: 62, width: 500, height: 375 }
  }
];

function addOrchidMask(image) {
  const svg = `
  <svg width="240" height="180" viewBox="0 0 240 180" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <filter id="blur" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur stdDeviation="8" />
      </filter>
      <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#35502d"/>
        <stop offset="55%" stop-color="#5a8f3c"/>
        <stop offset="100%" stop-color="#4b6d31"/>
      </linearGradient>
    </defs>
    <rect x="0" y="0" width="34" height="88" rx="10" fill="url(#bg)" filter="url(#blur)" opacity="0.98" />
  </svg>`;

  return image.composite([{ input: Buffer.from(svg), blend: 'over' }]);
}

async function writeFormats(buffer, outputBase) {
  await sharp(buffer).jpeg({ quality: 88, mozjpeg: true }).toFile(`${outputBase}.jpg`);
  await sharp(buffer).webp({ quality: 88 }).toFile(`${outputBase}.webp`);
  await sharp(buffer).avif({ quality: 60 }).toFile(`${outputBase}.avif`);
}

async function run() {
  for (const job of jobs) {
    if (!fs.existsSync(job.input)) {
      throw new Error(`Missing input image: ${job.input}`);
    }

    let image = sharp(job.input).rotate().extract(job.position);
    if (job.afterExtract) {
      image = job.afterExtract(image);
    }

    const buffer = await image.resize(job.width, job.height, { fit: 'cover' }).toBuffer();

    await writeFormats(buffer, job.outputBase);
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
