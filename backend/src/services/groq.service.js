import axios from 'axios';
import env from '../config/env.js';
import extractJSON from '../utils/jsonExtract.js';
import AiUsageLog from '../models/AiUsageLog.js';
import logger from '../utils/logger.js';

const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';

const groqConfigured = Boolean(env.GROQ_API_KEY);

/**
 * Generate text from Groq. Returns a normalized result matching
 * the gemini.service.js interface so callers can use either provider
 * interchangeably.
 */
export async function generateText({ prompt, system, agent = 'generic', action = 'generate', userId = null }) {
  logger.entry('[GROQ]', 'generateText', { agent, action, promptLength: prompt?.length || 0, hasSystem: Boolean(system) });

  if (!groqConfigured) {
    await recordUsage({ userId, agent, action, status: 'unavailable', error: 'GROQ_API_KEY not configured', latencyMs: 0 });
    logger.warn('[GROQ] Not configured — GROQ_API_KEY missing');
    return {
      success: false,
      configured: false,
      text: null,
      message: 'Groq AI is not configured. Add GROQ_API_KEY to backend/.env',
    };
  }

  const started = Date.now();

  try {
    const messages = [];
    if (system) {
      messages.push({ role: 'system', content: system });
    }
    messages.push({ role: 'user', content: prompt });

    const response = await axios.post(
      `${GROQ_BASE_URL}/chat/completions`,
      {
        model: env.GROQ_MODEL,
        messages,
        temperature: 0.3,
        max_tokens: 8192,
        response_format: { type: 'json_object' },
      },
      {
        headers: {
          'Authorization': `Bearer ${env.GROQ_API_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: env.GROQ_TIMEOUT_MS || 60000,
      }
    );

    const text = response.data?.choices?.[0]?.message?.content || '';
    const latencyMs = Date.now() - started;

    await recordUsage({ userId, agent, action, status: 'success', latencyMs });
    logger.exit('[GROQ]', 'generateText', { status: 'success', latencyMs, agent, action, textLength: text.length });
    return { success: true, configured: true, text, message: 'AI response generated' };
  } catch (err) {
    const latencyMs = Date.now() - started;
    const errorMsg = err.response?.data?.error?.message || err.message || 'Unknown error';
    const statusCode = err.response?.status;

    await recordUsage({ userId, agent, action, status: 'error', error: errorMsg, latencyMs });
    logger.error(`[GROQ] generateText failed (${latencyMs}ms): ${errorMsg}${statusCode ? ` (HTTP ${statusCode})` : ''}`);
    return {
      success: false,
      configured: true,
      text: null,
      message: `Groq request failed: ${errorMsg}`,
    };
  }
}

/**
 * Generate structured JSON from Groq with robust parsing.
 */
export async function generateJSON({ prompt, system, agent = 'generic', action = 'generate', userId = null }) {
  logger.entry('[GROQ]', 'generateJSON', { agent, action });
  const res = await generateText({ prompt, system, agent, action, userId });
  if (!res.success) {
    logger.warn(`[GROQ] generateJSON failed: ${res.message}`);
    return { ...res, data: null };
  }
  const data = extractJSON(res.text);
  if (data === null) {
    logger.warn(`[GROQ] generateJSON: AI did not return valid JSON (text length: ${res.text?.length || 0})`);
    return { ...res, success: false, data: null, message: 'AI did not return valid JSON' };
  }
  logger.info(`[GROQ] generateJSON success — extracted ${typeof data === 'object' ? Object.keys(data).length : 'non-object'} keys`);
  return { ...res, data };
}

async function recordUsage({ userId, agent, action, status, error, latencyMs }) {
  try {
    await AiUsageLog.create({
      user: userId || null,
      agent: agent || '',
      model: env.GROQ_MODEL,
      action,
      status,
      error: error || '',
      latencyMs,
    });
  } catch {
    /* non-fatal */
  }
}

export { groqConfigured };

export default { generateText, generateJSON, groqConfigured };
