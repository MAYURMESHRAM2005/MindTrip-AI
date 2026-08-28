import axios from 'axios';
import { useAuthStore } from '../store/authStore';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  withCredentials: true,
  timeout: 60000,
});

let refreshPromise = null;

api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  console.log(`[API] → ${config.method?.toUpperCase()} ${config.baseURL}${config.url}`, config.params || config.data || '');
  return config;
});

api.interceptors.response.use(
  (res) => {
    console.log(`[API] ← ${res.config.method?.toUpperCase()} ${res.config.url} [${res.status}]`, res.data?.message || '');
    return res;
  },
  async (error) => {
    const original = error.config;
    const status = error.response?.status;

    // Silent 401 for the refresh/me endpoints to avoid loops
    const isAuthCall = original?.url?.includes('/auth/');
    console.warn(`[API] ← ${original?.method?.toUpperCase()} ${original?.url} [${status}]`, error.message);
    if (status === 401 && !original._retry && !isAuthCall) {
      console.log('[API] Token expired, attempting refresh...');
      original._retry = true;
      try {
        if (!refreshPromise) {
          refreshPromise = axios
            .post('/api/auth/refresh', null, { withCredentials: true })
            .then(({ data }) => {
              const token = data?.data?.accessToken;
              useAuthStore.getState().setToken(token);
              return token;
            })
            .finally(() => {
              refreshPromise = null;
            });
        }
        const newToken = await refreshPromise;
        if (newToken) {
          console.log('[API] Token refreshed successfully, retrying request...');
          original.headers.Authorization = `Bearer ${newToken}`;
          return api(original);
        }
      } catch (refreshErr) {
        console.warn('[API] Token refresh failed, logging out:', refreshErr.message);
        // Session expired - clear and redirect to login
        useAuthStore.getState().logout();
        if (window.location.pathname !== '/login') {
          window.location.href = '/login';
        }
      }
    }
    return Promise.reject(error);
  }
);

export function errorMessage(error, fallback = 'Something went wrong') {
  return error?.response?.data?.message || error?.message || fallback;
}

export default api;
