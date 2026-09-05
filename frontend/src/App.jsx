import React, { useEffect } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import AppRouter from './router/AppRouter';
import { useThemeStore } from './store/themeStore';
import { useAuthStore } from './store/authStore';
import { I18nProvider } from './utils/i18n';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Retry transient failures once, but NEVER retry HTTP 429 quota errors.
      // Retrying a RESOURCE_EXHAUSTED response doubles the Google API calls
      // and burns the daily quota faster — it never succeeds.
      retry: (failureCount, error) => failureCount < 1 && error?.response?.status !== 429,
      refetchOnWindowFocus: false,
      staleTime: 30000,
    },
  },
});

function Bootstrap() {
  const bootstrap = useAuthStore((s) => s.bootstrap);
  useEffect(() => {
    useThemeStore.getState().init();
    bootstrap();
    // PWA: register service worker (only in production build / supported browsers)
    if ('serviceWorker' in navigator && import.meta.env.PROD) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  }, [bootstrap]);
  return <AppRouter />;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <BrowserRouter>
          <Bootstrap />
          <Toaster
            position="top-right"
            toastOptions={{
              style: {
                borderRadius: '12px',
                background: '#0f172a',
                color: '#fff',
                fontSize: '14px',
              },
              success: { iconTheme: { primary: '#22c55e', secondary: '#fff' } },
              error: { iconTheme: { primary: '#f43f5e', secondary: '#fff' } },
            }}
          />
        </BrowserRouter>
      </I18nProvider>
    </QueryClientProvider>
  );
}
