function formatResendError(payload, raw, status) {
  const nested = payload?.error;
  if (nested && typeof nested === 'object') return nested.message || nested.error || JSON.stringify(nested);
  if (typeof payload?.error === 'string' && payload.error.trim()) return payload.error.trim();
  if (typeof payload?.message === 'string' && payload.message.trim()) return payload.message.trim();
  if (typeof raw === 'string' && raw.trim()) return raw.trim();
  return `Resend HTTP ${status}`;
}

export async function sendEmailViaResend(env, { to, subject, text, html }) {
  const apiKey = env.RESEND_API_KEY;
  const from = String(env.MAIL_FROM || '').trim();
  const recipient = String(to || '').trim().toLowerCase();
  if (!apiKey) return { ok: false, error: 'RESEND_API_KEY is not configured.' };
  if (!from) return { ok: false, error: 'MAIL_FROM is not configured.' };
  if (!recipient) return { ok: false, error: 'Recipient email is empty.' };
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [recipient], subject, text, ...(html ? { html } : {}) })
    });
    const raw = await response.text();
    let payload = {};
    try { payload = raw ? JSON.parse(raw) : {}; } catch { payload = {}; }
    if (!response.ok) return { ok: false, status: response.status, error: formatResendError(payload, raw, response.status), details: payload };
    return { ok: true, id: payload.id || payload.data?.id || null };
  } catch (error) {
    return { ok: false, error: String(error?.message || error) };
  }
}
