import { useState } from 'react';
import { useAuth } from './auth';
import { useFeedStore } from './feedStore';
import { useUI } from './uiStore';
import { api, type BoxRecord } from './api';

/**
 * Floating control panel for the active center slot.
 *
 * Cases:
 *  - placeholder slot         → "Claim a new box" (assigns next spiral coord)
 *  - owned by me              → owner controls (Add / change YouTube video)
 *  - owned by someone else    → no panel (the @owner badge on the tile is enough)
 *
 * Logged-out users always see a "Sign in to claim" prompt that opens the
 * Account modal.
 */
export function BoxControlPanel({ box }: { box: BoxRecord | null }) {
  const { user } = useAuth();
  const insertNewBox = useFeedStore((s) => s.insertNewBox);
  const updateFeedBox = useFeedStore((s) => s.updateBox);
  const openAccount = useUI((s) => s.setAccountOpen);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState('');
  const [editing, setEditing] = useState(false);

  const isPlaceholder = !box;
  const isOwner = !!user && !!box && box.ownerId === user.id;
  const isOwnedByOther = !!box && !!box.ownerId && !isOwner;

  if (isOwnedByOther) return null;

  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  const claimNew = async () => {
    setError(null);
    if (!user) {
      openAccount(true);
      return;
    }
    setBusy(true);
    try {
      const created = await api.claimNextBox();
      insertNewBox(created);
    } catch (e: any) {
      setError(e.message || 'Failed to claim');
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!user || !box) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await api.setContent(box.x, box.y, null, 'youtube', { url });
      updateFeedBox(updated);
      setEditing(false);
      setUrl('');
    } catch (e: any) {
      setError(e.message || 'Failed to save');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed left-1/2 -translate-x-1/2 bottom-6 z-40 max-w-[92vw]"
      onPointerDown={stop}
      onPointerUp={stop}
      onPointerMove={stop}
      onMouseDown={stop}
      onClick={stop}
      onWheel={stop}
    >
      <div className="rounded-2xl border border-white/10 bg-neutral-900/90 backdrop-blur shadow-2xl px-4 py-3 flex items-center gap-3 text-sm">
        {box && (
          <div className="font-mono text-xs text-white/40">
            ({box.x}, {box.y})
          </div>
        )}

        {isPlaceholder && (
          <>
            <span className="text-white/70">
              {user ? 'Empty slot.' : 'Sign in to start claiming boxes.'}
            </span>
            <button
              onClick={claimNew}
              disabled={busy}
              className="px-3 py-1.5 rounded-lg bg-white text-black font-medium disabled:opacity-50"
            >
              {busy ? 'Claiming…' : 'Claim a new box'}
            </button>
          </>
        )}

        {isOwner && !editing && (
          <>
            <span className="text-white/70">You own this box.</span>
            <button
              onClick={() => setEditing(true)}
              className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white border border-white/15"
            >
              {box?.content ? 'Change video' : 'Add YouTube video'}
            </button>
          </>
        )}

        {isOwner && editing && (
          <>
            <input
              autoFocus
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="Paste YouTube URL"
              className="px-3 py-1.5 rounded-lg bg-black/40 border border-white/15 text-white w-72 outline-none focus:border-white/40"
              onKeyDown={(e) => {
                if (e.key === 'Enter') save();
                if (e.key === 'Escape') setEditing(false);
              }}
            />
            <button
              onClick={save}
              disabled={busy || !url}
              className="px-3 py-1.5 rounded-lg bg-white text-black font-medium disabled:opacity-50"
            >
              {busy ? 'Saving…' : 'Save'}
            </button>
            <button
              onClick={() => setEditing(false)}
              className="px-2 py-1.5 rounded-lg text-white/60 hover:text-white"
            >
              Cancel
            </button>
          </>
        )}

        {error && <span className="text-red-400 text-xs">{error}</span>}
      </div>
    </div>
  );
}
