import mongoose from 'mongoose';
import { TICKET_CATEGORIES } from '../utils/constants.js';

const ticketSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    trip: { type: mongoose.Schema.Types.ObjectId, ref: 'Trip', default: null },
    category: { type: String, enum: TICKET_CATEGORIES, required: true },
    provider: { type: String, default: '' }, // e.g. airline / railway / user-entered
    title: { type: String, required: true, trim: true, maxlength: 160 },
    reference: { type: String, default: '' }, // user-provided or app-generated
    bookingDate: { type: Date },
    travelDate: { type: Date },
    details: { type: mongoose.Schema.Types.Mixed, default: null }, // passenger, seat, pnr, amount...
    qrData: { type: String, default: '' }, // content encoded into QR (never fabricated bookings)
    qrGenerated: { type: Boolean, default: false },
    isFabricated: { type: Boolean, default: false }, // true only for app-generated reference
  },
  { timestamps: true }
);

ticketSchema.index({ user: 1, createdAt: -1 });

const Ticket = mongoose.model('Ticket', ticketSchema);
export default Ticket;
