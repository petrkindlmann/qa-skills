const secretName = /^(?:access[_-]?token|auth(?:orization)?|api[_-]?key|key|token|password|passwd|secret|session|cookie|signature|sig|code)$/i;
export function redactUrl(value) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return value;
    if (url.username || url.password) { url.username = '[REDACTED]'; url.password = ''; }
    // Queries and fragments may contain credentials under arbitrary parameter names.
    if (url.search) url.search = '?redacted';
    if (url.hash) url.hash = '#redacted';
    return url.href;
  } catch { return value; }
}

export function redactText(value, secrets = []) {
  let result = String(value ?? '');
  for (const secret of secrets.filter(item => typeof item === 'string' && item.length >= 4).sort((a, b) => b.length - a.length)) {
    result = result.split(secret).join('[REDACTED]');
  }
  result = result.replace(/https?:\/\/[^\s<>"'`]+/gi, url => redactUrl(url));
  result = result.replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1[REDACTED]');
  result = result.replace(/\b(authorization|password|passwd|secret|api[_-]?key|access[_-]?token|session|cookie)\s*[:=]\s*("[^"\n]*"|'[^'\n]*'|[^\s,;]+)/gi, '$1=[REDACTED]');
  return result;
}

export function secretValues(env = process.env, urls = []) {
  const values = [];
  // A name is a weak signal on its own: TOKENIZERS_PARALLELISM=false or TOKEN_LIMIT=100000
  // would otherwise blank every "false" or "100000" in the evidence.
  const trivial = /^(?:true|false|null|undefined|\d+)$/i;
  for (const [key, value] of Object.entries(env)) {
    if (/(?:token|secret|password|passwd|api_?key|private_?key|credential)/i.test(key) && value && value.length >= 8 && !trivial.test(value)) values.push(value);
  }
  for (const text of urls) {
    try { const url = new URL(text); for (const value of url.searchParams.values()) if (value) values.push(value); } catch {}
  }
  return [...new Set(values)];
}

export function sanitized(value, secrets = []) {
  if (Array.isArray(value)) return value.map(item => sanitized(item, secrets));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) =>
    [key, secretName.test(key) ? '[REDACTED]' : sanitized(item, secrets)]));
  return typeof value === 'string' ? redactText(value, secrets) : value;
}

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}
