import { create } from 'zustand'
import { getAlbum, type Album } from '../spotify/api'
import { splitIntoSides, type Side } from '../vinyl/sides'
import { deckAudio } from '../audio/deckAudio'
import { isDemoAlbum } from '../demo/great78'

// Physical state of the room. The 3D rig animates towards it every frame and
// the playback controller derives what Spotify should be doing from it.

export type VinylPlace = 'sleeve' | 'hand' | 'platter'
export type ArmState =
  | 'rest' // on the arm rest
  | 'lifted' // raised by the cue lever, free to swing
  | 'down' // stylus in the groove
  | 'auto-in' // automatic cueing to the lead-in
  | 'auto-return' // automatic return to the rest
export type Focus = 'room' | 'crate' | 'deck' | 'both' | 'window' | 'chair' | 'shelf' | 'free'

/** Views an action never moves away from: free camera, crate + deck together. */
const keepsFocus = (f: Focus) => f === 'free' || f === 'both'

interface DeckState {
  focus: Focus
  album: Album | null
  sides: Side[]
  /** Index into `sides` of the face pointing up (platter) or towards the viewer (hand). */
  sideIndex: number
  vinyl: VinylPlace
  lidOpen: boolean
  motorOn: boolean
  speed: 33 | 45
  arm: ArmState
  /** Target arm yaw set by the user while dragging a lifted arm (radians). */
  armYaw: number
  /** Groove radius under the stylus (metres), kept up to date by the rig. */
  stylusRadius: number | null
  /** Stylus physically touching the record (set by the rig when lowering ends). */
  contact: boolean
  /** Platter has reached the selected speed (set by the rig). */
  atSpeed: boolean
  /**
   * Where the picked sleeve was lifted from (world position + quaternion), so
   * it can be carried to the stand. `watch` = keep the camera on the flight.
   */
  pickedFrom: { pos: [number, number, number]; quat: [number, number, number, number]; watch: boolean } | null
  message: string | null

  /** Back to an empty deck (leaving for the home page). */
  reset: () => void

  /** A view the user chose (buttons, keys): always obeyed. */
  setFocus: (f: Focus) => void
  /** A view an action suggests (picking, taking a record…): ignored in the free and crate + deck views. */
  followFocus: (f: Focus) => void
  pickAlbum: (album: Album, from?: DeckState['pickedFrom']) => Promise<void>
  returnAlbum: () => void
  takeVinyl: () => void
  flipVinyl: () => void
  placeOnPlatter: () => void
  sleeveVinyl: () => void
  /** Double albums: swap the record in hand for the other one in the sleeve. */
  swapRecord: () => void
  toggleLid: () => void
  toggleStart: () => void
  toggleSpeed: () => void
  toggleCue: () => void
  dragArm: (yaw: number) => void
  armArrived: (state: ArmState) => void
  setStylusRadius: (r: number | null) => void
  setContact: (contact: boolean) => void
  setAtSpeed: (atSpeed: boolean) => void
  say: (m: string | null) => void
}

const INITIAL = {
  focus: 'room' as Focus,
  album: null,
  sides: [],
  sideIndex: 0,
  vinyl: 'sleeve' as VinylPlace,
  lidOpen: true,
  motorOn: false,
  speed: 33 as const,
  arm: 'rest' as ArmState,
  armYaw: 0,
  stylusRadius: null,
  contact: false,
  atSpeed: false,
  pickedFrom: null,
  message: null,
}

export const useDeck = create<DeckState>((set, get) => ({
  ...INITIAL,
  reset: () => set(INITIAL),

  setFocus: (focus) => set({ focus }),
  followFocus: (focus) => {
    if (!keepsFocus(get().focus)) set({ focus })
  },

  pickAlbum: async (picked, from = null) => {
    const { vinyl, album: current } = get()
    if (current && vinyl !== 'sleeve') {
      return set({ message: 'Guarda primero el disco que tienes fuera' })
    }
    try {
      // Search results and saved albums may carry a partial tracklist
      // (the demo records come complete)
      const album = picked.id.startsWith('demo') || isDemoAlbum(picked.id) ? picked : await getAlbum(picked.id)
      // With a known origin the deck carries the sleeve over and moves the
      // camera itself once it has landed (or right away, if `watch` is off)
      set({
        album,
        sides: splitIntoSides(album),
        sideIndex: 0,
        vinyl: 'sleeve',
        pickedFrom: from,
        message: null,
        ...(from || keepsFocus(get().focus) ? {} : { focus: 'deck' as const }),
      })
    } catch (e) {
      set({ message: (e as Error).message })
    }
  },

  returnAlbum: () => {
    if (get().vinyl !== 'sleeve') return
    set({ album: null, sides: [] })
    get().followFocus('crate')
  },

  takeVinyl: () => {
    const { vinyl, arm, album } = get()
    if (!album) return
    if (vinyl === 'platter' && arm !== 'rest') {
      return set({ message: 'Levanta el brazo y déjalo en su soporte antes de quitar el disco' })
    }
    if (vinyl === 'platter' && !get().lidOpen) return set({ message: 'Abre la tapa' })
    deckAudio().resume()
    // From the sleeve the camera waits for the record to come out (see Deck)
    set({ vinyl: 'hand', message: null })
    if (vinyl !== 'sleeve') get().followFocus('deck')
  },

  flipVinyl: () => {
    const { vinyl, sideIndex, sides } = get()
    if (vinyl !== 'hand') return
    // Flip within the same physical record: A<->B, C<->D
    set({ sideIndex: sideIndex % 2 === 0 ? Math.min(sideIndex + 1, sides.length - 1) : sideIndex - 1 })
  },

  placeOnPlatter: () => {
    const { vinyl, lidOpen } = get()
    if (vinyl !== 'hand') return
    if (!lidOpen) return set({ message: 'Abre la tapa' })
    deckAudio().recordOnPlatter()
    set({ vinyl: 'platter', message: null })
  },

  sleeveVinyl: () => {
    if (get().vinyl !== 'hand') return
    set({ vinyl: 'sleeve', sideIndex: get().sideIndex - (get().sideIndex % 2) })
  },

  swapRecord: () => {
    const { vinyl, sideIndex, sides } = get()
    const records = Math.ceil(sides.length / 2)
    if (vinyl !== 'hand' || records < 2) return
    set({ sideIndex: ((Math.floor(sideIndex / 2) + 1) % records) * 2 })
  },

  toggleLid: () => {
    const { lidOpen, arm } = get()
    if (lidOpen && (arm === 'lifted' || arm === 'auto-in' || arm === 'auto-return')) {
      return set({ message: 'Espera a que el brazo esté quieto' })
    }
    deckAudio().click(1.4)
    set({ lidOpen: !lidOpen })
  },

  toggleStart: () => {
    const { motorOn, arm, vinyl } = get()
    deckAudio().resume()
    deckAudio().click()
    if (!motorOn) {
      // PS 500 start: platter spins; with a record and the arm at rest it cues itself.
      set({ motorOn: true, arm: vinyl === 'platter' && arm === 'rest' ? 'auto-in' : arm })
    } else {
      set({ motorOn: false, arm: arm === 'rest' ? 'rest' : 'auto-return' })
    }
  },

  toggleSpeed: () => {
    deckAudio().click(0.7)
    set({ speed: get().speed === 33 ? 45 : 33 })
  },

  toggleCue: () => {
    const { arm } = get()
    deckAudio().click(0.8)
    if (arm === 'down') set({ arm: 'lifted' })
    else if (arm === 'lifted') set({ arm: 'down' })
    else if (arm === 'rest') set({ arm: 'lifted' })
  },

  dragArm: (armYaw) => {
    if (get().arm === 'lifted') set({ armYaw })
  },

  armArrived: (arm) => set({ arm }),

  setStylusRadius: (stylusRadius) => set({ stylusRadius }),

  setContact: (contact) => {
    if (contact !== get().contact) set({ contact })
  },

  setAtSpeed: (atSpeed) => {
    if (atSpeed !== get().atSpeed) set({ atSpeed })
  },

  say: (message) => set({ message }),
}))

export const currentSide = (s: Pick<DeckState, 'sides' | 'sideIndex'>) => s.sides[s.sideIndex] ?? null
