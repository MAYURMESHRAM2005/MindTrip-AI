/**
 * Local Guide Agent: cultural and practical tips using general knowledge.
 * Now purely deterministic — no Gemini calls. Never invents specific prices,
 * hours or availability.
 */
import logger from '../utils/logger.js';

class LocalGuideAgent {
  constructor() {
    this.name = 'localGuide';
    this._systemPrompt = '';
  }

  get systemPrompt() { return this._systemPrompt; }
  set systemPrompt(v) { this._systemPrompt = v; }

  async run({ destination, travelStyle }) {
    logger.entry('[AGENT:localGuide]', 'run', { destination, travelStyle });
    const tips = [
      'Respect local customs and dress codes at religious sites',
      'Carry small change for local markets and tips',
      'Try local street food from busy stalls — high turnover means fresh food',
      'Ask locals for recommendations — they know the hidden gems',
    ];

    const etiquette = [
      'Remove shoes before entering temples, mosques and some homes',
      'Ask permission before photographing people',
      'Use your right hand for giving and receiving in many cultures',
    ];

    const hiddenGems = [
      'Visit popular attractions early morning or late afternoon to avoid crowds',
      'Walk through residential areas for authentic local experiences',
      'Check for free walking tours led by local volunteers',
    ];

    const languagePhrases = [
      'Hello / Greetings',
      'Thank you',
      'How much does this cost?',
      'Where is the nearest hospital?',
      'Can you help me?',
    ];

    let paymentNotes = 'Carry a mix of cash and cards. ATMs are widely available in cities.';
    if (travelStyle === 'budget' || travelStyle === 'backpacker') {
      paymentNotes = 'Carry mostly cash for local markets and small vendors. Use cards for hotels and restaurants.';
    }
    if (travelStyle === 'luxury') {
      paymentNotes = 'Cards are accepted at most upscale establishments. Keep some cash for tips and small purchases.';
    }

    logger.exit('[AGENT:localGuide]', 'run', { status: 'success', tipsCount: tips.length, etiquetteCount: etiquette.length });
    return {
      agent: this.name,
      status: 'success',
      data: {
        localTips: tips,
        etiquette,
        hiddenGems,
        languagePhrases,
        paymentNotes,
      },
      message: 'Local guide tips generated from general knowledge',
      latencyMs: 0,
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

export default new LocalGuideAgent();
