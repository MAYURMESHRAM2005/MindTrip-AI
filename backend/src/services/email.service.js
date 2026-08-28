import nodemailer from 'nodemailer';
import env from '../config/env.js';
import logger from '../utils/logger.js';

let transporter = null;

if (env.SMTP_HOST && env.SMTP_USER) {
  transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
  });
}

export const emailConfigured = Boolean(transporter);

/**
 * Send an email. When SMTP is not configured, logs the email (dev mode) so the
 * auth flows still work locally - the returned links are real and functional.
 */
export async function sendEmail({ to, subject, html, text }) {
  logger.entry('[EMAIL]', 'sendEmail', { to, subject, hasHtml: Boolean(html) });
  const started = Date.now();
  if (!transporter) {
    logger.info(`[EMAIL] SMTP not configured - simulated send to ${to} subject="${subject}"`);
    return { success: false, simulated: true, message: 'Email service not configured (SMTP). Email logged instead.' };
  }
  try {
    await transporter.sendMail({
      from: env.EMAIL_FROM,
      to,
      subject,
      html,
      text,
    });
    logger.exit('[EMAIL]', 'sendEmail', { status: 'success', to, latencyMs: Date.now() - started });
    return { success: true, simulated: false };
  } catch (err) {
    logger.error(`[EMAIL] send failed to ${to}: ${err.message}`);
    return { success: false, simulated: false, message: err.message };
  }
}

export function sendVerificationEmail({ to, name, token }) {
  logger.entry('[EMAIL]', 'sendVerificationEmail', { to, name });
  const link = `${env.FRONTEND_URL}/verify-email/${token}`;
  return sendEmail({
    to,
    subject: 'Verify your TravelMind AI email',
    html: `<div style="font-family:Inter,Arial,sans-serif;max-width:480px;margin:auto;padding:24px;border:1px solid #e5e7eb;border-radius:16px">
      <h2 style="color:#0f172a">Welcome to TravelMind AI ✈️</h2>
      <p>Hi ${name}, please verify your email address to activate your account.</p>
      <a href="${link}" style="display:inline-block;background:#0ea5e9;color:#fff;padding:12px 24px;border-radius:10px;text-decoration:none">Verify Email</a>
      <p style="color:#64748b;font-size:12px">Or paste this link: ${link}</p>
      <p style="color:#94a3b8;font-size:12px">This link expires in 24 hours.</p>
    </div>`,
    text: `Verify your email: ${link}`,
  });
}

export function sendPasswordResetEmail({ to, name, token }) {
  logger.entry('[EMAIL]', 'sendPasswordResetEmail', { to, name });
  const link = `${env.FRONTEND_URL}/reset-password/${token}`;
  return sendEmail({
    to,
    subject: 'Reset your TravelMind AI password',
    html: `<div style="font-family:Inter,Arial,sans-serif;max-width:480px;margin:auto;padding:24px;border:1px solid #e5e7eb;border-radius:16px">
      <h2 style="color:#0f172a">Password reset</h2>
      <p>Hi ${name}, click below to set a new password.</p>
      <a href="${link}" style="display:inline-block;background:#0ea5e9;color:#fff;padding:12px 24px;border-radius:10px;text-decoration:none">Reset Password</a>
      <p style="color:#64748b;font-size:12px">Or paste this link: ${link}</p>
      <p style="color:#94a3b8;font-size:12px">This link expires in 1 hour.</p>
    </div>`,
    text: `Reset your password: ${link}`,
  });
}

export default { sendEmail, sendVerificationEmail, sendPasswordResetEmail, emailConfigured };
