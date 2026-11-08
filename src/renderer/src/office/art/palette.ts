// Material ramps: hi (top-plane highlight), base, mid (front face shade), lo (deepest shadow / detail lines).
// Asset code should pick from these instead of inventing one-off colors. See docs/ART_DIRECTION.md.

export interface Ramp {
  hi: string
  base: string
  mid: string
  lo: string
}

const ramp = (hi: string, base: string, mid: string, lo: string): Ramp => ({ hi, base, mid, lo })

export const M = {
  oak: ramp('#e2bf8f', '#cfa676', '#b48659', '#8a6141'),
  oakFloor: ramp('#d7b083', '#c79d6e', '#b78c5f', '#9c744d'),
  birch: ramp('#efdcbf', '#e2cba8', '#d0b690', '#b39a74'),
  walnut: ramp('#9a6a4a', '#7c5238', '#643f2b', '#45291c'),
  black: ramp('#4a4d57', '#33353d', '#25272d', '#17181c'),
  white: ramp('#fbfaf7', '#ecebe6', '#d9d6cf', '#b9b5ac'),
  steel: ramp('#e1e5ea', '#c2c8cf', '#9ea5ae', '#727982'),
  concrete: ramp('#c6c2b9', '#b2ada3', '#9d988e', '#827d74'),
  plaster: ramp('#f2ede4', '#e7e0d4', '#d9d0c1', '#c1b6a5'),
  stone: ramp('#f3f1ec', '#e3dfd7', '#cdc8bd', '#aaa498'),
  carpet: ramp('#56626d', '#46515b', '#3b454e', '#2c343b'),
  sage: ramp('#9db59a', '#7f9a7c', '#677f65', '#4b5f4a'),
  forest: ramp('#5f8a6e', '#46705a', '#355745', '#243d30'),
  mustard: ramp('#f0c264', '#d9a440', '#b8862b', '#8a621b'),
  terracotta: ramp('#e08a62', '#c96a43', '#a85434', '#7c3d25'),
  slate: ramp('#7d8aa0', '#5f6b80', '#4a5466', '#343b48'),
  leaf: ramp('#8fcf6d', '#5ea24f', '#3f7d3f', '#28562d'),
  leafDeep: ramp('#6fae5c', '#468a48', '#2f6a39', '#1d4627'),
  glass: ramp('#e8f6fb', '#b7e1ee', '#8ccbe0', '#5aa7c2'),
  brand: ramp('#fff4d9', '#f7c66b', '#e9a443', '#b97a24')
} as const

export const PAL = {
  void: '#141219',
  wallCap: '#2b2832',
  wallCapHi: '#45404f',
  shadow: '#000000',
  screenOff: '#11151d',
  signWarm: '#fff4d9',
  signGlow: '#ffc979',
  // legacy aliases used by older call sites
  outline: '#211c26'
} as const
