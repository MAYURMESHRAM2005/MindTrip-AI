/**
 * Extract a JSON value from an LLM response that may contain markdown fences,
 * prose, or trailing text. Returns null when no valid JSON can be found.
 */
export function extractJSON(text) {
  if (!text) return null;
  let t = String(text).trim();

  // Strip code fences
  const fenceMatch = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) t = fenceMatch[1].trim();

  const candidates = [];
  const firstBrace = t.indexOf('{');
  const firstBracket = t.indexOf('[');
  let start = -1;
  if (firstBrace === -1 && firstBracket === -1) return null;
  if (firstBrace === -1) start = firstBracket;
  else if (firstBracket === -1) start = firstBrace;
  else start = Math.min(firstBrace, firstBracket);

  const lastBrace = t.lastIndexOf('}');
  const lastBracket = t.lastIndexOf(']');
  let end = -1;
  if (lastBrace === -1 && lastBracket === -1) return null;
  if (lastBrace === -1) end = lastBracket;
  else if (lastBracket === -1) end = lastBrace;
  else end = Math.max(lastBrace, lastBracket);

  if (start !== -1 && end !== -1 && end > start) {
    candidates.push(t.slice(start, end + 1));
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      /* try next */
    }
  }
  return null;
}

export default extractJSON;
