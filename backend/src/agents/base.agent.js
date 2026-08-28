import geminiService from '../services/gemini.service.js';
import logger from '../utils/logger.js';

/**
 * Base class for all agents.
 *
 * Every agent.run() returns an AgentResult:
 * {
 *   agent,            // agent name
 *   status,           // 'success' | 'degraded' | 'unavailable'
 *   data,             // structured output
 *   message,          // human readable status
 *   latencyMs,
 *   usedAI: boolean,
 *   source: 'ai' | 'deterministic' | 'provider',
 * }
 */
export class BaseAgent {
  constructor(name) {
    this.name = name;
    this._systemPrompt = '';
  }

  get systemPrompt() {
    return this._systemPrompt;
  }

  set systemPrompt(value) {
    this._systemPrompt = value;
  }

  /** Deterministic fallback when AI is unavailable - override in subclasses. */
  fallback() {
    return null;
  }

  async think({ prompt, userId, action, data }) {
    logger.entry(`[AGENT:${this.name}]`, 'think', { action, promptLength: prompt?.length || 0 });
    const started = Date.now();
    const aiResult = await geminiService.generateJSON({
      prompt,
      system: this.systemPrompt,
      agent: this.name,
      action: action || 'generate',
      userId,
    });
    const latencyMs = Date.now() - started;

    if (aiResult.success) {
      logger.exit(`[AGENT:${this.name}]`, 'think', { status: 'success', latencyMs, usedAI: true });
      return {
        agent: this.name,
        status: 'success',
        data: aiResult.data,
        message: 'Processed by ' + this.name,
        latencyMs,
        usedAI: true,
        source: 'ai',
      };
    }

    const fallback = this.fallback ? this.fallback(data) : null;
    if (fallback) {
      logger.warn(`[AGENT:${this.name}] AI unavailable, using fallback (${latencyMs}ms): ${aiResult.message}`);
      return {
        agent: this.name,
        status: 'degraded',
        data: fallback,
        message: aiResult.message,
        latencyMs,
        usedAI: false,
        source: 'deterministic',
      };
    }

    logger.warn(`[AGENT:${this.name}] AI failed, no fallback (${latencyMs}ms): ${aiResult.message}`);
    return {
      agent: this.name,
      status: 'unavailable',
      data: null,
      message: aiResult.message,
      latencyMs,
      usedAI: false,
      source: 'deterministic',
    };
  }

  report(result) {
    return {
      agent: this.name,
      status: result.status,
      message: result.message,
      latencyMs: result.latencyMs,
      usedAI: result.usedAI,
    };
  }
}

export default BaseAgent;
