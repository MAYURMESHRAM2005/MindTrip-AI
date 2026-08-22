import React, { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { authApi } from '../services/apiClient';
import { errorMessage } from '../services/api';
import { Input } from '../components/ui/Input';
import Button from '../components/ui/Button';
import { useI18n } from '../utils/i18n';
import { KeyRound } from 'lucide-react';

const schema = z
  .object({
    password: z.string().min(8, 'At least 8 characters').regex(/[A-Z]/, 'One uppercase').regex(/[a-z]/, 'One lowercase').regex(/\d/, 'One number'),
    confirm: z.string(),
  })
  .refine((d) => d.password === d.confirm, { message: 'Passwords do not match', path: ['confirm'] });

export default function ResetPassword() {
  const { t } = useI18n();
  const { token } = useParams();
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { register, handleSubmit, formState: { errors } } = useForm({ resolver: zodResolver(schema) });

  const onSubmit = async ({ password }) => {
    setLoading(true);
    try {
      await authApi.resetPassword(token, password);
      toast.success(t('Password updated. Please sign in.'));
      navigate('/login');
    } catch (err) {
      toast.error(errorMessage(err, 'Reset failed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card animate-slide-up p-8">
      <div className="mb-6 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-card">
          <KeyRound className="h-6 w-6" />
        </div>
        <h1 className="text-xl font-extrabold text-slate-900 dark:text-white">{t('Set a new password')}</h1>
      </div>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <Input label={t('New password')} type="password" placeholder={t('Min 8 chars, A-Z, 0-9')} error={errors.password?.message} {...register('password')} />
        <Input label={t('Confirm password')} type="password" error={errors.confirm?.message} {...register('confirm')} />
        <Button type="submit" loading={loading} className="w-full">
          {t('Update password')}
        </Button>
      </form>
      <p className="mt-5 text-center text-sm">
        <Link to="/login" className="font-bold text-brand-600 hover:underline dark:text-brand-400">
          {t('Back to login')}
        </Link>
      </p>
    </div>
  );
}
