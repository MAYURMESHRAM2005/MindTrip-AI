import { Router } from 'express';
import authController from '../controllers/auth.controller.js';
import { protect } from '../middleware/auth.js';
import { authLimiter } from '../middleware/rateLimiter.js';
import validate from '../middleware/validate.js';
import {
  registerSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  googleSchema,
} from '../validators/auth.validator.js';

const router = Router();

router.post('/register', authLimiter, validate(registerSchema), authController.register);
router.post('/login', authLimiter, validate(loginSchema), authController.login);
router.post('/logout', authController.logout);
router.post('/refresh', authLimiter, authController.refresh);
router.get('/me', protect, authController.me);
router.get('/verify-email/:token', authController.verifyEmail);
router.post('/forgot-password', authLimiter, validate(forgotPasswordSchema), authController.forgotPassword);
router.post('/reset-password/:token', authLimiter, validate(resetPasswordSchema), authController.resetPassword);

// Google OAuth (server-side redirect flow)
router.get('/google', authController.googleRedirect);
router.get('/google/callback', authController.googleCallback);
// Alternative: verify Google id_token sent from the client
router.post('/google/token', validate(googleSchema), authController.googleToken);

export default router;
