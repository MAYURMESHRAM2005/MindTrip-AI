import mongoose from 'mongoose';

const aiUsageLogSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    agent: { type: String, default: '' },
    model: { type: String, default: '' },
    action: { type: String, default: 'generate' }, // generate | chat | image | translate
    promptTokens: { type: Number, default: 0 },
    completionTokens: { type: Number, default: 0 },
    latencyMs: { type: Number, default: 0 },
    status: { type: String, enum: ['success', 'error', 'unavailable'], default: 'success' },
    error: { type: String, default: '' },
    trip: { type: mongoose.Schema.Types.ObjectId, ref: 'Trip', default: null },
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: false }
);

aiUsageLogSchema.index({ createdAt: 1 });

const AiUsageLog = mongoose.model('AiUsageLog', aiUsageLogSchema);
export default AiUsageLog;
