import { GoogleGenerativeAI } from '@google/generative-ai';
import env from '../config/env.js';
import extractJSON from '../utils/jsonExtract.js';
import AiUsageLog from '../models/AiUsageLog.js';
import logger from '../utils/logger.js';

let client = null;
if (env.GEMINI_API_KEY) {
  try {
    client = new GoogleGenerativeAI(env.GEMINI_API_KEY);
  } catch {
    client = null;
  }
}

export const geminiConfigured = Boolean(client);

function model() {
  return client.getGenerativeModel({ model: env.GEMINI_MODEL });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ── Daily quota tracking ──────────────────────────────────────────────
// Google's free tier: 20 requests/day/model. Track in memory so we don't
// waste retries when the daily cap is already hit.
let dailyRequestCount = 0;
let dailyResetDate = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
let dailyQuotaExhausted = false;

function trackDailyUsage() {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== dailyResetDate) {
    dailyResetDate = today;
    dailyRequestCount = 0;
    dailyQuotaExhausted = false;
  }
  dailyRequestCount++;
}

function isDailyQuotaExhausted() {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== dailyResetDate) {
    dailyResetDate = today;
    dailyRequestCount = 0;
    dailyQuotaExhausted = false;
  }
  return dailyQuotaExhausted;
}

function markDailyQuotaExhausted() {
  dailyQuotaExhausted = true;
  logger.warn(`[GEMINI] Daily quota exhausted (${dailyRequestCount} requests today). No more retries today.`);
}

function isRateLimited(err) {
  const msg = String(err?.message || err || '');
  return /429|resource_exhausted|rate limit/i.test(msg);
}

function isDailyQuotaError(err) {
  const msg = String(err?.message || err || '');
  return /quota|GenerateRequestsPerDayPerProjectPerModel/i.test(msg);
}

/**
 * Parse the retry delay from Google's error response.
 * Google includes a retryDelay in the error details, e.g. "27s".
 */
function parseRetryDelay(err) {
  const msg = String(err?.message || err || '');
  // Look for "retryDelay":"27s" or "Please retry in 27.09s"
  const retryMatch = msg.match(/retryDelay["\s:]+(\d+(?:\.\d+)?s)/i) || msg.match(/retry in (\d+(?:\.\d+)?s)/i);
  if (retryMatch) {
    const seconds = parseFloat(retryMatch[1]);
    if (!Number.isNaN(seconds) && seconds > 0) return Math.ceil(seconds * 1000);
  }
  return null;
}

/**
 * Retry a Gemini call with exponential backoff.
 * - For daily quota errors: no retry (the cap is hit for the day)
 * - For rate-limit errors: retry with Google's suggested delay, up to 3 attempts
 */
async function withRetry(fn, retries = 3) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      trackDailyUsage();
      return await fn();
    } catch (err) {
      lastErr = err;

      // Daily quota — no point retrying, the cap is hit for today
      if (isDailyQuotaError(err)) {
        markDailyQuotaExhausted();
        throw err;
      }

      // Rate limited — retry with Google's suggested delay
      if (isRateLimited(err) && attempt < retries) {
        const suggestedDelay = parseRetryDelay(err);
        const delay = suggestedDelay || (3000 * Math.pow(2, attempt)); // 3s, 6s, 12s
        logger.info(`[GEMINI] Rate limited (attempt ${attempt + 1}/${retries}), retrying in ${Math.round(delay / 1000)}s...`);
        await sleep(delay);
        continue;
      }

      throw err;
    }
  }
  throw lastErr;
}

/**
 * Get current daily usage stats for monitoring.
 */
export function getDailyUsage() {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== dailyResetDate) {
    dailyResetDate = today;
    dailyRequestCount = 0;
    dailyQuotaExhausted = false;
  }
  return {
    date: dailyResetDate,
    requestsToday: dailyRequestCount,
    quotaExhausted: dailyQuotaExhausted,
    limit: 20, // Gemini free tier daily limit
  };
}

async function recordUsage({ userId, agent, action, status, error, latencyMs }) {
  try {
    await AiUsageLog.create({
      user: userId || null,
      agent: agent || '',
      model: env.GEMINI_MODEL,
      action,
      status,
      error: error || '',
      latencyMs,
    });
  } catch {
    /* non-fatal */
  }
}

/**
 * Generate text from Gemini. Never throws - returns a normalized result so
 * callers can degrade gracefully when the AI is not configured.
 */
export async function generateText({ prompt, system, agent = 'generic', action = 'generate', userId = null }) {
  logger.entry('[GEMINI]', 'generateText', { agent, action, promptLength: prompt?.length || 0, hasSystem: Boolean(system) });
  if (!client) {
    await recordUsage({ userId, agent, action, status: 'unavailable', error: 'GEMINI_API_KEY not configured', latencyMs: 0 });
    logger.warn('[GEMINI] Not configured — GEMINI_API_KEY missing');
    return {
      success: false,
      configured: false,
      text: null,
      message: 'Gemini AI is not configured. Add GEMINI_API_KEY to backend/.env',
    };
  }
  // Check daily quota before making the request
  if (isDailyQuotaExhausted()) {
    const usage = getDailyUsage();
    await recordUsage({ userId, agent, action, status: 'quota_exhausted', error: 'Daily quota exhausted', latencyMs: 0 });
    logger.warn(`[GEMINI] Daily quota exhausted (${usage.requestsToday}/${usage.limit}). Skipping request.`);
    return {
      success: false,
      configured: true,
      quotaExhausted: true,
      text: null,
      message: `Gemini daily quota exhausted (${usage.requestsToday}/${usage.limit} requests today). Try again tomorrow or upgrade your plan at https://ai.google.dev/pricing`,
    };
  }
  const started = Date.now();
  try {
    const m = model();
    const parts = [];
    if (system) parts.push(system);
    parts.push(prompt);
    const result = await withRetry(() => m.generateContent(parts));
    const text = result.response?.text?.() || '';
    const latencyMs = Date.now() - started;
    await recordUsage({ userId, agent, action, status: 'success', latencyMs });
    logger.exit('[GEMINI]', 'generateText', { status: 'success', latencyMs, agent, action, textLength: text.length });
    return { success: true, configured: true, text, message: 'AI response generated' };
  } catch (err) {
    const latencyMs = Date.now() - started;
    await recordUsage({ userId, agent, action, status: 'error', error: err.message, latencyMs });
    logger.error(`[GEMINI] generateText failed (${latencyMs}ms): ${err.message}`);
    return {
      success: false,
      configured: true,
      text: null,
      message: `Gemini request failed: ${err.message}`,
    };
  }
}

/**
 * Generate structured JSON from Gemini with robust parsing.
 */
export async function generateJSON({ prompt, system, agent = 'generic', action = 'generate', userId = null }) {
  logger.entry('[GEMINI]', 'generateJSON', { agent, action });
  const res = await generateText({ prompt, system, agent, action, userId });
  if (!res.success) {
    logger.warn(`[GEMINI] generateJSON failed: ${res.message}`);
    return { ...res, data: null };
  }
  const data = extractJSON(res.text);
  if (data === null) {
    logger.warn(`[GEMINI] generateJSON: AI did not return valid JSON (text length: ${res.text?.length || 0})`);
    return { ...res, success: false, data: null, message: 'AI did not return valid JSON' };
  }
  logger.info(`[GEMINI] generateJSON success — extracted ${typeof data === 'object' ? Object.keys(data).length : 'non-object'} keys`);
  return { ...res, data };
}

/**
 * Multimodal image understanding (used by Image Search).
 */
export async function analyzeImage({ imageBase64, mimeType, prompt, userId = null }) {
  if (!client) {
    return {
      success: false,
      configured: false,
      data: null,
      message: 'Gemini AI is not configured. Add GEMINI_API_KEY to backend/.env',
    };
  }
  const started = Date.now();
  try {
    const m = model();
    const result = await withRetry(() =>
      m.generateContent([
        prompt,
        {
          inlineData: {
            mimeType,
            data: imageBase64,
          },
        },
      ])
    );
    const text = result.response?.text?.() || '';
    await recordUsage({ userId, agent: 'imageSearch', action: 'image', status: 'success', latencyMs: Date.now() - started });
    return { success: true, configured: true, text, data: extractJSON(text) };
  } catch (err) {
    await recordUsage({ userId, agent: 'imageSearch', action: 'image', status: 'error', error: err.message, latencyMs: Date.now() - started });
    return { success: false, configured: true, data: null, message: `Gemini image analysis failed: ${err.message}` };
  }
}

export default { generateText, generateJSON, analyzeImage, geminiConfigured, getDailyUsage };
