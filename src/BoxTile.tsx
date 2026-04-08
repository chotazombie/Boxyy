import React, { memo, useRef, useState } from 'react';
import type { BoxRecord } from './api';

interface Props {
  box: BoxRecord | null;       // null = placeholder slot
  width: number;
  height: number;
  px: number;
  py: number;
  active: boolean;
}

function BoxTileImpl({ box, width, height, px, py, active }: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [hovered, setHovered] = useState(false);

  const toggleFullscreen = (e: React.MouseEvent) => {
    e.stopPropagation();
    const el = rootRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen();
    else el.requestFullscreen?.();
  };

  let inner: React.ReactNode = null;
  if (!box) {
    // Placeholder slot — no content, no address
    inner = (
      <div className="w-full h-full flex flex-col items-center justify-center gap-3 bg-neutral-900 text-white/40">
        <div className="w-14 h-14 rounded-full border-2 border-white/20 flex items-center justify-center text-3xl">
          +
        </div>
        <div className="text-sm">Claim a new box</div>
      </div>
    );
  } else if (box.content?.kind === 'youtube') {
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
        // pointer-events: none lets scroll and drag pass through to the canvas.
        // The video autoplays muted + loops, so YouTube's own controls aren't
        // needed for the default browsing experience. Fullscreen via the corner
        // button still works because requestFullscreen() temporarily promotes
        // the tile and the iframe accepts pointer events inside fullscreen.
        style={{ pointerEvents: 'none' }}
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
        <div className="absolute top-3 left-3 z-20 px-2 py-1 rounded-md bg-black/60 backdrop-blur text-[11px] text-white/90 border border-white/10">
          @{box.ownerUsername}
        </div>
      )}

      {active && box && liveViews > 0 && (
        <div className="absolute top-3 right-3 z-20 px-2 py-1 rounded-md bg-black/60 backdrop-blur text-[11px] text-white/90 border border-white/10 flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
          {liveViews} watching
        </div>
      )}

      {active && box && hovered && (
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
