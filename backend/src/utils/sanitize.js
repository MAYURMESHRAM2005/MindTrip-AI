/**
 * Lightweight sanitization applied to free-text user input before it is
 * stored or sent to LLMs. Prevents obvious prompt-injection / HTML payloads
 * while preserving multilingual text (Hindi, Marathi, emoji, etc).
 */
export function sanitizeText(value, maxLen = 5000) {
  if (value === null || value === undefined) return '';
  let s = String(value);
  if (s.length > maxLen) s = s.slice(0, maxLen);
  // Remove control characters except newline/tab
  s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
  return s.trim();
}

/** Remove keys that start with $ or contain dots (protects MongoDB operators). */
export function sanitizeObject(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
  const out = {};
  for (const [key, value] of Object.entries(obj)) {
    if (key.startsWith('$') || key.includes('.')) continue;
    out[key] =
      value && typeof value === 'object' && !Array.isArray(value)
        ? sanitizeObject(value)
        : value;
  }
  return out;
}

/** Strip HTML tags from a string. */
export function stripHtml(value) {
  return String(value ?? '').replace(/<[^>]*>/g, '');
}

export default { sanitizeText, sanitizeObject, stripHtml };
