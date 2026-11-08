// The Tech Startup: the original Autopia office (layout data only; see ../layout.ts for the shape).
// Kept exactly as it was: this office sets the quality bar every other office is measured against.

import { TILE } from '../grid'
import type { OfficeLayout, Placement, PosterKind, Spot, DeskVariant, ZoneId } from '../layout'

const seatAt = (x: number, y: number): Spot => ({ tx: x + 1, ty: y + 2, facing: 'up', pose: 'sitUp', dy: 1 })
const deskAt = (x: number, y: number, variant: DeskVariant) => ({ desk: { x, y, w: 3, h: 2 }, seat: seatAt(x, y), variant })
const chair = (key: string, tx: number, ty: number, depthBias: number, dy = 0): Placement => ({ key, tx, ty, tw: 1, th: 1, blocks: false, depthBias, dy })
const decor = (uid: string, key: string, tx: number, ty: number, tw = 1, th = 1): Placement => ({ key, tx, ty, tw, th, blocks: true, uid })

const ZONES: OfficeLayout['ZONES'] = {
  workspace: { x: 1, y: 4, w: 24, h: 12 },
  meeting: { x: 26, y: 4, w: 12, h: 10 },
  kitchen: { x: 39, y: 4, w: 16, h: 12 },
  corridor: { x: 1, y: 16, w: 54, h: 2 },
  studio: { x: 1, y: 19, w: 13, h: 8 },
  lounge: { x: 1, y: 27, w: 14, h: 8 },
  reception: { x: 16, y: 18, w: 16, h: 17 },
  focus: { x: 33, y: 19, w: 8, h: 6 },
  supply: { x: 33, y: 26, w: 8, h: 9 },
  booths: { x: 42, y: 18, w: 6, h: 3 },
  play: { x: 42, y: 21, w: 13, h: 14 }
}
const ZONE_LABEL: OfficeLayout['ZONE_LABEL'] = {
  workspace: 'Engineering floor',
  meeting: 'Boardroom',
  kitchen: 'Kitchen & coffee bar',
  corridor: 'Corridor',
  studio: 'Design studio',
  lounge: 'Lounge',
  reception: 'Reception',
  focus: 'Focus room',
  supply: 'Print & supply room',
  booths: 'Phone booths',
  play: 'Game corner'
}
const ZONE_PURPOSE: OfficeLayout['ZONE_PURPOSE'] = {
  workspace: 'Engineering desks. Real tasks run here.',
  meeting: 'Planning kickoffs with Maya.',
  kitchen: 'Coffee, lunch and the occasional hallway decision.',
  corridor: 'Connects every room.',
  studio: 'Design work, moodboards and the light table.',
  lounge: 'Quiet breaks between tasks.',
  reception: 'The front door and the AUTOPIA sign.',
  focus: 'Teammate consultations: design and architecture questions.',
  supply: 'Printer, lockers and supplies.',
  booths: 'Private calls.',
  play: 'Ping-pong, arcade and beanbags.'
}
const WALLS: OfficeLayout['WALLS'] = [
  { id: 'boardWest', kind: 'glass', axis: 'v', x: 25, y: 4, len: 10 },
  { id: 'boardSouth', kind: 'glass', axis: 'h', x: 25, y: 14, len: 13, doors: [{ at: 5, w: 2 }] },
  { id: 'kitchenPartition', kind: 'solid', axis: 'v', x: 38, y: 4, len: 10 },
  { id: 'studioNorth', kind: 'glass', axis: 'h', x: 1, y: 18, len: 13, doors: [{ at: 10, w: 2 }] },
  { id: 'studioEast', kind: 'glass', axis: 'v', x: 14, y: 18, len: 9 },
  { id: 'focusWest', kind: 'glass', axis: 'v', x: 32, y: 18, len: 7 },
  { id: 'focusNorth', kind: 'glass', axis: 'h', x: 32, y: 18, len: 9, doors: [{ at: 3, w: 2 }] },
  { id: 'focusEast', kind: 'solid', axis: 'v', x: 41, y: 18, len: 7 },
  { id: 'supplyNorth', kind: 'solid', axis: 'h', x: 32, y: 25, len: 10 },
  { id: 'supplyWest', kind: 'solid', axis: 'v', x: 32, y: 25, len: 10 },
  { id: 'supplyEast', kind: 'solid', axis: 'v', x: 41, y: 25, len: 10, doors: [{ at: 4, w: 2 }] }
]
const FEATURE_WALL: OfficeLayout['FEATURE_WALL'] = { x: 18, y: 18, w: 12, h: 3 }
const ENTRANCE: OfficeLayout['ENTRANCE'] = { x: 22, w: 4 }
const DESKS: OfficeLayout['DESKS'] = {
  'desk-pm': { ...deskAt(2, 6, 'pm'), zone: 'workspace' },
  'desk-dev': { ...deskAt(5, 6, 'dev'), zone: 'workspace' },
  'desk-qa': { ...deskAt(2, 11, 'qa'), zone: 'workspace' },
  'desk-5': { ...deskAt(5, 11, 'dev'), zone: 'workspace' },
  'desk-6': { ...deskAt(10, 6, 'dev'), zone: 'workspace' },
  'desk-7': { ...deskAt(13, 6, 'dev'), zone: 'workspace' },
  'desk-8': { ...deskAt(10, 11, 'dev'), zone: 'workspace' },
  'desk-9': { ...deskAt(13, 11, 'dev'), zone: 'workspace' },
  'desk-design': { ...deskAt(2, 20, 'design'), zone: 'studio' },
  'desk-10': { ...deskAt(5, 20, 'design'), zone: 'studio' }
}
const MEETING_SEATS: OfficeLayout['MEETING_SEATS'] = {
  pm: { tx: 29, ty: 6, facing: 'down', pose: 'sitDown', dy: -4 },
  lead_dev: { tx: 31, ty: 6, facing: 'down', pose: 'sitDown', dy: -4 },
  designer: { tx: 29, ty: 9, facing: 'up', pose: 'sitUp', dy: -3 },
  qa: { tx: 31, ty: 9, facing: 'up', pose: 'sitUp', dy: -3 }
}
const SPARE_MEETING_SEATS: OfficeLayout['SPARE_MEETING_SEATS'] = [
  { tx: 33, ty: 6, facing: 'down', pose: 'sitDown', dy: -4 },
  { tx: 33, ty: 9, facing: 'up', pose: 'sitUp', dy: -3 }
]
const FOCUS_SEATS: OfficeLayout['FOCUS_SEATS'] = [
  { tx: 36, ty: 21, facing: 'down', pose: 'sitDown', dy: -4 },
  { tx: 36, ty: 23, facing: 'up', pose: 'sitUp', dy: -3 }
]
const IDLE_SPOTS: OfficeLayout['IDLE_SPOTS'] = {
  // where real work happens away from the desk (workPlace.ts)
  whiteboard: [{ tx: 35, ty: 5, facing: 'up', pose: 'stand' }],
  testing: [{ tx: 22, ty: 14, facing: 'up', pose: 'stand' }],
  coffee: [
    { tx: 51, ty: 5, facing: 'up', pose: 'stand' },
    { tx: 53, ty: 5, facing: 'up', pose: 'stand' }
  ],
  fridge: [
    { tx: 48, ty: 5, facing: 'up', pose: 'stand' },
    { tx: 54, ty: 8, facing: 'up', pose: 'stand' }
  ],
  sink: [{ tx: 44, ty: 5, facing: 'up', pose: 'stand' }],
  island: [
    { tx: 42, ty: 11, facing: 'up', pose: 'sitUp', dy: -5 },
    { tx: 44, ty: 11, facing: 'up', pose: 'sitUp', dy: -5 },
    { tx: 42, ty: 8, facing: 'down', pose: 'sitDown', dy: -5 },
    { tx: 44, ty: 8, facing: 'down', pose: 'sitDown', dy: -5 }
  ],
  dining: [
    { tx: 50, ty: 10, facing: 'down', pose: 'sitDown', dy: -4 },
    { tx: 52, ty: 10, facing: 'down', pose: 'sitDown', dy: -4 },
    { tx: 50, ty: 13, facing: 'up', pose: 'sitUp', dy: -3 },
    { tx: 52, ty: 13, facing: 'up', pose: 'sitUp', dy: -3 }
  ],
  cooler: [{ tx: 23, ty: 9, facing: 'up', pose: 'stand' }],
  huddle: [
    { tx: 18, ty: 12, facing: 'up', pose: 'sitUp', dy: -5 },
    { tx: 20, ty: 12, facing: 'up', pose: 'sitUp', dy: -5 },
    { tx: 18, ty: 10, facing: 'down', pose: 'sitDown', dy: -5 },
    { tx: 20, ty: 10, facing: 'down', pose: 'sitDown', dy: -5 }
  ],
  kanban: [{ tx: 23, ty: 14, facing: 'up', pose: 'stand' }],
  roadmap: [{ tx: 17, ty: 5, facing: 'up', pose: 'stand' }, { tx: 18, ty: 5, facing: 'up', pose: 'stand' }],
  window: [
    { tx: 13, ty: 5, facing: 'up', pose: 'stand' },
    { tx: 21, ty: 5, facing: 'up', pose: 'stand' }
  ],
  bookshelf: [{ tx: 10, ty: 5, facing: 'up', pose: 'stand' }],
  sofa: [
    { tx: 3, ty: 31, facing: 'down', pose: 'sitDown', dy: -11 },
    { tx: 5, ty: 31, facing: 'down', pose: 'sitDown', dy: -11 }
  ],
  armchair: [
    { tx: 2, ty: 33, facing: 'up', pose: 'sitUp', dy: -4 },
    { tx: 6, ty: 33, facing: 'up', pose: 'sitUp', dy: -4 }
  ],
  readingNook: [{ tx: 12, ty: 29, facing: 'down', pose: 'sitDown', dy: -9 }],
  aquarium: [{ tx: 10, ty: 34, facing: 'up', pose: 'stand' }],
  records: [{ tx: 13, ty: 34, facing: 'up', pose: 'stand' }],
  moodboard: [{ tx: 10, ty: 22, facing: 'up', pose: 'stand' }],
  lightTable: [{ tx: 11, ty: 25, facing: 'up', pose: 'stand' }],
  printer: [{ tx: 34, ty: 28, facing: 'up', pose: 'stand' }],
  lockers: [{ tx: 38, ty: 28, facing: 'up', pose: 'stand' }],
  phone: [
    { tx: 42, ty: 19, facing: 'down', pose: 'sitDown', dy: -4 },
    { tx: 44, ty: 19, facing: 'down', pose: 'sitDown', dy: -4 },
    { tx: 46, ty: 19, facing: 'down', pose: 'sitDown', dy: -4 }
  ],
  foosball: [
    { tx: 51, ty: 27, facing: 'up', pose: 'stand' },
    { tx: 53, ty: 27, facing: 'up', pose: 'stand' }
  ],
  arcade: [
    { tx: 50, ty: 20, facing: 'up', pose: 'stand' },
    { tx: 51, ty: 20, facing: 'up', pose: 'stand' }
  ],
  beanbag: [
    { tx: 44, ty: 31, facing: 'up', pose: 'sitUp', dy: -5 },
    { tx: 46, ty: 32, facing: 'up', pose: 'sitUp', dy: -5 },
    { tx: 48, ty: 31, facing: 'up', pose: 'sitUp', dy: -5 }
  ],
  reception: [{ tx: 24, ty: 26, facing: 'up', pose: 'stand' }],
  // a short walk along the corridor and back
  stroll: [
    { tx: 9, ty: 17, facing: 'down', pose: 'stand' },
    { tx: 30, ty: 17, facing: 'down', pose: 'stand' },
    { tx: 40, ty: 17, facing: 'down', pose: 'stand' }
  ],
  // across the ping-pong table from the lounge TV, watching a rally
  pongWatch: [
    { tx: 46, ty: 22, facing: 'down', pose: 'stand' },
    { tx: 48, ty: 22, facing: 'down', pose: 'stand' }
  ],
  waiting: [
    { tx: 18, ty: 32, facing: 'down', pose: 'sitDown', dy: -11 },
    { tx: 29, ty: 32, facing: 'down', pose: 'sitDown', dy: -11 }
  ]
}
const PAIR_SPOTS: OfficeLayout['PAIR_SPOTS'] = [
  { kind: 'chat', zone: 'workspace', a: { tx: 21, ty: 7, facing: 'right', pose: 'stand' }, b: { tx: 22, ty: 7, facing: 'left', pose: 'stand' } },
  { kind: 'chat', zone: 'kitchen', a: { tx: 47, ty: 13, facing: 'right', pose: 'stand' }, b: { tx: 48, ty: 13, facing: 'left', pose: 'stand' } },
  { kind: 'chat', zone: 'kitchen', a: { tx: 51, ty: 8, facing: 'right', pose: 'stand' }, b: { tx: 52, ty: 8, facing: 'left', pose: 'stand' } },
  { kind: 'chat', zone: 'corridor', a: { tx: 12, ty: 16, facing: 'right', pose: 'stand' }, b: { tx: 13, ty: 16, facing: 'left', pose: 'stand' } },
  { kind: 'chat', zone: 'reception', a: { tx: 20, ty: 28, facing: 'right', pose: 'stand' }, b: { tx: 21, ty: 28, facing: 'left', pose: 'stand' } },
  { kind: 'chat', zone: 'studio', a: { tx: 8, ty: 25, facing: 'right', pose: 'stand' }, b: { tx: 9, ty: 25, facing: 'left', pose: 'stand' } },
  { kind: 'pingpong', zone: 'play', a: { tx: 44, ty: 24, facing: 'right', pose: 'stand' }, b: { tx: 50, ty: 24, facing: 'left', pose: 'stand' } }
]
const PLACEMENTS: OfficeLayout['PLACEMENTS'] = [
  // ── engineering floor ──
  // desks and their chairs are added per occupied workstation (see deskPlacements)
  { key: 'deskDivider', tx: 4, ty: 6, tw: 2, th: 2, blocks: false, depthBias: 1 },
  { key: 'deskDivider', tx: 4, ty: 11, tw: 2, th: 2, blocks: false, depthBias: 1 },
  { key: 'storage', tx: 2, ty: 4, tw: 6, th: 1, blocks: true },
  { key: 'bookshelf', tx: 9, ty: 4, tw: 3, th: 1, blocks: true },
  { key: 'huddleTable', tx: 18, ty: 11, tw: 3, th: 1, blocks: true },
  ...[18, 20].map((x) => chair('stool:N', x, 10, -8)),
  ...[18, 20].map((x) => chair('stool:S', x, 12, 4, 1)),
  { key: 'kanbanBoard', tx: 22, ty: 13, tw: 3, th: 1, blocks: true, id: 'kanban' },
  { key: 'cooler', tx: 23, ty: 8, tw: 1, th: 1, blocks: true },
  { key: 'coatRack', tx: 24, ty: 4, tw: 1, th: 1, blocks: true },
  decor('eng-plant-1', 'plant:fig', 1, 4),
  decor('eng-plant-2', 'plant:monstera', 24, 15),
  decor('eng-plant-3', 'plant:snake', 1, 15),
  decor('eng-plant-4', 'plant:snake', 8, 15),
  decor('eng-plant-5', 'plant:small', 16, 13),
  decor('eng-bin-1', 'bin', 1, 9),
  decor('eng-bin-2', 'bin', 16, 8),

  // ── boardroom ──
  { key: 'meetingTable', tx: 28, ty: 7, tw: 7, th: 2, blocks: true, id: 'meeting' },
  ...[29, 31, 33].map((x) => chair('chair:meetingN', x, 6, -8)),
  ...[29, 31, 33].map((x) => chair('chair:meetingS', x, 9, 4, 1)),
  { key: 'credenza', tx: 29, ty: 4, tw: 5, th: 1, blocks: true },
  { key: 'flipchart', tx: 26, ty: 5, tw: 1, th: 1, blocks: true },
  decor('board-plant-1', 'plant:fig', 37, 4),
  decor('board-plant-2', 'plant:small', 26, 12),
  decor('board-plant-3', 'plant:snake', 37, 12),

  // ── kitchen & coffee bar ──
  { key: 'kitchenRun', tx: 40, ty: 4, tw: 8, th: 1, blocks: true },
  { key: 'fridge', tx: 48, ty: 4, tw: 2, th: 1, blocks: true },
  { key: 'coffeeBar', tx: 50, ty: 4, tw: 5, th: 1, blocks: true, id: 'coffee' },
  { key: 'island', tx: 41, ty: 9, tw: 5, th: 2, blocks: true },
  ...[42, 44].map((x) => chair('stool:N', x, 8, -8)),
  ...[42, 44].map((x) => chair('stool:S', x, 11, 4, 1)),
  { key: 'diningTable', tx: 50, ty: 11, tw: 3, th: 2, blocks: true },
  ...[50, 52].map((x) => chair('chair:diningN', x, 10, -8)),
  ...[50, 52].map((x) => chair('chair:diningS', x, 13, 4, 1)),
  decor('kit-plant-1', 'plant:monstera', 54, 14),
  decor('kit-plant-2', 'plant:small', 39, 14),
  { key: 'drinksFridge', tx: 54, ty: 7, tw: 1, th: 1, blocks: true },
  { key: 'recycling', tx: 39, ty: 11, tw: 2, th: 1, blocks: true },
  decor('kit-plant-3', 'plant:fig', 47, 14),

  // ── design studio ──
  { key: 'moodboard', tx: 9, ty: 21, tw: 2, th: 1, blocks: true, id: 'moodboard' },
  { key: 'lightTable', tx: 10, ty: 23, tw: 3, th: 2, blocks: true },
  { key: 'swatchShelf', tx: 1, ty: 25, tw: 4, th: 1, blocks: true },
  decor('studio-plant-1', 'plant:monstera', 13, 20),
  decor('studio-plant-2', 'plant:fig', 1, 20),
  decor('studio-lamp', 'floorLamp', 8, 21),

  // ── lounge ──
  { key: 'lowShelf', tx: 1, ty: 27, tw: 5, th: 1, blocks: true },
  { key: 'bookshelfTall', tx: 9, ty: 27, tw: 3, th: 1, blocks: true },
  { key: 'sofa', tx: 2, ty: 30, tw: 5, th: 1, blocks: true },
  { key: 'coffeeTable', tx: 3, ty: 32, tw: 3, th: 1, blocks: true },
  chair('armchairS', 2, 33, 4, 1),
  chair('armchairS', 6, 33, 4, 1),
  chair('armchairN', 12, 29, -6),
  { key: 'aquarium', tx: 9, ty: 33, tw: 3, th: 1, blocks: true, id: 'aquarium' },
  { key: 'recordConsole', tx: 12, ty: 33, tw: 3, th: 1, blocks: true },
  decor('lounge-lamp-1', 'floorLamp', 1, 30),
  decor('lounge-lamp-2', 'floorLamp', 13, 28),
  decor('lounge-side', 'sideTable', 7, 30),
  decor('lounge-plant-1', 'plant:monstera', 1, 34),
  decor('lounge-plant-2', 'plant:fig', 14, 31),

  // ── reception ──
  { key: 'receptionDesk', tx: 21, ty: 25, tw: 6, th: 1, blocks: true, id: 'reception' },
  { key: 'waitingSofa', tx: 17, ty: 31, tw: 3, th: 1, blocks: true },
  { key: 'waitingSofa', tx: 28, ty: 31, tw: 3, th: 1, blocks: true },
  { key: 'sideTable', tx: 20, ty: 31, tw: 1, th: 1, blocks: true },
  { key: 'planter', tx: 16, ty: 22, tw: 1, th: 3, blocks: true },
  { key: 'planter', tx: 31, ty: 22, tw: 1, th: 3, blocks: true },
  { key: 'umbrellaStand', tx: 27, ty: 33, tw: 1, th: 1, blocks: true },
  decor('rec-plant-1', 'plant:fig', 17, 21),
  decor('rec-plant-2', 'plant:fig', 30, 21),
  decor('rec-plant-3', 'plant:small', 27, 31),
  decor('rec-plant-4', 'plant:monstera', 16, 34),
  decor('rec-plant-5', 'plant:monstera', 31, 34),

  // ── focus room ──
  { key: 'focusTable', tx: 35, ty: 22, tw: 3, th: 1, blocks: true, id: 'focus' },
  chair('chair:meetingN', 36, 21, -8),
  chair('chair:meetingS', 36, 23, 4, 1),
  { key: 'displayStand', tx: 39, ty: 21, tw: 2, th: 1, blocks: true },
  decor('focus-plant', 'plant:snake', 33, 20),

  // ── print & supply room ──
  { key: 'printerStation', tx: 33, ty: 27, tw: 3, th: 1, blocks: true, id: 'printer' },
  { key: 'lockers', tx: 37, ty: 27, tw: 4, th: 1, blocks: true },
  { key: 'supplyShelf', tx: 33, ty: 31, tw: 1, th: 3, blocks: true },
  { key: 'paperBoxes', tx: 39, ty: 33, tw: 2, th: 1, blocks: true },
  { key: 'cooler', tx: 38, ty: 34, tw: 1, th: 1, blocks: true },
  decor('supply-bin', 'bin', 35, 34),

  // ── phone booths & game corner ──
  ...[42, 44, 46].map((x) => ({ key: 'phoneBooth', tx: x, ty: 18, tw: 2, th: 2, blocks: false, id: 'booths' }) as Placement),
  { key: 'arcade', tx: 50, ty: 18, tw: 1, th: 2, blocks: true },
  { key: 'arcade', tx: 51, ty: 18, tw: 1, th: 2, blocks: true, dx: 1 },
  { key: 'gameShelf', tx: 52, ty: 22, tw: 3, th: 1, blocks: true },
  { key: 'pingpong', tx: 45, ty: 23, tw: 5, th: 2, blocks: true },
  { key: 'foosball', tx: 51, ty: 25, tw: 3, th: 2, blocks: true },
  { key: 'tvConsole', tx: 44, ty: 28, tw: 5, th: 1, blocks: true },
  { key: 'beanbag:terracotta', tx: 44, ty: 31, tw: 1, th: 1, blocks: false, depthBias: 3, uid: 'beanbag-1' },
  { key: 'beanbag:slate', tx: 46, ty: 32, tw: 1, th: 1, blocks: false, depthBias: 3, uid: 'beanbag-2' },
  { key: 'beanbag:mustard', tx: 48, ty: 31, tw: 1, th: 1, blocks: false, depthBias: 3, uid: 'beanbag-3' },
  decor('play-plant-1', 'plant:monstera', 54, 34),
  decor('play-plant-2', 'plant:snake', 54, 18),
  decor('play-plant-3', 'plant:fig', 42, 34)
]
const WALL_DECOR: OfficeLayout['WALL_DECOR'] = {
  windows: [
    { x: 12, w: 4, tall: true },
    { x: 20, w: 2, tall: true },
    { x: 43, w: 3, tall: false }
  ],
  posters: [{ x: 22, kind: 'grid' }] as { x: number; kind: PosterKind }[],
  clock: { x: 8 },
  roadmap: { x: 16, w: 4 },
  meetingTv: { x: 29, w: 5 },
  whiteboard: { x: 34, w: 3 },
  upperCabinets: [
    { x: 40, w: 3 },
    { x: 46, w: 2 }
  ],
  coffeeMenu: { x: 51, w: 3 },
  workspaceSlats: { x: 2, w: 6 },
  boardFelt: { x: 26, w: 12 },
  backsplash: { x: 39, w: 16 }
}
const INTERACTIVES: OfficeLayout['INTERACTIVES'] = [
  ...Object.entries(DESKS).map(([id, d]) => ({ id: `desk:${id}`, label: 'Workstation', rect: { ...d.desk, y: d.desk.y - 1, h: d.desk.h + 1 } })),
  { id: 'meeting', label: 'Boardroom table', rect: { x: 28, y: 6, w: 7, h: 3 } },
  { id: 'kanban', label: 'Team board', rect: { x: 22, y: 12, w: 3, h: 2 } },
  { id: 'roadmap', label: 'Milestone board', rect: { x: 16, y: 1, w: 4, h: 3 } },
  { id: 'coffee', label: 'Coffee bar', rect: { x: 50, y: 3, w: 5, h: 2 } },
  { id: 'sign', label: 'AUTOPIA', rect: { x: 20, y: 18, w: 8, h: 3 } },
  { id: 'aquarium', label: 'Aquarium', rect: { x: 9, y: 32, w: 3, h: 2 } },
  { id: 'focus', label: 'Focus room screen', rect: { x: 35, y: 19, w: 6, h: 4 } },
  { id: 'printer', label: 'Printer', rect: { x: 33, y: 26, w: 3, h: 2 } },
  { id: 'moodboard', label: 'Moodboard', rect: { x: 9, y: 20, w: 2, h: 2 } },
  { id: 'receptionist', label: 'Rachel · Front desk', rect: { x: 23.3, y: 22.6, w: 1.3, h: 1.7 } },
  { id: 'loungeTv', label: 'Lounge TV', rect: { x: 44.9, y: 26, w: 3.25, h: 1.6 } },
  { id: 'microwave', label: 'Microwave', rect: { x: 46.1, y: 2.8, w: 1.7, h: 1 } },
  { id: 'fridge', label: 'Fridge', rect: { x: 48, y: 1.6, w: 2, h: 3.4 } },
  { id: 'menu', label: 'Coffee menu', rect: { x: 51, y: 1.1, w: 3, h: 1.3 } },
  { id: 'whiteboard', label: 'Boardroom whiteboard', rect: { x: 34, y: 1.3, w: 3, h: 1.9 } },
  ...(Object.keys(ZONES) as ZoneId[]).filter((z) => z !== 'corridor').map((z) => ({ id: `room:${z}`, label: ZONE_LABEL[z], rect: ZONES[z] }))
]
const EMPTY_SLOT_DECOR: OfficeLayout['EMPTY_SLOT_DECOR'] = [
  { desks: ['desk-6', 'desk-7'], p: { key: 'planterBench', tx: 10, ty: 7, tw: 6, th: 1, blocks: true } },
  { desks: ['desk-8', 'desk-9'], p: { key: 'planterBench', tx: 10, ty: 12, tw: 6, th: 1, blocks: true } },
  { desks: ['desk-10'], p: { key: 'plant:fig', tx: 6, ty: 21, tw: 1, th: 1, blocks: true } }
]
const ROOM_LIGHTS: OfficeLayout['ROOM_LIGHTS'] = [
  ...[4, 11].flatMap((y) => [4, 12].map((x) => ({ zone: 'workspace' as ZoneId, x: x * TILE, y: (y + 1) * TILE, r: 80, a: 0.4 }))),
  { zone: 'workspace', x: 20 * TILE, y: 11 * TILE, r: 70, a: 0.45 },
  { zone: 'meeting', x: 31 * TILE + 8, y: 8 * TILE, r: 110, a: 0.55 },
  { zone: 'kitchen', x: 43 * TILE, y: 9 * TILE, r: 80, a: 0.55 },
  { zone: 'kitchen', x: 51 * TILE + 8, y: 11 * TILE, r: 60, a: 0.6 },
  { zone: 'kitchen', x: 52 * TILE, y: 5 * TILE, r: 50, a: 0.45 },
  { zone: 'studio', x: 4 * TILE, y: 22 * TILE, r: 70, a: 0.45 },
  { zone: 'studio', x: 11 * TILE, y: 23 * TILE, r: 60, a: 0.5 },
  { zone: 'lounge', x: 1 * TILE + 8, y: 30 * TILE, r: 70, a: 0.8 },
  { zone: 'lounge', x: 13 * TILE + 8, y: 28 * TILE, r: 60, a: 0.75 },
  { zone: 'lounge', x: 11 * TILE, y: 32 * TILE, r: 40, a: 0.5 },
  { zone: 'reception', x: 24 * TILE, y: 21 * TILE + 8, r: 120, a: 0.8 },
  { zone: 'reception', x: 24 * TILE, y: 27 * TILE, r: 80, a: 0.45 },
  { zone: 'focus', x: 37 * TILE, y: 22 * TILE, r: 60, a: 0.5 },
  { zone: 'supply', x: 37 * TILE, y: 30 * TILE, r: 60, a: 0.4 },
  { zone: 'booths', x: 45 * TILE, y: 19 * TILE, r: 40, a: 0.5 },
  { zone: 'play', x: 47 * TILE, y: 24 * TILE, r: 90, a: 0.45 },
  { zone: 'play', x: 51 * TILE, y: 19 * TILE, r: 40, a: 0.5 }
]

export const startupLayout: OfficeLayout = {
  type: 'startup',
  ZONES,
  ZONE_LABEL,
  ZONE_PURPOSE,
  WALLS,
  FEATURE_WALL,
  ENTRANCE,
  DESKS,
  MEETING_SEATS,
  SPARE_MEETING_SEATS,
  FOCUS_SEATS,
  IDLE_SPOTS,
  PAIR_SPOTS,
  PLACEMENTS,
  WALL_DECOR,
  INTERACTIVES,
  EMPTY_SLOT_DECOR,
  DESK_DIVIDERS: [
    ['desk-6', 'desk-7', 12, 6],
    ['desk-8', 'desk-9', 12, 11]
  ],
  ROOM_LIGHTS,
  RECEPTION: { seat: { tx: 24, ty: 24 }, front: { tx: 24, ty: 26, key: 'reception:0' }, entry: { tx: 23, ty: 34 }, name: 'Rachel' },
  DOG: { bed: { tx: 28, ty: 24 }, bowl: { tx: 30, ty: 24 }, ball: { tx: 27, ty: 26 } }
}
