import React, { useState } from 'react';
import { Outlet, Link, useNavigate } from 'react-router-dom';
import { Menu, Bell, Moon, Sun, LogOut } from 'lucide-react';
import Sidebar from './Sidebar';
import GlobalSearch from '../GlobalSearch';
import { useThemeStore } from '../../store/themeStore';
import { useAuthStore } from '../../store/authStore';
import { useQuery } from '@tanstack/react-query';
import { notificationsApi } from '../../services/apiClient';
import useOnline from '../../hooks/useOnline';
import { useI18n } from '../../utils/i18n';

export default function MainLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { theme, toggle } = useThemeStore();
  const online = useOnline();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();
  const { t } = useI18n();

  const handleLogout = () => {
    // Fire-and-forget: the store clears state immediately regardless of the
    // API result, so we don't block redirect on a slow/offline network.
    logout();
    navigate('/login', { replace: true });
  };


  const { data: notifData } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => notificationsApi.list().then((r) => r.data.data),
    refetchInterval: 60000,
  });
  const unread = notifData?.unreadCount || 0;

  return (
    <div className="min-h-screen">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="lg:pl-64">
        {/* Topbar */}
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-slate-200/80 bg-white/80 px-4 backdrop-blur-xl dark:border-slate-800 dark:bg-slate-900/80 sm:px-6">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <button
              onClick={() => setSidebarOpen(true)}
              className="shrink-0 rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 lg:hidden"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="min-w-0 flex-1 sm:max-w-md">
              <GlobalSearch />
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <span
              className={`hidden items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold sm:inline-flex ${
                online
                  ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400'
                  : 'bg-amber-50 text-amber-600 dark:bg-amber-950 dark:text-amber-400'
              }`}
            >
              <span className={`h-2 w-2 rounded-full ${online ? 'bg-emerald-500' : 'bg-amber-500'} animate-pulse`} />
              {online ? t('Online') : t('Offline')}
            </span>
            <button
              onClick={toggle}
              className="rounded-xl p-2 text-slate-500 transition-colors hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              aria-label={t('Toggle theme')}
            >
              {theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
            </button>
            <Link
              to="/notifications"
              className="relative rounded-xl p-2 text-slate-500 transition-colors hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <Bell className="h-5 w-5" />
              {unread > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-rose-500 text-[9px] font-bold text-white">
                  {unread > 9 ? '9+' : unread}
                </span>
              )}
            </Link>
            <Link
              to="/profile"
              className="ml-1 flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-brand-400 to-brand-600 text-sm font-extrabold text-white transition-transform hover:scale-105"
            >
              {user?.profileImage ? <img src={user.profileImage} alt="" className="h-9 w-9 rounded-full object-cover" /> : (user?.name || 'T')[0]?.toUpperCase()}
            </Link>
            <button
              onClick={handleLogout}
              title={t('logout')}
              aria-label={t('logout')}
              className="rounded-xl p-2 text-slate-500 transition-colors hover:bg-rose-50 hover:text-rose-600 dark:text-slate-300 dark:hover:bg-rose-950/50 dark:hover:text-rose-400 lg:hidden"
            >
              <LogOut className="h-5 w-5" />
            </button>
          </div>
        </header>

        <main className="mx-auto max-w-7xl p-4 sm:p-6 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
