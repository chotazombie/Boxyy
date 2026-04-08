import { create } from 'zustand';
import { api, type BoxRecord } from './api';

/**
 * Cache of server-side box metadata keyed by "x:y".
 * - `fetch(x,y)` is idempotent: in-flight promises are de-duped.
 * - `update(box)` writes the authoritative record returned by claim/setContent.
 */

interface BoxStoreState {
  boxes: Record<string, BoxRecord>;
  inFlight: Record<string, Promise<BoxRecord>>;
  fetch: (x: number, y: number) => Promise<BoxRecord>;
  update: (box: BoxRecord) => void;
  get: (x: number, y: number) => BoxRecord | undefined;
}

const key = (x: number, y: number) => `${x}:${y}`;

export const useBoxStore = create<BoxStoreState>((set, getState) => ({
  boxes: {},
  inFlight: {},

  get: (x, y) => getState().boxes[key(x, y)],

  fetch: async (x, y) => {
    const k = key(x, y);
    const existing = getState().boxes[k];
    if (existing) return existing;
    const pending = getState().inFlight[k];
    if (pending) return pending;
    const p = api
      .getBox(x, y)
      .then((box) => {
        set((s) => ({
          boxes: { ...s.boxes, [k]: box },
          inFlight: Object.fromEntries(Object.entries(s.inFlight).filter(([kk]) => kk !== k)),
        }));
        return box;
      })
      .catch((err) => {
        set((s) => ({
          inFlight: Object.fromEntries(Object.entries(s.inFlight).filter(([kk]) => kk !== k)),
        }));
        throw err;
      });
    set((s) => ({ inFlight: { ...s.inFlight, [k]: p } }));
    return p;
  },

  update: (box) =>
    set((s) => ({
      boxes: { ...s.boxes, [key(box.x, box.y)]: box },
    })),
}));
