import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useFeedStore } from './feedStore';
import { BoxTile } from './BoxTile';
import { initTickSoundOnGesture, tickOnBoxCross, resetTickAccumulator } from './tickSound';
import { BoxControlPanel } from './BoxControlPanel';
import { api } from './api';

/**
 * InfiniteCanvas — activity-ranked feed edition (Part 3 of SPEC.md).
 *
 * The grid no longer represents a coordinate plane. It renders a sliding
 * 3×3 window over a server-ranked feed of owned boxes. The user's position
 * in the feed is `centerIndex`. Scrolling right advances by 1; scrolling down
 * advances by 3 (one row). The visible 9 cells are:
 *
 *     [c-4][c-3][c-2]
 *     [c-1][ c ][c+1]
 *     [c+2][c+3][c+4]
 *
 * The address (x, y) of the active box is still synced to the URL `/x/y` and
 * still copyable via right-click — it's just no longer the layout key.
 */

const NEIGHBOR_RANGE = 1; // 3x3 = 9 boxes
const ROW_W = 3;          // viewport row width in cells
const SNAP_STIFFNESS = 0.18;
const SNAP_DAMPING = 0.74;
const WHEEL_IDLE_MS = 120;
const HEARTBEAT_MS = 10000;
const REFRESH_IDLE_MS = 5000;

function getBoxDims() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let width = vw * 0.8;
  let height = width * (9 / 16);
  if (height > vh * 0.85) {
    height = vh * 0.85;
    width = height * (16 / 9);
  }
  return { width: Math.round(width), height: Math.round(height) };
}

interface ContextMenuState {
  screenX: number;
  screenY: number;
  x: number;
  y: number;
}

export function InfiniteCanvas() {
  const navigate = useNavigate();
  const params = useParams();
  const feed = useFeedStore();

  const [dims, setDims] = useState(getBoxDims);
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const [copied, setCopied] = useState(false);

  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const offsetRef = useRef({ x: 0, y: 0 });
  const velocityRef = useRef({ x: 0, y: 0 });
  const draggingRef = useRef(false);
  const wheelingRef = useRef(false);
  const lastPointerRef = useRef({ x: 0, y: 0 });
  const rafRef = useRef<number | null>(null);
  const wheelTimeoutRef = useRef<number | null>(null);
  const refreshTimeoutRef = useRef<number | null>(null);
  const dimsRef = useRef(dims);

  useEffect(() => {
    dimsRef.current = dims;
  }, [dims]);

  // Initial feed load
  useEffect(() => {
    feed.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyTransform = useCallback(() => {
    const w = wrapperRef.current;
    if (!w) return;
    const { x, y } = offsetRef.current;
    w.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  }, []);

  // Rebase: when offset crosses ±boxDim/2, advance centerIndex by 1 (horizontal)
  // or 3 (vertical) and pull the offset back into range.
  const rebase = useCallback(() => {
    const { width, height } = dimsRef.current;
    let { x, y } = offsetRef.current;
    let idx = useFeedStore.getState().centerIndex;
    let changed = false;
    while (x > width / 2) {
      x -= width;
      idx -= 1;
      changed = true;
    }
    while (x < -width / 2) {
      x += width;
      idx += 1;
      changed = true;
    }
    while (y > height / 2) {
      y -= height;
      idx -= ROW_W;
      changed = true;
    }
    while (y < -height / 2) {
      y += height;
      idx += ROW_W;
      changed = true;
    }
    offsetRef.current = { x, y };
    if (changed) {
      tickOnBoxCross();
      // Clamp at the lower bound; allow scrolling past the end into placeholders.
      if (idx < 0) idx = 0;
      useFeedStore.getState().setCenterIndex(idx);
    }
  }, []);

  const snapTick = useCallback(() => {
    if (draggingRef.current || wheelingRef.current) {
      rafRef.current = null;
      return;
    }
    const o = offsetRef.current;
    const v = velocityRef.current;
    v.x = v.x * SNAP_DAMPING + -o.x * SNAP_STIFFNESS;
    v.y = v.y * SNAP_DAMPING + -o.y * SNAP_STIFFNESS;
    o.x += v.x;
    o.y += v.y;
    if (
      Math.abs(o.x) < 0.25 &&
      Math.abs(o.y) < 0.25 &&
      Math.abs(v.x) < 0.25 &&
      Math.abs(v.y) < 0.25
    ) {
      o.x = 0;
      o.y = 0;
      v.x = 0;
      v.y = 0;
      applyTransform();
      resetTickAccumulator();
      rafRef.current = null;
      return;
    }
    rebase();
    applyTransform();
    rafRef.current = requestAnimationFrame(snapTick);
  }, [applyTransform, rebase]);

  const startSnap = useCallback(() => {
    if (rafRef.current == null) {
      rafRef.current = requestAnimationFrame(snapTick);
    }
  }, [snapTick]);

  const stopSnap = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    velocityRef.current = { x: 0, y: 0 };
  }, []);

  // Schedule a feed refresh when the user goes idle.
  const scheduleIdleRefresh = useCallback(() => {
    if (refreshTimeoutRef.current) window.clearTimeout(refreshTimeoutRef.current);
    refreshTimeoutRef.current = window.setTimeout(() => {
      feed.refresh().catch(() => {});
    }, REFRESH_IDLE_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    initTickSoundOnGesture();
    scheduleIdleRefresh();
  }, [scheduleIdleRefresh]);

  // URL handling
  useEffect(() => {
    const px = params.x != null ? parseInt(params.x, 10) : NaN;
    const py = params.y != null ? parseInt(params.y, 10) : NaN;
    if (!Number.isNaN(px) && !Number.isNaN(py)) {
      feed.seekToBox(px, py).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.x, params.y]);

  // Sync URL when centerIndex points at a real box
  useEffect(() => {
    const item = feed.items[feed.centerIndex];
    if (!item) return;
    const url = `/${item.x}/${item.y}`;
    if (window.location.pathname !== url) {
      navigate(url, { replace: true });
    }
  }, [feed.centerIndex, feed.items, navigate]);

  // Heartbeat for the active box (mock activity bump)
  useEffect(() => {
    const item = feed.items[feed.centerIndex];
    if (!item) return;
    api.heartbeat(item.x, item.y, null).catch(() => {});
    const t = window.setInterval(() => {
      api.heartbeat(item.x, item.y, null).catch(() => {});
    }, HEARTBEAT_MS);
    return () => window.clearInterval(t);
  }, [feed.centerIndex, feed.items]);

  useEffect(() => {
    const onResize = () => setDims(getBoxDims());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // ----- Pointer drag -----
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button === 2) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest('button, input, textarea, select, a, [data-ui], iframe')) return;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    stopSnap();
    draggingRef.current = true;
    lastPointerRef.current = { x: e.clientX, y: e.clientY };
    setMenu(null);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    const dx = e.clientX - lastPointerRef.current.x;
    const dy = e.clientY - lastPointerRef.current.y;
    offsetRef.current.x += dx;
    offsetRef.current.y += dy;
    lastPointerRef.current = { x: e.clientX, y: e.clientY };
    rebase();
    applyTransform();
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    try {
      (e.currentTarget as Element).releasePointerCapture(e.pointerId);
    } catch {}
    startSnap();
    scheduleIdleRefresh();
  };

  // ----- Wheel / 2-finger trackpad pan -----
  useEffect(() => {
    const el = wrapperRef.current?.parentElement;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      wheelingRef.current = true;
      stopSnap();
      offsetRef.current.x -= e.deltaX;
      offsetRef.current.y -= e.deltaY;
      rebase();
      applyTransform();
      if (wheelTimeoutRef.current) window.clearTimeout(wheelTimeoutRef.current);
      wheelTimeoutRef.current = window.setTimeout(() => {
        wheelingRef.current = false;
        startSnap();
        scheduleIdleRefresh();
      }, WHEEL_IDLE_MS);
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, [applyTransform, rebase, startSnap, stopSnap, scheduleIdleRefresh]);

  // ----- Keyboard -----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const { width, height } = dimsRef.current;
      if (e.key === 'ArrowRight') offsetRef.current.x -= width;
      else if (e.key === 'ArrowLeft') offsetRef.current.x += width;
      else if (e.key === 'ArrowDown') offsetRef.current.y -= height;
      else if (e.key === 'ArrowUp') offsetRef.current.y += height;
      else return;
      startSnap();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [startSnap]);

  // ----- Right-click: copy box address -----
  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const o = offsetRef.current;
    const { width, height } = dimsRef.current;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const cxScreen = vw / 2 - width / 2 + o.x;
    const cyScreen = vh / 2 - height / 2 + o.y;
    const relX = e.clientX - cxScreen;
    const relY = e.clientY - cyScreen;
    const dx = Math.floor(relX / width);
    const dy = Math.floor(relY / height);
    const idx = feed.centerIndex + dy * ROW_W + dx;
    const item = feed.items[idx];
    if (!item) return; // placeholder slot has no address
    setMenu({ screenX: e.clientX, screenY: e.clientY, x: item.x, y: item.y });
  };

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [menu]);

  const copyAddress = async () => {
    if (!menu) return;
    const url = `${window.location.origin}/${menu.x}/${menu.y}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = url;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
    setMenu(null);
  };

  // ----- Render -----
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const cxScreen = vw / 2 - dims.width / 2;
  const cyScreen = vh / 2 - dims.height / 2;

  const tiles: React.ReactNode[] = [];
  for (let dy = -NEIGHBOR_RANGE; dy <= NEIGHBOR_RANGE; dy++) {
    for (let dx = -NEIGHBOR_RANGE; dx <= NEIGHBOR_RANGE; dx++) {
      const idx = feed.centerIndex + dy * ROW_W + dx;
      const px = cxScreen + dx * dims.width;
      const py = cyScreen + dy * dims.height;
      const isActive = dx === 0 && dy === 0;
      const item = idx >= 0 ? feed.items[idx] : undefined;
      tiles.push(
        <BoxTile
          key={`slot-${dx}-${dy}-${item ? `${item.x}:${item.y}` : `ph-${idx}`}`}
          box={item ?? null}
          width={dims.width}
          height={dims.height}
          px={px}
          py={py}
          active={isActive}
        />
      );
    }
  }

  const activeItem = feed.items[feed.centerIndex] ?? null;

  return (
    <div
      className="fixed inset-0 select-none cursor-grab active:cursor-grabbing overflow-hidden"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onContextMenu={onContextMenu}
    >
      <div ref={wrapperRef} style={{ position: 'absolute', inset: 0, willChange: 'transform' }}>
        {tiles}
      </div>

      {menu && (
        <div
          className="fixed z-50 min-w-[180px] rounded-lg border border-white/10 bg-neutral-900/95 backdrop-blur shadow-2xl py-1 text-sm"
          style={{ left: menu.screenX, top: menu.screenY }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="w-full text-left px-3 py-2 hover:bg-white/10 text-white/90"
            onClick={copyAddress}
          >
            Copy box address
          </button>
          <div className="px-3 py-1 text-xs text-white/40 font-mono border-t border-white/5">
            ({menu.x}, {menu.y})
          </div>
        </div>
      )}

      <BoxControlPanel box={activeItem} />

      {copied && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-full bg-white text-black text-sm font-medium shadow-lg">
          Address copied
        </div>
      )}
    </div>
  );
}
