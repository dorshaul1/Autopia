// What a project's office can be personalised with: a small, curated catalog, and the one function that
// decides what a saved customization may contain. Everything here is data: keys from these lists, tiles,
// a short sign and a picture stored as palette indexes. Nothing a user adds is ever run or loaded as a file.

export type DecorGroup = 'own' | 'plant' | 'light' | 'bit' | 'rug'

export interface DecorDef {
  key: string
  label: string
  group: DecorGroup
  tw: number
  th: number
  /** Lies on the floor: people walk over it, and it never blocks anyone. */
  flat?: boolean
  /** Throws a pool of light after dark, in the office's lighting colour. */
  glow?: boolean
}

export const FLOOR_DECOR: DecorDef[] = [
  { key: 'decor:sign', label: 'Standing sign', group: 'own', tw: 4, th: 1 },
  { key: 'decor:easel', label: 'Easel', group: 'own', tw: 1, th: 1 },
  { key: 'plant:fig', label: 'Fig tree', group: 'plant', tw: 1, th: 1 },
  { key: 'plant:monstera', label: 'Monstera', group: 'plant', tw: 1, th: 1 },
  { key: 'plant:snake', label: 'Snake plant', group: 'plant', tw: 1, th: 1 },
  { key: 'plant:small', label: 'Little plant', group: 'plant', tw: 1, th: 1 },
  { key: 'plant:cactus', label: 'Cactus', group: 'plant', tw: 1, th: 1 },
  { key: 'plant:palm', label: 'Palm', group: 'plant', tw: 1, th: 1 },
  { key: 'floorLamp', label: 'Floor lamp', group: 'light', tw: 1, th: 1, glow: true },
  { key: 'lamp:lantern', label: 'Paper lantern', group: 'light', tw: 1, th: 1, glow: true },
  { key: 'lamp:arc', label: 'Arc lamp', group: 'light', tw: 1, th: 1, glow: true },
  { key: 'lamp:mushroom', label: 'Mushroom lamp', group: 'light', tw: 1, th: 1, glow: true },
  { key: 'decor:globe', label: 'Globe', group: 'bit', tw: 1, th: 1 },
  { key: 'decor:books', label: 'Stack of books', group: 'bit', tw: 1, th: 1 },
  { key: 'decor:crate', label: 'Record crate', group: 'bit', tw: 1, th: 1 },
  { key: 'decor:pouf', label: 'Pouf', group: 'bit', tw: 1, th: 1 },
  { key: 'sideTable', label: 'Side table', group: 'bit', tw: 1, th: 1 },
  { key: 'bin', label: 'Bin', group: 'bit', tw: 1, th: 1 },
  { key: 'rug:woven', label: 'Woven rug', group: 'rug', tw: 4, th: 3, flat: true },
  { key: 'rug:round', label: 'Round rug', group: 'rug', tw: 3, th: 3, flat: true },
  { key: 'rug:stripe', label: 'Striped runner', group: 'rug', tw: 5, th: 2, flat: true },
  { key: 'rug:check', label: 'Check rug', group: 'rug', tw: 3, th: 2, flat: true }
]


export interface WallDef {
  key: string
  label: string
  /** Width in tiles. */
  w: number
  /** Painted in the office's lighting colour, and glows after dark. */
  lit?: boolean
}

export const WALL_ITEMS: WallDef[] = [
  { key: 'wall:picture', label: 'Your picture', w: 2 },
  { key: 'wall:sign', label: 'Your sign', w: 4 },
  { key: 'wall:frames', label: 'Gallery frames', w: 3 },
  { key: 'wall:shelf', label: 'Floating shelf', w: 2 },
  { key: 'wall:pennants', label: 'Bunting', w: 3 },
  { key: 'wall:neon', label: 'Neon bolt', w: 2, lit: true },
  { key: 'wall:string', label: 'String lights', w: 3, lit: true },
  { key: 'wall:poster:ship', label: 'Launch poster', w: 2 },
  { key: 'wall:poster:bloom', label: 'Bloom poster', w: 2 },
  { key: 'wall:poster:wave', label: 'Wave poster', w: 2 }
]

export type CatalogTab = 'furniture' | 'decor' | 'walls' | 'floors' | 'lighting'

/** How the catalog is laid out: every piece has one home here. */
export const CATALOG: { id: CatalogTab; label: string; sections: { label: string; keys: string[] }[] }[] = [
  { id: 'furniture', label: 'Furniture', sections: [{ label: 'Pieces', keys: ['sideTable', 'decor:pouf', 'decor:crate', 'bin'] }] },
  {
    id: 'decor',
    label: 'Decor',
    sections: [
      { label: 'Plants', keys: ['plant:fig', 'plant:monstera', 'plant:snake', 'plant:small', 'plant:cactus', 'plant:palm'] },
      { label: 'Little things', keys: ['decor:globe', 'decor:books'] },
      { label: 'Yours', keys: ['decor:sign', 'decor:easel'] }
    ]
  },
  {
    id: 'walls',
    label: 'Walls',
    sections: [
      { label: 'Yours', keys: ['wall:picture', 'wall:sign'] },
      { label: 'Hang up', keys: ['wall:frames', 'wall:shelf', 'wall:pennants', 'wall:poster:ship', 'wall:poster:bloom', 'wall:poster:wave'] }
    ]
  },
  { id: 'floors', label: 'Floors', sections: [{ label: 'Rugs', keys: ['rug:woven', 'rug:round', 'rug:stripe', 'rug:check'] }] },
  {
    id: 'lighting',
    label: 'Lighting',
    sections: [
      { label: 'Lamps', keys: ['floorLamp', 'lamp:lantern', 'lamp:arc', 'lamp:mushroom'] },
      { label: 'On the wall', keys: ['wall:neon', 'wall:string'] }
    ]
  }
]

export const LIGHTS = {
  warm: { label: 'Warm', color: '#ffc979' },
  rose: { label: 'Rose', color: '#ff7f9e' },
  teal: { label: 'Teal', color: '#5ec4c9' },
  violet: { label: 'Violet', color: '#a98bff' }
} as const
export type LightId = keyof typeof LIGHTS

export const DOG_BEDS = {
  denim: { label: 'Denim', rim: '#6f7ea2' },
  terracotta: { label: 'Terracotta', rim: '#c96a43' },
  sage: { label: 'Sage', rim: '#7f9a7c' },
  plum: { label: 'Plum', rim: '#8a5c8f' }
} as const
export type DogBedId = keyof typeof DOG_BEDS

export const DOG_TOYS = {
  ball: { label: 'Ball' },
  bone: { label: 'Bone' },
  duck: { label: 'Rubber duck' },
  rope: { label: 'Rope' }
} as const
export type DogToyId = keyof typeof DOG_TOYS

export interface OfficeConfig {
  accent: 'terracotta' | 'sage' | 'slate' | 'mustard'
  art: 'ship' | 'grid' | 'bloom' | 'wave'
  /** Decor the office came with, moved: placement uid → tile. */
  moves: Record<string, { tx: number; ty: number }>
  /** Decor the office came with, swapped for another piece of the same kind: uid → key. */
  swaps: Record<string, string>
  /** Decor the office came with, taken away. */
  removed: string[]
  /** Pieces added to the floor. */
  items: { id: string; key: string; tx: number; ty: number }[]
  /** Pieces hung on the north wall, by their left tile. */
  wall: { id: string; key: string; x: number }[]
  light: LightId
  /** The words on this office's sign. */
  sign: string
  /** This office's picture, as palette indexes (see encodePicture). */
  picture: string
  dog: { bed: { tx: number; ty: number } | null; bedStyle: DogBedId; toy: DogToyId }
}

export const DEFAULT_OFFICE: OfficeConfig = {
  accent: 'terracotta',
  art: 'grid',
  moves: {},
  swaps: {},
  removed: [],
  items: [],
  wall: [],
  light: 'warm',
  sign: '',
  picture: '',
  dog: { bed: null, bedStyle: 'denim', toy: 'ball' }
}

export const MAX_ITEMS = 40
export const MAX_WALL = 12
export const SIGN_MAX = 10

export const decorDef = (key: string): DecorDef | undefined => FLOOR_DECOR.find((d) => d.key === key)
export const wallDef = (key: string): WallDef | undefined => WALL_ITEMS.find((d) => d.key === key)

// ── the picture ──────────────────────────────────────────────

export const PICTURE_W = 20
export const PICTURE_H = 24

/** The office's own colours: any picture hung here is redrawn in them, so it always belongs on the wall. */
export const PICTURE_PALETTE = ['#17181c', '#33353d', '#727982', '#c2c8cf', '#fbfaf7', '#e2bf8f', '#9a6a4a', '#45291c', '#e08a62', '#a85434', '#f0c264', '#5ea24f', '#28562d', '#8ccbe0', '#5f6b80', '#8a5c8f']

const rgbOf = (c: string) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)]
const PALETTE_RGB = PICTURE_PALETTE.map(rgbOf)
const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5]
]

/** Pixels of a PICTURE_W × PICTURE_H image → one hex digit per pixel, lightly dithered so soft shading survives. */
export function encodePicture(rgba: ArrayLike<number>): string {
  let out = ''
  for (let y = 0; y < PICTURE_H; y++) {
    for (let x = 0; x < PICTURE_W; x++) {
      const i = (y * PICTURE_W + x) * 4
      const a = rgba[i + 3] / 255
      const d = (BAYER[y % 4][x % 4] / 16 - 0.5) * 22
      // see-through parts sit on a white mount
      const c = [0, 1, 2].map((k) => rgba[i + k] * a + 251 * (1 - a) + d)
      let best = 0
      let bestD = Infinity
      PALETTE_RGB.forEach((p, n) => {
        const dist = (p[0] - c[0]) ** 2 * 0.3 + (p[1] - c[1]) ** 2 * 0.59 + (p[2] - c[2]) ** 2 * 0.11
        if (dist < bestD) {
          bestD = dist
          best = n
        }
      })
      out += best.toString(16)
    }
  }
  return out
}

const PICTURE_SHAPE = new RegExp(`^[0-9a-f]{${PICTURE_W * PICTURE_H}}$`)
export const validPicture = (s: unknown): s is string => typeof s === 'string' && PICTURE_SHAPE.test(s)

// ── the sign ─────────────────────────────────────────────────

/** Signs are painted in the office's pixel font: its letters and digits, nothing else. */
export function cleanSign(text: unknown): string {
  if (typeof text !== 'string') return ''
  return text
    .normalize('NFKD')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trimStart()
    .slice(0, SIGN_MAX)
}

/** What a project's sign says until you change it: its name, as much as fits, in whole words. */
export function signFor(name: string): string {
  const words = name.normalize('NFKD').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim()
  if (words.length <= SIGN_MAX) return words
  const cut = words.lastIndexOf(' ', SIGN_MAX)
  return words.slice(0, cut > 0 ? cut : SIGN_MAX)
}

// ── what a saved customization may contain ───────────────────

const isTile = (n: unknown, max: number): n is number => Number.isInteger(n) && (n as number) >= 0 && (n as number) < max
const isId = (s: unknown): s is string => typeof s === 'string' && /^[\w:-]{1,40}$/.test(s)
const pickOf = <T extends string>(allowed: readonly T[], v: unknown, fallback: T): T => (allowed.includes(v as T) ? (v as T) : fallback)
const keysOf = <T extends string>(o: Record<T, unknown>) => Object.keys(o) as T[]

/**
 * Whatever comes in (a save, an old record, a damaged one) leaves as a valid config. Anything unknown is
 * dropped, so a piece removed from the catalog one day simply stops showing. Fits on the floor is decided
 * later, by the office that knows its own floor plan (see office/decor.ts).
 */
export function sanitizeOffice(raw: unknown): OfficeConfig {
  const c = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof OfficeConfig, unknown>>
  const moves: OfficeConfig['moves'] = {}
  for (const [uid, m] of Object.entries((c.moves as object) ?? {})) {
    if (isId(uid) && isTile(m?.tx, 200) && isTile(m?.ty, 200)) moves[uid] = { tx: m.tx, ty: m.ty }
  }
  const swaps: OfficeConfig['swaps'] = {}
  for (const [uid, key] of Object.entries((c.swaps as object) ?? {})) {
    if (isId(uid) && decorDef(key as string)) swaps[uid] = key as string
  }
  const seen = new Set<string>()
  const fresh = (id: unknown) => isId(id) && !seen.has(id) && !!seen.add(id)
  const items = (Array.isArray(c.items) ? c.items : [])
    .filter((i) => fresh(i?.id) && decorDef(i?.key) && isTile(i?.tx, 200) && isTile(i?.ty, 200))
    .slice(0, MAX_ITEMS)
    .map((i) => ({ id: i.id as string, key: i.key as string, tx: i.tx as number, ty: i.ty as number }))
  const wall = (Array.isArray(c.wall) ? c.wall : [])
    .filter((i) => fresh(i?.id) && wallDef(i?.key) && isTile(i?.x, 200))
    .slice(0, MAX_WALL)
    .map((i) => ({ id: i.id as string, key: i.key as string, x: i.x as number }))
  const d = (c.dog && typeof c.dog === 'object' ? c.dog : {}) as Partial<OfficeConfig['dog']>
  return {
    accent: pickOf(['terracotta', 'sage', 'slate', 'mustard'], c.accent, DEFAULT_OFFICE.accent),
    art: pickOf(['ship', 'grid', 'bloom', 'wave'], c.art, DEFAULT_OFFICE.art),
    moves,
    swaps,
    removed: (Array.isArray(c.removed) ? c.removed : []).filter(isId).slice(0, 200),
    items,
    wall,
    light: pickOf(keysOf(LIGHTS), c.light, DEFAULT_OFFICE.light),
    sign: cleanSign(c.sign).trim(),
    picture: validPicture(c.picture) ? c.picture : '',
    dog: {
      bed: isTile(d.bed?.tx, 200) && isTile(d.bed?.ty, 200) ? { tx: d.bed.tx, ty: d.bed.ty } : null,
      bedStyle: pickOf(keysOf(DOG_BEDS), d.bedStyle, DEFAULT_OFFICE.dog.bedStyle),
      toy: pickOf(keysOf(DOG_TOYS), d.toy, DEFAULT_OFFICE.dog.toy)
    }
  }
}

/** Everything the layout holds, back as the office came. Your sign words, picture and colours are kept. */
export function layoutReset(c: OfficeConfig): OfficeConfig {
  return { ...c, moves: {}, swaps: {}, removed: [], items: [], wall: [], dog: { ...DEFAULT_OFFICE.dog, bedStyle: c.dog.bedStyle, toy: c.dog.toy } }
}

/** How many things differ from the office as it came. */
export function changesIn(c: OfficeConfig): number {
  return Object.keys(c.moves).length + Object.keys(c.swaps).length + c.removed.length + c.items.length + c.wall.length + (c.dog.bed ? 1 : 0)
}
