import { json, nowIso } from '../../_lib/http.js';

function base64ToBytes(value) {
  const normalized = String(value || '').replace(/^whsec_/, '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function verifySignature(request, rawBody, secret) {
  const webhookId = request.headers.get('svix-id');
  const timestamp = request.headers.get('svix-timestamp');
  const signatures = String(request.headers.get('svix-signature') || '').split(' ').map((item) => item.trim());
  if (!webhookId || !timestamp || signatures.length === 0 || !secret) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp)) > 5 * 60) return false;

  const key = await crypto.subtle.importKey(
    'raw',
    base64ToBytes(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  );
  const signed = new TextEncoder().encode(`${webhookId}.${timestamp}.${rawBody}`);
  for (const item of signatures) {
    const [, value] = item.split(',', 2);
    if (!value) continue;
    try {
      if (await crypto.subtle.verify('HMAC', key, base64ToBytes(value), signed)) return true;
    } catch {
      // Try every signature value sent by Svix during key rotation.
    }
  }
  return false;
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.DB || !env.RESEND_WEBHOOK_SECRET) {
    return json({ ok: false, error: 'Webhook is not configured.' }, { status: 503 });
  }

  const rawBody = await request.text();
  if (!(await verifySignature(request, rawBody, env.RESEND_WEBHOOK_SECRET))) {
    return json({ ok: false, error: 'Invalid webhook signature.' }, { status: 401 });
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return json({ ok: false, error: 'Invalid webhook payload.' }, { status: 400 });
  }

  const webhookId = request.headers.get('svix-id');
  const emailId = String(event?.data?.email_id || '').trim();
  const eventType = String(event?.type || '').trim();
  if (!webhookId || !emailId || !eventType.startsWith('email.')) {
    return json({ ok: false, error: 'Unsupported webhook event.' }, { status: 400 });
  }

  await env.DB.prepare(`
    INSERT OR IGNORE INTO activity_logs (id, type, target_id, payload_json, created_at)
    VALUES (?, 'mail.event', ?, ?, ?)
  `).bind(
    webhookId,
    emailId,
    JSON.stringify({
      emailId,
      eventType,
      createdAt: event.created_at || nowIso(),
      recipient: Array.isArray(event?.data?.to) ? event.data.to.join(', ') : '',
      subject: String(event?.data?.subject || '').slice(0, 300)
    }),
    nowIso()
  ).run();

  return json({ ok: true });
}
