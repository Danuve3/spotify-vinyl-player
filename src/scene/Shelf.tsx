import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import type { Album } from '../spotify/api'
import { useDeck } from '../deck/store'
import { coverTexture, finishSleeve } from '../vinyl/sleeveTextures'

// A Vitsoe 606 Universal Shelving System (Dieter Rams, 1960) on the wall
// facing the deck: anodised E-tracks, off-white shelves with their folded
// front lip, the record collection spine-out (pick one to play it), three
// covers on display, a few books and ceramics, and a small "Danuve" neon.
// Lit in real time like the other props; soft painted shadows on the baked wall.

const RECORD_URL = `${import.meta.env.BASE_URL}models/record.glb`
const DECOR_URL = `${import.meta.env.BASE_URL}models/decor.glb`
const WALL_Z = 3.4 // inner face of the front wall (three.js)
const BAY = 0.655
const RAILS = [-0.75, -0.75 + BAY, -0.75 + 2 * BAY, -0.75 + 3 * BAY]
const RAIL_Y: [number, number] = [0.3, 2.2]
const DEEP = 0.36 // record shelves
const SHALLOW = 0.22
type Use = 'records' | 'covers' | 'books' | 'objects' | 'empty'
const SHELVES: { bay: number; y: number; depth: number; use: Use }[] = [
  { bay: 0, y: 0.4, depth: DEEP, use: 'records' },
  { bay: 1, y: 0.4, depth: DEEP, use: 'records' },
  { bay: 2, y: 0.4, depth: DEEP, use: 'records' },
  { bay: 0, y: 0.86, depth: DEEP, use: 'records' },
  { bay: 1, y: 0.86, depth: DEEP, use: 'covers' },
  { bay: 2, y: 0.86, depth: DEEP, use: 'records' },
  { bay: 0, y: 1.32, depth: SHALLOW, use: 'books' },
  { bay: 1, y: 1.32, depth: SHALLOW, use: 'objects' },
  { bay: 2, y: 1.32, depth: SHALLOW, use: 'books' },
  { bay: 0, y: 1.74, depth: SHALLOW, use: 'objects' },
  { bay: 2, y: 1.74, depth: SHALLOW, use: 'books' },
]
const NEON = new THREE.Vector3((RAILS[1] + RAILS[2]) / 2, 1.9, WALL_Z - 0.03)
const SLEEVE = 0.315
const PULL = 0.04 // how far a hovered record slides out

function rng(seed: number) {
  return () => {
    seed = (seed * 16807) % 2147483647
    return (seed - 1) / 2147483646
  }
}

/** Average colour of an album cover, leaning towards its saturated tones. */
function coverColour(url: string, done: (c: THREE.Color) => void) {
  const img = new Image()
  img.crossOrigin = 'anonymous'
  img.onload = () => {
    const c = document.createElement('canvas')
    c.width = c.height = 8
    const ctx = c.getContext('2d', { willReadFrequently: true })!
    ctx.drawImage(img, 0, 0, 8, 8)
    const d = ctx.getImageData(0, 0, 8, 8).data
    let r = 0, g = 0, b = 0, w = 0
    for (let i = 0; i < d.length; i += 4) {
      const max = Math.max(d[i], d[i + 1], d[i + 2]), min = Math.min(d[i], d[i + 1], d[i + 2])
      const k = 0.3 + (max - min) / 255
      r += d[i] * k
      g += d[i + 1] * k
      b += d[i + 2] * k
      w += k
    }
    done(new THREE.Color(r / w / 255, g / w / 255, b / w / 255).convertSRGBToLinear())
  }
  img.src = url
}

function gradientTexture(stops: [number, string][], w = 4, h = 64) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')!
  const g = ctx.createLinearGradient(0, 0, 0, h)
  for (const [at, col] of stops) g.addColorStop(at, col)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

function Neon() {
  const [ready, setReady] = useState(false)
  const { sign, glow, mats } = useMemo(() => {
    const make = (w: number, h: number) => {
      const c = document.createElement('canvas')
      c.width = w
      c.height = h
      const tex = new THREE.CanvasTexture(c)
      tex.colorSpace = THREE.SRGBColorSpace
      return { c, tex }
    }
    const sign = make(1024, 384)
    const glow = make(512, 256)
    const mats = {
      tube: new THREE.MeshBasicMaterial({ map: sign.tex, transparent: true, toneMapped: false, depthWrite: false, color: new THREE.Color(2.2, 2.2, 2.2) }),
      spill: new THREE.MeshBasicMaterial({ map: glow.tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.5 }),
      acrylic: new THREE.MeshPhysicalMaterial({ color: '#ffffff', transparent: true, opacity: 0.12, roughness: 0.05, depthWrite: false }),
      chrome: new THREE.MeshStandardMaterial({ color: '#d9d9d9', metalness: 1, roughness: 0.2 }),
    }
    return { sign, glow, mats }
  }, [])

  useEffect(() => {
    let alive = true
    document.fonts.load('200px Sacramento').finally(() => {
      if (!alive) return
      const draw = (canvas: HTMLCanvasElement, size: number, blurs: [number, string][], core: string | null) => {
        const ctx = canvas.getContext('2d')!
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        ctx.font = `${size}px Sacramento, cursive`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        const x = canvas.width / 2
        const y = canvas.height / 2 + size * 0.04
        for (const [blur, colour] of blurs) {
          ctx.shadowBlur = blur
          ctx.shadowColor = colour
          ctx.fillStyle = colour
          ctx.fillText('Danuve', x, y)
        }
        if (core) {
          ctx.shadowBlur = 0
          ctx.fillStyle = core
          ctx.fillText('Danuve', x, y)
        }
      }
      // The tube: sky-blue glass around a hot, almost white core
      draw(sign.c, 250, [[26, 'rgba(60,175,255,0.9)'], [8, 'rgba(110,200,255,1)']], '#effaff')
      // Light thrown onto the wall behind it
      // Same lettering size as the tube, on a plane 2.2x wider
      draw(glow.c, 250 * (512 / 1024) / 2.2, [[40, 'rgba(50,160,255,0.9)'], [18, 'rgba(100,190,255,0.8)']], null)
      sign.tex.needsUpdate = glow.tex.needsUpdate = true
      setReady(true)
    })
    return () => {
      alive = false
    }
  }, [sign, glow])

  const W = 0.6
  const H = W * (384 / 1024)
  return (
    <group position={NEON}>
      <mesh position={[0, 0, 0.028]} rotation-y={Math.PI} material={mats.spill} visible={ready}>
        <planeGeometry args={[W * 2.2, H * 2.8]} />
      </mesh>
      <mesh position={[0, 0, -0.004]} material={mats.acrylic}>
        <boxGeometry args={[W * 0.92, H * 0.78, 0.005]} />
      </mesh>
      {[-1, 1].flatMap((sx) =>
        [-1, 1].map((sy) => (
          <mesh key={`${sx}${sy}`} position={[sx * W * 0.42, sy * H * 0.32, 0.012]} rotation-x={Math.PI / 2} material={mats.chrome}>
            <cylinderGeometry args={[0.006, 0.006, 0.03, 12]} />
          </mesh>
        )),
      )}
      <mesh position={[0, 0, -0.012]} rotation-y={Math.PI} material={mats.tube} visible={ready}>
        <planeGeometry args={[W, H]} />
      </mesh>
      {/* A little of its light on the shelves and records nearby */}
      <pointLight position={[0, -0.05, -0.25]} color="#6cc4ff" intensity={0.35} distance={1.4} decay={2} />
    </group>
  )
}

interface Props {
  albums: Album[]
}

export function Shelf({ albums }: Props) {
  const record = useGLTF(RECORD_URL)
  const decorGltf = useGLTF(DECOR_URL)
  const current = useDeck((s) => s.album)
  const shown = useMemo(() => albums.filter((a) => a.id !== current?.id), [albums, current])
  const hover = useRef<number | null>(null)

  const mats = useMemo(
    () => ({
      shelf: new THREE.MeshStandardMaterial({ color: '#f4f1ea', roughness: 0.5, metalness: 0.05 }),
      rail: new THREE.MeshStandardMaterial({ color: '#b9bcbf', roughness: 0.38, metalness: 0.85 }),
      slot: new THREE.MeshStandardMaterial({ color: '#2a2b2d', roughness: 0.7 }),
      shadow: new THREE.MeshBasicMaterial({
        map: gradientTexture([[0, 'rgba(0,0,0,0.55)'], [0.35, 'rgba(0,0,0,0.2)'], [1, 'rgba(0,0,0,0)']]),
        transparent: true,
        depthWrite: false,
      }),
    }),
    [],
  )

  // --- records spine-out: one instanced mesh, spines tinted like their covers ---
  const spines = useMemo(() => {
    const rand = rng(606)
    const slots: { album: Album; matrix: THREE.Matrix4; base: THREE.Vector3; rot: number; thick: number }[] = []
    if (!shown.length) return { mesh: null, slots }
    let k = 0
    for (const s of SHELVES.filter((s) => s.use === 'records')) {
      let x = RAILS[s.bay] + 0.02
      const end = RAILS[s.bay + 1] - 0.02
      const fill = end - (0.08 + rand() * 0.12) // leave a gap for the last few to lean into
      while (x < fill) {
        const thick = 0.0036 + rand() * 0.0022
        slots.push({
          album: shown[k++ % shown.length],
          matrix: new THREE.Matrix4(),
          base: new THREE.Vector3(x + thick / 2, s.y + 0.0025 + SLEEVE / 2, WALL_Z - 0.02 - SLEEVE / 2 - rand() * 0.012),
          rot: 0,
          thick,
        })
        x += thick + (rand() < 0.08 ? 0.002 : 0.0003)
      }
      // The last records lean over into the gap
      const leaners = slots.slice(-4)
      leaners.forEach((l, i) => {
        l.rot = -(0.04 + i * 0.05)
        l.base.x += Math.sin(-l.rot) * SLEEVE * 0.5
        l.base.y -= (1 - Math.cos(l.rot)) * SLEEVE * 0.5
      })
    }
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ roughness: 0.72 }), slots.length)
    const grey = new THREE.Color('#6c6660')
    slots.forEach((slot, i) => {
      mesh.setColorAt(i, grey)
      coverColour(slot.album.coverUrl, (c) => {
        c.multiplyScalar(0.85 + ((i * 37) % 11) / 40)
        mesh.setColorAt(i, c)
        mesh.instanceColor!.needsUpdate = true
      })
    })
    mesh.castShadow = true
    return { mesh, slots }
  }, [shown])

  const pull = useRef<Float32Array>(new Float32Array(0))
  useEffect(() => {
    pull.current = new Float32Array(spines.slots.length)
    return () => {
      spines.mesh?.geometry.dispose()
      ;(spines.mesh?.material as THREE.Material | undefined)?.dispose()
    }
  }, [spines])

  const tmp = useMemo(() => ({ q: new THREE.Quaternion(), p: new THREE.Vector3(), s: new THREE.Vector3(), z: new THREE.Vector3(0, 0, 1) }), [])
  useFrame((_, dt) => {
    const { mesh, slots } = spines
    if (!mesh) return
    let dirty = false
    const first = !mesh.userData.placed
    slots.forEach((slot, i) => {
      // Only records that are sliding out or back need a new matrix
      const target = hover.current === i ? PULL : 0
      const cur = pull.current[i] ?? 0
      const next = Math.abs(target - cur) < 1e-4 ? target : THREE.MathUtils.damp(cur, target, 14, dt)
      if (!first && next === cur) return
      pull.current[i] = next
      tmp.q.setFromAxisAngle(tmp.z, slot.rot)
      tmp.p.copy(slot.base).add(new THREE.Vector3(0, 0, -next))
      mesh.setMatrixAt(i, slot.matrix.compose(tmp.p, tmp.q, tmp.s.set(slot.thick, SLEEVE, SLEEVE)))
      dirty = true
    })
    if (dirty) {
      mesh.instanceMatrix.needsUpdate = true
      mesh.userData.placed = true
    }
  })

  const onMove = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    if (e.instanceId === undefined) return
    hover.current = e.instanceId
    document.body.style.cursor = 'pointer'
  }
  const onOut = () => {
    hover.current = null
    document.body.style.cursor = ''
  }
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    if (e.instanceId === undefined) return
    const deck = useDeck.getState()
    // First click brings the shelf into view, like the crate
    if (deck.focus !== 'shelf' && deck.focus !== 'free') return deck.setFocus('shelf')
    const album = spines.slots[e.instanceId]?.album
    if (album) deck.pickAlbum(album)
  }

  // --- three covers on display, leaning on the wall ---
  const covers = useMemo(() => {
    const template = record.scene.getObjectByName('Sleeve')
    if (!template) return []
    const s = SHELVES.find((s) => s.use === 'covers')!
    const mid = (RAILS[s.bay] + RAILS[s.bay + 1]) / 2
    return shown.slice(0, 3).map((album, i) => {
      const o = template.clone(true)
      o.visible = true
      o.traverse((c) => {
        const mesh = c as THREE.Mesh
        if (!mesh.isMesh) return
        mesh.castShadow = true
        const mat = mesh.material as THREE.MeshStandardMaterial
        if (mat.name === 'Sleeve_Front') {
          const front = mat.clone()
          finishSleeve(front, coverTexture(album.coverUrl))
          mesh.material = front
        }
      })
      const lean = 0.13 + i * 0.03
      // Stand the flat sleeve up facing the room (-Z), art upright
      o.rotation.set(-(Math.PI / 2 - lean), Math.PI, 0)
      o.position.set(mid + (i - 1) * 0.16, s.y + 0.004 + (SLEEVE / 2) * Math.cos(lean), WALL_Z - 0.02 - (SLEEVE / 2) * Math.sin(lean) - i * 0.012)
      return { album, object: o }
    })
  }, [record.scene, shown])

  // --- books and objects: small instanced sets with muted cloth colours ---
  const books = useMemo(() => {
    const rand = rng(1960)
    const palette = ['#7d2e24', '#1f3a4a', '#c9b58f', '#2e2b28', '#8a6a3b', '#3d4f3a', '#e6dccb', '#5b2a3a']
    const items: { m: THREE.Matrix4; c: THREE.Color }[] = []
    for (const s of SHELVES.filter((s) => s.use === 'books')) {
      let x = RAILS[s.bay] + 0.04 + rand() * 0.1
      const count = 7 + Math.floor(rand() * 6)
      for (let i = 0; i < count; i++) {
        const t = 0.018 + rand() * 0.03
        const h = 0.19 + rand() * 0.09
        const d = 0.13 + rand() * 0.05
        items.push({
          m: new THREE.Matrix4().compose(
            new THREE.Vector3(x + t / 2, s.y + 0.0025 + h / 2, WALL_Z - 0.02 - d / 2),
            new THREE.Quaternion(),
            new THREE.Vector3(t, h, d),
          ),
          c: new THREE.Color(palette[Math.floor(rand() * palette.length)]),
        })
        x += t + 0.001
      }
      // A small stack lying flat at the other end
      let y = s.y + 0.0025
      for (let i = 0; i < 3; i++) {
        const h = 0.02 + rand() * 0.02
        items.push({
          m: new THREE.Matrix4().compose(
            new THREE.Vector3(RAILS[s.bay + 1] - 0.16, y + h / 2, WALL_Z - 0.02 - 0.08),
            new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (rand() - 0.5) * 0.3),
            new THREE.Vector3(0.21 - i * 0.02, h, 0.15 - i * 0.01),
          ),
          c: new THREE.Color(palette[Math.floor(rand() * palette.length)]),
        })
        y += h
      }
    }
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ roughness: 0.85 }), items.length)
    items.forEach((it, i) => {
      mesh.setMatrixAt(i, it.m)
      mesh.setColorAt(i, it.c.convertSRGBToLinear())
    })
    mesh.castShadow = true
    return mesh
  }, [])

  // Scanned ceramics and a turned wooden bowl (Poly Haven, CC0)
  const decor = useMemo(() => {
    const place = (name: string, x: number, shelfY: number, z: number, scale: number, yaw: number) => {
      const src = decorGltf.scene.getObjectByName(name)
      if (!src) return null
      const o = src.clone(true)
      o.position.set(x, shelfY + 0.0025, z)
      o.rotation.set(0, yaw, 0)
      o.scale.setScalar(scale)
      o.traverse((c) => {
        const mesh = c as THREE.Mesh
        if (mesh.isMesh) mesh.castShadow = mesh.receiveShadow = true
      })
      return o
    }
    const mid = (RAILS[1] + RAILS[2]) / 2
    return [
      place('ceramic_vase_02', mid - 0.13, 1.32, WALL_Z - 0.1, 0.72, 0.4),
      place('wooden_bowl_02', mid + 0.12, 1.32, WALL_Z - 0.1, 1.1, 1.2),
      place('ceramic_vase_01', RAILS[0] + 0.2, 1.74, WALL_Z - 0.11, 0.72, 0.3),
      place('ceramic_vase_03', RAILS[0] + 0.42, 1.74, WALL_Z - 0.09, 0.62, 0.25),
    ].filter((o): o is THREE.Object3D => !!o)
  }, [decorGltf.scene])

  useEffect(
    () => () => {
      books.geometry.dispose()
      ;(books.material as THREE.Material).dispose()
    },
    [books],
  )

  return (
    <group>
      {/* E-tracks screwed to the wall */}
      {RAILS.map((x) => (
        <group key={x} position={[x, (RAIL_Y[0] + RAIL_Y[1]) / 2, WALL_Z - 0.006]}>
          <mesh material={mats.rail} castShadow>
            <boxGeometry args={[0.034, RAIL_Y[1] - RAIL_Y[0], 0.012]} />
          </mesh>
          <mesh position={[0, 0, -0.0062]} material={mats.slot}>
            <boxGeometry args={[0.008, RAIL_Y[1] - RAIL_Y[0] - 0.02, 0.001]} />
          </mesh>
        </group>
      ))}
      {/* Shelves: thin plate with the folded front lip, and a soft shadow on the wall */}
      {SHELVES.map((s) => {
        const x = (RAILS[s.bay] + RAILS[s.bay + 1]) / 2
        const w = BAY - 0.036
        return (
          <group key={`${s.bay}-${s.y}`}>
            <mesh position={[x, s.y, WALL_Z - s.depth / 2]} material={mats.shelf} castShadow receiveShadow>
              <boxGeometry args={[w, 0.005, s.depth]} />
            </mesh>
            <mesh position={[x, s.y - 0.0095, WALL_Z - s.depth + 0.002]} material={mats.shelf} castShadow>
              <boxGeometry args={[w, 0.024, 0.004]} />
            </mesh>
            <mesh position={[x, s.y - 0.055, WALL_Z - 0.0015]} rotation-y={Math.PI} material={mats.shadow}>
              <planeGeometry args={[w, 0.11]} />
            </mesh>
          </group>
        )
      })}
      {spines.mesh && (
        <primitive object={spines.mesh} onPointerMove={onMove} onPointerOut={onOut} onClick={onClick} />
      )}
      {covers.map(({ album, object }) => (
        <primitive
          key={album.id}
          object={object}
          onClick={(e: ThreeEvent<MouseEvent>) => {
            e.stopPropagation()
            const deck = useDeck.getState()
            if (deck.focus !== 'shelf' && deck.focus !== 'free') return deck.setFocus('shelf')
            deck.pickAlbum(album)
          }}
          onPointerOver={(e: ThreeEvent<PointerEvent>) => {
            e.stopPropagation()
            document.body.style.cursor = 'pointer'
          }}
          onPointerOut={() => (document.body.style.cursor = '')}
        />
      ))}
      <primitive object={books} />
      {decor.map((o) => (
        <primitive key={o.uuid} object={o} />
      ))}
      <Neon />
    </group>
  )
}

useGLTF.preload(RECORD_URL)
useGLTF.preload(DECOR_URL)
