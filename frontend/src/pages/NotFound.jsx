import React from 'react';
import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { useI18n } from '../utils/i18n';

export default function NotFound() {
  const { t } = useI18n();
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-50 px-4 text-center dark:bg-slate-950">
      <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-card">
        <Compass className="h-10 w-10" />
      </div>
      <h1 className="text-4xl font-extrabold text-slate-900 dark:text-white">404</h1>
      <p className="max-w-sm text-sm text-slate-500 dark:text-slate-400">{t("This route doesn't exist — even the AI agents can't find it.")}</p>
      <Link to="/dashboard" className="btn-primary mt-2">
        {t('Back to dashboard')}
      </Link>
    </div>
  );
}
