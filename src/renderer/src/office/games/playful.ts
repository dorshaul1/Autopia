// What the office's things do when you click them. No AI and no state beyond this visit: it's all here, on purpose.

import type { Expression } from '../Character'

export type Floaty = 'can' | 'note' | 'leaf' | 'spark' | 'bubble' | 'duck' | 'plane' | 'flower'
export type Game = 'pong' | 'foosball' | 'hotfix'

export const pick = <T,>(xs: T[], r: () => number = Math.random): T => xs[Math.floor(r() * xs.length) % xs.length]

export function gameFor(key: string): Game | null {
  if (key === 'pingpong') return 'pong'
  if (key === 'foosball') return 'foosball'
  if (key === 'arcade' || key === 'gs:arcadeB') return 'hotfix'
  return null
}

const LABELS: Record<string, string> = {
  pingpong: 'Ping pong',
  foosball: 'Foosball',
  arcade: 'Arcade cabinet',
  'gs:arcadeB': 'Arcade cabinet',
  drinksFridge: 'Drinks fridge',
  cooler: 'Water cooler',
  recordConsole: 'Record player',
  flipchart: 'Flipchart',
  gameShelf: 'Board games',
  'gs:clawMachine': 'Claw machine',
  'gs:danceMachine': 'Dance machine',
  'gs:pinball': 'Pinball',
  'gs:mascot': 'The mascot',
  'gs:trophyCase': 'Trophy case',
  'lab:robotKiosk': 'Robot',
  'lab:chessTable': 'Chess table',
  'lab:gpuRig': 'GPU rig'
}

/** Only what does something: most of the office is furniture, and stays that way. */
export function playfulLabel(key: string): string | null {
  if (key.startsWith('plant:')) return 'Plant'
  if (key.startsWith('beanbag:')) return 'Beanbag'
  return LABELS[key] ?? null
}

export interface PropReaction {
  move: 'squash' | 'shake' | 'hop'
  icon?: Floaty
  text?: string
  /** Someone free nearby notices. */
  crowd?: Expression
}

/** `n` is how many times this has been clicked this visit: some things run out of patience. */
export function propReaction(key: string, n: number, r: () => number): PropReaction | null {
  if (key.startsWith('plant:')) {
    if (n === 12) return { move: 'shake', icon: 'leaf', text: 'Fine. It flowers. Are you happy?' }
    return { move: 'shake', icon: 'leaf', text: r() < 0.12 ? 'It looks a bit greener. Probably.' : undefined }
  }
  if (key.startsWith('beanbag:')) return { move: 'squash', text: r() < 0.2 ? 'Pfffff.' : undefined }
  switch (key) {
    case 'drinksFridge':
      if (n % 7 === 0) return { move: 'shake', text: 'Out of everything except the one nobody likes.' }
      return { move: 'shake', icon: 'can', text: r() < 0.3 ? pick(['Clunk.', 'That was the last cold one.', 'Someone wrote their name on this.'], r) : undefined }
    case 'cooler':
      return { move: 'shake', icon: 'bubble', text: r() < 0.25 ? 'Glug.' : undefined }
    case 'recordConsole':
      return { move: 'hop', icon: 'note', crowd: 'cheer', text: n === 1 ? 'Side B.' : undefined }
    case 'flipchart':
      return { move: 'shake', text: pick(['Q3: more arrows.', 'Someone drew a very good cat here.', 'Synergy, crossed out twice.'], r) }
    case 'gameShelf':
      return { move: 'shake', text: pick(['Missing: one die, all of the rules.', 'Nobody has finished this one.', 'A truce was signed over this.'], r) }
    case 'gs:clawMachine':
      return r() < 0.15 ? { move: 'hop', icon: 'duck', crowd: 'surprise', text: 'You won a rubber duck!' } : { move: 'shake', text: pick(['So close.', 'The claw lets go. It always does.', 'Rigged. Definitely rigged.'], r) }
    case 'gs:danceMachine':
      return { move: 'hop', icon: 'spark', crowd: 'cheer', text: pick(['PERFECT!', 'GREAT!', 'MISS.'], r) }
    case 'gs:pinball':
      return { move: 'shake', icon: 'spark', text: n >= 3 && r() < 0.5 ? 'TILT.' : pick(['Multiball!', 'Replay.', 'Drain.'], r) }
    case 'gs:mascot':
      return { move: 'hop', text: n === 8 ? 'It blinked. You saw it blink.' : pick(['Hi!', 'Hello again!', '(waves)'], r) }
    case 'gs:trophyCase':
      return { move: 'shake', icon: 'spark', text: pick(['Best Use of a Spreadsheet, 2019.', 'Most Bugs Shipped Quietly.', 'Participation, again.'], r) }
    case 'lab:robotKiosk':
      return { move: 'hop', text: n === 10 ? 'I know what you did with the coffee.' : pick(['I am not sentient. Probably.', 'Have you tried turning me off?', 'Beep. That was a joke.', 'Your request is important to me.'], r) }
    case 'lab:chessTable':
      return { move: 'shake', text: pick(['Knight to f3. Nobody is here.', 'Mate in twelve, apparently.', 'This game started in March.'], r) }
    case 'lab:gpuRig':
      return { move: 'shake', icon: 'spark', text: pick(['Warm enough to heat lunch.', 'All eight fans say hi.'], r) }
    default:
      return null
  }
}

const SPRITES: Record<Floaty, [string, string[]]> = {
  can: ['#e04f5f', ['.xx.', 'xwwx', 'xxxx', 'xwwx', 'xxxx', '.xx.']],
  note: ['#f2c14e', ['..xx', '..x.', '..x.', 'xxx.', 'xxx.']],
  leaf: ['#5fae5a', ['..x', '.xx', 'xx.', 'x..']],
  spark: ['#f7e27a', ['.x.', 'xwx', '.x.']],
  bubble: ['#8fd3f4', ['.xx.', 'x.wx', 'x..x', '.xx.']],
  duck: ['#f2c14e', ['..xx.', '..xxo', 'xxxx.', 'xxxx.', '.xx..']],
  flower: ['#f28bb3', ['.x.', 'xox', '.x.']],
  plane: ['#f4f6f9', ['x.....', 'xxx...', 'xxxxxx', 'xxx...', 'x.....']]
}

export function floatyArt(what: Floaty): HTMLCanvasElement {
  const [color, rows] = SPRITES[what]
  const c = document.createElement('canvas')
  c.width = rows[0].length
  c.height = rows.length
  const ctx = c.getContext('2d')!
  rows.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      if (ch === '.') return
      ctx.fillStyle = ch === 'w' ? '#ffffff' : ch === 'o' ? '#e8833a' : color
      ctx.fillRect(x, y, 1, 1)
    })
  )
  return c
}
