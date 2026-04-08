import { create } from 'zustand';
import { api, type BoxRecord } from './api';

/**
 * Ranked feed of owned boxes.
 *
 * - `items` is the current snapshot, ordered by server-computed rank.
 * - `centerIndex` is the user's current position in the feed.
 * - During active scrolling the items array is FROZEN; we never reorder under
 *   the user's hands. Refreshes happen on idle, and we rebase `centerIndex` so
 *   the user stays on the same box even when the ranking around it shifts.
 */

interface FeedState {
  items: BoxRecord[];
  centerIndex: number;
  version: number;
  loaded: boolean;

  refresh: () => Promise<void>;
  seekToBox: (x: number, y: number) => Promise<void>;
  setCenterIndex: (i: number) => void;
  insertNewBox: (box: BoxRecord) => void;
  updateBox: (box: BoxRecord) => void;
}

export const useFeedStore = create<FeedState>((set, get) => ({
  items: [],
  centerIndex: 0,
  version: 0,
  loaded: false,

  refresh: async () => {
    const { items, version } = await api.getFeed();
    // Preserve the user's current box across reorders.
    const currentBox = get().items[get().centerIndex];
    let nextCenter = get().centerIndex;
    if (currentBox) {
      const newIdx = items.findIndex((b) => b.x === currentBox.x && b.y === currentBox.y);
      if (newIdx >= 0) nextCenter = newIdx;
    }
    set({ items, version, loaded: true, centerIndex: Math.max(0, nextCenter) });
  },

  seekToBox: async (x, y) => {
    if (!get().loaded) await get().refresh();
    let idx = get().items.findIndex((b) => b.x === x && b.y === y);
    if (idx < 0) {
      // Box may have been added since last refresh.
      await get().refresh();
      idx = get().items.findIndex((b) => b.x === x && b.y === y);
    }
    if (idx >= 0) set({ centerIndex: idx });
  },

  setCenterIndex: (i) => set({ centerIndex: i }),

  insertNewBox: (box) => {
    // Optimistic insert at the front of the feed; refresh will resort.
    const items = [box, ...get().items.filter((b) => !(b.x === box.x && b.y === box.y))];
    set({ items, centerIndex: 0 });
  },

  updateBox: (box) => {
    const items = get().items.map((b) => (b.x === box.x && b.y === box.y ? box : b));
    set({ items });
  },
}));
