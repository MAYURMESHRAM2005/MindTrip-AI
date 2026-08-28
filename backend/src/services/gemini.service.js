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

function isRateLimited(err) {
  const msg = String(err?.message || err || '');
  return /429|quota|resource_exhausted|rate limit/i.test(msg);
}

/**
 * Retry a Gemini call with exponential backoff when the provider rate-limits
 * us (Google's free tier allows ~20 requests/min for gemini-3.5-flash).
 */
async function withRetry(fn, retries = 2) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (isRateLimited(err) && attempt < retries) {
        await sleep(1500 * (attempt + 1));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
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

export default { generateText, generateJSON, analyzeImage, geminiConfigured };
