import { create } from 'zustand';

function initialTheme() {
  // Default to the light theme. Only an explicit saved choice (user toggled
  // the theme before) is honoured — the OS dark-mode preference is ignored so
  // the app always opens in light mode by default.
  const saved = localStorage.getItem('travelmind-theme');
  if (saved === 'dark' || saved === 'light') return saved;
  return 'light';
}

export const useThemeStore = create((set, get) => ({
  theme: initialTheme(),

  toggle: () => {
    const next = get().theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('travelmind-theme', next);
    document.documentElement.classList.toggle('dark', next === 'dark');
    set({ theme: next });
  },

  setTheme: (theme) => {
    localStorage.setItem('travelmind-theme', theme);
    document.documentElement.classList.toggle('dark', theme === 'dark');
    set({ theme });
  },

  init: () => {
    document.documentElement.classList.toggle('dark', get().theme === 'dark');
  },
}));

export default useThemeStore;
