import { handleProductDetailRequest } from '../_lib/product-detail-renderer.js';

export async function onRequestGet(context) {
  const { env, params } = context;
  return handleProductDetailRequest(env, params.slug, 'en');
}
