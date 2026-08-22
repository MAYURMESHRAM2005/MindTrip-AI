import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { authApi } from '../services/apiClient';
import { errorMessage } from '../services/api';
import { useAuthStore } from '../store/authStore';
import { Spinner } from '../components/ui/Spinner';
import { useI18n } from '../utils/i18n';
import { CheckCircle2, XCircle } from 'lucide-react';

export default function VerifyEmail() {
  const { t } = useI18n();
  const { token } = useParams();
  const [state, setState] = useState('loading'); // loading | success | error
  const [message, setMessage] = useState('');
  const setUser = useAuthStore((s) => s.setUser);

  useEffect(() => {
    authApi
      .verifyEmail(token)
      .then(({ data }) => {
        setUser(data.data.user);
        setState('success');
      })
      .catch((err) => {
        setMessage(errorMessage(err, 'Verification failed'));
        setState('error');
      });
  }, [token]);

  return (
    <div className="card animate-slide-up p-8 text-center">
      {state === 'loading' && (
        <div className="flex flex-col items-center gap-3 py-6">
          <Spinner size="lg" />
          <p className="text-sm text-slate-500">{t('Verifying your email…')}</p>
        </div>
      )}
      {state === 'success' && (
        <>
          <CheckCircle2 className="mx-auto h-14 w-14 text-emerald-500" />
          <h1 className="mt-4 text-xl font-extrabold text-slate-900 dark:text-white">{t('Email verified!')}</h1>
          <p className="mt-2 text-sm text-slate-500">{t('Your account is now active.')}</p>
          <Link to="/dashboard" className="btn-primary mt-6">
            {t('Go to dashboard')}
          </Link>
        </>
      )}
      {state === 'error' && (
        <>
          <XCircle className="mx-auto h-14 w-14 text-rose-500" />
          <h1 className="mt-4 text-xl font-extrabold text-slate-900 dark:text-white">{t('Verification failed')}</h1>
          <p className="mt-2 text-sm text-slate-500">{message}</p>
          <Link to="/login" className="btn-secondary mt-6">
            {t('Back to login')}
          </Link>
        </>
      )}
    </div>
  );
}
