import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from './lib/supabase';
import { useAuth } from './auth';

/**
 * Landing page Supabase redirects to after Google OAuth.
 * - Supabase parses the URL fragment automatically (detectSessionInUrl: true).
 * - We then call bootstrap() and bounce home.
 * - Any error is shown on screen instead of silently failing.
 */
export default function AuthCallback() {
  const navigate = useNavigate();
  const bootstrap = useAuth((s) => s.bootstrap);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        // Wait briefly for Supabase to finish parsing the URL fragment.
        const { data, error: sessErr } = await supabase.auth.getSession();
        if (sessErr) throw sessErr;
        if (!data.session) {
          // Sometimes Supabase needs a moment after the redirect.
          await new Promise((r) => setTimeout(r, 300));
          const again = await supabase.auth.getSession();
          if (!again.data.session) {
            throw new Error('No session after Google redirect. Check Supabase Auth → URL Configuration.');
          }
        }
        await bootstrap();
        navigate('/', { replace: true });
      } catch (e: any) {
        // eslint-disable-next-line no-console
        console.error('[auth/callback]', e);
        setError(e?.message || 'Sign in failed');
      }
    })();
  }, [bootstrap, navigate]);

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black text-white/70 text-sm p-8">
      {error ? (
        <div className="max-w-md text-center">
          <div className="text-red-400 font-medium mb-2">Sign in failed</div>
          <div className="text-white/60 text-xs mb-4 break-words">{error}</div>
          <button
            onClick={() => navigate('/')}
            className="px-3 py-1.5 rounded-lg bg-white text-black text-xs font-medium"
          >
            Go back
          </button>
        </div>
      ) : (
        'Signing you in…'
      )}
    </div>
  );
}
