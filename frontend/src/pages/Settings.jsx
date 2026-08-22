import React from 'react';
import { Link } from 'react-router-dom';
import { Settings as SettingsIcon, Moon, Sun, Languages, Trash2, ExternalLink } from 'lucide-react';
import PageHeader from '../components/ui/PageHeader';
import { useThemeStore } from '../store/themeStore';
import { useI18n } from '../utils/i18n';
import { useAuthStore } from '../store/authStore';
import { useNavigate } from 'react-router-dom';
import { userApi } from '../services/apiClient';
import { LANGUAGES } from '../constants';
import toast from 'react-hot-toast';
import { errorMessage } from '../services/api';

export default function Settings() {
  const { theme, setTheme } = useThemeStore();
  const { t, lang, setLang } = useI18n();
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();

  const handleDelete = async () => {
    if (!window.confirm(t('This permanently deletes your account and all trips. Continue?'))) return;
    try {
      await userApi.deleteAccount();
      toast.success(t('Account deleted'));
      navigate('/');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader icon={SettingsIcon} title={t('Settings')} subtitle={t('Appearance, language and account.')} />

      <div className="card mb-5 p-6">
        <h3 className="mb-4 text-sm font-extrabold text-slate-900 dark:text-white">{t('Appearance')}</h3>
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => setTheme('light')}
            className={`flex items-center justify-center gap-2 rounded-2xl border-2 p-4 font-bold transition-all ${theme === 'light' ? 'border-brand-500 bg-brand-50 dark:bg-brand-950/60' : 'border-slate-200 dark:border-slate-700'}`}
          >
            <Sun className="h-5 w-5 text-amber-500" /> {t('Light')}
          </button>
          <button
            onClick={() => setTheme('dark')}
            className={`flex items-center justify-center gap-2 rounded-2xl border-2 p-4 font-bold transition-all ${theme === 'dark' ? 'border-brand-500 bg-brand-50 dark:bg-brand-950/60' : 'border-slate-200 dark:border-slate-700'}`}
          >
            <Moon className="h-5 w-5 text-indigo-400" /> {t('Dark')}
          </button>
        </div>
      </div>

      <div className="card mb-5 p-6">
        <h3 className="mb-4 flex items-center gap-2 text-sm font-extrabold text-slate-900 dark:text-white">
          <Languages className="h-4 w-4 text-brand-500" /> {t('Language')}
        </h3>
        <div className="flex flex-wrap gap-2">
          {LANGUAGES.map((l) => (
            <button
              key={l.code}
              onClick={() => setLang(l.code)}
              className={`btn ${lang === l.code ? 'btn-primary' : 'btn-secondary'}`}
            >
              {l.native} <span className="text-xs opacity-70">({l.label})</span>
            </button>
          ))}
        </div>
        <p className="mt-3 text-xs text-slate-400">{t('UI strings translate instantly; AI responses are translated by the Translation Agent when available.')}</p>
      </div>

      <div className="card mb-5 p-6">
        <h3 className="mb-3 text-sm font-extrabold text-slate-900 dark:text-white">{t('External data providers')}</h3>
        <p className="text-sm text-slate-500 dark:text-slate-400">{t('The app shows live data only from providers configured in')} <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">backend/.env</code>. {t('Anything else honestly shows “Live data unavailable”. See the README for setup.')}</p>
        <Link to="/admin" className="btn-secondary mt-3">
          <ExternalLink className="h-4 w-4" /> {t('Admin: provider status')}
        </Link>
      </div>

      <div className="card border-rose-200 p-6 dark:border-rose-900">
        <h3 className="mb-2 text-sm font-extrabold text-rose-600 dark:text-rose-400">{t('Danger zone')}</h3>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-slate-500 dark:text-slate-400">{t('Delete your account and all associated data.')}</p>
          <button onClick={handleDelete} className="btn-danger">
            <Trash2 className="h-4 w-4" /> {t('Delete account')}
          </button>
        </div>
      </div>
    </div>
  );
}
