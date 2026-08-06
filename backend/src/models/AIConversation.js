import mongoose from 'mongoose';

const messageSchema = new mongoose.Schema(
  {
    role: { type: String, enum: ['user', 'assistant', 'system', 'tool'], required: true },
    content: { type: String, required: true },
    toolCalls: { type: mongoose.Schema.Types.Mixed, default: null }, // actions executed
    timestamp: { type: Date, default: Date.now },
  },
  { _id: true }
);

const aiConversationSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    trip: { type: mongoose.Schema.Types.ObjectId, ref: 'Trip', default: null },
    title: { type: String, default: 'New conversation' },
    messages: { type: [messageSchema], default: [] },
    meta: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true }
);

aiConversationSchema.index({ user: 1, updatedAt: -1 });

const AIConversation = mongoose.model('AIConversation', aiConversationSchema);
export default AIConversation;
