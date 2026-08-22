import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import * as Icons from 'lucide-react';
import { SIDEBAR_NAV, APP_NAME } from '../../constants';
import { useAuthStore } from '../../store/authStore';
import { useI18n } from '../../utils/i18n';
import { initials } from '../../utils/format';
import { X, LogOut } from 'lucide-react';

function Icon({ name, className }) {
  const Cmp = Icons[name] || Icons.Circle;
  return <Cmp className={className} />;
}

export default function Sidebar({ open, onClose }) {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const { t } = useI18n();
  const navigate = useNavigate();

  const isAdmin = user?.role === 'admin';

  const handleLogout = () => {
    // Fire-and-forget: the store clears state immediately regardless of the
    // API result, so we don't block redirect on a slow/offline network.
    logout();
    navigate('/login', { replace: true });
  };

  return (
    <AnimatePresence>
      {(open || true) && (
        <>
          {/* Mobile overlay */}
          {open && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-30 bg-slate-950/50 backdrop-blur-sm lg:hidden"
              onClick={onClose}
            />
          )}
          <aside
            className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-slate-200/80 bg-white transition-transform duration-300 dark:border-slate-800 dark:bg-slate-900 lg:translate-x-0 ${
              open ? 'translate-x-0' : '-translate-x-full'
            }`}
          >
            <div className="flex h-16 items-center justify-between border-b border-slate-100 px-5 dark:border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-card">
                  <Icons.Plane className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm font-extrabold leading-tight text-slate-900 dark:text-white">{APP_NAME}</p>
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-brand-600 dark:text-brand-400">{t('Smart Travel')}</p>
                </div>
              </div>
              <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 lg:hidden">
                <X className="h-5 w-5" />
              </button>
            </div>

            <nav className="flex-1 overflow-y-auto px-3 py-4">
              {SIDEBAR_NAV.map((group) => {
                const items = isAdmin ? group.items : group.items.filter((i) => i.to !== '/admin');
                if (!items.length) return null;
                return (
                  <div key={group.section} className="mb-4">
                    <p className="mb-1.5 px-3 text-[10px] font-bold uppercase tracking-widest text-slate-400">{t(group.section)}</p>
                    <div className="space-y-0.5">
                      {items.map((item) => (
                        <NavLink
                          key={item.to}
                          to={item.to}
                          onClick={onClose}
                          className={({ isActive }) =>
                            `group flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-semibold transition-all ${
                              isActive
                                ? 'bg-brand-50 text-brand-700 dark:bg-brand-950/70 dark:text-brand-300'
                                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white'
                            }`
                          }
                        >
                          <Icon name={item.icon} className="h-[18px] w-[18px]" />
                          {t(item.label)}
                        </NavLink>
                      ))}
                    </div>
                  </div>
                );
              })}
            </nav>

            <div className="border-t border-slate-100 p-4 dark:border-slate-800">
              <div className="flex items-center gap-3 rounded-xl bg-slate-50 p-3 dark:bg-slate-800/60">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-400 to-brand-600 text-sm font-extrabold text-white">
                  {user?.profileImage ? (
                    <img src={user.profileImage} alt="" className="h-9 w-9 rounded-full object-cover" />
                  ) : (
                    initials(user?.name)
                  )}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-slate-900 dark:text-white">{user?.name || t('Traveler')}</p>
                  <p className="truncate text-xs text-slate-500 dark:text-slate-400">{user?.email}</p>
                </div>
              </div>
              <button
                onClick={handleLogout}
                title={t('logout')}
                aria-label={t('logout')}
                className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-bold text-slate-500 transition-all hover:bg-rose-50 hover:text-rose-600 dark:text-slate-400 dark:hover:bg-rose-950/60 dark:hover:text-rose-400"
              >
                <LogOut className="h-3.5 w-3.5" />
                {t('logout')}
              </button>
            </div>
          </aside>
        </>
      )}
    </AnimatePresence>
  );
}
