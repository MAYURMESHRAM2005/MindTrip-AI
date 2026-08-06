import { BaseAgent } from './base.agent.js';
import { USER_PREFERENCE_AGENT_PROMPT } from '../prompts/agentPrompts.js';

/**
 * Normalizes the user's profile + request into one preference object.
 */
class UserPreferenceAgent extends BaseAgent {
  constructor() {
    super('userPreference');
    this.systemPrompt = USER_PREFERENCE_AGENT_PROMPT;
  }

  async run({ user, request }) {
    const input = {
      profile: {
        travelStyle: user?.travelStyle,
        foodPreference: user?.foodPreference,
        hotelPreference: user?.hotelPreference,
        transportPreference: user?.transportPreference,
        interests: user?.interests || [],
        accessibility: user?.accessibility || [],
        language: user?.language,
      },
      request,
    };

    const result = await this.think({
      prompt: `User profile and trip request:\n${JSON.stringify(input, null, 2)}`,
      userId: user?._id?.toString(),
      action: 'preference',
    });

    if (result.status === 'success') {
      result.data = {
        ...result.data,
        merged: {
          travelStyle: result.data.travelStyle || request.travelStyle || user?.travelStyle || 'standard',
          activityLevel: result.data.activityLevel || request.activityLevel || 'moderate',
          interests: result.data.interests?.length ? result.data.interests : request.interests?.length ? request.interests : user?.interests || [],
          foodPreference: result.data.foodPreference || request.foodPreference || user?.foodPreference || '',
          hotelPreference: result.data.hotelPreference || request.hotelPreference || user?.hotelPreference || '',
          transportPreference: result.data.transportPreference || request.transportPreference || user?.transportPreference || '',
          accessibility: result.data.accessibility?.length ? result.data.accessibility : request.accessibility || user?.accessibility || [],
          familyWithKids: Boolean(request.children > 0),
        },
      };
    } else {
      // Deterministic merge - no AI needed
      result.data = {
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
    }
    return result;
  }
}

export default new UserPreferenceAgent();
