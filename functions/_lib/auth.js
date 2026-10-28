const TOKEN_EXPIRES_SECONDS = 12 * 60 * 60;
const SESSION_COOKIE_NAME = 'greensmart_admin_session';
const MIN_JWT_SECRET_LENGTH = 32;
const INSECURE_JWT_SECRETS = new Set([
  'change-this-secret',
  'change-this-secret-in-production',
  'change-this-secret-before-production'
]);

class SecurityConfigurationError extends Error {}

function getJwtSecret(env) {
  const secret = String(env?.JWT_SECRET || '').trim();
  if (secret.length < MIN_JWT_SECRET_LENGTH || INSECURE_JWT_SECRETS.has(secret)) {
    throw new SecurityConfigurationError('JWT_SECRET is missing or insecure.');
  }
  return secret;
}

function base64UrlEncode(bytes) {
  const text = String.fromCharCode(...new Uint8Array(bytes));
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlEncodeText(text) {
  return base64UrlEncode(new TextEncoder().encode(text));
}

function base64UrlDecodeText(text) {
  const normalized = text.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

// --- Password hashing (PBKDF2-SHA256) ----------------------------------
// 无盐 SHA-256 属快速哈希，一旦数据库泄露可被彩虹表/字典爆破。改用
// PBKDF2（Web Crypto 原生支持，无需引入依赖），存储格式：
//   pbkdf2-sha256$<iterations>$<salt base64url>$<hash base64url>
// Cloudflare Workers 的 PBKDF2 实现上限为 100000 次迭代（超过会抛
// NotSupportedError），这里取上限值以最大化安全性。
const PBKDF2_ITERATIONS = 100000;
const PBKDF2_SALT_BYTES = 16;

function base64UrlToBytes(text) {
  const normalized = text.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function pbkdf2Derive(password, salt, iterations) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    key,
    256
  );
  return new Uint8Array(bits);
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(PBKDF2_SALT_BYTES));
  const hash = await pbkdf2Derive(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2-sha256$${PBKDF2_ITERATIONS}$${base64UrlEncode(salt)}$${base64UrlEncode(hash)}`;
}

export async function verifyPassword(password, stored) {
  const value = String(stored || '');
  if (value.startsWith('pbkdf2-sha256$')) {
    const parts = value.split('$');
    if (parts.length !== 4) return { ok: false };
    const iterations = Number(parts[1]);
    if (!Number.isInteger(iterations) || iterations <= 0) return { ok: false };
    const salt = base64UrlToBytes(parts[2]);
    const expected = base64UrlToBytes(parts[3]);
    const actual = await pbkdf2Derive(password, salt, iterations);
    if (actual.length !== expected.length) return { ok: false };
    let match = true;
    for (let i = 0; i < actual.length; i += 1) {
      if (actual[i] !== expected[i]) { match = false; break; }
    }
    return { ok: match };
  }
  // 旧无盐 SHA-256 兼容：校验通过则标记需要升级，登录成功后平滑迁移。
  if (value === await sha256Hex(password)) return { ok: true, needsRehash: true };
  return { ok: false };
}

async function hmacSign(input, secret) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return base64UrlEncode(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(input)));
}

export async function createToken(payload, env) {
  const header = base64UrlEncodeText(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64UrlEncodeText(JSON.stringify({
    ...payload,
    exp: Math.floor(Date.now() / 1000) + TOKEN_EXPIRES_SECONDS
  }));
  const unsigned = `${header}.${body}`;
  const signature = await hmacSign(unsigned, getJwtSecret(env));
  return `${unsigned}.${signature}`;
}

export async function verifyToken(token, env) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new Error('Invalid token.');
  const [header, body, signature] = parts;
  const expected = await hmacSign(`${header}.${body}`, getJwtSecret(env));
  if (signature !== expected) throw new Error('Invalid signature.');
  const payload = JSON.parse(base64UrlDecodeText(body));
  if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error('Expired token.');
  }
  return payload;
}

function parseBearerToken(request) {
  const header = request.headers.get('Authorization') || '';
  const [scheme, token] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' ? token : '';
}

function parseCookieToken(request) {
  const cookie = request.headers.get('Cookie') || '';
  const prefix = `${SESSION_COOKIE_NAME}=`;
  const part = cookie.split(';').map((item) => item.trim()).find((item) => item.startsWith(prefix));
  return part ? decodeURIComponent(part.slice(prefix.length)) : '';
}

export function getRequestToken(request) {
  return parseBearerToken(request) || parseCookieToken(request);
}

export function sessionCookie(request, token) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=${TOKEN_EXPIRES_SECONDS}${secure}`;
}

export function expiredSessionCookie(request) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${SESSION_COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/api; Max-Age=0${secure}`;
}

export async function requireAuth(request, env, roles = []) {
  // 本地开发开关：仅当 LOCAL_NO_AUTH 环境变量存在时跳过鉴权。
  // 该变量只配置在 .dev.vars（wrangler pages dev 本地运行），生产环境不会加载，
  // 因此生产鉴权不受影响。
  if (String(env?.LOCAL_NO_AUTH || '').trim() === '1') {
    return { auth: { sub: 'local-dev', role: 'admin', email: 'local-dev@example.com', name: 'Local Dev' } };
  }

  const token = getRequestToken(request);
  if (!token) {
    return { response: jsonUnauthorized('Missing authorization token.') };
  }
  try {
    const auth = await verifyToken(token, env);
    if (roles.length && !roles.includes(auth.role)) {
      return { response: jsonForbidden() };
    }
    return { auth };
  } catch (error) {
    if (error instanceof SecurityConfigurationError) {
      return { response: jsonServerConfigurationError() };
    }
    return { response: jsonUnauthorized('Invalid or expired token.') };
  }
}

function jsonUnauthorized(message) {
  return new Response(JSON.stringify({ ok: false, error: message }), {
    status: 401,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

function jsonForbidden() {
  return new Response(JSON.stringify({ ok: false, error: 'Forbidden.' }), {
    status: 403,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

function jsonServerConfigurationError() {
  return new Response(JSON.stringify({ ok: false, error: 'Server security configuration is incomplete.' }), {
    status: 500,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

export async function checkRateLimit(env, request, bucket, limit, windowSeconds) {
  if (!env.RATE_LIMIT) return jsonRateLimitUnavailable();
  try {
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const slot = Math.floor(Date.now() / (windowSeconds * 1000));
    const key = `${bucket}:${ip}:${slot}`;
    const count = Number(await env.RATE_LIMIT.get(key) || '0') + 1;
    await env.RATE_LIMIT.put(key, String(count), { expirationTtl: windowSeconds + 60 });
    if (count > limit) {
      return new Response(JSON.stringify({ ok: false, error: `Too many ${bucket} requests. Please retry later.` }), {
        status: 429,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
      });
    }
  } catch (error) {
    console.error(`[rate-limit] ${bucket} failed:`, error);
    return jsonRateLimitUnavailable();
  }
  return null;
}

function jsonRateLimitUnavailable() {
  return new Response(JSON.stringify({ ok: false, error: 'Request protection is temporarily unavailable.' }), {
    status: 503,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}
