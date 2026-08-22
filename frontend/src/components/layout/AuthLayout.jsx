import React from 'react';
import { Outlet, Link } from 'react-router-dom';
import { Plane, Moon, Sun } from 'lucide-react';
import { useThemeStore } from '../../store/themeStore';
import { APP_NAME } from '../../constants';
import { useI18n } from '../../utils/i18n';

export default function AuthLayout() {
  const { theme, toggle } = useThemeStore();
  const { t } = useI18n();
  return (
    <div className="gradient-hero flex min-h-screen flex-col">
      <header className="flex items-center justify-between px-6 py-5">
        <Link to="/" className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-card">
            <Plane className="h-5 w-5" />
          </div>
          <span className="text-base font-extrabold text-slate-900 dark:text-white">{APP_NAME}</span>
        </Link>
        <button
          onClick={toggle}
          className="rounded-xl p-2 text-slate-500 transition-colors hover:bg-white/60 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          {theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
        </button>
      </header>
      <main className="flex flex-1 items-center justify-center px-4 py-8">
        <div className="w-full max-w-md">
          <Outlet />
        </div>
      </main>
      <footer className="px-6 py-4 text-center text-xs text-slate-400">
        © {new Date().getFullYear()} {APP_NAME} · {t('Multi-Agent LLM Travel Planning')}
      </footer>
    </div>
  );
}
