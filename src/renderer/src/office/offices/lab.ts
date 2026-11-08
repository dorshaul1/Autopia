// The AI Lab: an ambitious AI research and engineering company. Its own composition: a glass review
// room, an open research floor facing a live data-visualization wall, a café, a tall atrium lobby in
// the south-west, a data-viz studio with a model-experimentation bench, a quiet library lounge, a
// glass evaluation room, a server room, quiet pods and a recreation area.
// Same functional rooms as every office (so every behaviour works here), own architecture and art.

import { TILE } from '../grid'
import type { DeskVariant, OfficeLayout, Placement, Spot, ZoneId } from '../layout'

const seatAt = (x: number, y: number): Spot => ({ tx: x + 1, ty: y + 2, facing: 'up', pose: 'sitUp', dy: 1 })
const deskAt = (x: number, y: number, variant: DeskVariant) => ({ desk: { x, y, w: 3, h: 2 }, seat: seatAt(x, y), variant })
const chair = (key: string, tx: number, ty: number, depthBias: number, dy = 0): Placement => ({ key, tx, ty, tw: 1, th: 1, blocks: false, depthBias, dy })
const decor = (uid: string, key: string, tx: number, ty: number, tw = 1, th = 1): Placement => ({ key, tx, ty, tw, th, blocks: true, uid })
const up = (tx: number, ty: number): Spot => ({ tx, ty, facing: 'up', pose: 'stand' })
const down = (tx: number, ty: number): Spot => ({ tx, ty, facing: 'down', pose: 'stand' })

const ZONES: OfficeLayout['ZONES'] = {
  meeting: { x: 1, y: 4, w: 11, h: 9 },
  workspace: { x: 13, y: 4, w: 26, h: 11 },
  kitchen: { x: 40, y: 4, w: 15, h: 11 },
  corridor: { x: 1, y: 15, w: 54, h: 2 },
  reception: { x: 1, y: 18, w: 14, h: 17 },
  studio: { x: 16, y: 18, w: 11, h: 8 },
  lounge: { x: 16, y: 27, w: 11, h: 8 },
  focus: { x: 28, y: 18, w: 9, h: 6 },
  supply: { x: 28, y: 25, w: 9, h: 10 },
  booths: { x: 38, y: 18, w: 7, h: 3 },
  play: { x: 38, y: 21, w: 17, h: 14 }
}

const ZONE_LABEL: OfficeLayout['ZONE_LABEL'] = {
  workspace: 'Research floor',
  meeting: 'Review room',
  kitchen: 'Café',
  corridor: 'Corridor',
  reception: 'Atrium',
  studio: 'Data-viz studio',
  lounge: 'Library lounge',
  focus: 'Evaluation room',
  supply: 'Server room',
  booths: 'Quiet pods',
  play: 'Recreation'
}

const ZONE_PURPOSE: OfficeLayout['ZONE_PURPOSE'] = {
  workspace: 'Model, data and evaluation work, facing the live metrics wall.',
  meeting: 'Kickoffs and design reviews with the AI Architect.',
  kitchen: 'Coffee, lunch and whiteboard arguments about baselines.',
  corridor: 'Connects every room.',
  reception: 'The front door, under the AUTOPIA · AI LAB sign.',
  studio: 'Dashboards, data visualisation and the experimentation bench.',
  lounge: 'Reading papers and quiet breaks.',
  focus: 'Teammate consultations over the eval dashboard.',
  supply: 'Server racks, the GPU rig and the printer.',
  booths: 'Calls and deep-focus time.',
  play: 'Table tennis, chess and the big screen.'
}

const WALLS: OfficeLayout['WALLS'] = [
  { id: 'reviewEast', kind: 'glass', axis: 'v', x: 12, y: 4, len: 9 },
  { id: 'reviewSouth', kind: 'glass', axis: 'h', x: 1, y: 13, len: 12, doors: [{ at: 4, w: 2 }] },
  { id: 'cafePartition', kind: 'solid', axis: 'v', x: 39, y: 4, len: 9 },
  { id: 'vizNorth', kind: 'glass', axis: 'h', x: 15, y: 17, len: 12, doors: [{ at: 5, w: 2 }] },
  { id: 'vizWest', kind: 'glass', axis: 'v', x: 15, y: 17, len: 9 },
  { id: 'vizEast', kind: 'glass', axis: 'v', x: 27, y: 17, len: 9 },
  { id: 'libraryNorth', kind: 'solid', axis: 'h', x: 16, y: 26, len: 11, doors: [{ at: 4, w: 2 }] },
  { id: 'libraryWest', kind: 'solid', axis: 'v', x: 15, y: 26, len: 9, doors: [{ at: 3, w: 2 }] },
  { id: 'evalNorth', kind: 'glass', axis: 'h', x: 28, y: 17, len: 9, doors: [{ at: 3, w: 2 }] },
  { id: 'evalEast', kind: 'solid', axis: 'v', x: 37, y: 17, len: 7 },
  { id: 'serverNorth', kind: 'solid', axis: 'h', x: 28, y: 24, len: 10 },
  { id: 'serverWest', kind: 'solid', axis: 'v', x: 27, y: 26, len: 9 },
  { id: 'serverEast', kind: 'solid', axis: 'v', x: 37, y: 24, len: 11, doors: [{ at: 4, w: 2 }] }
]

const FEATURE_WALL: OfficeLayout['FEATURE_WALL'] = { x: 3, y: 19, w: 9, h: 3 }
const ENTRANCE: OfficeLayout['ENTRANCE'] = { x: 6, w: 4 }

const DESKS: OfficeLayout['DESKS'] = {
  'desk-pm': { ...deskAt(14, 6, 'pm'), zone: 'workspace' },
  'desk-dev': { ...deskAt(17, 6, 'dev'), zone: 'workspace' },
  'desk-5': { ...deskAt(22, 6, 'dev'), zone: 'workspace' },
  'desk-6': { ...deskAt(25, 6, 'dev'), zone: 'workspace' },
  'desk-7': { ...deskAt(14, 10, 'dev'), zone: 'workspace' },
  'desk-qa': { ...deskAt(17, 10, 'qa'), zone: 'workspace' },
  'desk-8': { ...deskAt(22, 10, 'dev'), zone: 'workspace' },
  'desk-9': { ...deskAt(25, 10, 'dev'), zone: 'workspace' },
  'desk-design': { ...deskAt(17, 19, 'design'), zone: 'studio' },
  'desk-10': { ...deskAt(20, 19, 'design'), zone: 'studio' }
}

const MEETING_SEATS: OfficeLayout['MEETING_SEATS'] = {
  pm: { tx: 3, ty: 6, facing: 'down', pose: 'sitDown', dy: -4 },
  lead_dev: { tx: 5, ty: 6, facing: 'down', pose: 'sitDown', dy: -4 },
  designer: { tx: 3, ty: 9, facing: 'up', pose: 'sitUp', dy: -3 },
  qa: { tx: 5, ty: 9, facing: 'up', pose: 'sitUp', dy: -3 }
}
const SPARE_MEETING_SEATS: Spot[] = [
  { tx: 7, ty: 6, facing: 'down', pose: 'sitDown', dy: -4 },
  { tx: 7, ty: 9, facing: 'up', pose: 'sitUp', dy: -3 }
]
const FOCUS_SEATS: [Spot, Spot] = [
  { tx: 31, ty: 19, facing: 'down', pose: 'sitDown', dy: -4 },
  { tx: 31, ty: 21, facing: 'up', pose: 'sitUp', dy: -3 }
]

const IDLE_SPOTS: OfficeLayout['IDLE_SPOTS'] = {
  // where real work happens away from the desk (workPlace.ts)
  whiteboard: [up(9, 5)],
  testing: [up(32, 5), up(35, 5)],
  coffee: [up(41, 5), up(43, 5)],
  fridge: [up(53, 5), up(54, 8)],
  sink: [up(47, 5)],
  island: [
    { tx: 43, ty: 10, facing: 'up', pose: 'sitUp', dy: -5 },
    { tx: 45, ty: 10, facing: 'up', pose: 'sitUp', dy: -5 },
    { tx: 43, ty: 7, facing: 'down', pose: 'sitDown', dy: -5 },
    { tx: 45, ty: 7, facing: 'down', pose: 'sitDown', dy: -5 }
  ],
  dining: [
    { tx: 49, ty: 10, facing: 'down', pose: 'sitDown', dy: -4 },
    { tx: 51, ty: 10, facing: 'down', pose: 'sitDown', dy: -4 },
    { tx: 49, ty: 13, facing: 'up', pose: 'sitUp', dy: -3 },
    { tx: 51, ty: 13, facing: 'up', pose: 'sitUp', dy: -3 }
  ],
  cooler: [up(38, 6)],
  huddle: [
    { tx: 31, ty: 9, facing: 'up', pose: 'sitUp', dy: -5 },
    { tx: 33, ty: 9, facing: 'up', pose: 'sitUp', dy: -5 },
    { tx: 31, ty: 7, facing: 'down', pose: 'sitDown', dy: -5 },
    { tx: 33, ty: 7, facing: 'down', pose: 'sitDown', dy: -5 }
  ],
  kanban: [up(36, 13)],
  roadmap: [up(15, 5), up(16, 5)],
  window: [up(21, 5), up(22, 5)],
  bookshelf: [up(36, 11)],
  sofa: [
    { tx: 19, ty: 30, facing: 'down', pose: 'sitDown', dy: -11 },
    { tx: 21, ty: 30, facing: 'down', pose: 'sitDown', dy: -11 }
  ],
  armchair: [
    { tx: 17, ty: 32, facing: 'up', pose: 'sitUp', dy: -4 },
    { tx: 23, ty: 32, facing: 'up', pose: 'sitUp', dy: -4 }
  ],
  readingNook: [{ tx: 25, ty: 28, facing: 'down', pose: 'sitDown', dy: -9 }],
  aquarium: [up(24, 34)],
  records: [up(19, 34)],
  moodboard: [up(25, 20)],
  lightTable: [up(24, 24)],
  printer: [up(29, 28)],
  lockers: [up(33, 28)],
  phone: [
    { tx: 38, ty: 19, facing: 'down', pose: 'sitDown', dy: -4 },
    { tx: 40, ty: 19, facing: 'down', pose: 'sitDown', dy: -4 },
    { tx: 42, ty: 19, facing: 'down', pose: 'sitDown', dy: -4 }
  ],
  foosball: [up(50, 25), up(52, 25)],
  arcade: [up(46, 20), up(47, 20)],
  beanbag: [
    { tx: 48, ty: 31, facing: 'up', pose: 'sitUp', dy: -5 },
    { tx: 50, ty: 32, facing: 'up', pose: 'sitUp', dy: -5 },
    { tx: 52, ty: 31, facing: 'up', pose: 'sitUp', dy: -5 }
  ],
  reception: [up(7, 26)],
  stroll: [down(9, 16), down(28, 16), down(45, 16)],
  pongWatch: [down(42, 22), down(44, 22)],
  waiting: [
    { tx: 3, ty: 32, facing: 'down', pose: 'sitDown', dy: -11 },
    { tx: 11, ty: 32, facing: 'down', pose: 'sitDown', dy: -11 }
  ]
}

const PAIR_SPOTS: OfficeLayout['PAIR_SPOTS'] = [
  { kind: 'chat', zone: 'workspace', a: { tx: 20, ty: 9, facing: 'right', pose: 'stand' }, b: { tx: 21, ty: 9, facing: 'left', pose: 'stand' } },
  { kind: 'chat', zone: 'kitchen', a: { tx: 46, ty: 13, facing: 'right', pose: 'stand' }, b: { tx: 47, ty: 13, facing: 'left', pose: 'stand' } },
  { kind: 'chat', zone: 'kitchen', a: { tx: 47, ty: 8, facing: 'right', pose: 'stand' }, b: { tx: 48, ty: 8, facing: 'left', pose: 'stand' } },
  { kind: 'chat', zone: 'corridor', a: { tx: 12, ty: 16, facing: 'right', pose: 'stand' }, b: { tx: 13, ty: 16, facing: 'left', pose: 'stand' } },
  { kind: 'chat', zone: 'reception', a: { tx: 4, ty: 28, facing: 'right', pose: 'stand' }, b: { tx: 5, ty: 28, facing: 'left', pose: 'stand' } },
  { kind: 'chat', zone: 'studio', a: { tx: 20, ty: 24, facing: 'right', pose: 'stand' }, b: { tx: 21, ty: 24, facing: 'left', pose: 'stand' } },
  { kind: 'pingpong', zone: 'play', a: { tx: 40, ty: 24, facing: 'right', pose: 'stand' }, b: { tx: 46, ty: 24, facing: 'left', pose: 'stand' } }
]

const PLACEMENTS: Placement[] = [
  // ── research floor (desks are added per occupied workstation) ──
  { key: 'huddleTable', tx: 31, ty: 8, tw: 3, th: 1, blocks: true },
  ...[31, 33].map((x) => chair('stool:N', x, 7, -8)),
  ...[31, 33].map((x) => chair('stool:S', x, 9, 4, 1)),
  { key: 'kanbanBoard', tx: 35, ty: 12, tw: 3, th: 1, blocks: true, id: 'kanban' },
  { key: 'bookshelf', tx: 35, ty: 10, tw: 3, th: 1, blocks: true },
  { key: 'cooler', tx: 38, ty: 5, tw: 1, th: 1, blocks: true },
  { key: 'lab:plantWall', tx: 13, ty: 4, tw: 2, th: 1, blocks: true },
  { key: 'lab:whiteboardCart', tx: 29, ty: 11, tw: 1, th: 1, blocks: true },
  { key: 'lab:sensorShelf', tx: 31, ty: 4, tw: 3, th: 1, blocks: true },
  decor('rf-plant-1', 'plant:monstera', 38, 13),
  decor('rf-plant-2', 'plant:fig', 13, 14),
  decor('rf-plant-3', 'plant:small', 28, 5),
  decor('rf-bin-1', 'bin', 20, 13),

  // ── review room ──
  { key: 'meetingTable', tx: 2, ty: 7, tw: 7, th: 2, blocks: true, id: 'meeting' },
  ...[3, 5, 7].map((x) => chair('chair:meetingN', x, 6, -8)),
  ...[3, 5, 7].map((x) => chair('chair:meetingS', x, 9, 4, 1)),
  { key: 'credenza', tx: 2, ty: 4, tw: 5, th: 1, blocks: true },
  { key: 'flipchart', tx: 10, ty: 5, tw: 1, th: 1, blocks: true },
  decor('rv-plant-1', 'plant:fig', 1, 4),
  decor('rv-plant-2', 'plant:snake', 1, 11),
  decor('rv-plant-3', 'plant:small', 10, 11),

  // ── café ──
  { key: 'coffeeBar', tx: 40, ty: 4, tw: 5, th: 1, blocks: true, id: 'coffee' },
  { key: 'kitchenRun', tx: 45, ty: 4, tw: 8, th: 1, blocks: true },
  { key: 'fridge', tx: 53, ty: 4, tw: 2, th: 1, blocks: true },
  { key: 'island', tx: 42, ty: 8, tw: 5, th: 2, blocks: true },
  ...[43, 45].map((x) => chair('stool:N', x, 7, -8)),
  ...[43, 45].map((x) => chair('stool:S', x, 10, 4, 1)),
  { key: 'diningTable', tx: 49, ty: 11, tw: 3, th: 2, blocks: true },
  ...[49, 51].map((x) => chair('chair:diningN', x, 10, -8)),
  ...[49, 51].map((x) => chair('chair:diningS', x, 13, 4, 1)),
  { key: 'drinksFridge', tx: 54, ty: 7, tw: 1, th: 1, blocks: true },
  { key: 'recycling', tx: 40, ty: 12, tw: 2, th: 1, blocks: true },
  decor('cafe-plant-1', 'plant:monstera', 54, 14),
  decor('cafe-plant-2', 'plant:small', 40, 10),
  decor('cafe-plant-3', 'plant:fig', 53, 11),

  // ── atrium ──
  { key: 'receptionDesk', tx: 5, ty: 25, tw: 6, th: 1, blocks: true, id: 'reception' },
  { key: 'waitingSofa', tx: 2, ty: 31, tw: 3, th: 1, blocks: true },
  { key: 'waitingSofa', tx: 10, ty: 31, tw: 3, th: 1, blocks: true },
  { key: 'sideTable', tx: 5, ty: 31, tw: 1, th: 1, blocks: true },
  { key: 'planter', tx: 1, ty: 22, tw: 1, th: 3, blocks: true },
  { key: 'planter', tx: 13, ty: 22, tw: 1, th: 3, blocks: true },
  { key: 'lab:lobbyTree', tx: 12, ty: 27, tw: 2, th: 2, blocks: true },
  { key: 'umbrellaStand', tx: 11, ty: 34, tw: 1, th: 1, blocks: true },
  decor('atrium-plant-1', 'plant:monstera', 1, 34),
  decor('atrium-plant-2', 'plant:fig', 1, 27),
  decor('atrium-plant-3', 'plant:small', 9, 31),

  // ── data-viz studio & experimentation bench ──
  { key: 'moodboard', tx: 24, ty: 19, tw: 2, th: 1, blocks: true, id: 'moodboard' },
  { key: 'lightTable', tx: 23, ty: 22, tw: 3, th: 2, blocks: true },
  { key: 'swatchShelf', tx: 16, ty: 24, tw: 4, th: 1, blocks: true },
  decor('viz-plant-1', 'plant:snake', 26, 18),
  decor('viz-plant-2', 'plant:small', 16, 18),

  // ── library lounge ──
  { key: 'bookshelfTall', tx: 16, ty: 27, tw: 3, th: 1, blocks: true },
  { key: 'sofa', tx: 18, ty: 29, tw: 5, th: 1, blocks: true },
  { key: 'coffeeTable', tx: 19, ty: 31, tw: 3, th: 1, blocks: true },
  chair('armchairS', 17, 32, 4, 1),
  chair('armchairS', 23, 32, 4, 1),
  chair('armchairN', 25, 28, -6),
  { key: 'aquarium', tx: 23, ty: 33, tw: 3, th: 1, blocks: true, id: 'aquarium' },
  { key: 'recordConsole', tx: 18, ty: 33, tw: 3, th: 1, blocks: true },
  decor('lib-lamp', 'floorLamp', 26, 30),
  decor('lib-plant', 'plant:monstera', 26, 34),

  // ── evaluation room ──
  { key: 'focusTable', tx: 30, ty: 20, tw: 3, th: 1, blocks: true, id: 'focus' },
  chair('chair:meetingN', 31, 19, -8),
  chair('chair:meetingS', 31, 21, 4, 1),
  { key: 'displayStand', tx: 34, ty: 19, tw: 2, th: 1, blocks: true },
  decor('eval-plant', 'plant:snake', 28, 18),

  // ── server room ──
  { key: 'printerStation', tx: 28, ty: 27, tw: 3, th: 1, blocks: true, id: 'printer' },
  { key: 'lockers', tx: 32, ty: 27, tw: 4, th: 1, blocks: true },
  { key: 'supplyShelf', tx: 28, ty: 31, tw: 1, th: 3, blocks: true },
  { key: 'lab:gpuRig', tx: 30, ty: 31, tw: 2, th: 1, blocks: true },
  { key: 'lab:coolingUnit', tx: 34, ty: 32, tw: 2, th: 1, blocks: true },
  { key: 'paperBoxes', tx: 33, ty: 34, tw: 2, th: 1, blocks: true },
  decor('server-bin', 'bin', 36, 34),

  // ── quiet pods & recreation ──
  ...[38, 40, 42].map((x) => ({ key: 'phoneBooth', tx: x, ty: 18, tw: 2, th: 2, blocks: false, id: 'booths' }) as Placement),
  { key: 'arcade', tx: 46, ty: 18, tw: 1, th: 2, blocks: true },
  { key: 'arcade', tx: 47, ty: 18, tw: 1, th: 2, blocks: true, dx: 1 },
  { key: 'gameShelf', tx: 49, ty: 18, tw: 3, th: 1, blocks: true },
  { key: 'pingpong', tx: 41, ty: 23, tw: 5, th: 2, blocks: true },
  { key: 'foosball', tx: 50, ty: 23, tw: 3, th: 2, blocks: true },
  { key: 'tvConsole', tx: 48, ty: 28, tw: 5, th: 1, blocks: true },
  { key: 'beanbag:terracotta', tx: 48, ty: 31, tw: 1, th: 1, blocks: false, depthBias: 3, uid: 'beanbag-1' },
  { key: 'beanbag:slate', tx: 50, ty: 32, tw: 1, th: 1, blocks: false, depthBias: 3, uid: 'beanbag-2' },
  { key: 'beanbag:mustard', tx: 52, ty: 31, tw: 1, th: 1, blocks: false, depthBias: 3, uid: 'beanbag-3' },
  { key: 'lab:chessTable', tx: 41, ty: 29, tw: 2, th: 1, blocks: true },
  ...[41, 42].map((x) => chair('stool:N', x, 28, -8)),
  ...[41, 42].map((x) => chair('stool:S', x, 30, 4, 1)),
  { key: 'lab:robotKiosk', tx: 53, ty: 22, tw: 1, th: 1, blocks: true },
  decor('rec-plant-1', 'plant:monstera', 54, 34),
  decor('rec-plant-2', 'plant:snake', 54, 18),
  decor('rec-plant-3', 'plant:fig', 38, 34),
  decor('rec-plant-4', 'plant:small', 45, 33)
]

const WALL_DECOR: OfficeLayout['WALL_DECOR'] = {
  windows: [
    { x: 20, w: 4, tall: true },
    { x: 7, w: 3, tall: false }
  ],
  posters: [{ x: 26, kind: 'grid' }],
  clock: { x: 28 },
  roadmap: { x: 14, w: 4 },
  meetingTv: { x: 2, w: 5 },
  whiteboard: { x: 9, w: 3 },
  upperCabinets: [{ x: 46, w: 3 }],
  coffeeMenu: { x: 41, w: 3 },
  workspaceSlats: { x: 24, w: 2 },
  boardFelt: { x: 1, w: 11 },
  backsplash: { x: 40, w: 15 }
}

const DESK_KEYS = Object.keys(DESKS)
const INTERACTIVES: OfficeLayout['INTERACTIVES'] = [
  ...DESK_KEYS.map((id) => ({ id: `desk:${id}`, label: 'Workstation', rect: { ...DESKS[id].desk, y: DESKS[id].desk.y - 1, h: DESKS[id].desk.h + 1 } })),
  { id: 'meeting', label: 'Review table', rect: { x: 2, y: 6, w: 7, h: 3 } },
  { id: 'kanban', label: 'Experiment board', rect: { x: 35, y: 11, w: 3, h: 2 } },
  { id: 'roadmap', label: 'Milestone board', rect: { x: 14, y: 1, w: 4, h: 3 } },
  { id: 'coffee', label: 'Espresso bar', rect: { x: 40, y: 3, w: 5, h: 2 } },
  { id: 'sign', label: 'AUTOPIA · AI Lab', rect: { x: 4, y: 19, w: 7, h: 3 } },
  { id: 'aquarium', label: 'Aquarium', rect: { x: 23, y: 32, w: 3, h: 2 } },
  { id: 'focus', label: 'Eval dashboard', rect: { x: 30, y: 18, w: 6, h: 4 } },
  { id: 'printer', label: 'Printer', rect: { x: 28, y: 26, w: 3, h: 2 } },
  { id: 'moodboard', label: 'Data-viz board', rect: { x: 24, y: 18, w: 2, h: 2 } },
  { id: 'receptionist', label: 'Nadia · Front desk', rect: { x: 6.3, y: 22.6, w: 1.3, h: 1.7 } },
  { id: 'loungeTv', label: 'Big screen', rect: { x: 48.9, y: 26, w: 3.25, h: 1.6 } },
  { id: 'microwave', label: 'Microwave', rect: { x: 51.1, y: 2.8, w: 1.7, h: 1 } },
  { id: 'fridge', label: 'Fridge', rect: { x: 53, y: 1.6, w: 2, h: 3.4 } },
  { id: 'menu', label: 'Café menu', rect: { x: 41, y: 1.1, w: 3, h: 1.3 } },
  { id: 'whiteboard', label: 'Review whiteboard', rect: { x: 9, y: 1.3, w: 3, h: 1.9 } },
  ...(Object.keys(ZONES) as ZoneId[]).filter((z) => z !== 'corridor').map((z) => ({ id: `room:${z}`, label: ZONE_LABEL[z], rect: ZONES[z] }))
]

const EMPTY_SLOT_DECOR: OfficeLayout['EMPTY_SLOT_DECOR'] = [
  { desks: ['desk-9'], p: { key: 'plant:fig', tx: 26, ty: 11, tw: 1, th: 1, blocks: true } },
  { desks: ['desk-design', 'desk-10'], p: { key: 'planterBench', tx: 17, ty: 20, tw: 6, th: 1, blocks: true } }
]

const ROOM_LIGHTS: OfficeLayout['ROOM_LIGHTS'] = [
  ...[6, 10].flatMap((y) => [16, 24].map((x) => ({ zone: 'workspace' as ZoneId, x: x * TILE, y: (y + 1) * TILE, r: 78, a: 0.42 }))),
  { zone: 'workspace', x: 32 * TILE, y: 8 * TILE, r: 70, a: 0.45 },
  { zone: 'meeting', x: 5 * TILE + 8, y: 8 * TILE, r: 100, a: 0.55 },
  { zone: 'kitchen', x: 44 * TILE, y: 9 * TILE, r: 80, a: 0.55 },
  { zone: 'kitchen', x: 50 * TILE + 8, y: 12 * TILE, r: 58, a: 0.6 },
  { zone: 'kitchen', x: 42 * TILE, y: 5 * TILE, r: 46, a: 0.45 },
  { zone: 'reception', x: 7 * TILE, y: 22 * TILE + 8, r: 120, a: 0.8 },
  { zone: 'reception', x: 7 * TILE, y: 29 * TILE, r: 86, a: 0.45 },
  { zone: 'studio', x: 19 * TILE, y: 21 * TILE, r: 66, a: 0.45 },
  { zone: 'studio', x: 24 * TILE, y: 23 * TILE, r: 56, a: 0.5 },
  { zone: 'lounge', x: 20 * TILE, y: 30 * TILE, r: 70, a: 0.7 },
  { zone: 'lounge', x: 26 * TILE + 8, y: 30 * TILE, r: 50, a: 0.75 },
  { zone: 'focus', x: 32 * TILE, y: 21 * TILE, r: 60, a: 0.5 },
  { zone: 'supply', x: 32 * TILE, y: 30 * TILE, r: 64, a: 0.35 },
  { zone: 'booths', x: 41 * TILE, y: 19 * TILE, r: 40, a: 0.5 },
  { zone: 'play', x: 43 * TILE + 8, y: 24 * TILE, r: 90, a: 0.45 },
  { zone: 'play', x: 50 * TILE, y: 30 * TILE, r: 70, a: 0.5 }
]

export const labLayout: OfficeLayout = {
  type: 'lab',
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
    ['desk-pm', 'desk-dev', 16, 6],
    ['desk-5', 'desk-6', 24, 6],
    ['desk-7', 'desk-qa', 16, 10],
    ['desk-8', 'desk-9', 24, 10]
  ],
  ROOM_LIGHTS,
  RECEPTION: { seat: { tx: 7, ty: 24 }, front: { tx: 7, ty: 26, key: 'reception:0' }, entry: { tx: 7, ty: 34 }, name: 'Nadia' },
  DOG: null
}
