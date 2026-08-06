import ApiResponse from '../utils/ApiResponse.js';
import asyncHandler from '../utils/asyncHandler.js';
import AIConversation from '../models/AIConversation.js';
import chatService from '../services/chat.service.js';

export const chat = asyncHandler(async (req, res) => {
  const { message, conversationId, tripId } = req.body;
  const result = await chatService.processMessage({
    userId: req.user._id.toString(),
    tripId: tripId || null,
    message,
    conversationId: conversationId || null,
  });
  res.json(ApiResponse.ok('Chat response', result));
});

export const history = asyncHandler(async (req, res) => {
  const conversations = await AIConversation.find({ user: req.user._id })
    .sort({ updatedAt: -1 })
    .limit(20)
    .select('title updatedAt trip messages');
  res.json(ApiResponse.ok('Conversations', { conversations }));
});

export const oneConversation = asyncHandler(async (req, res) => {
  const conversation = await AIConversation.findOne({ _id: req.params.id, user: req.user._id });
  if (!conversation) {
    return res.status(404).json({ success: false, message: 'Conversation not found' });
  }
  res.json(ApiResponse.ok('Conversation', { conversation }));
});

export const clearHistory = asyncHandler(async (req, res) => {
  await AIConversation.deleteMany({ user: req.user._id });
  res.json(ApiResponse.ok('Chat history cleared'));
});

export default { chat, history, oneConversation, clearHistory };
