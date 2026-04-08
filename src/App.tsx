import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { InfiniteCanvas } from './InfiniteCanvas';
import { setTickSoundEnabled } from './tickSound';
import { useAuth } from './auth';
import { api, type BoxRecord } from './api';
import { useFeedStore } from './feedStore';
import { useUI } from './uiStore';

/**
 * App is a hard sign-in gate. Three explicit states:
 *
 *   1. loading           → splash
 *   2. !user             → SignInGate (Google sign-in only, full screen)
 *   3. user && no username → UsernameClaim (full screen)
 *   4. user && username  → the actual app (grid + account button)
 *
 * Until state 4, the InfiniteCanvas does not mount. Nothing about the grid,
 * the boxes, or anything else is visible.
 */
export default function App() {
  const { user, loading, needsUsername, bootstrap } = useAuth();

  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  if (loading) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-black text-white/50 text-sm">
        Loading…
      </div>
    );
  }

  if (!user) {
    return <SignInGate />;
  }

  if (needsUsername || !user.username) {
    return <UsernameClaim />;
  }

  return <SignedInApp />;
}

// ─────────────────────────────────────────────────────────
// State 2 — Signed out
// ─────────────────────────────────────────────────────────
function SignInGate() {
  const signInWithGoogle = useAuth((s) => s.signInWithGoogle);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      await signInWithGoogle();
      // Browser will navigate away to Google. If we're still here a few seconds
      // later, something went wrong.
    } catch (e: any) {
      setBusy(false);
      setError(e.message || 'Sign in failed');
    }
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black">
      <div className="w-[22rem] max-w-[92vw] text-center">
        <div className="text-white text-2xl font-medium mb-2">boxyy</div>
        <div className="text-white/50 text-sm mb-8">Sign in to view and claim boxes.</div>
        <button
          onClick={start}
          disabled={busy}
          className="w-full py-3 rounded-xl bg-white text-black font-medium flex items-center justify-center gap-3 disabled:opacity-50"
        >
          <svg width="20" height="20" viewBox="0 0 48 48">
            <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.6-6 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/>
            <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16 19 13 24 13c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/>
            <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2c-2 1.4-4.5 2.3-7.2 2.3-5.3 0-9.7-3.4-11.3-8L6.1 33c3.3 6.4 10 11 17.9 11z"/>
            <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4-4.1 5.3l6.2 5.2C41.3 36.4 44 30.7 44 24c0-1.3-.1-2.4-.4-3.5z"/>
          </svg>
          {busy ? 'Redirecting…' : 'Sign in with Google'}
        </button>
        {error && (
          <div className="text-red-400 text-xs mt-4 break-words">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// State 3 — Signed in but no username
// ─────────────────────────────────────────────────────────
function UsernameClaim() {
  const { user, setUsername, signOut } = useAuth();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const v = value.trim();
    if (!v) return;
    setBusy(true);
    setError(null);
    try {
      await setUsername(v);
    } catch (e: any) {
      setError(e.message || 'Failed to set username');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black">
      <div className="w-[22rem] max-w-[92vw]">
        <div className="text-center mb-6">
          <div className="text-white text-2xl font-medium mb-1">Choose your username</div>
          <div className="text-white/50 text-sm">
            3–20 characters. Letters, numbers, and underscores.
          </div>
          {user?.email && (
            <div className="text-white/30 text-xs mt-2">Signed in as {user.email}</div>
          )}
        </div>
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="your_handle"
          className="w-full px-3 py-2.5 rounded-lg bg-neutral-900 border border-white/15 text-white outline-none focus:border-white/40"
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
        {error && <div className="text-red-400 text-xs mt-2">{error}</div>}
        <button
          onClick={submit}
          disabled={busy || !value.trim()}
          className="mt-4 w-full py-2.5 rounded-xl bg-white text-black font-medium disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Continue'}
        </button>
        <button
          onClick={signOut}
          className="mt-2 w-full py-2 text-white/40 hover:text-white text-xs"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// State 4 — Fully signed in: render the app
// ─────────────────────────────────────────────────────────
function SignedInApp() {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const accountOpen = useUI((s) => s.accountOpen);
  const setAccountOpen = useUI((s) => s.setAccountOpen);

  const [myBoxes, setMyBoxes] = useState<BoxRecord[]>([]);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editUrl, setEditUrl] = useState('');
  const [rowError, setRowError] = useState<string | null>(null);
  const [rowBusy, setRowBusy] = useState(false);
  const [claimBusy, setClaimBusy] = useState(false);

  const insertNewBox = useFeedStore((s) => s.insertNewBox);
  const updateFeedBox = useFeedStore((s) => s.updateBox);
  const refreshFeed = useFeedStore((s) => s.refresh);
  const seekToBox = useFeedStore((s) => s.seekToBox);

  const [soundOn, setSoundOn] = useState<boolean>(() => {
    try {
      const v = localStorage.getItem('boxyy.sound.enabled');
      if (v === null) {
        setTickSoundEnabled(true);
        return true;
      }
      return v === '1';
    } catch {
      return true;
    }
  });
  useEffect(() => setTickSoundEnabled(soundOn), [soundOn]);

  const refreshMyBoxes = async () => {
    try {
      const list = await api.listMyBoxes();
      setMyBoxes(list);
    } catch {
      setMyBoxes([]);
    }
  };

  useEffect(() => {
    if (!accountOpen) return;
    refreshMyBoxes();
  }, [accountOpen]);

  const goToBox = (x: number, y: number) => {
    setAccountOpen(false);
    seekToBox(x, y).catch(() => {});
    navigate(`/${x}/${y}`);
  };

  const claimNewFromAccount = async () => {
    setClaimBusy(true);
    setRowError(null);
    try {
      const created = await api.claimNextBox();
      insertNewBox(created);
      await refreshMyBoxes();
      goToBox(created.x, created.y);
    } catch (e: any) {
      setRowError(e.message || 'Claim failed');
    } finally {
      setClaimBusy(false);
    }
  };

  const startEdit = (b: BoxRecord) => {
    setEditingKey(`${b.x}:${b.y}`);
    setEditUrl(b.content?.kind === 'youtube' ? `https://youtu.be/${b.content.data.videoId}` : '');
    setRowError(null);
  };

  const saveEdit = async (b: BoxRecord) => {
    setRowBusy(true);
    setRowError(null);
    try {
      const updated = await api.setContent(b.x, b.y, null, 'youtube', { url: editUrl });
      updateFeedBox(updated);
      await refreshMyBoxes();
      await refreshFeed();
      setEditingKey(null);
      setEditUrl('');
    } catch (e: any) {
      setRowError(e.message || 'Save failed');
    } finally {
      setRowBusy(false);
    }
  };

  return (
    <>
      <InfiniteCanvas />

      <button
        onClick={() => setAccountOpen(true)}
        className="fixed top-4 right-4 z-50 h-10 px-3 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur border border-white/20 flex items-center justify-center text-sm font-medium text-white"
      >
        @{user!.username}
      </button>

      {accountOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center"
          onClick={() => setAccountOpen(false)}
        >
          <div
            className="bg-neutral-900 border border-white/10 rounded-2xl p-8 w-[28rem] max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-xl font-medium mb-6 text-white">Account</h2>

            <div className="flex items-center justify-between py-3 border-t border-white/10">
              <div className="flex items-center gap-3">
                {user!.avatarUrl && (
                  <img src={user!.avatarUrl} alt="" className="w-9 h-9 rounded-full" />
                )}
                <div>
                  <div className="text-white text-sm font-medium">@{user!.username}</div>
                  <div className="text-white/50 text-xs">{user!.email}</div>
                </div>
              </div>
              <button
                onClick={signOut}
                className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white border border-white/15 text-sm"
              >
                Log out
              </button>
            </div>

            <div className="py-3 border-t border-white/10">
              <div className="flex items-center justify-between mb-3">
                <div className="text-white text-sm font-medium">
                  My boxes{' '}
                  <span className="text-white/40 text-xs font-normal">({myBoxes.length})</span>
                </div>
                <button
                  onClick={claimNewFromAccount}
                  disabled={claimBusy}
                  className="px-3 py-1.5 rounded-lg bg-white text-black text-xs font-medium disabled:opacity-50"
                >
                  {claimBusy ? 'Claiming…' : '+ Claim a new box'}
                </button>
              </div>
              {myBoxes.length === 0 ? (
                <div className="text-white/50 text-xs">
                  You don't own any boxes yet. Click{' '}
                  <span className="text-white/80">+ Claim a new box</span> above.
                </div>
              ) : (
                <ul className="-mx-2">
                  {myBoxes.map((b) => {
                    const k = `${b.x}:${b.y}`;
                    const isEditing = editingKey === k;
                    return (
                      <li
                        key={k}
                        className="px-2 py-2 rounded-lg hover:bg-white/5 border-b border-white/5 last:border-0"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <button
                            onClick={() => goToBox(b.x, b.y)}
                            className="flex items-center gap-2 flex-1 text-left min-w-0"
                          >
                            <span className="font-mono text-xs text-white/60 w-14 shrink-0">
                              {b.x},{b.y}
                            </span>
                            <span className="text-xs text-white/80 truncate">
                              {b.content?.kind === 'youtube'
                                ? `▶ youtu.be/${b.content.data.videoId}`
                                : 'Empty'}
                            </span>
                          </button>
                          <button
                            onClick={() => (isEditing ? setEditingKey(null) : startEdit(b))}
                            className="px-2 py-1 rounded bg-white/10 hover:bg-white/20 text-xs text-white border border-white/10"
                          >
                            {isEditing ? 'Cancel' : b.content ? 'Edit' : 'Add video'}
                          </button>
                        </div>
                        {isEditing && (
                          <div className="mt-2 flex items-center gap-2">
                            <input
                              autoFocus
                              value={editUrl}
                              onChange={(e) => setEditUrl(e.target.value)}
                              placeholder="Paste YouTube URL"
                              className="flex-1 px-2 py-1.5 rounded bg-black/40 border border-white/15 text-white text-xs outline-none focus:border-white/40"
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') saveEdit(b);
                                if (e.key === 'Escape') setEditingKey(null);
                              }}
                            />
                            <button
                              onClick={() => saveEdit(b)}
                              disabled={rowBusy || !editUrl}
                              className="px-3 py-1.5 rounded bg-white text-black text-xs font-medium disabled:opacity-50"
                            >
                              {rowBusy ? 'Saving…' : 'Save'}
                            </button>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
              {rowError && <div className="text-red-400 text-xs mt-2">{rowError}</div>}
            </div>

            <div className="flex items-center justify-between py-3 border-t border-white/10">
              <div>
                <div className="text-white text-sm font-medium">Scroll sound</div>
                <div className="text-white/50 text-xs mt-0.5">
                  Play a tick when crossing each box
                </div>
              </div>
              <button
                role="switch"
                aria-checked={soundOn}
                onClick={() => setSoundOn((s) => !s)}
                className={`relative w-11 h-6 rounded-full transition-colors ${
                  soundOn ? 'bg-white' : 'bg-white/20'
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-black transition-transform ${
                    soundOn ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            <button
              className="mt-6 w-full py-2 rounded-lg bg-white text-black font-medium"
              onClick={() => setAccountOpen(false)}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </>
  );
}
