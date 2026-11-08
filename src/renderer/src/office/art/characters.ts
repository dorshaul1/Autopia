// Generates a full animation sheet for one employee from their appearance description.
// 20 × 32 cells; feet rest on row 30 (the y-sort anchor). See docs/ART_DIRECTION.md.

import type { Appearance } from '@shared/types'
import { M } from './palette'
import { makeCanvas, mix, selout, shade, type Px } from './px'

export const CELL_W = 20
export const CELL_H = 32
export const FEET_ROW = 30
export const SHEET_COLS = 4

/** Row index of each animation. Right-facing rows are mirrored copies of the left-facing ones. */
export const ROW = {
  down: 0,
  up: 1,
  left: 2,
  right: 3,
  sitUp: 4,
  sitDown: 5,
  extra: 6,
  talkLeft: 7,
  talkRight: 8,
  // expressive rows: nod, laugh A, laugh B, point (profile; right mirrored)
  gestLeft: 9,
  gestRight: 10,
  // facing the viewer: cheer, shrug, think, surprise
  expr: 11,
  // from behind (in a group): listen, nod, talk A, talk B
  backTalk: 12,
  // profile: pet A, pet B, lean in, explain (point + talk)
  moreLeft: 13,
  moreRight: 14
} as const
const ROWS = 15

interface Opts {
  bob?: number
  legL?: number
  legR?: number
  armL?: number
  armR?: number
  stride?: -1 | 0 | 1
  seated?: boolean
  blink?: boolean
  talk?: boolean
  mug?: boolean
  wave?: number
  gesture?: number
  lean?: number
  // seated, facing the viewer (reception only)
  /** Handset held to the ear. */
  phone?: boolean
  /** A sheet held up in both hands. */
  paper?: number
  /** Both arms raised. */
  stretch?: boolean
  /** Eyes lowered to the screen or desk. */
  down?: boolean
  /** Eyes turned to one side. */
  look?: -1 | 1
  // expressive poses (Phase 31), all standing
  /** Side/back: head dips in a nod. */
  nod?: boolean
  /** Side: head thrown back with a laugh (mouth open). */
  laugh?: boolean
  /** Side: forearm held straight out, pointing / explaining. */
  point?: boolean
  /** Side: bending a little, hand reaching down (petting the dog); 0/1 = stroke. */
  pet?: 0 | 1
  /** Side: leaning in with curiosity. */
  leanIn?: boolean
  /** Front: both arms up. */
  cheer?: boolean
  /** Front: shoulders up, hands out. */
  shrug?: boolean
  /** Front: hand to chin. */
  think?: boolean
  /** Front: hands up, mouth open. */
  surprise?: boolean
  /** Back: one arm out while talking (0/1 = which way it moves). */
  talkBack?: 0 | 1
}

const EYE = '#251a18'

class Figure {
  private skin: string
  private skinHi: string
  private skinLo: string
  private hairHi: string
  private hairLo: string
  private top: string
  private topHi: string
  private topLo: string
  private pantsLo: string

  constructor(
    private px: Px,
    private ox: number,
    private oy: number,
    private a: Appearance
  ) {
    this.skin = a.skin
    this.skinHi = shade(a.skin, 0.12)
    this.skinLo = shade(a.skin, -0.17)
    this.hairHi = shade(a.hair, 0.3)
    this.hairLo = shade(a.hair, -0.3)
    this.top = a.shirt
    this.topHi = shade(a.shirt, 0.18)
    this.topLo = shade(a.shirt, -0.22)
    this.pantsLo = shade(a.pants, -0.22)
  }

  private r(x: number, y: number, w: number, h: number, c: string) {
    this.px.r(this.ox + x, this.oy + y, w, h, c)
  }
  private p(x: number, y: number, c: string) {
    this.px.p(this.ox + x, this.oy + y, c)
  }

  // ── legs ──
  private legsFront(o: Opts, back: boolean) {
    const a = this.a
    if (o.seated) {
      if (back) return
      this.r(5, 24, 10, 2, a.pants)
      this.r(5, 25, 10, 1, this.pantsLo)
      this.r(6, 26, 3, 2, this.pantsLo)
      this.r(11, 26, 3, 2, this.pantsLo)
      this.r(5, 28, 4, 2, a.shoes)
      this.r(11, 28, 4, 2, a.shoes)
      this.p(5, 28, shade(a.shoes, 0.25))
      this.p(11, 28, shade(a.shoes, 0.25))
      return
    }
    const ll = o.legL ?? 0
    const lr = o.legR ?? 0
    this.r(6, 23, 4, 5 - ll, back ? this.pantsLo : a.pants)
    this.r(10, 23, 4, 5 - lr, back ? a.pants : this.pantsLo)
    this.p(9, 23, this.pantsLo)
    this.r(5, 28 - ll, 5, 2, a.shoes)
    this.r(10, 28 - lr, 5, 2, shade(a.shoes, -0.08))
    this.h(5, 28 - ll, 5, shade(a.shoes, 0.25))
    this.h(10, 28 - lr, 5, shade(a.shoes, 0.18))
    this.h(5, 29 - ll, 5, shade(a.shoes, -0.25))
    this.h(10, 29 - lr, 5, shade(a.shoes, -0.25))
  }

  private h(x: number, y: number, w: number, c: string) {
    this.r(x, y, w, 1, c)
  }

  // ── torso by outfit ──
  private torsoFront(ty: number) {
    const a = this.a
    const T = this.top
    this.r(5, ty + 1, 10, 9, T)
    this.r(6, ty, 8, 1, T)
    this.r(5, ty + 1, 1, 9, this.topHi)
    this.r(14, ty + 1, 1, 9, this.topLo)
    this.r(6, ty + 9, 8, 1, this.topLo)
    switch (a.outfit) {
      case 'blazer':
        // open jacket over a light top, notched lapels, two buttons
        this.r(8, ty, 4, 6, a.inner)
        this.r(9, ty + 6, 2, 2, a.inner)
        this.p(8, ty + 6, a.inner)
        this.p(11, ty + 6, a.inner)
        this.r(7, ty, 1, 4, this.topLo)
        this.r(12, ty, 1, 4, this.topLo)
        this.p(8, ty + 4, this.topLo)
        this.p(11, ty + 4, this.topLo)
        this.p(9, ty + 8, a.shirtAccent)
        this.r(6, ty + 7, 2, 1, this.topLo)
        this.r(12, ty + 7, 2, 1, this.topLo)
        break
      case 'hoodie':
        this.r(6, ty - 1, 8, 2, this.topLo)
        this.r(7, ty - 1, 6, 1, T)
        this.p(8, ty + 1, a.shirtAccent)
        this.p(8, ty + 2, a.shirtAccent)
        this.p(11, ty + 1, a.shirtAccent)
        this.p(11, ty + 2, a.shirtAccent)
        this.r(7, ty + 5, 6, 4, this.topLo)
        this.r(8, ty + 5, 4, 3, T)
        this.r(5, ty + 9, 10, 1, this.topLo)
        break
      case 'sweater':
        this.r(7, ty - 2, 6, 3, T)
        this.r(7, ty - 2, 6, 1, this.topHi)
        this.p(8, ty - 1, this.topLo)
        this.p(10, ty - 1, this.topLo)
        for (let x = 5; x < 15; x += 2) this.p(x, ty + 9, this.topLo)
        this.p(9, ty + 4, this.topLo)
        this.p(10, ty + 5, this.topLo)
        break
      case 'overshirt':
        for (let y = ty + 1; y < ty + 10; y++) if ((y - ty) % 3 === 0) this.h(5, y, 10, a.shirtAccent)
        for (let x = 6; x < 15; x += 3) this.r(x, ty + 1, 1, 9, this.topLo)
        this.r(9, ty, 2, 9, a.inner)
        this.r(6, ty + 2, 2, 2, this.topLo)
        this.r(12, ty + 2, 2, 2, this.topLo)
        break
    }
    this.r(8, ty - 1, 4, 1, this.skinLo)
    if (a.outfit === 'sweater') this.r(8, ty - 1, 4, 1, T)
  }

  private torsoBack(ty: number) {
    const a = this.a
    const T = this.top
    this.r(5, ty + 1, 10, 9, T)
    this.r(6, ty, 8, 1, T)
    this.r(5, ty + 1, 1, 9, this.topHi)
    this.r(14, ty + 1, 1, 9, this.topLo)
    if (a.outfit === 'hoodie') {
      this.r(6, ty, 8, 4, this.topLo)
      this.r(7, ty + 1, 6, 2, shade(T, -0.1))
    } else if (a.outfit === 'overshirt') {
      for (let y = ty + 1; y < ty + 10; y++) if ((y - ty) % 3 === 0) this.h(5, y, 10, a.shirtAccent)
      for (let x = 6; x < 15; x += 3) this.r(x, ty + 1, 1, 9, this.topLo)
      this.h(6, ty, 8, this.topLo)
    } else if (a.outfit === 'sweater') {
      this.r(7, ty - 2, 6, 3, T)
      for (let x = 5; x < 15; x += 2) this.p(x, ty + 9, this.topLo)
    } else {
      this.r(9, ty + 2, 1, 7, this.topLo)
      this.h(6, ty, 8, this.topLo)
    }
    this.r(6, ty + 9, 8, 1, this.topLo)
  }

  // ── views ──
  front(o: Opts) {
    const b = o.bob ?? 0
    const sit = o.seated ? 3 : 0
    const hy = 1 + b + sit
    const ty = 13 + b + sit
    this.legsFront(o, false)
    if (this.a.hairStyle === 'long' || this.a.hairStyle === 'curly') this.hairBehindFront(hy)
    this.torsoFront(ty)
    // arms
    const arm = (x: number, off: number, lit: boolean) => {
      this.r(x, ty + 1 + off, 2, 6, lit ? this.topHi : this.topLo)
      this.r(x, ty + 1 + off, 2, 1, lit ? this.topHi : this.top)
      this.r(x, ty + 7 + off, 2, 2, this.skin)
      this.p(x + (lit ? 0 : 1), ty + 8 + off, this.skinLo)
    }
    if (o.seated && o.stretch) {
      this.r(3, ty - 6, 2, 7, this.topHi)
      this.r(15, ty - 6, 2, 7, this.topLo)
      this.r(3, ty - 9, 2, 3, this.skin)
      this.r(15, ty - 9, 2, 3, this.skin)
    } else if (o.seated && (o.phone || o.mug || o.wave !== undefined || o.paper !== undefined)) {
      this.r(3, ty + 1, 2, 5, this.topHi)
      if (o.paper !== undefined) {
        // both hands up holding a sheet at chest height; the sheet tilts between frames
        this.r(15, ty + 1, 2, 4, this.topLo)
        this.r(5, ty + 3, 10, 6, M.white.hi)
        this.h(6, ty + 5 + o.paper, 7, M.white.lo)
        this.h(6, ty + 7 - o.paper, 5, M.white.lo)
        this.r(4, ty + 4, 2, 2, this.skin)
        this.r(14, ty + 4, 2, 2, this.skin)
      } else {
        this.r(5, ty + 7, 3, 2, this.skin)
        if (o.phone) {
          // handset from ear to chin, forearm up beside the face
          this.r(15, ty - 3, 2, 5, this.topLo)
          this.r(14, ty - 6, 2, 3, this.skin)
        } else if (o.mug) {
          this.r(15, ty + 1, 2, 3, this.topLo)
          this.r(13, ty + 2, 2, 2, this.skin)
          this.r(11, ty, 3, 4, M.white.hi)
          this.p(11, ty, '#6b4a33')
          this.p(14, ty + 1, M.white.mid)
        } else {
          this.r(15, ty - 3, 2, 5, this.topLo)
          this.r(15 + (o.wave ?? 0), ty - 6, 2, 3, this.skin)
        }
      }
    } else if (o.seated) {
      this.r(3, ty + 1, 2, 5, this.topHi)
      this.r(15, ty + 1, 2, 5, this.topLo)
      this.r(5, ty + 7, 3, 2, this.skin)
      if (o.gesture) {
        this.r(15, ty - 1, 2, 4, this.topLo)
        this.r(15, ty - 3, 2, 2, this.skin)
      } else this.r(12, ty + 7, 3, 2, this.skin)
    } else if (o.cheer) {
      // both arms up and out in a V, clear of the hair
      this.r(3, ty - 1, 2, 3, this.topHi)
      this.r(2, ty - 4, 2, 3, this.topHi)
      this.r(1, ty - 7, 2, 3, this.skin)
      this.r(15, ty - 1, 2, 3, this.topLo)
      this.r(16, ty - 4, 2, 3, this.topLo)
      this.r(17, ty - 7, 2, 3, this.skin)
    } else if (o.shrug) {
      // shoulders up, elbows in, forearms and open hands out to the sides
      this.r(3, ty, 2, 5, this.topHi)
      this.r(15, ty, 2, 5, this.topLo)
      this.r(1, ty + 4, 3, 2, this.skin)
      this.r(16, ty + 4, 3, 2, this.skin)
    } else if (o.think) {
      arm(3, 0, true)
      // forearm up, hand to the chin
      this.r(14, ty + 1, 2, 4, this.topLo)
      this.r(11, ty - 1, 3, 2, this.skin)
    } else if (o.surprise) {
      // hands up by the shoulders
      this.r(3, ty + 1, 2, 3, this.topHi)
      this.r(15, ty + 1, 2, 3, this.topLo)
      this.r(2, ty - 1, 2, 2, this.skin)
      this.r(16, ty - 1, 2, 2, this.skin)
    } else {
      arm(3, o.armL ?? 0, true)
      if (o.wave !== undefined) {
        this.r(15, ty - 3, 2, 5, this.topLo)
        this.r(15 + o.wave, ty - 6, 2, 3, this.skin)
      } else if (o.mug) {
        this.r(15, ty + 1, 2, 4, this.topLo)
        this.r(13, ty + 4, 2, 2, this.skin)
        this.r(11, ty + 2, 3, 4, M.white.hi)
        this.p(11, ty + 2, '#6b4a33')
        this.p(14, ty + 3, M.white.mid)
      } else arm(15, o.armR ?? 0, false)
    }
    this.headFront(hy, o.surprise || o.cheer ? { ...o, talk: true } : o)
    // the handset sits over the hair, against her cheek
    if (o.seated && o.phone) {
      this.r(13, ty - 8, 2, 6, M.black.base)
      this.p(13, ty - 8, M.black.hi)
      this.p(14, ty - 3, M.black.hi)
    }
  }

  back(o: Opts) {
    const b = o.bob ?? 0
    const sit = o.seated ? 3 : 0
    const hy = 1 + b + sit
    const ty = 13 + b + sit
    this.legsFront(o, true)
    this.torsoBack(ty)
    const al = o.armL ?? 0
    const ar = o.armR ?? 0
    if (o.seated) {
      // forearms forward onto the keyboard: elbows out, hands hidden
      this.r(3, ty + 2 + al, 2, 5, this.topHi)
      this.r(15, ty + 2 + ar, 2, 5, this.topLo)
      this.p(4, ty + 6 + al, this.topLo)
      this.p(15, ty + 6 + ar, shade(this.top, -0.3))
    } else if (o.talkBack !== undefined) {
      // one hand out to the side while they talk, the other relaxed
      this.r(3, ty + 1, 2, 6, this.topHi)
      this.r(3, ty + 7, 2, 2, this.skinLo)
      this.r(15 + o.talkBack, ty + 1, 2, 4, this.topLo)
      this.r(16 + o.talkBack, ty + 4, 2, 2, this.skinLo)
    } else {
      this.r(3, ty + 1 + al, 2, 6, this.topHi)
      this.r(15, ty + 1 + ar, 2, 6, this.topLo)
      this.r(3, ty + 7 + al, 2, 2, this.skinLo)
      this.r(15, ty + 7 + ar, 2, 2, this.skinLo)
    }
    this.r(8, ty - 1, 4, 1, this.skinLo)
    this.headBack(hy + (o.nod ? 1 : 0), o.lean ?? 0)
  }

  side(o: Opts) {
    const a = this.a
    const b = o.bob ?? 0
    const hy = 1 + b
    const ty = 13 + b
    const s = o.stride ?? 0
    if (s === 0) {
      this.r(8, 23, 5, 5, a.pants)
      this.r(12, 23, 1, 5, this.pantsLo)
      this.r(6, 28, 6, 2, a.shoes)
      this.h(6, 28, 6, shade(a.shoes, 0.25))
    } else {
      const fr = s === 1 ? a.pants : this.pantsLo
      const bk = s === 1 ? this.pantsLo : a.pants
      this.r(10, 23, 4, 4, bk)
      this.r(12, 27, 4, 2, shade(a.shoes, -0.18))
      this.r(6, 23, 4, 5, fr)
      this.r(4, 28, 6, 2, a.shoes)
      this.h(4, 28, 6, shade(a.shoes, 0.25))
    }
    if (a.hairStyle === 'long') this.r(11, hy + 6, 3, 9, this.hairLo)
    // torso (narrower in profile)
    this.r(7, ty + 1, 7, 9, this.top)
    this.r(8, ty, 5, 1, this.top)
    this.r(7, ty + 1, 1, 9, this.topHi)
    this.r(13, ty + 1, 1, 9, this.topLo)
    this.r(7, ty + 9, 7, 1, this.topLo)
    if (a.outfit === 'hoodie') this.r(11, ty, 3, 4, this.topLo)
    if (a.outfit === 'overshirt') for (let y = ty + 3; y < ty + 10; y += 3) this.h(7, y, 7, a.shirtAccent)
    if (a.outfit === 'blazer') this.r(7, ty, 2, 6, a.inner)
    if (a.outfit === 'sweater') this.r(8, ty - 2, 4, 3, this.top)
    this.r(9, ty - 1, 3, 1, this.skinLo)
    // arm: swings opposite to the front leg, or gestures while talking
    if (o.point) {
      // forearm straight out in front at chest height, hand open
      this.r(5, ty + 2, 5, 2, this.topLo)
      this.r(3, ty + 2, 2, 2, this.skin)
      this.p(2, ty + 2, this.skinLo)
    } else if (o.pet !== undefined) {
      // reaching down and forward to stroke the dog
      this.r(6, ty + 3, 3, 4, this.topLo)
      this.r(3 + o.pet, ty + 7, 3, 2, this.skin)
      this.p(3 + o.pet, ty + 8, this.skinLo)
    } else if (o.laugh) {
      // a hand to the stomach
      this.r(8, ty + 2, 3, 5, this.topLo)
      this.r(7, ty + 6, 2, 2, this.skin)
    } else if (o.gesture) {
      const g = o.gesture
      this.r(8 - g, ty + 1, 3, 3, this.topLo)
      this.r(6 - g, ty + 1 - g, 2, 2, this.skin)
    } else {
      const ax = 9 - (o.armL ?? 0)
      this.r(ax, ty + 1, 2, 6, this.topLo)
      this.r(ax, ty + 1, 2, 1, this.top)
      this.r(ax, ty + 7, 2, 2, this.skin)
    }
    // the head: dips in a nod or a pet, tips back in a laugh, leans forward with curiosity
    const hdy = (o.nod || o.pet !== undefined ? 1 : 0) - (o.laugh ? 1 : 0)
    const hdx = o.leanIn || o.pet !== undefined ? -1 : o.laugh ? 1 : 0
    this.ox += hdx
    this.headSide(hy + hdy, o.laugh ? { ...o, talk: true } : o)
    this.ox -= hdx
  }

  // ── heads ──
  private headFront(y: number, o: Opts) {
    const a = this.a
    this.r(6, y + 4, 8, 7, this.skin)
    this.r(7, y + 11, 6, 1, this.skin)
    this.r(6, y + 4, 1, 6, this.skinHi)
    this.r(13, y + 5, 1, 6, this.skinLo)
    this.r(8, y + 11, 5, 1, this.skinLo)
    this.r(5, y + 7, 1, 2, this.skinLo)
    this.r(14, y + 7, 1, 2, this.skinLo)
    // brows, eyes, nose, mouth
    this.h(7, y + 6, 2, this.hairLo)
    this.h(11, y + 6, 2, this.hairLo)
    if (o.blink || o.down) {
      this.h(7, y + 8, 2, EYE)
      this.h(11, y + 8, 2, EYE)
    } else if (o.look) {
      const d = o.look < 0 ? 0 : 1
      this.r(7, y + 7, 2, 2, EYE)
      this.r(11, y + 7, 2, 2, EYE)
      this.p(7 + d, y + 7, '#f4f1ea')
      this.p(11 + d, y + 7, '#f4f1ea')
    } else {
      this.r(7, y + 7, 2, 2, EYE)
      this.r(11, y + 7, 2, 2, EYE)
      this.p(7, y + 7, '#f4f1ea')
      this.p(11, y + 7, '#f4f1ea')
    }
    this.p(10, y + 9, this.skinLo)
    const blush = mix(a.skin, '#ff8a8a', 0.32)
    this.p(6, y + 9, blush)
    this.p(13, y + 9, blush)
    if (o.talk) {
      this.r(9, y + 10, 2, 1, '#6e2a2a')
      this.p(9, y + 10, '#a8443f')
    } else this.h(9, y + 10, 2, shade(a.skin, -0.3))
    this.hairFront(y)
    this.accessoryFront(y)
  }

  private headBack(y: number, lean: number) {
    this.r(5, y + 7, 1, 2, this.skinLo)
    this.r(14, y + 7, 1, 2, this.skinLo)
    this.hairBack(y, lean)
    if (this.a.accessory === 'headphones') {
      this.h(6, y, 8, M.black.base)
      this.r(4, y + 5, 2, 5, '#e04f5f')
      this.r(14, y + 5, 2, 5, '#e04f5f')
    }
    if (this.a.accessory === 'beanie') this.beanie(y, 4, 12)
  }

  private headSide(y: number, o: Opts) {
    const a = this.a
    this.r(6, y + 4, 7, 7, this.skin)
    this.r(7, y + 11, 5, 1, this.skin)
    this.p(5, y + 8, this.skin)
    this.p(5, y + 9, this.skinLo)
    this.r(11, y + 5, 2, 6, this.skinLo)
    this.r(11, y + 7, 1, 2, shade(a.skin, -0.25))
    this.h(6, y + 6, 2, this.hairLo)
    if (o.blink) this.h(6, y + 8, 2, EYE)
    else {
      this.r(7, y + 7, 1, 2, EYE)
      this.p(6, y + 7, '#f4f1ea')
    }
    if (o.talk) this.r(6, y + 10, 2, 1, '#6e2a2a')
    else this.p(6, y + 10, shade(a.skin, -0.3))
    this.p(7, y + 9, mix(a.skin, '#ff8a8a', 0.32))
    this.hairSide(y)
    if (a.accessory === 'glasses') {
      this.h(5, y + 7, 4, '#1d1d24')
      this.p(5, y + 8, '#1d1d24')
      this.p(8, y + 8, '#1d1d24')
      this.h(9, y + 7, 3, '#1d1d24')
      this.p(6, y + 8, '#cfe9f3')
    } else if (a.accessory === 'headphones') {
      this.h(7, y, 6, M.black.base)
      this.r(10, y + 5, 3, 5, '#e04f5f')
      this.p(10, y + 5, '#ff8a95')
    } else if (a.accessory === 'earrings') this.p(11, y + 10, M.brand.base)
    if (a.accessory === 'beanie') this.beanie(y, 5, 9)
  }

  private beanie(y: number, x0: number, w: number) {
    const c = M.mustard
    this.r(x0, y, w, 5, c.base)
    this.r(x0 + 1, y - 1, w - 2, 1, c.base)
    this.r(x0 + 2, y - 2, w - 4, 1, c.hi)
    for (let x = x0 + 1; x < x0 + w; x += 2) this.p(x, y + 1, c.hi)
    this.r(x0, y + 4, w, 2, c.mid)
    for (let x = x0; x < x0 + w; x += 2) this.p(x, y + 5, c.lo)
  }

  private accessoryFront(y: number) {
    const a = this.a
    if (a.accessory === 'glasses') {
      const g = '#1d1d24'
      this.r(6, y + 6, 4, 1, g)
      this.r(10, y + 6, 4, 1, g)
      this.r(6, y + 9, 4, 1, g)
      this.r(10, y + 9, 4, 1, g)
      this.r(6, y + 7, 1, 2, g)
      this.r(9, y + 7, 2, 1, g)
      this.r(13, y + 7, 1, 2, g)
      this.p(8, y + 7, '#cfe9f3')
      this.p(12, y + 7, '#cfe9f3')
    } else if (a.accessory === 'headphones') {
      this.h(6, y, 8, M.black.base)
      this.p(5, y + 1, M.black.base)
      this.p(14, y + 1, M.black.base)
      this.r(3, y + 5, 3, 5, '#e04f5f')
      this.r(14, y + 5, 3, 5, '#e04f5f')
      this.p(3, y + 5, '#ff8a95')
    } else if (a.accessory === 'earrings') {
      this.p(5, y + 10, M.brand.base)
      this.p(14, y + 10, M.brand.base)
    } else if (a.accessory === 'beanie') this.beanie(y, 4, 12)
  }

  private hairBehindFront(y: number) {
    if (this.a.hairStyle === 'long') this.r(4, y + 5, 12, 10, this.hairLo)
    else this.r(3, y + 4, 14, 7, this.hairLo)
  }

  private hairFront(y: number) {
    const a = this.a
    const H = a.hair
    switch (a.hairStyle) {
      case 'short':
        this.r(5, y + 1, 10, 4, H)
        this.r(6, y, 8, 1, H)
        this.r(5, y + 5, 1, 3, H)
        this.r(14, y + 5, 1, 2, H)
        // swept fringe
        this.r(6, y + 5, 5, 1, H)
        this.p(11, y + 5, this.hairLo)
        this.h(7, y + 1, 4, this.hairHi)
        this.p(12, y + 2, this.hairHi)
        break
      case 'long':
        this.r(5, y + 1, 10, 4, H)
        this.r(6, y, 8, 1, H)
        this.r(4, y + 3, 2, 9, H)
        this.r(14, y + 3, 2, 9, H)
        this.r(6, y + 5, 3, 1, H)
        this.h(7, y + 1, 4, this.hairHi)
        break
      case 'bun':
        this.r(5, y + 1, 10, 4, H)
        this.r(6, y, 8, 1, H)
        this.r(8, y - 3, 4, 3, H)
        this.h(9, y - 3, 2, this.hairHi)
        this.r(5, y + 5, 1, 5, H)
        this.r(14, y + 5, 1, 5, H)
        this.r(6, y + 5, 2, 1, H)
        this.r(12, y + 5, 2, 1, H)
        this.h(6, y + 1, 4, this.hairHi)
        break
      case 'curly':
        this.r(4, y - 1, 12, 6, H)
        this.r(3, y + 1, 2, 9, H)
        this.r(15, y + 1, 2, 9, H)
        for (const [x, dy] of [
          [4, -2],
          [7, -2],
          [10, -2],
          [13, -2],
          [2, 2],
          [17, 3],
          [2, 6],
          [17, 7]
        ]) this.p(x, y + dy, H)
        for (const [x, dy] of [
          [5, 0],
          [8, 1],
          [11, 0],
          [14, 1],
          [3, 4],
          [16, 5],
          [6, 3],
          [12, 3]
        ]) this.p(x, y + dy, this.hairHi)
        this.r(6, y + 5, 2, 1, H)
        this.r(12, y + 5, 2, 1, H)
        break
      case 'buzz':
        this.r(5, y + 2, 10, 3, H)
        this.r(6, y + 1, 8, 1, H)
        for (const x of [6, 8, 10, 12]) this.p(x, y + 2, this.hairHi)
        break
    }
  }

  private hairBack(y: number, lean: number) {
    const a = this.a
    const H = a.hair
    const L = lean
    switch (a.hairStyle) {
      case 'short':
        this.r(6 + L, y, 8, 1, H)
        this.r(5 + L, y + 1, 10, 9, H)
        this.r(6 + L, y + 10, 8, 1, this.hairLo)
        break
      case 'long':
        this.r(6 + L, y, 8, 1, H)
        this.r(5 + L, y + 1, 10, 14, H)
        this.r(6 + L, y + 13, 8, 2, this.hairLo)
        break
      case 'bun':
        this.r(6 + L, y, 8, 1, H)
        this.r(5 + L, y + 1, 10, 9, H)
        this.r(8 + L, y - 3, 4, 4, H)
        this.h(9 + L, y - 3, 2, this.hairHi)
        break
      case 'curly':
        // rounded volume with coil texture so it never reads as a flat block
        this.r(4 + L, y - 1, 12, 11, H)
        this.r(3 + L, y + 1, 14, 7, H)
        for (const x of [5, 8, 11, 14]) this.p(x + L, y - 2, H)
        for (const dy of [2, 5]) {
          this.p(2 + L, y + dy, H)
          this.p(17 + L, y + dy, H)
        }
        for (let yy = 0; yy < 10; yy += 2) {
          for (let xx = 4 + ((yy / 2) % 2); xx < 16; xx += 3) this.p(xx + L, y + yy, yy < 4 ? this.hairHi : shade(H, 0.14))
        }
        this.h(5 + L, y + 10, 10, this.hairLo)
        break
      case 'buzz':
        this.r(6 + L, y + 1, 8, 1, H)
        this.r(5 + L, y + 2, 10, 7, H)
        this.r(6 + L, y + 9, 8, 2, this.skinLo)
        break
    }
    if (a.hairStyle !== 'curly' && a.hairStyle !== 'buzz') this.h(7 + L, y + 2, 5, this.hairHi)
    if (a.hairStyle === 'short' || a.hairStyle === 'bun') this.r(7 + L, y + 10, 6, 1, this.skinLo)
  }

  private hairSide(y: number) {
    const a = this.a
    const H = a.hair
    switch (a.hairStyle) {
      case 'short':
        this.r(6, y + 1, 8, 4, H)
        this.r(7, y, 6, 1, H)
        this.r(11, y + 5, 3, 4, H)
        this.p(5, y + 4, H)
        this.h(7, y + 1, 4, this.hairHi)
        break
      case 'long':
        this.r(6, y + 1, 8, 4, H)
        this.r(7, y, 6, 1, H)
        this.r(11, y + 5, 3, 10, H)
        break
      case 'bun':
        this.r(6, y + 1, 8, 4, H)
        this.r(7, y, 6, 1, H)
        this.r(11, y + 5, 3, 4, H)
        this.r(13, y - 2, 4, 4, H)
        this.p(14, y - 2, this.hairHi)
        this.h(7, y + 1, 4, this.hairHi)
        break
      case 'curly':
        this.r(5, y - 1, 11, 7, H)
        this.r(10, y + 5, 6, 6, H)
        for (const x of [6, 9, 12, 15]) this.p(x, y - 2, H)
        for (const [x, dy] of [
          [7, 0],
          [11, 1],
          [14, 4],
          [12, 7]
        ]) this.p(x, y + dy, this.hairHi)
        break
      case 'buzz':
        this.r(6, y + 2, 8, 3, H)
        this.r(7, y + 1, 6, 1, H)
        this.r(11, y + 5, 2, 3, H)
        break
    }
  }
}

export function characterSheet(a: Appearance): HTMLCanvasElement {
  const W = CELL_W * SHEET_COLS
  const H = CELL_H * ROWS
  const { canvas, px } = makeCanvas(W, H)
  const cell = (col: number, row: number) => new Figure(px, col * CELL_W, row * CELL_H, a)

  const walk: Opts[] = [{}, { bob: 1, legL: 2, armL: 1, armR: -1 }, {}, { bob: 1, legR: 2, armL: -1, armR: 1 }]
  walk.forEach((o, i) => cell(i, ROW.down).front(o))
  walk.forEach((o, i) => cell(i, ROW.up).back(o))
  ;[{}, { bob: 1, stride: 1, armL: 1 }, {}, { bob: 1, stride: -1, armL: -1 }].forEach((o, i) => cell(i, ROW.left).side(o as Opts))

  // seated at a desk, back to the viewer: idle, type A, type B, lean in
  ;[{}, { armL: -1 }, { armR: -1 }, { lean: 1 }].forEach((o, i) => cell(i, ROW.sitUp).back({ ...o, seated: true }))
  // seated facing the viewer: idle, talk, blink, talk + gesture
  ;[{}, { talk: true }, { blink: true }, { talk: true, gesture: 1, bob: 1 }].forEach((o, i) => cell(i, ROW.sitDown).front({ ...o, seated: true }))
  // extras: blink, coffee, wave A, wave B
  cell(0, ROW.extra).front({ blink: true })
  cell(1, ROW.extra).front({ mug: true })
  cell(2, ROW.extra).front({ wave: 0 })
  cell(3, ROW.extra).front({ wave: 1 })
  // standing conversation in profile: listen, talk, blink, talk + gesture
  ;[{}, { talk: true, gesture: 1 }, { blink: true }, { talk: true, gesture: 2 }].forEach((o, i) => cell(i, ROW.talkLeft).side(o))
  // expression: nod, laugh (two frames), point
  ;[{ nod: true }, { laugh: true }, { laugh: true, bob: 1 }, { point: true, talk: true }].forEach((o, i) => cell(i, ROW.gestLeft).side(o as Opts))
  ;[{ cheer: true }, { shrug: true }, { think: true }, { surprise: true }].forEach((o, i) => cell(i, ROW.expr).front(o))
  ;[{}, { nod: true }, { talkBack: 0 as const }, { talkBack: 1 as const }].forEach((o, i) => cell(i, ROW.backTalk).back(o))
  ;[{ pet: 0 as const }, { pet: 1 as const }, { leanIn: true }, { point: true, talk: true, leanIn: true }].forEach((o, i) => cell(i, ROW.moreLeft).side(o as Opts))

  for (let row = 0; row < ROWS; row++) {
    if (row === ROW.right || row === ROW.talkRight || row === ROW.gestRight || row === ROW.moreRight) continue
    for (let col = 0; col < SHEET_COLS; col++) selout(px, col * CELL_W, row * CELL_H, CELL_W, CELL_H, 0.55)
  }
  const ctx = px.ctx
  for (const [from, to] of [
    [ROW.left, ROW.right],
    [ROW.talkLeft, ROW.talkRight],
    [ROW.gestLeft, ROW.gestRight],
    [ROW.moreLeft, ROW.moreRight]
  ]) {
    for (let col = 0; col < SHEET_COLS; col++) {
      ctx.save()
      ctx.translate((col + 1) * CELL_W, to * CELL_H)
      ctx.scale(-1, 1)
      ctx.drawImage(canvas, col * CELL_W, from * CELL_H, CELL_W, CELL_H, 0, 0, CELL_W, CELL_H)
      ctx.restore()
    }
  }
  return canvas
}

/** Extra rows only the receptionist has: seated facing the viewer, below the shared rows. */
export const RECEPTION_ROW = { work: ROWS, hands: ROWS + 1, look: ROWS + 2, more: ROWS + 3 } as const

/**
 * The receptionist's sheet: every shared row (so walking and talking match the team exactly) plus
 * seated front poses for the desk: typing, phone, coffee, paperwork, stretching, looking, waving.
 */
export function receptionistSheet(a: Appearance): HTMLCanvasElement {
  const base = characterSheet(a)
  const { canvas, px } = makeCanvas(CELL_W * SHEET_COLS, CELL_H * (ROWS + 4))
  px.ctx.drawImage(base, 0, 0)
  const cell = (col: number, row: number) => new Figure(px, col * CELL_W, row * CELL_H, a)
  const S = { seated: true } as const
  // typing / reading the screen: eyes down, shoulders shift with the keys
  ;[{ down: true }, { down: true, bob: 1 }, { down: true }, { look: -1 }].forEach((o, i) => cell(i, RECEPTION_ROW.work).front({ ...S, ...o } as Opts))
  // phone, phone talking, coffee, paperwork
  ;[{ phone: true }, { phone: true, talk: true }, { mug: true }, { paper: 0, down: true }].forEach((o, i) => cell(i, RECEPTION_ROW.hands).front({ ...S, ...o } as Opts))
  // look left, look right, wave A, wave B
  ;[{ look: -1 }, { look: 1 }, { wave: 0, talk: true }, { wave: 1 }].forEach((o, i) => cell(i, RECEPTION_ROW.look).front({ ...S, ...o } as Opts))
  // stretch, paperwork (sheet tilted), blink, smile-talk
  ;[{ stretch: true }, { paper: 1, down: true }, { blink: true }, { talk: true }].forEach((o, i) => cell(i, RECEPTION_ROW.more).front({ ...S, ...o } as Opts))
  for (const row of Object.values(RECEPTION_ROW)) {
    for (let col = 0; col < SHEET_COLS; col++) selout(px, col * CELL_W, row * CELL_H, CELL_W, CELL_H, 0.55)
  }
  return canvas
}

/** Index of a frame in the sheet. */
export const frameIndex = (row: number, col: number) => row * SHEET_COLS + col
