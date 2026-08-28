import { create } from 'zustand';
import api from '../services/api';

/**
 * Auth store. The access token lives in memory ONLY (never localStorage) -
 * httpOnly refresh cookies restore sessions after reload.
 */
export const useAuthStore = create((set, get) => ({
  user: null,
  accessToken: null,
  initializing: true,
  authenticated: false,

  setAuth: ({ user, accessToken }) =>
    set({ user, accessToken, authenticated: true, initializing: false }),

  setUser: (user) => set({ user }),

  /**
   * Restore the session. Relies on the httpOnly refresh cookie: /auth/refresh
   * rotates it and returns a fresh short-lived access token + user.
   */
  bootstrap: async () => {
    console.log('[AUTH] Bootstrap: attempting session restore...');
    try {
      const { data } = await api.post('/auth/refresh');
      const user = data?.data?.user || null;
      console.log('[AUTH] Bootstrap: session restored for', user?.email || 'anonymous');
      set({
        user,
        accessToken: data?.data?.accessToken || null,
        authenticated: Boolean(data?.data?.user),
        initializing: false,
      });
    } catch (err) {
      console.log('[AUTH] Bootstrap: no active session', err.message);
      set({ user: null, accessToken: null, authenticated: false, initializing: false });
    }
  },

  setToken: (token) => set({ accessToken: token }),

  login: ({ user, accessToken }) => {
    console.log('[AUTH] Login:', user?.email);
    set({ user, accessToken, authenticated: true, initializing: false });
  },

  logout: async () => {
    console.log('[AUTH] Logout: clearing session...');
    try {
      await api.post('/auth/logout');
    } catch {
      /* ignore */
    }
    set({ user: null, accessToken: null, authenticated: false, initializing: false });
  },
}));

export default useAuthStore;
