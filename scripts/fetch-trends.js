/**
 * fetch-trends.js — 刷新 Google Trends 数据到 trend-data.json
 *
 * 使用方法:
 *   node scripts/fetch-trends.js
 *
 * Google Trends 会封锁来自云服务器 IP 的直连请求（ECONNRESET/TLS 错误）。
 * 用居家代理 IP 运行可解决此问题:
 *   TRENDS_PROXY=http://user:pass@host:port node scripts/fetch-trends.js
 *
 * 脚本会保留上次成功采集的数据（stale fallback），避免全量失败时数据变空。
 */

const fs = require('fs');
const path = require('path');

const OUTPUT = path.join(__dirname, '..', 'trend-data.json');

const COUNTRIES = ['VN', 'TH', 'ID', 'MY', 'SG', 'PH'];

const PRODUCTS = {
  bamboo_fiber_planter: 'bamboo planter',
  self_watering_planter: 'self watering pot',
  nursery_tray: 'seedling tray',
  terracotta_pot: 'terracotta pot',
  balcony_planter_box: 'balcony planter',
  hanging_basket: 'hanging basket',
};

const DELAY_BETWEEN_REQUESTS_MS = 4000;
const MAX_RETRIES = 3;
const ONE_YEAR_AGO = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(fn, retries = MAX_RETRIES) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === retries) throw err;
      const wait = DELAY_BETWEEN_REQUESTS_MS * Math.pow(2, attempt);
      console.warn(`  retry ${attempt + 1}/${retries} in ${(wait / 1000).toFixed(0)}s — ${err.message}`);
      await sleep(wait);
    }
  }
}

async function fetchTrend(googleTrends, keyword, geo) {
  const raw = await fetchWithRetry(() =>
    googleTrends.interestOverTime({
      keyword,
      geo,
      startTime: ONE_YEAR_AGO,
    })
  );

  const parsed = JSON.parse(raw);
  const timeline = parsed?.default?.timelineData || [];
  const values = timeline.map((d) => (Array.isArray(d.value) ? d.value[0] : 0));
  const averageValue = values.length
    ? Math.round(values.reduce((sum, v) => sum + v, 0) / values.length)
    : 0;

  return { values, averageValue };
}

function loadExisting() {
  if (!fs.existsSync(OUTPUT)) return { products: {} };
  try {
    return JSON.parse(fs.readFileSync(OUTPUT, 'utf8'));
  } catch {
    return { products: {} };
  }
}

async function main() {
  let googleTrends;
  try {
    googleTrends = require('google-trends-api');
  } catch {
    console.error('google-trends-api 未安装，请先运行: npm install');
    process.exit(1);
  }

  if (process.env.TRENDS_PROXY) {
    process.env.https_proxy = process.env.TRENDS_PROXY;
    process.env.http_proxy = process.env.TRENDS_PROXY;
    console.log(`使用代理: ${process.env.TRENDS_PROXY}`);
  }

  const existing = loadExisting();

  const output = {
    generatedAt: new Date().toISOString(),
    window: 'last 12 months',
    countries: COUNTRIES,
    products: {},
  };

  let successCount = 0;
  let failCount = 0;

  for (const [key, keyword] of Object.entries(PRODUCTS)) {
    console.log(`\n[${keyword}]`);
    output.products[key] = { keyword, byCountry: {} };

    for (const geo of COUNTRIES) {
      await sleep(DELAY_BETWEEN_REQUESTS_MS);

      try {
        const data = await fetchTrend(googleTrends, keyword, geo);
        output.products[key].byCountry[geo] = data;
        console.log(`  ✓ ${geo}: avg ${data.averageValue}`);
        successCount++;
      } catch (err) {
        failCount++;
        const prev = existing.products?.[key]?.byCountry?.[geo];
        if (prev && !prev.error) {
          output.products[key].byCountry[geo] = { ...prev, _stale: true, _staleReason: err.message };
          console.warn(`  ⚠ ${geo}: 失败（保留上次数据）— ${err.message}`);
        } else {
          output.products[key].byCountry[geo] = { error: err.message };
          console.warn(`  ✗ ${geo}: 失败 — ${err.message}`);
        }
      }
    }
  }

  fs.writeFileSync(OUTPUT, JSON.stringify(output, null, 2), 'utf8');

  console.log(`\n✅ 完成: ${successCount} 成功 / ${failCount} 失败`);
  console.log(`📄 已写入: ${OUTPUT}`);

  if (failCount > 0) {
    console.log('\n💡 提示: Google Trends 封锁直连云 IP。');
    console.log('   使用居家宽带代理重试:');
    console.log('   TRENDS_PROXY=http://user:pass@host:port node scripts/fetch-trends.js');
  }
}

main().catch((err) => {
  console.error('脚本执行失败:', err);
  process.exit(1);
});
