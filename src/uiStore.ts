import { create } from 'zustand';

// Cross-component UI state (no prop drilling).
interface UIState {
  accountOpen: boolean;
  setAccountOpen: (v: boolean) => void;
}

export const useUI = create<UIState>((set) => ({
  accountOpen: false,
  setAccountOpen: (v) => set({ accountOpen: v }),
}));
