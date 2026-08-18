import { create } from "zustand";

type State = {
  /** Whether the immersive full-window "Now Playing" karaoke overlay is
   *  open. */
  open: boolean;
  setOpen: (v: boolean) => void;
  toggle: () => void;
};

/**
 * Visibility of the immersive Now-Playing overlay (big cover + full-size
 * synced lyrics), opened from the expand button on the player cover.
 *
 * Deliberately a standalone, NON-persisted store rather than a field on
 * `useLayoutStore`:
 *  - a fresh launch (or a cross-window rehydrate through the shared
 *    `ytm-layout` storage listener) must never resurrect the overlay, and
 *  - it can't be broken later if someone adds a persisted layout field.
 *
 * The overlay only ever lives in the main window, so no cross-window sync
 * is needed here.
 */
export const useNowPlayingStore = create<State>()((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
  toggle: () => set((s) => ({ open: !s.open })),
}));
