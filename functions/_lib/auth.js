const TOKEN_EXPIRES_SECONDS = 12 * 60 * 60;

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
  const signature = await hmacSign(unsigned, env.JWT_SECRET || 'change-this-secret');
  return `${unsigned}.${signature}`;
}

export async function verifyToken(token, env) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new Error('Invalid token.');
  const [header, body, signature] = parts;
  const expected = await hmacSign(`${header}.${body}`, env.JWT_SECRET || 'change-this-secret');
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

export async function requireAuth(request, env, roles = []) {
  const token = parseBearerToken(request);
  if (!token) {
    return { response: jsonUnauthorized('Missing authorization token.') };
  }
  try {
    const auth = await verifyToken(token, env);
    if (roles.length && !roles.includes(auth.role)) {
      return { response: jsonForbidden() };
    }
    return { auth };
  } catch {
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

export async function checkRateLimit(env, request, bucket, limit, windowSeconds) {
  if (!env.RATE_LIMIT) return null;
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
  return null;
}
