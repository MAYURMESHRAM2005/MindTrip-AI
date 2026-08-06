import mongoose from 'mongoose';

const emergencyContactSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    relationship: { type: String, default: '' },
    phone: { type: String, required: true, maxlength: 20 },
    email: { type: String, default: '' },
    isPrimary: { type: Boolean, default: false },
  },
  { timestamps: true }
);

const EmergencyContact = mongoose.model('EmergencyContact', emergencyContactSchema);
export default EmergencyContact;
