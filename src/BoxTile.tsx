import React, { memo, useEffect, useRef, useState } from 'react';
import type { BoxRecord } from './api';

interface Props {
  box: BoxRecord | null;       // null = placeholder slot
  width: number;
  height: number;
  px: number;
  py: number;
  active: boolean;
}

/**
 * BoxTile
 *
 * YouTube interactivity model — read this before changing iframe behavior:
 *
 * Wheel events that occur over a cross-origin iframe (like a YouTube embed)
 * are delivered to the iframe's own document and CANNOT be intercepted by the
 * parent page. There is no CSS or JS workaround. So we cannot have "scroll
 * always works AND iframe controls always work" at the same time over the
 * same pixels.
 *
 * The pattern we use, same as Twitter / Reddit / TikTok web:
 *
 *   - Default mode: iframe is `pointer-events: none`. Scroll, drag, and
 *     right-click pass straight through to the canvas. The video still
 *     autoplays muted and loops, so passive viewing works fine.
 *
 *   - Interact mode: user clicks the small "controls" button on the active
 *     tile to enable iframe interactivity. Iframe becomes `pointer-events:
 *     auto`, so YouTube's play/pause/seek/volume/unmute controls work. While
 *     in interact mode, scrolling over the box does not move the canvas
 *     (it goes to YouTube). Click the same button (now an "X") to exit and
 *     resume scrolling.
 *
 *   - Interact mode auto-resets when the tile becomes inactive (the user
 *     scrolled away) so the next active box always starts in default mode.
 */
function BoxTileImpl({ box, width, height, px, py, active }: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [hovered, setHovered] = useState(false);
  const [interactive, setInteractive] = useState(false);

  // Reset interact mode whenever this tile stops being the active one.
  useEffect(() => {
    if (!active && interactive) setInteractive(false);
  }, [active, interactive]);

  const toggleFullscreen = (e: React.MouseEvent) => {
    e.stopPropagation();
    const el = rootRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen();
    else el.requestFullscreen?.();
  };

  const toggleInteract = (e: React.MouseEvent) => {
    e.stopPropagation();
    setInteractive((v) => !v);
  };

  const isYouTube = box?.content?.kind === 'youtube';

  let inner: React.ReactNode = null;
  if (!box) {
    inner = (
      <div className="w-full h-full flex flex-col items-center justify-center gap-3 bg-neutral-900 text-white/40">
        <div className="w-14 h-14 rounded-full border-2 border-white/20 flex items-center justify-center text-3xl">
          +
        </div>
        <div className="text-sm">Claim a new box</div>
      </div>
    );
  } else if (isYouTube && box.content?.kind === 'youtube') {
    const id = box.content.data.videoId;
    const params = new URLSearchParams({
      autoplay: active ? '1' : '0',
      mute: '1',
      loop: '1',
      playlist: id,
      controls: '1',
      modestbranding: '1',
      rel: '0',
    });
    inner = (
      <iframe
        title={`yt-${id}`}
        src={`https://www.youtube.com/embed/${id}?${params}`}
        className="w-full h-full"
        // pointer-events toggles between scroll-passthrough and YouTube-controls
        // based on the user's explicit interact-mode choice (see component doc).
        style={{ pointerEvents: interactive && active ? 'auto' : 'none' }}
        frameBorder={0}
        allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
        allowFullScreen
      />
    );
  } else {
    inner = (
      <div className="w-full h-full flex items-center justify-center bg-neutral-900 text-white/30 text-sm">
        Empty — owner hasn't added a video yet
      </div>
    );
  }

  const liveViews = box?.activity?.liveViews ?? 0;
  const showControls = active && box && (hovered || interactive);

  return (
    <div
      ref={rootRef}
      className="absolute will-change-transform transition-[filter,opacity] duration-300 ease-out group"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width,
        height,
        transform: `translate3d(${px}px, ${py}px, 0)`,
        filter: active ? 'none' : 'brightness(0.45) blur(1px)',
        opacity: active ? 1 : 0.85,
        boxShadow: active
          ? '0 30px 80px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.05)'
          : '0 10px 30px rgba(0,0,0,0.5)',
        borderRadius: 16,
        overflow: 'hidden',
        zIndex: active ? 10 : 1,
        background: '#000',
      }}
    >
      {inner}

      {box?.ownerUsername && (
        <div className="absolute top-3 left-3 z-20 px-2 py-1 rounded-md bg-black/60 backdrop-blur text-[11px] text-white/90 border border-white/10 pointer-events-none">
          @{box.ownerUsername}
        </div>
      )}

      {active && box && liveViews > 0 && (
        <div className="absolute top-3 right-3 z-20 px-2 py-1 rounded-md bg-black/60 backdrop-blur text-[11px] text-white/90 border border-white/10 flex items-center gap-1.5 pointer-events-none">
          <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
          {liveViews} watching
        </div>
      )}

      {/* Interact toggle — only on YouTube boxes that are active */}
      {showControls && isYouTube && (
        <button
          onClick={toggleInteract}
          onPointerDown={(e) => e.stopPropagation()}
          className={`absolute bottom-3 left-3 z-20 h-10 px-3 rounded-full backdrop-blur border flex items-center gap-2 text-xs font-medium transition-colors ${
            interactive
              ? 'bg-white text-black border-white'
              : 'bg-black/60 hover:bg-black/80 text-white border-white/15'
          }`}
          title={interactive ? 'Exit interact mode (resume scrolling)' : 'Interact with video (pause scrolling)'}
        >
          {interactive ? (
            <>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
              Done
            </>
          ) : (
            <>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
              Controls
            </>
          )}
        </button>
      )}

      {showControls && (
        <button
          onClick={toggleFullscreen}
          onPointerDown={(e) => e.stopPropagation()}
          className="absolute bottom-3 right-3 z-20 w-10 h-10 rounded-full bg-black/60 hover:bg-black/80 backdrop-blur border border-white/15 flex items-center justify-center text-white"
          title="Fullscreen"
          aria-label="Fullscreen"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 9V4h5" />
            <path d="M20 9V4h-5" />
            <path d="M4 15v5h5" />
            <path d="M20 15v5h-5" />
          </svg>
        </button>
      )}
    </div>
  );
}

export const BoxTile = memo(BoxTileImpl);
