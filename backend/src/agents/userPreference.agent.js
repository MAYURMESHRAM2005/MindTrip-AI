/**
 * User Preference Agent: normalizes the user's profile + request into one
 * preference object. Now purely deterministic — no Gemini calls.
 */
import logger from '../utils/logger.js';

class UserPreferenceAgent {
  constructor() {
    this.name = 'userPreference';
    this._systemPrompt = '';
  }

  get systemPrompt() { return this._systemPrompt; }
  set systemPrompt(v) { this._systemPrompt = v; }

  async run({ user, request }) {
    logger.entry('[AGENT:userPreference]', 'run', { userId: user?._id, travelStyle: request.travelStyle });
    // Deterministic merge — no AI needed
    const prefs = {
      travelStyle: request.travelStyle || user?.travelStyle || 'standard',
      activityLevel: request.activityLevel || 'moderate',
      interests: request.interests?.length ? request.interests : user?.interests || [],
      foodPreference: request.foodPreference || user?.foodPreference || '',
      hotelPreference: request.hotelPreference || user?.hotelPreference || '',
      transportPreference: request.transportPreference || user?.transportPreference || '',
      accessibility: request.accessibility?.length ? request.accessibility : user?.accessibility || [],
      familyWithKids: Boolean(request.children > 0),
      merged: {},
    };

    logger.exit('[AGENT:userPreference]', 'run', { status: 'success', travelStyle: prefs.travelStyle, interests: prefs.interests.length, foodPreference: prefs.foodPreference });
    return {
      agent: this.name,
      status: 'success',
      data: prefs,
      message: 'Preferences merged deterministically',
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

export default new UserPreferenceAgent();
