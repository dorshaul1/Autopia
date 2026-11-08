import { describe, expect, it } from 'vitest'
import { INTERACTIVES } from '../src/renderer/src/office/layout'
import { LOUNGE_CHANNELS } from '../src/renderer/src/office/screens'

const objects = INTERACTIVES.filter((i) => !i.id.startsWith('room:'))
const overlap = (a: (typeof objects)[number]['rect'], b: (typeof objects)[number]['rect']) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

describe('office objects', () => {
  it('every clickable object has its own area: a click never lands on two objects', () => {
    const clashes: string[] = []
    for (const [i, a] of objects.entries()) for (const b of objects.slice(i + 1)) if (overlap(a.rect, b.rect)) clashes.push(`${a.id}/${b.id}`)
    expect(clashes).toEqual([])
  })

  it('object ids are unique, and small decor is not clickable', () => {
    expect(new Set(INTERACTIVES.map((i) => i.id)).size).toBe(INTERACTIVES.length)
    expect(objects.length).toBeLessThan(30)
  })

  it('the lounge TV offers a fixed set of channels, including off', () => {
    expect(LOUNGE_CHANNELS.map((c) => c.id)).toEqual(['auto', 'team', 'skyline', 'off'])
  })
})
