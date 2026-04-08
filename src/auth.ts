import { create } from 'zustand';
import { supabase } from './lib/supabase';
import { api, type User } from './api';

/**
 * Auth store backed by Supabase.
 *
 *  - On mount the app calls `bootstrap()` which fetches the existing session
 *    (if any) and the user's profile row.
 *  - `signInWithGoogle()` redirects through Google OAuth.
 *  - `signOut()` clears everything.
 *  - `setUsername()` writes to public.users via the set_username RPC.
 *  - The store auto-refreshes whenever Supabase emits an auth state change
 *    (sign in, sign out, token refresh).
 */

interface AuthState {
  user: User | null;            // null = signed out
  loading: boolean;             // true while bootstrap or sign-in is in flight
  needsUsername: boolean;       // signed in but no username chosen yet
  bootstrap: () => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  setUsername: (name: string) => Promise<void>;
  refreshProfile: () => Promise<void>;
}

export const useAuth = create<AuthState>((set, get) => ({
  user: null,
  loading: true,
  needsUsername: false,

  bootstrap: async () => {
    set({ loading: true });
    try {
      const me = await api.getMyProfile();
      set({
        user: me,
        needsUsername: !!me && !me.username,
        loading: false,
      });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[auth.bootstrap] failed', e);
      set({ user: null, needsUsername: false, loading: false });
    }
  },

  signInWithGoogle: async () => {
    await api.signInWithGoogle();
    // Browser will navigate away to Google. The /auth/callback page calls
    // bootstrap() once the session is back.
  },

  signOut: async () => {
    await api.signOut();
    set({ user: null, needsUsername: false });
  },

  setUsername: async (name: string) => {
    const me = await api.setUsername(name);
    set({ user: me, needsUsername: false });
  },

  refreshProfile: async () => {
    const me = await api.getMyProfile();
    set({ user: me, needsUsername: !!me && !me.username });
  },
}));

// Subscribe once at module load: any sign-in / sign-out / token refresh
// triggers a profile refresh so the rest of the app stays in sync.
supabase.auth.onAuthStateChange((_event, _session) => {
  useAuth.getState().refreshProfile().catch(() => {});
});
