import { BaseAgent } from './base.agent.js';
import { BUDGET_AGENT_PROMPT } from '../prompts/agentPrompts.js';

/**
 * The Budget Agent reasons about the deterministic allocation produced by
 * budget.service - it never performs the arithmetic itself.
 */
class BudgetAgent extends BaseAgent {
  constructor() {
    super('budget');
    this.systemPrompt = BUDGET_AGENT_PROMPT;
  }

  async run({ allocation, totalBudget, currency, travelStyle, providerReport, userId }) {
    const result = await this.think({
      prompt: `Deterministic budget allocation (do not change arithmetic):
${JSON.stringify(allocation, null, 2)}
Total budget: ${totalBudget} ${currency}
Travel style: ${travelStyle}
Provider report:
${JSON.stringify(providerReport, null, 2)}
Produce optimization suggestions and category priorities.`,
      userId,
      action: 'budget',
    });

    if (result.status !== 'success') {
      result.data = {
        suggestions: ['Keep emergency reserve untouched', 'Prefer public transport for local hops', 'Book accommodation early for better rates'],
        categoryPriorities: ['hotels', 'transport', 'food', 'activities'],
        risks: [],
        notes: 'Budget reasoning from deterministic engine (AI unavailable)',
      };
      result.status = 'degraded';
    }
    return result;
  }
}

export default new BudgetAgent();
