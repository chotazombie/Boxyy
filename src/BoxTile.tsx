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
 * BoxTile — universal cross-browser YouTube embed
 *
 * Why this is implemented the way it is:
 *
 * Different browsers handle wheel events that occur physically over a
 * cross-origin iframe (a YouTube embed) differently:
 *
 *   - Safari (WebKit) propagates the wheel event up to the parent document
 *     if the iframe doesn't consume it. So scrolling over a YouTube tile
 *     "works" with a normal interactive iframe — but this is Safari being
 *     unusually lenient. It's a quirk, not the standard.
 *
 *   - Chrome / Edge / Brave / Arc (Blink) and Firefox (Gecko) DO NOT
 *     propagate. The cross-origin process boundary is hard. The parent
 *     never sees the event. So scrolling over a YouTube tile is dead.
 *
 * To make scrolling work in every browser, we set the iframe to
 * `pointer-events: none`. The browser then ignores it during hit-testing
 * and routes wheel/pointer events straight through to the canvas behind.
 * Universal, no browser sniffing.
 *
 * The cost is that YouTube's own controls (play/pause/seek/volume) become
 * unreachable. We restore them via the **YouTube IFrame API**, which
 * YouTube explicitly exposes for cross-origin parent control. The parent
 * sends commands like `{"event":"command","func":"playVideo"}` via
 * `postMessage`, and YouTube responds. This is a documented, supported
 * protocol that works in every browser.
 *
 * The iframe URL must include `enablejsapi=1` for postMessage commands
 * to work, and `controls=0` so YouTube doesn't render its own UI on top
 * of ours.
 *
 * Our custom controls (play/pause, mute/unmute, fullscreen) are React-
 * rendered buttons that sit on top of the iframe. They're part of our
 * document, not YouTube's, so they receive clicks normally and work
 * everywhere.
 */

function BoxTileImpl({ box, width, height, px, py, active }: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [hovered, setHovered] = useState(false);
  const [playing, setPlaying] = useState(true);  // assume autoplay starts playing
  const [muted, setMuted] = useState(false);    // we unmute via postMessage after load
  const [fullscreen, setFullscreen] = useState(false);

  const isYouTube = box?.content?.kind === 'youtube';
  const videoId = box?.content?.kind === 'youtube' ? box.content.data.videoId : null;

  // Reset playback state when the underlying video changes (owner switched it).
  // Default: playing + unmuted. We keep mute=1 in the URL for autoplay compliance
  // and immediately send unMute via postMessage once the iframe loads.
  useEffect(() => {
    if (videoId) {
      setPlaying(true);
      setMuted(false);
    }
  }, [videoId]);

  // Auto-unmute after iframe loads. The embed URL uses mute=1 so autoplay works
  // in every browser, then we unmute via the IFrame API. The 1s delay gives the
  // YouTube player time to initialize its postMessage listener.
  useEffect(() => {
    if (!videoId) return;
    const timer = setTimeout(() => sendYT('unMute'), 1000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId]);

  // Track fullscreen state. When this tile becomes fullscreen, we flip the
  // iframe to pointer-events:auto so YouTube's own controls become reachable.
  // When we exit fullscreen, scroll-passthrough mode kicks back in.
  useEffect(() => {
    const handler = () => {
      setFullscreen(document.fullscreenElement === rootRef.current);
    };
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  // Send a postMessage command to the YouTube iframe via the IFrame API.
  // This is the cross-origin remote-control channel YouTube exposes.
  const sendYT = (func: string, args: unknown[] = []) => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    try {
      win.postMessage(JSON.stringify({ event: 'command', func, args }), '*');
    } catch {
      /* never break the UI on a postMessage failure */
    }
  };

  const togglePlay = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (playing) {
      sendYT('pauseVideo');
      setPlaying(false);
    } else {
      sendYT('playVideo');
      setPlaying(true);
    }
  };

  const toggleMute = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (muted) {
      sendYT('unMute');
      setMuted(false);
    } else {
      sendYT('mute');
      setMuted(true);
    }
  };

  const toggleFullscreen = (e: React.MouseEvent) => {
    e.stopPropagation();
    const el = rootRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen();
    else el.requestFullscreen?.();
  };

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
  } else if (videoId) {
    const params = new URLSearchParams({
      autoplay: '1',           // start playing on load
      mute: '1',               // required for autoplay in every modern browser
      loop: '1',               // loop the video
      playlist: videoId,       // required for `loop` to work on a single video
      // controls=1 keeps YouTube's native UI in the DOM. While the iframe is
      // pointer-events:none, those controls receive no hover/click events so
      // they auto-hide and stay hidden — invisible in normal browsing. The
      // moment we go fullscreen and flip pointer-events to auto, YouTube's
      // hover detection wakes them back up with the full control bar
      // (timeline scrubber, volume slider, quality, captions, etc.).
      controls: '1',
      fs: '0',                 // hide YouTube's own fullscreen button — we provide
                               //   our own. YouTube's button conflicts with our
                               //   requestFullscreen() on the parent tile div.
      modestbranding: '1',
      rel: '0',
      iv_load_policy: '3',     // hide annotations
      playsinline: '1',
      enablejsapi: '1',        // enable postMessage commands
    });
    inner = (
      <iframe
        ref={iframeRef}
        title={`yt-${videoId}`}
        src={`https://www.youtube.com/embed/${videoId}?${params.toString()}`}
        className="w-full h-full"
        // Default mode: pointer-events:none → wheel/pointer pass through to
        //   the canvas in every browser. Our React overlay provides
        //   play/pause/mute/fullscreen controls.
        // Fullscreen mode: pointer-events:auto → YouTube's own native
        //   controls (timeline, volume slider, quality, captions, etc.)
        //   become fully reachable. Our overlay hides itself.
        style={{ pointerEvents: fullscreen ? 'auto' : 'none' }}
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

  // Show the controls bar on hover, or whenever the video is paused (so users
  // always have a way to resume). In fullscreen, we hide play/pause/mute
  // (YouTube's own controls handle those) but keep our fullscreen exit button.
  const showControlsBar =
    !fullscreen && active && !!videoId && (hovered || !playing);
  const showFullscreenButton =
    active && !!videoId && (fullscreen || hovered || !playing);

  // Click anywhere on the active video tile → toggle play/pause.
  // Buttons already stopPropagation, so their clicks don't reach here.
  // Drag moves the pointer significantly, so the browser doesn't fire click.
  const handleTileClick = (e: React.MouseEvent) => {
    if (!active || !videoId || fullscreen) return;
    togglePlay(e);
  };

  return (
    <div
      ref={rootRef}
      className="absolute will-change-transform transition-[filter,opacity] duration-300 ease-out"
      onClick={handleTileClick}
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

      {/* Owner badge — pointer-events:none so it doesn't block scroll */}
      {box?.ownerUsername && (
        <div className="absolute top-3 left-3 z-20 px-2 py-1 rounded-md bg-black/60 backdrop-blur text-[11px] text-white/90 border border-white/10 pointer-events-none">
          @{box.ownerUsername}
        </div>
      )}

      {/* Live viewers badge */}
      {active && box && liveViews > 0 && (
        <div className="absolute top-3 right-3 z-20 px-2 py-1 rounded-md bg-black/60 backdrop-blur text-[11px] text-white/90 border border-white/10 flex items-center gap-1.5 pointer-events-none">
          <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
          {liveViews} watching
        </div>
      )}

      {/* Big center play indicator — visible only when paused (not in fullscreen) */}
      {!fullscreen && active && videoId && !playing && (
        <button
          onClick={togglePlay}
          onPointerDown={(e) => e.stopPropagation()}
          className="absolute inset-0 z-20 flex items-center justify-center bg-black/20"
          aria-label="Play"
        >
          <span className="w-20 h-20 rounded-full bg-black/70 backdrop-blur border border-white/20 flex items-center justify-center text-white shadow-2xl hover:bg-black/90 transition-colors">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="6 4 20 12 6 20 6 4" />
            </svg>
          </span>
        </button>
      )}

      {/* Hover-revealed controls bar (active YouTube tiles, not in fullscreen) */}
      {showControlsBar && (
        <div
          className="absolute bottom-3 left-3 right-14 z-20 flex items-center gap-2"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button
            onClick={togglePlay}
            className="w-10 h-10 rounded-full bg-black/60 hover:bg-black/80 backdrop-blur border border-white/15 flex items-center justify-center text-white"
            title={playing ? 'Pause' : 'Play'}
            aria-label={playing ? 'Pause' : 'Play'}
          >
            {playing ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="4" width="4" height="16" />
                <rect x="14" y="4" width="4" height="16" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="6 4 20 12 6 20 6 4" />
              </svg>
            )}
          </button>
          <button
            onClick={toggleMute}
            className="w-10 h-10 rounded-full bg-black/60 hover:bg-black/80 backdrop-blur border border-white/15 flex items-center justify-center text-white"
            title={muted ? 'Unmute' : 'Mute'}
            aria-label={muted ? 'Unmute' : 'Mute'}
          >
            {muted ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                <line x1="23" y1="9" x2="17" y2="15" />
                <line x1="17" y1="9" x2="23" y2="15" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
              </svg>
            )}
          </button>
        </div>
      )}

      {/* Fullscreen button — visible on hover AND in fullscreen (acts as exit) */}
      {showFullscreenButton && (
        <button
          onClick={toggleFullscreen}
          onPointerDown={(e) => e.stopPropagation()}
          className="absolute bottom-3 right-3 z-30 w-10 h-10 rounded-full bg-black/60 hover:bg-black/80 backdrop-blur border border-white/15 flex items-center justify-center text-white"
          title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          aria-label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
        >
          {fullscreen ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 4v5H4" />
              <path d="M15 4v5h5" />
              <path d="M9 20v-5H4" />
              <path d="M15 20v-5h5" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 9V4h5" />
              <path d="M20 9V4h-5" />
              <path d="M4 15v5h5" />
              <path d="M20 15v5h-5" />
            </svg>
          )}
        </button>
      )}

      {/* Fullscreen button on non-video active boxes */}
      {active && box && !videoId && hovered && (
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
