import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { authApi } from '../services/apiClient';
import { errorMessage } from '../services/api';
import { Input } from '../components/ui/Input';
import Button from '../components/ui/Button';
import { MailCheck, KeyRound } from 'lucide-react';

const schema = z.object({ email: z.string().email('Enter a valid email') });

export default function ForgotPassword() {
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const { register, handleSubmit, formState: { errors } } = useForm({ resolver: zodResolver(schema) });

  const onSubmit = async ({ email }) => {
    setLoading(true);
    try {
      await authApi.forgotPassword(email);
      setSent(true);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  if (sent) {
    return (
      <div className="card animate-slide-up p-8 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-500 dark:bg-emerald-950">
          <MailCheck className="h-7 w-7" />
        </div>
        <h1 className="text-lg font-extrabold text-slate-900 dark:text-white">Check your email</h1>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          If an account exists for that address, we've sent a password reset link. It expires in 1 hour.
        </p>
        <Link to="/login" className="btn-primary mt-6">
          Back to login
        </Link>
      </div>
    );
  }

  return (
    <div className="card animate-slide-up p-8">
      <div className="mb-6 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-card">
          <KeyRound className="h-6 w-6" />
        </div>
        <h1 className="text-xl font-extrabold text-slate-900 dark:text-white">Forgot password?</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">We'll email you a reset link</p>
      </div>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <Input label="Email" type="email" placeholder="you@example.com" error={errors.email?.message} {...register('email')} />
        <Button type="submit" loading={loading} className="w-full">
          Send reset link
        </Button>
      </form>
      <p className="mt-5 text-center text-sm text-slate-500 dark:text-slate-400">
        Remembered it?{' '}
        <Link to="/login" className="font-bold text-brand-600 hover:underline dark:text-brand-400">
          Sign in
        </Link>
      </p>
    </div>
  );
}
