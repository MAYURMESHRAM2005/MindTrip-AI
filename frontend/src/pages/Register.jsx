import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { authApi } from '../services/apiClient';
import { useAuthStore } from '../store/authStore';
import { errorMessage } from '../services/api';
import { Input } from '../components/ui/Input';
import Button from '../components/ui/Button';
import { useI18n } from '../utils/i18n';
import { Plane } from 'lucide-react';

const schema = z
  .object({
    name: z.string().min(2, 'Name must be at least 2 characters').max(80),
    email: z.string().email('Enter a valid email'),
    password: z
      .string()
      .min(8, 'At least 8 characters')
      .regex(/[A-Z]/, 'One uppercase letter')
      .regex(/[a-z]/, 'One lowercase letter')
      .regex(/\d/, 'One number'),
    confirm: z.string(),
  })
  .refine((d) => d.password === d.confirm, { message: 'Passwords do not match', path: ['confirm'] });

export default function Register() {
  const { t } = useI18n();
  const [loading, setLoading] = useState(false);
  const login = useAuthStore((s) => s.login);
  const navigate = useNavigate();

  const { register, handleSubmit, formState: { errors } } = useForm({ resolver: zodResolver(schema) });

  const onSubmit = async (values) => {
    setLoading(true);
    try {
      const { data } = await authApi.register({ name: values.name, email: values.email, password: values.password });
      login({ user: data.data.user, accessToken: data.data.accessToken || null });
      if (data.data.emailSent) {
        toast.success(t('Account created! Check your email to verify.'));
      } else {
        toast(t('Account created. Email service not configured — use the verification link in logs.'), { icon: '📧' });
      }
      navigate('/dashboard');
    } catch (err) {
      toast.error(errorMessage(err, t('Registration failed')));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card animate-slide-up p-8">
      <div className="mb-6 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-card">
          <Plane className="h-6 w-6" />
        </div>
        <h1 className="text-xl font-extrabold text-slate-900 dark:text-white">{t('Create your account')}</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t('Start planning trips with AI agents')}</p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <Input label={t('Full name')} placeholder="Aarav Sharma" error={errors.name?.message} {...register('name')} />
        <Input label={t('Email')} type="email" placeholder="you@example.com" error={errors.email?.message} {...register('email')} />
        <Input label={t('Password')} type="password" placeholder={t('Min 8 chars, A-Z, 0-9')} error={errors.password?.message} {...register('password')} />
        <Input label={t('Confirm password')} type="password" placeholder={t('Repeat password')} error={errors.confirm?.message} {...register('confirm')} />
        <Button type="submit" loading={loading} className="w-full">
          {t('Create account')}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-slate-500 dark:text-slate-400">
        {t('Already have an account?')}{' '}
        <Link to="/login" className="font-bold text-brand-600 hover:underline dark:text-brand-400">
          {t('Sign in')}
        </Link>
      </p>
    </div>
  );
}
