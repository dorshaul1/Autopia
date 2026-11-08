// The office between jobs: what the weather's doing, what people say when you bother them, and what occasionally happens.
// Pure and local, with no AI: nobody's real work is read, changed or implied by anything in here.

import type { Profile } from './personality'

export type Weather = 'clear' | 'cloudy' | 'rain' | 'snow'

/** The same for everyone at the same time of the same day, and it changes every few hours. Mostly it's fine out. */
export function weatherAt(date: Date): Weather {
  const block = Math.floor(date.getHours() / 3)
  let h = (date.getFullYear() * 372 + date.getMonth() * 31 + date.getDate()) * 8 + block
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995)
  h = ((h ^ (h >>> 15)) >>> 0) % 100
  const winter = date.getMonth() === 11 || date.getMonth() <= 1
  if (h < 55) return 'clear'
  if (h < 80) return 'cloudy'
  return winter ? 'snow' : 'rain'
}

/** Paints weather over a window's glass. `tick` moves it along. */
export function paintWeather(ctx: CanvasRenderingContext2D, w: number, h: number, weather: Weather, tick: number, seed: number): void {
  if (weather === 'clear') return
  ctx.fillStyle = weather === 'cloudy' ? 'rgba(120,130,145,.28)' : 'rgba(70,82,100,.42)'
  ctx.fillRect(0, 0, w, h)
  if (weather === 'cloudy') return
  ctx.fillStyle = weather === 'rain' ? 'rgba(200,220,245,.6)' : 'rgba(250,250,255,.85)'
  const n = Math.ceil(w / 6)
  for (let i = 0; i < n; i++) {
    const x0 = (i * 6 + seed * 3) % w
    if (weather === 'rain') {
      const y = (i * 37 + seed + tick * 3) % (h + 6)
      ctx.fillRect(Math.round((x0 + y * 0.25) % w), Math.round(y) - 3, 1, 3)
    } else {
      const y = (i * 29 + seed + tick * 0.6) % h
      ctx.fillRect(Math.round((x0 + Math.sin((tick + i * 9) / 9) * 2 + w) % w), Math.round(y), 1, 1)
    }
  }
}

const say = (xs: string[], r: () => number) => xs[Math.floor(r() * xs.length) % xs.length]

/** What someone on a break says when you click them, in their own way. Never anything about work: they aren't doing any. */
export function clickLine(p: Profile, n: number, r: () => number): { line: string; gesture: 'wave' | 'cheer' | 'shrug' | 'surprise' | 'think' } {
  if (n === 12) return { line: 'I’m going to start charging for this.', gesture: 'shrug' }
  if (n === 7) return { line: 'Do you need something?', gesture: 'surprise' }
  const t = p.traits
  const has = (h: Profile['habits'][number]) => p.habits.includes(h)
  const own: string[] = []
  if (has('coffeeRegular')) own.push('Is that my third coffee? Don’t answer.', 'The good beans are hidden. I won’t say where.')
  if (has('pongFan') || t.competitiveness > 0.65) own.push('Ping pong later? I’m not scared.', 'I’m undefeated this week. Don’t check.')
  if (has('dogPerson')) own.push('Have you seen Puffy today?', 'I keep treats in my desk. For a friend.')
  if (has('nookReader')) own.push('One more chapter.', 'Good book. Ask me nothing about it.')
  if (has('gamer')) own.push('I nearly had the high score.', 'That cabinet is rigged.')
  if (has('loner') || t.quiet > 0.65) own.push('Oh. Hi.', 'Mm.', '(nods)')
  if (has('chatty') || t.sociability > 0.65) own.push('Oh good, you’re here. So anyway…', 'Did you hear about the printer?')
  if (t.playfulness > 0.65) own.push('Tag. You’re it.', 'I can see my house from here.')
  const line = say(own.length ? own : ['Hey.', 'Nice day.', 'Just stretching my legs.'], r)
  const gesture = t.quiet > 0.65 ? 'think' : t.playfulness > 0.6 ? 'cheer' : 'wave'
  return { line, gesture }
}

export type RareEvent = 'plane' | 'coffeeMishap' | 'nap' | 'puffySteal' | 'birthday' | 'foosRivalry'

export interface RareContext {
  /** Teammates not on real work. */
  idle: number
  /** One of them is settled somewhere comfortable. */
  someoneResting: boolean
  hasDog: boolean
  reducedMotion: boolean
}

/** What happens next, if anything can. Never the same thing twice running, and nothing that needs someone who's working. */
export function nextRareEvent(r: () => number, recent: RareEvent[], c: RareContext): RareEvent | null {
  const can: RareEvent[] = []
  if (!c.reducedMotion) can.push('plane')
  if (c.idle >= 1) can.push('coffeeMishap')
  if (c.someoneResting) can.push('nap')
  if (c.hasDog && !c.reducedMotion) can.push('puffySteal')
  if (c.idle >= 3) can.push('birthday')
  if (c.idle >= 2) can.push('foosRivalry')
  const fresh = can.filter((k) => !recent.slice(-3).includes(k))
  const from = fresh.length ? fresh : can.filter((k) => k !== recent[recent.length - 1])
  return from.length ? from[Math.floor(r() * from.length) % from.length] : null
}

/** Long enough apart that you never quite expect one. */
export const rareGapMs = (r: () => number) => 5 * 60_000 + r() * 8 * 60_000
