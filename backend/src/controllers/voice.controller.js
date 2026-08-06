import ApiResponse from '../utils/ApiResponse.js';
import asyncHandler from '../utils/asyncHandler.js';
import chatService from '../services/chat.service.js';
import translateService from '../services/translate.service.js';

/**
 * Speech-to-text happens in the browser (Web Speech API). This endpoint
 * processes the transcript through the same agent pipeline as the chatbot.
 */
export const processVoiceCommand = asyncHandler(async (req, res) => {
  const { transcript, conversationId, tripId, lang } = req.body;
  const result = await chatService.processMessage({
    userId: req.user._id.toString(),
    tripId: tripId || null,
    message: transcript,
    conversationId: conversationId || null,
  });
  res.json(ApiResponse.ok('Voice command processed', result));
});

/**
 * Optional server-side TTS fallback via Gemini for browsers without
 * speechSynthesis. Returns plain text; the client reads it with its own TTS.
 */
export const textForSpeech = asyncHandler(async (req, res) => {
  const { text, lang } = req.body;
  if (!text) return res.json(ApiResponse.ok('Empty', { text: '' }));
  res.json(ApiResponse.ok('Text for speech', { text, lang: lang || 'en' }));
});

export default { processVoiceCommand, textForSpeech };
