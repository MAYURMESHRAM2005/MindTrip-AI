import { BaseAgent } from './base.agent.js';
import { EXPENSE_AGENT_PROMPT } from '../prompts/agentPrompts.js';
import logger from '../utils/logger.js';

/**
 * Expense Agent: analyzes the user's REAL recorded expenses against the
 * budget allocation and reports overspending categories.
 */
class ExpenseAgent extends BaseAgent {
  constructor() {
    super('expense');
    this.systemPrompt = EXPENSE_AGENT_PROMPT;
  }

  async run({ expenses, allocation, totalBudget, currency, userId }) {
    logger.entry('[AGENT:expense]', 'run', { expenseCount: expenses?.length || 0, totalBudget, currency });
    const started = Date.now();
    const result = await this.think({
      prompt: `Recorded expenses:
${JSON.stringify(expenses, null, 2)}
Budget allocation:
${JSON.stringify(allocation, null, 2)}
Total budget: ${totalBudget} ${currency}
Identify overspending categories and realistic adjustments.`,
      userId,
      action: 'expenseAnalysis',
    });

    if (result.status !== 'success') {
      // Deterministic analysis fallback (normalize expense → allocation keys)
      const CATEGORY_MAP = {
        hotel: 'hotels', food: 'food', transport: 'transport',
        activities: 'activities', tickets: 'tickets', shopping: 'misc', other: 'misc',
      };
      const byCat = {};
      for (const e of expenses) {
        const key = CATEGORY_MAP[e.category] || 'misc';
        byCat[key] = (byCat[key] || 0) + e.amount;
      }
      const overspendingCategories = Object.keys(byCat).filter(
        (c) => byCat[c] > (allocation?.[c] || allocation?.misc || 0)
      );
      result.status = 'degraded';
      result.data = {
        analysis: 'Deterministic expense summary (AI unavailable).',
        overspendingCategories,
        suggestions: overspendingCategories.map((c) => `Review spending on ${c}`),
        projectedOvershoot: Math.max(0, expenses.reduce((s, e) => s + e.amount, 0) - totalBudget),
        isEstimate: true,
      };
    }
    logger.exit('[AGENT:expense]', 'run', { status: result.status, overspendingCategories: result.data?.overspendingCategories?.length || 0, latencyMs: Date.now() - started });
    return result;
  }
}

export default new ExpenseAgent();
