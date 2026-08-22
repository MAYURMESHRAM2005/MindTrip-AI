import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { authApi } from '../services/apiClient';
import { signInWithGoogle } from '../services/firebase';
import { useAuthStore } from '../store/authStore';
import { errorMessage } from '../services/api';
import { Input } from '../components/ui/Input';
import Button from '../components/ui/Button';
import { useI18n } from '../utils/i18n';
import { Eye, EyeOff, Plane } from 'lucide-react';

const schema = z.object({
  email: z.string().email('Enter a valid email'),
  password: z.string().min(1, 'Password is required'),
});

export default function Login() {
  const { t } = useI18n();
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState(false);
  const login = useAuthStore((s) => s.login);
  const navigate = useNavigate();

  const { register, handleSubmit, formState: { errors } } = useForm({ resolver: zodResolver(schema) });

  const onSubmit = async (values) => {
    setLoading(true);
    try {
      const { data } = await authApi.login(values);
      login({ user: data.data.user, accessToken: data.data.accessToken || null });
      toast.success(t('Welcome back!'));
      navigate('/dashboard');
    } catch (err) {
      toast.error(errorMessage(err, 'Login failed'));
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = async () => {
    setOauthLoading(true);
    try {
      const idToken = await signInWithGoogle();
      const { data } = await authApi.firebaseToken(idToken);
      login({ user: data.data.user, accessToken: data.data.accessToken || null });
      toast.success(t('Welcome back!'));
      navigate('/dashboard');
    } catch (err) {
      // Silently reset when the user simply closes the Google popup.
      if (err?.code !== 'auth/popup-closed-by-user' && err?.code !== 'auth/cancelled-popup-request') {
        toast.error(errorMessage(err, t('Google sign-in failed')));
      }
    } finally {
      setOauthLoading(false);
    }
  };

  return (
    <div className="card animate-slide-up p-8">
      <div className="mb-6 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-card">
          <Plane className="h-6 w-6" />
        </div>
        <h1 className="text-xl font-extrabold text-slate-900 dark:text-white">{t('Welcome back')}</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t('Sign in to plan your next trip')}</p>
      </div>


      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <Input label={t('Email')} type="email" placeholder="you@example.com" error={errors.email?.message} {...register('email')} />
        <div className="relative">
          <Input
            label={t('Password')}
            type={showPw ? 'text' : 'password'}
            placeholder="••••••••"
            error={errors.password?.message}
            {...register('password')}
          />
          <button
            type="button"
            onClick={() => setShowPw((s) => !s)}
            className="absolute right-3 top-[34px] text-slate-400 hover:text-slate-600"
          >
            {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        <div className="flex items-center justify-between text-sm">
          <Link to="/forgot-password" className="font-semibold text-brand-600 hover:underline dark:text-brand-400">
            {t('Forgot password?')}
          </Link>
        </div>
        <Button type="submit" loading={loading} className="w-full">
          {t('Sign in')}
        </Button>
      </form>

      <div className="my-5 flex items-center gap-3 text-xs text-slate-400">
        <span className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
        {t('or continue with')}
        <span className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
      </div>

      <Button variant="outline" className="w-full" onClick={handleGoogle} loading={oauthLoading} disabled={oauthLoading}>
        <svg className="h-4 w-4" viewBox="0 0 24 24">
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z" />
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A10.96 10.96 0 0 0 1 12c0 1.77.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
        </svg>
        {t('Continue with Google')}
      </Button>

      <p className="mt-6 text-center text-sm text-slate-500 dark:text-slate-400">
        {t('New to TravelMind?')}{' '}
        <Link to="/register" className="font-bold text-brand-600 hover:underline dark:text-brand-400">
          {t('Create an account')}
        </Link>
      </p>
    </div>
  );
}
