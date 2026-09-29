import { create } from 'zustand'

// The floor lamp's pull switch. `lampLevel` is the shared uniform the room's
// materials and lights follow (a filament takes a few tens of ms to glow).

interface LampState {
  on: boolean
  /** The pull cord is being held: the camera stops following the pointer. */
  dragging: boolean
  toggle: () => void
}

export const useLamp = create<LampState>((set, get) => ({
  on: true,
  dragging: false,
  toggle: () => set({ on: !get().on }),
}))

export const lampLevel = { value: 1 }
