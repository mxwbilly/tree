export function nowIso() {
  return new Date().toISOString();
}

export function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    status: init.status || 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...(init.headers || {})
    }
  });
}

export function csv(text, filename) {
  return new Response(`﻿${text}`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store'
    }
  });
}

export function newId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function hasText(value) {
  return String(value || '').trim().length > 0;
}

export function parseJson(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function toCsvCell(value) {
  const text = String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
}

export async function readBody(request) {
  if (!request.headers.get('Content-Type')?.includes('application/json')) return {};
  return request.json().catch(() => ({}));
}
