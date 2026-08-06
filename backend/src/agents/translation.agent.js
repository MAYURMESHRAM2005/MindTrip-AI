import { BaseAgent } from './base.agent.js';
import { TRANSLATION_AGENT_PROMPT } from '../prompts/agentPrompts.js';

/**
 * Translation Agent: translates text into the target language.
 */
class TranslationAgent extends BaseAgent {
  constructor() {
    super('translation');
    this.systemPrompt = TRANSLATION_AGENT_PROMPT;
  }

  async run({ text, target, userId }) {
    const langName = target === 'hi' ? 'Hindi' : target === 'mr' ? 'Marathi' : 'English';
    const result = await this.think({
      prompt: `Translate the following text into ${langName}. Respond with only the translated text:\n\n${text}`,
      userId,
      action: 'translate',
    });
    return result;
  }
}

export default new TranslationAgent();
