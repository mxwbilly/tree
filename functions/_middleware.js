const HOME_LANGUAGE_PATHS = {
  vi: '/vi/',
  th: '/th/',
  id: '/id/'
};

const MAX_PATH_LENGTH = 500;
const MAX_UA_LENGTH = 300;
// 常见搜索引擎爬虫 UA 关键字，命中则标记 is_crawler=1（用于观察哪些平台在抓取站点）。
// 现阶段访问量低，爬虫照常记录；后期流量上来后可改为跳过。
const CRAWLER_PATTERNS = [
  'googlebot', 'bingbot', 'baiduspider', 'yandex', 'duckduckbot',
  'slurp', 'facebookexternalhit', 'twitterbot', 'bytespider', 'ahrefsbot',
  'semrushbot', 'mj12bot', 'dotbot', 'petalbot', 'sogou', '360spider',
  'crawler', 'spider', 'bot/'
];

// 需要记录的页面类型（首页、产品详情页、文章页），避免记录静态资源与内部 API 请求
function shouldTrack(pathname) {
  const p = pathname.toLowerCase();
  if (p === '/' || p === '/index.html') return true;
  if (p.startsWith('/products/')) return true;
  if (p.startsWith('/articles/')) return true;
  // 多语言首页 /vi/ /th/ /id/ 及多语言产品详情页
  if (/^\/(vi|th|id)(\/index\.html|\/)?$/i.test(p)) return true;
  if (/^\/(vi|th|id)\/products\//i.test(p)) return true;
  if (/^\/(vi|th|id)\/articles\//i.test(p)) return true;
  return false;
}

function detectCrawler(userAgent) {
  const ua = String(userAgent || '').toLowerCase();
  return CRAWLER_PATTERNS.some((pattern) => ua.includes(pattern)) ? 1 : 0;
}

function recordVisit(env, request) {
  try {
    const url = new URL(request.url);
    const ip = (request.headers.get('CF-Connecting-IP') || '').trim();
    if (!ip) return;

    const userAgent = (request.headers.get('User-Agent') || '').slice(0, MAX_UA_LENGTH);
    const country = (request.headers.get('CF-IPCountry') || '').trim().slice(0, 8);
    const path = url.pathname.slice(0, MAX_PATH_LENGTH);
    const isCrawler = detectCrawler(userAgent);
    const now = new Date().toISOString();

    return env.DB.prepare(
      'INSERT INTO visits (id, ip, path, country, user_agent, is_crawler, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(`v_${crypto.randomUUID()}`, ip, path, country || null, userAgent || null, isCrawler, now).run();
  } catch (error) {
    console.error('[middleware] record visit failed:', error);
    return Promise.resolve();
  }
}

export async function onRequest(context) {
  const { request, env, waitUntil } = context;
  const url = new URL(request.url);

  if (['GET', 'HEAD'].includes(request.method)) {
    if (shouldTrack(url.pathname) && env.DB) {
      waitUntil(recordVisit(env, request));
    }
  }

  if (!['GET', 'HEAD'].includes(request.method)) return context.next();

  const isHomeRequest = url.pathname === '/' || url.pathname === '/index.html';
  const targetPath = HOME_LANGUAGE_PATHS[url.searchParams.get('lang')];
  if (!isHomeRequest || !targetPath) return context.next();

  url.pathname = targetPath;
  url.searchParams.delete('lang');
  return Response.redirect(url.toString(), 301);
}
