import { handleProductDetailRequest } from '../../_lib/product-detail-renderer.js';

const SUPPORTED_LANGS = new Set(['vi', 'th', 'id']);

export async function onRequestGet(context) {
  const { env, params } = context;
  const lang = String(params.lang || '').trim().toLowerCase();
  if (!SUPPORTED_LANGS.has(lang)) {
    // 未识别的语言前缀，回退到英文详情页。
    return handleProductDetailRequest(env, params.slug, 'en');
  }
  return handleProductDetailRequest(env, params.slug, lang);
}
