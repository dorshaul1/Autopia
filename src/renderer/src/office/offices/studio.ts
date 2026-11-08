// The Game Studio: a creative indie game company. Its own composition (not the startup rearranged):
// a glass greenlight room in the north-west, a central dev pit facing a wall of playtest screens, a
// neon snack bar, a concept-art studio, a couch co-op lounge, a level-design war room, a hardware and
// devkit lab, an offset lobby with the neon logo wall, recording booths, and a neon arcade.
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
  meeting: { x: 1, y: 4, w: 12, h: 10 },
  workspace: { x: 14, y: 4, w: 24, h: 11 },
  kitchen: { x: 39, y: 4, w: 16, h: 11 },
  corridor: { x: 1, y: 15, w: 54, h: 2 },
  studio: { x: 1, y: 18, w: 12, h: 9 },
  lounge: { x: 1, y: 27, w: 12, h: 8 },
  focus: { x: 15, y: 18, w: 9, h: 6 },
  supply: { x: 15, y: 25, w: 9, h: 10 },
  reception: { x: 25, y: 17, w: 15, h: 18 },
  booths: { x: 41, y: 18, w: 7, h: 3 },
  play: { x: 41, y: 21, w: 14, h: 14 }
}

const ZONE_LABEL: OfficeLayout['ZONE_LABEL'] = {
  workspace: 'Dev pit',
  meeting: 'Greenlight room',
  kitchen: 'Snack bar',
  corridor: 'Corridor',
  studio: 'Concept-art studio',
  lounge: 'Couch co-op lounge',
  reception: 'Lobby',
  focus: 'Level-design war room',
  supply: 'Hardware & devkit lab',
  booths: 'Recording booths',
  play: 'Arcade'
}

const ZONE_PURPOSE: OfficeLayout['ZONE_PURPOSE'] = {
  workspace: 'Gameplay, systems and level work happens here, facing the playtest wall.',
  meeting: 'Kickoffs and greenlight reviews with the Game Director.',
  kitchen: 'Snacks, espresso and arguments about frame data.',
  corridor: 'Connects every room.',
  studio: 'Concept art, sprites and visual effects.',
  lounge: 'Couch co-op breaks and playtests on the big screen.',
  reception: 'The front door and the neon logo wall.',
  focus: 'Teammate consultations over printed level maps.',
  supply: 'Devkits, controllers and the 3D printer.',
  booths: 'Voice lines, sound effects and private calls.',
  play: 'Arcade cabinets, air hockey and pinball.'
}

const WALLS: OfficeLayout['WALLS'] = [
  { id: 'greenlightEast', kind: 'glass', axis: 'v', x: 13, y: 4, len: 10 },
  { id: 'greenlightSouth', kind: 'glass', axis: 'h', x: 1, y: 14, len: 13, doors: [{ at: 9, w: 2 }] },
  { id: 'snackPartition', kind: 'solid', axis: 'v', x: 38, y: 4, len: 9 },
  { id: 'artNorth', kind: 'glass', axis: 'h', x: 1, y: 17, len: 13, doors: [{ at: 8, w: 2 }] },
  { id: 'artEast', kind: 'glass', axis: 'v', x: 13, y: 17, len: 10 },
  { id: 'warNorth', kind: 'glass', axis: 'h', x: 14, y: 17, len: 11, doors: [{ at: 4, w: 2 }] },
  { id: 'warWest', kind: 'glass', axis: 'v', x: 14, y: 17, len: 7 },
  { id: 'warEast', kind: 'solid', axis: 'v', x: 24, y: 17, len: 7 },
  { id: 'labNorth', kind: 'solid', axis: 'h', x: 14, y: 24, len: 11 },
  { id: 'labWest', kind: 'solid', axis: 'v', x: 14, y: 24, len: 11 },
  { id: 'labEast', kind: 'solid', axis: 'v', x: 24, y: 24, len: 11, doors: [{ at: 5, w: 2 }] }
]

const FEATURE_WALL: OfficeLayout['FEATURE_WALL'] = { x: 28, y: 18, w: 9, h: 3 }
const ENTRANCE: OfficeLayout['ENTRANCE'] = { x: 31, w: 4 }

const DESKS: OfficeLayout['DESKS'] = {
  'desk-pm': { ...deskAt(15, 6, 'pm'), zone: 'workspace' },
  'desk-dev': { ...deskAt(18, 6, 'dev'), zone: 'workspace' },
  'desk-5': { ...deskAt(23, 6, 'dev'), zone: 'workspace' },
  'desk-6': { ...deskAt(26, 6, 'dev'), zone: 'workspace' },
  'desk-7': { ...deskAt(15, 10, 'dev'), zone: 'workspace' },
  'desk-qa': { ...deskAt(18, 10, 'qa'), zone: 'workspace' },
  'desk-9': { ...deskAt(23, 10, 'dev'), zone: 'workspace' },
  'desk-10': { ...deskAt(26, 10, 'dev'), zone: 'workspace' },
  'desk-design': { ...deskAt(2, 20, 'design'), zone: 'studio' },
  'desk-8': { ...deskAt(5, 20, 'design'), zone: 'studio' }
}

const MEETING_SEATS: OfficeLayout['MEETING_SEATS'] = {
  pm: { tx: 4, ty: 6, facing: 'down', pose: 'sitDown', dy: -4 },
  lead_dev: { tx: 6, ty: 6, facing: 'down', pose: 'sitDown', dy: -4 },
  designer: { tx: 4, ty: 9, facing: 'up', pose: 'sitUp', dy: -3 },
  qa: { tx: 6, ty: 9, facing: 'up', pose: 'sitUp', dy: -3 }
}
const SPARE_MEETING_SEATS: Spot[] = [
  { tx: 8, ty: 6, facing: 'down', pose: 'sitDown', dy: -4 },
  { tx: 8, ty: 9, facing: 'up', pose: 'sitUp', dy: -3 }
]
const FOCUS_SEATS: [Spot, Spot] = [
  { tx: 18, ty: 19, facing: 'down', pose: 'sitDown', dy: -4 },
  { tx: 18, ty: 21, facing: 'up', pose: 'sitUp', dy: -3 }
]

const IDLE_SPOTS: OfficeLayout['IDLE_SPOTS'] = {
  // where real work happens away from the desk (workPlace.ts)
  whiteboard: [up(10, 5)],
  testing: [up(16, 5), up(23, 5)],
  coffee: [up(41, 5), up(43, 5)],
  fridge: [up(53, 5), up(54, 8)],
  sink: [up(47, 5)],
  island: [
    { tx: 42, ty: 10, facing: 'up', pose: 'sitUp', dy: -5 },
    { tx: 44, ty: 10, facing: 'up', pose: 'sitUp', dy: -5 },
    { tx: 42, ty: 7, facing: 'down', pose: 'sitDown', dy: -5 },
    { tx: 44, ty: 7, facing: 'down', pose: 'sitDown', dy: -5 }
  ],
  dining: [
    { tx: 49, ty: 10, facing: 'down', pose: 'sitDown', dy: -4 },
    { tx: 51, ty: 10, facing: 'down', pose: 'sitDown', dy: -4 },
    { tx: 49, ty: 13, facing: 'up', pose: 'sitUp', dy: -3 },
    { tx: 51, ty: 13, facing: 'up', pose: 'sitUp', dy: -3 }
  ],
  cooler: [up(37, 6)],
  huddle: [
    { tx: 31, ty: 9, facing: 'up', pose: 'sitUp', dy: -5 },
    { tx: 33, ty: 9, facing: 'up', pose: 'sitUp', dy: -5 },
    { tx: 31, ty: 7, facing: 'down', pose: 'sitDown', dy: -5 },
    { tx: 33, ty: 7, facing: 'down', pose: 'sitDown', dy: -5 }
  ],
  kanban: [up(35, 13)],
  roadmap: [up(28, 5), up(29, 5)],
  window: [up(35, 5), up(36, 5)],
  bookshelf: [up(36, 11)],
  sofa: [
    { tx: 9, ty: 30, facing: 'down', pose: 'sitDown', dy: -11 },
    { tx: 11, ty: 30, facing: 'down', pose: 'sitDown', dy: -11 }
  ],
  armchair: [
    { tx: 5, ty: 33, facing: 'up', pose: 'sitUp', dy: -4 },
    { tx: 7, ty: 33, facing: 'up', pose: 'sitUp', dy: -4 }
  ],
  readingNook: [{ tx: 12, ty: 27, facing: 'down', pose: 'sitDown', dy: -9 }],
  aquarium: [up(10, 34)],
  records: [up(2, 34)],
  moodboard: [up(10, 22)],
  lightTable: [up(10, 25)],
  printer: [up(17, 28)],
  lockers: [up(21, 28)],
  phone: [
    { tx: 41, ty: 19, facing: 'down', pose: 'sitDown', dy: -4 },
    { tx: 43, ty: 19, facing: 'down', pose: 'sitDown', dy: -4 },
    { tx: 45, ty: 19, facing: 'down', pose: 'sitDown', dy: -4 }
  ],
  foosball: [up(49, 27), up(51, 27)],
  arcade: [up(48, 20), up(49, 20)],
  beanbag: [
    { tx: 2, ty: 31, facing: 'up', pose: 'sitUp', dy: -5 },
    { tx: 4, ty: 32, facing: 'up', pose: 'sitUp', dy: -5 },
    { tx: 6, ty: 31, facing: 'up', pose: 'sitUp', dy: -5 }
  ],
  reception: [up(32, 26)],
  stroll: [down(9, 16), down(28, 16), down(45, 16)],
  pongWatch: [down(45, 22), down(47, 22)],
  waiting: [
    { tx: 27, ty: 32, facing: 'down', pose: 'sitDown', dy: -11 },
    { tx: 37, ty: 32, facing: 'down', pose: 'sitDown', dy: -11 }
  ]
}

const PAIR_SPOTS: OfficeLayout['PAIR_SPOTS'] = [
  { kind: 'chat', zone: 'workspace', a: { tx: 21, ty: 9, facing: 'right', pose: 'stand' }, b: { tx: 22, ty: 9, facing: 'left', pose: 'stand' } },
  { kind: 'chat', zone: 'kitchen', a: { tx: 46, ty: 13, facing: 'right', pose: 'stand' }, b: { tx: 47, ty: 13, facing: 'left', pose: 'stand' } },
  { kind: 'chat', zone: 'kitchen', a: { tx: 47, ty: 8, facing: 'right', pose: 'stand' }, b: { tx: 48, ty: 8, facing: 'left', pose: 'stand' } },
  { kind: 'chat', zone: 'corridor', a: { tx: 12, ty: 16, facing: 'right', pose: 'stand' }, b: { tx: 13, ty: 16, facing: 'left', pose: 'stand' } },
  { kind: 'chat', zone: 'reception', a: { tx: 28, ty: 28, facing: 'right', pose: 'stand' }, b: { tx: 29, ty: 28, facing: 'left', pose: 'stand' } },
  { kind: 'chat', zone: 'studio', a: { tx: 7, ty: 25, facing: 'right', pose: 'stand' }, b: { tx: 8, ty: 25, facing: 'left', pose: 'stand' } },
  { kind: 'pingpong', zone: 'play', a: { tx: 43, ty: 24, facing: 'right', pose: 'stand' }, b: { tx: 49, ty: 24, facing: 'left', pose: 'stand' } }
]

const PLACEMENTS: Placement[] = [
  // ── dev pit (desks are added per occupied workstation) ──
  { key: 'huddleTable', tx: 31, ty: 8, tw: 3, th: 1, blocks: true },
  ...[31, 33].map((x) => chair('stool:N', x, 7, -8)),
  ...[31, 33].map((x) => chair('stool:S', x, 9, 4, 1)),
  { key: 'kanbanBoard', tx: 34, ty: 12, tw: 3, th: 1, blocks: true, id: 'kanban' },
  { key: 'bookshelf', tx: 35, ty: 10, tw: 3, th: 1, blocks: true },
  { key: 'cooler', tx: 37, ty: 5, tw: 1, th: 1, blocks: true },
  { key: 'gs:speaker', tx: 14, ty: 4, tw: 1, th: 1, blocks: true },
  { key: 'gs:merchShelf', tx: 30, ty: 4, tw: 3, th: 1, blocks: true },
  decor('pit-plant-1', 'plant:monstera', 37, 13),
  decor('pit-plant-2', 'plant:snake', 14, 14),
  decor('pit-plant-3', 'plant:small', 22, 5),
  decor('pit-bin-1', 'bin', 21, 13),
  decor('pit-figure', 'gs:figureStand', 29, 12),

  // ── greenlight room ──
  { key: 'meetingTable', tx: 3, ty: 7, tw: 7, th: 2, blocks: true, id: 'meeting' },
  ...[4, 6, 8].map((x) => chair('chair:meetingN', x, 6, -8)),
  ...[4, 6, 8].map((x) => chair('chair:meetingS', x, 9, 4, 1)),
  { key: 'credenza', tx: 3, ty: 4, tw: 5, th: 1, blocks: true },
  { key: 'flipchart', tx: 11, ty: 5, tw: 1, th: 1, blocks: true },
  decor('gl-plant-1', 'plant:fig', 1, 4),
  decor('gl-plant-2', 'plant:snake', 1, 12),
  decor('gl-plant-3', 'plant:small', 12, 12),

  // ── snack bar ──
  { key: 'coffeeBar', tx: 40, ty: 4, tw: 5, th: 1, blocks: true, id: 'coffee' },
  { key: 'kitchenRun', tx: 45, ty: 4, tw: 8, th: 1, blocks: true },
  { key: 'fridge', tx: 53, ty: 4, tw: 2, th: 1, blocks: true },
  { key: 'island', tx: 41, ty: 8, tw: 5, th: 2, blocks: true },
  ...[42, 44].map((x) => chair('stool:N', x, 7, -8)),
  ...[42, 44].map((x) => chair('stool:S', x, 10, 4, 1)),
  { key: 'diningTable', tx: 49, ty: 11, tw: 3, th: 2, blocks: true },
  ...[49, 51].map((x) => chair('chair:diningN', x, 10, -8)),
  ...[49, 51].map((x) => chair('chair:diningS', x, 13, 4, 1)),
  { key: 'drinksFridge', tx: 54, ty: 7, tw: 1, th: 1, blocks: true },
  { key: 'gs:clawMachine', tx: 53, ty: 11, tw: 2, th: 1, blocks: true },
  { key: 'recycling', tx: 39, ty: 12, tw: 2, th: 1, blocks: true },
  decor('snack-plant-1', 'plant:monstera', 54, 14),
  decor('snack-plant-2', 'plant:small', 39, 10),

  // ── concept-art studio ──
  { key: 'moodboard', tx: 9, ty: 21, tw: 2, th: 1, blocks: true, id: 'moodboard' },
  { key: 'lightTable', tx: 9, ty: 23, tw: 3, th: 2, blocks: true },
  { key: 'swatchShelf', tx: 1, ty: 25, tw: 4, th: 1, blocks: true },
  { key: 'gs:easel', tx: 12, ty: 21, tw: 1, th: 1, blocks: true },
  decor('art-plant-1', 'plant:fig', 1, 19),
  decor('art-plant-2', 'plant:snake', 12, 25),
  decor('art-lamp', 'floorLamp', 8, 19),

  // ── couch co-op lounge ──
  { key: 'tvConsole', tx: 2, ty: 28, tw: 5, th: 1, blocks: true },
  { key: 'beanbag:terracotta', tx: 2, ty: 31, tw: 1, th: 1, blocks: false, depthBias: 3, uid: 'beanbag-1' },
  { key: 'beanbag:slate', tx: 4, ty: 32, tw: 1, th: 1, blocks: false, depthBias: 3, uid: 'beanbag-2' },
  { key: 'beanbag:mustard', tx: 6, ty: 31, tw: 1, th: 1, blocks: false, depthBias: 3, uid: 'beanbag-3' },
  { key: 'sofa', tx: 8, ty: 29, tw: 5, th: 1, blocks: true },
  { key: 'coffeeTable', tx: 9, ty: 31, tw: 3, th: 1, blocks: true },
  chair('armchairS', 5, 33, 4, 1),
  chair('armchairS', 7, 33, 4, 1),
  chair('armchairN', 12, 27, -6),
  { key: 'aquarium', tx: 9, ty: 33, tw: 3, th: 1, blocks: true, id: 'aquarium' },
  { key: 'recordConsole', tx: 1, ty: 33, tw: 3, th: 1, blocks: true },
  decor('lounge-lamp', 'floorLamp', 12, 31),
  decor('lounge-plant', 'plant:monstera', 12, 34),

  // ── level-design war room ──
  { key: 'focusTable', tx: 17, ty: 20, tw: 3, th: 1, blocks: true, id: 'focus' },
  chair('chair:meetingN', 18, 19, -8),
  chair('chair:meetingS', 18, 21, 4, 1),
  { key: 'displayStand', tx: 21, ty: 19, tw: 2, th: 1, blocks: true },
  decor('war-plant', 'plant:snake', 15, 18),

  // ── hardware & devkit lab ──
  { key: 'printerStation', tx: 16, ty: 27, tw: 3, th: 1, blocks: true, id: 'printer' },
  { key: 'lockers', tx: 20, ty: 27, tw: 4, th: 1, blocks: true },
  { key: 'supplyShelf', tx: 15, ty: 30, tw: 1, th: 3, blocks: true },
  { key: 'paperBoxes', tx: 21, ty: 33, tw: 2, th: 1, blocks: true },
  { key: 'gs:devkitBench', tx: 18, ty: 31, tw: 3, th: 1, blocks: true },
  decor('lab-bin', 'bin', 23, 33),

  // ── lobby ──
  { key: 'receptionDesk', tx: 30, ty: 25, tw: 6, th: 1, blocks: true, id: 'reception' },
  { key: 'waitingSofa', tx: 26, ty: 31, tw: 3, th: 1, blocks: true },
  { key: 'waitingSofa', tx: 36, ty: 31, tw: 3, th: 1, blocks: true },
  { key: 'sideTable', tx: 29, ty: 31, tw: 1, th: 1, blocks: true },
  { key: 'gs:trophyCase', tx: 37, ty: 18, tw: 2, th: 1, blocks: true },
  { key: 'gs:mascot', tx: 26, ty: 22, tw: 2, th: 2, blocks: true },
  { key: 'gs:neonPlay', tx: 39, ty: 27, tw: 1, th: 1, blocks: true },
  { key: 'umbrellaStand', tx: 35, ty: 33, tw: 1, th: 1, blocks: true },
  decor('lobby-plant-1', 'plant:fig', 25, 18),
  decor('lobby-plant-2', 'plant:monstera', 25, 34),
  decor('lobby-plant-3', 'plant:monstera', 39, 34),
  decor('lobby-plant-4', 'plant:small', 35, 31),

  // ── recording booths & arcade ──
  ...[41, 43, 45].map((x) => ({ key: 'phoneBooth', tx: x, ty: 18, tw: 2, th: 2, blocks: false, id: 'booths' }) as Placement),
  { key: 'arcade', tx: 48, ty: 18, tw: 1, th: 2, blocks: true },
  { key: 'arcade', tx: 49, ty: 18, tw: 1, th: 2, blocks: true, dx: 1 },
  { key: 'gs:arcadeB', tx: 50, ty: 18, tw: 1, th: 2, blocks: true, dx: 2 },
  { key: 'gameShelf', tx: 52, ty: 18, tw: 3, th: 1, blocks: true },
  { key: 'pingpong', tx: 44, ty: 23, tw: 5, th: 2, blocks: true },
  { key: 'foosball', tx: 49, ty: 25, tw: 3, th: 2, blocks: true },
  { key: 'gs:pinball', tx: 53, ty: 22, tw: 1, th: 2, blocks: true },
  { key: 'gs:pinball', tx: 54, ty: 22, tw: 1, th: 2, blocks: true, dx: 1 },
  { key: 'gs:vrStand', tx: 42, ty: 28, tw: 1, th: 1, blocks: true },
  { key: 'gs:danceMachine', tx: 51, ty: 28, tw: 3, th: 2, blocks: true },
  // spectators' corner: a high table with stools between the VR space and the rhythm game
  { key: 'huddleTable', tx: 47, ty: 31, tw: 3, th: 1, blocks: true },
  ...[47, 49].map((x) => chair('stool:N', x, 30, -8)),
  ...[47, 49].map((x) => chair('stool:S', x, 32, 4, 1)),
  { key: 'gs:arcadeB', tx: 54, ty: 25, tw: 1, th: 2, blocks: true },
  { key: 'arcade', tx: 54, ty: 31, tw: 1, th: 2, blocks: true },
  { key: 'gs:speaker', tx: 46, ty: 27, tw: 1, th: 1, blocks: true },
  { key: 'gs:speaker', tx: 41, ty: 33, tw: 1, th: 1, blocks: true },
  decor('arcade-figure', 'gs:figureStand', 50, 34),
  decor('arcade-plant-1', 'plant:snake', 41, 34),
  decor('arcade-plant-2', 'plant:monstera', 54, 34),
  decor('arcade-bin', 'bin', 47, 34)
]

const WALL_DECOR: OfficeLayout['WALL_DECOR'] = {
  windows: [
    { x: 34, w: 3, tall: false },
    { x: 50, w: 3, tall: false }
  ],
  posters: [
    { x: 20, kind: 'ship' },
    { x: 12, kind: 'wave' }
  ],
  clock: { x: 32 },
  roadmap: { x: 27, w: 4 },
  meetingTv: { x: 4, w: 5 },
  whiteboard: { x: 9, w: 3 },
  upperCabinets: [{ x: 46, w: 3 }],
  coffeeMenu: { x: 41, w: 3 },
  workspaceSlats: { x: 15, w: 4 },
  boardFelt: { x: 1, w: 12 },
  backsplash: { x: 39, w: 16 }
}

/** The playtest wall: big screens over the dev pit that play the team's game loop (decorative). */
export const STUDIO_SCREENS = [
  { x: 15, w: 4 },
  { x: 22, w: 4 }
]

const DESK_KEYS = Object.keys(DESKS)
const INTERACTIVES: OfficeLayout['INTERACTIVES'] = [
  ...DESK_KEYS.map((id) => ({ id: `desk:${id}`, label: 'Workstation', rect: { ...DESKS[id].desk, y: DESKS[id].desk.y - 1, h: DESKS[id].desk.h + 1 } })),
  { id: 'meeting', label: 'Greenlight table', rect: { x: 3, y: 6, w: 7, h: 3 } },
  { id: 'kanban', label: 'Sprint board', rect: { x: 34, y: 11, w: 3, h: 2 } },
  { id: 'roadmap', label: 'Milestone board', rect: { x: 27, y: 1, w: 4, h: 3 } },
  { id: 'coffee', label: 'Espresso bar', rect: { x: 40, y: 3, w: 5, h: 2 } },
  { id: 'sign', label: 'AUTOPIA · Game Studio', rect: { x: 29, y: 18, w: 7, h: 3 } },
  { id: 'aquarium', label: 'Neon fish tank', rect: { x: 9, y: 32, w: 3, h: 2 } },
  { id: 'focus', label: 'Level map screen', rect: { x: 17, y: 18, w: 6, h: 4 } },
  { id: 'printer', label: '3D printer', rect: { x: 16, y: 26, w: 3, h: 2 } },
  { id: 'moodboard', label: 'Concept board', rect: { x: 9, y: 20, w: 2, h: 2 } },
  { id: 'receptionist', label: 'Mika · Front desk', rect: { x: 31.3, y: 22.6, w: 1.3, h: 1.7 } },
  { id: 'loungeTv', label: 'Co-op screen', rect: { x: 2.9, y: 26, w: 3.25, h: 1.6 } },
  { id: 'microwave', label: 'Microwave', rect: { x: 51.1, y: 2.8, w: 1.7, h: 1 } },
  { id: 'fridge', label: 'Fridge', rect: { x: 53, y: 1.6, w: 2, h: 3.4 } },
  { id: 'menu', label: 'Snack menu', rect: { x: 41, y: 1.1, w: 3, h: 1.3 } },
  { id: 'whiteboard', label: 'Storyboard', rect: { x: 9, y: 1.3, w: 3, h: 1.9 } },
  ...(Object.keys(ZONES) as ZoneId[]).filter((z) => z !== 'corridor').map((z) => ({ id: `room:${z}`, label: ZONE_LABEL[z], rect: ZONES[z] }))
]

const EMPTY_SLOT_DECOR: OfficeLayout['EMPTY_SLOT_DECOR'] = [
  { desks: ['desk-9', 'desk-10'], p: { key: 'planterBench', tx: 23, ty: 11, tw: 6, th: 1, blocks: true } },
  { desks: ['desk-8'], p: { key: 'plant:fig', tx: 6, ty: 21, tw: 1, th: 1, blocks: true } }
]

const ROOM_LIGHTS: OfficeLayout['ROOM_LIGHTS'] = [
  ...[6, 10].flatMap((y) => [17, 25].map((x) => ({ zone: 'workspace' as ZoneId, x: x * TILE, y: (y + 1) * TILE, r: 74, a: 0.42 }))),
  { zone: 'workspace', x: 32 * TILE, y: 8 * TILE, r: 64, a: 0.45 },
  { zone: 'meeting', x: 6 * TILE + 8, y: 8 * TILE, r: 100, a: 0.55 },
  { zone: 'kitchen', x: 43 * TILE, y: 9 * TILE, r: 76, a: 0.55 },
  { zone: 'kitchen', x: 50 * TILE + 8, y: 12 * TILE, r: 58, a: 0.6 },
  { zone: 'kitchen', x: 42 * TILE, y: 5 * TILE, r: 46, a: 0.45 },
  { zone: 'studio', x: 4 * TILE, y: 22 * TILE, r: 70, a: 0.45 },
  { zone: 'studio', x: 10 * TILE, y: 23 * TILE, r: 56, a: 0.5 },
  { zone: 'lounge', x: 4 * TILE + 8, y: 29 * TILE, r: 64, a: 0.6 },
  { zone: 'lounge', x: 12 * TILE + 8, y: 31 * TILE, r: 56, a: 0.75 },
  { zone: 'lounge', x: 10 * TILE, y: 33 * TILE, r: 40, a: 0.5 },
  { zone: 'reception', x: 32 * TILE, y: 21 * TILE + 8, r: 120, a: 0.75 },
  { zone: 'reception', x: 32 * TILE, y: 28 * TILE, r: 84, a: 0.45 },
  { zone: 'focus', x: 19 * TILE, y: 21 * TILE, r: 60, a: 0.5 },
  { zone: 'supply', x: 19 * TILE, y: 30 * TILE, r: 64, a: 0.4 },
  { zone: 'booths', x: 44 * TILE, y: 19 * TILE, r: 40, a: 0.5 },
  { zone: 'play', x: 46 * TILE + 8, y: 24 * TILE, r: 90, a: 0.45 },
  { zone: 'play', x: 50 * TILE, y: 19 * TILE, r: 46, a: 0.55 },
  { zone: 'play', x: 52 * TILE, y: 29 * TILE, r: 56, a: 0.5 }
]

export const studioLayout: OfficeLayout = {
  type: 'studio',
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
    ['desk-pm', 'desk-dev', 17, 6],
    ['desk-5', 'desk-6', 25, 6],
    ['desk-7', 'desk-qa', 17, 10],
    ['desk-9', 'desk-10', 25, 10]
  ],
  ROOM_LIGHTS,
  RECEPTION: { seat: { tx: 32, ty: 24 }, front: { tx: 32, ty: 26, key: 'reception:0' }, entry: { tx: 32, ty: 34 }, name: 'Mika' },
  DOG: null
}
