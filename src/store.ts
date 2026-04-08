import { create } from 'zustand';

interface GridState {
  centerX: number;
  centerY: number;
  setCenter: (x: number, y: number) => void;
}

export const useGridStore = create<GridState>((set) => ({
  centerX: 0,
  centerY: 0,
  setCenter: (x, y) => set({ centerX: x, centerY: y }),
}));
