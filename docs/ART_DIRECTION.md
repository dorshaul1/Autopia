# Autopia art direction

The rules every in-game asset and UI surface follows. If a new asset breaks one of these rules, fix the asset, not the rule.

## World

**Projection.** Top-down 3/4. Every solid object has two visible planes:

- a **top plane**, the lightest
- a **front (south) face**, mid-tone, whose height shows how tall the object is

There are no side planes and no diamond isometry. Vertical surfaces seen edge-on (east/west walls, glass partitions) are drawn as a thin cap strip.

**Scale.**

| Item | Size |
| --- | --- |
| 1 tile | 16 px |
| 1 art pixel | 1 world pixel, never scaled or rotated |
| Person | 14 px wide, ~30 px tall |
| Desk | 3 × 2 tiles |
| Chair seat | 1 tile |
| Doorway | 2 tiles wide minimum |
| Wall face | 48 px tall |

**Light.** One key light from the upper left, through the north windows:

- Top planes +10–15% lightness.
- Front faces are the base color.
- The bottom 1–2 px of a front face are −15%.
- Every object casts a soft contact shadow on the floor: 2–4 px, 20–28% black, offset down and right.
- Emissive things (screens, the sign, lamps, the coffee machine LED) add light through the ADD layer, never by brightening their own pixels past the ramp.

**Outlines.** Selective, never pure black:

- A silhouette pixel takes the darkest neighboring color, darkened another 45%.
- Interior detail lines use the material's darkest ramp step.

**Materials.** Each material has a 4-step ramp in `office/art/palette.ts` (`hi, base, mid, lo`). Do not invent one-off colors in asset code.

| Material | Used for |
| --- | --- |
| Oak | Floors, desks |
| Walnut | Premium furniture |
| Matte black metal | Legs, frames, fixtures |
| Warm white | Cabinets, walls |
| Glass | Partitions: 25–35% alpha, mullions every 2 tiles, a diagonal reflection streak |
| Greens | Plants, in 3 families: monstera, fig, snake |
| Fabrics | Sage, mustard, terracotta, slate |
| Brand amber `#F7C66B` | The AUTOPIA sign and UI accents only |

**Detail density.** Every surface gets 1–3 believable props: mugs, notebooks, cables, a lamp, a plant. Leave floor space clear so circulation reads. Props are at most 6 px; nothing important is a single pixel.

**Calm floors.** A floor is never the loudest thing in a room. Pattern stays low in contrast, in every office.

**Readability.** At the default fit zoom you should be able to tell a person from furniture, every room's purpose, and the state of every monitor.

## Characters

- A 20 × 32 cell. Feet sit on row 29, which is the y-sort anchor.
- Directions: down, up, left; right is a mirror of left.
- Rows: walk ×4, sit facing up (typing), sit facing down (talking), extras (blink, mug, wave), standing side-talk.
- Each employee has a distinct silhouette: hair shape plus an outfit cut (blazer, hoodie, sweater, overshirt) and one signature accessory.

## Floor plan

The office is 56 × 36 tiles. Every room has a job:

| Room | Purpose |
| --- | --- |
| Engineering floor | Two pods of four desks, a huddle table, the team board and a wall-mounted milestone board |
| Boardroom (glass) | Planning kickoffs |
| Focus room (glass) | Real teammate consultations (design or architecture questions) |
| Design studio (glass) | Two design desks, moodboard, light table, swatch shelf |
| Kitchen & coffee bar | Espresso bar, kitchen run, island, dining table, drinks fridge, recycling |
| Lounge | Sofa, armchairs, reading nook, aquarium, records |
| Reception | The illuminated AUTOPIA wall, reception desk, waiting sofas, entrance |
| Phone booths | Three booths. The caller sits between the booth's back and its glass front |
| Print & supply room | Printer and shredder, lockers, shelving, paper stock |
| Game corner | Ping-pong, arcade, TV with beanbags, game shelf |

**Walls.** Walls are data (`WALLS` in `layout.ts`):
- Horizontal walls are a south-facing face: 30 px of glass or drywall.
- Vertical walls are a thin cap.
- Doors are walkable gaps. Glass doors slide open as people approach; drywall doors get walnut jambs.

**Wall height.** Interior walls are shorter than the 48 px north wall, so tall furniture placed against them must clear the face. The top of the sprite stays at or below the wall's top edge.

**Growth.** There are never empty desks. Where future desks will go, the floor holds a planter bench or a plant. A hire replaces it with a furnished desk carrying the new owner's belongings.

## Personal touches

Each desk carries its role kit plus the owner's mug colour, sticky-note colour and one personal item (succulent, photo, figurine, bottle, books, or speaker). These come deterministically from the employee id, so a desk always looks like its owner's.

## Motion

- Walking: 58 px/s at 8 fps. The body bobs 1 px on passing frames.
- Characters reserve the tile they're moving into and never overlap. When blocked they wait, then route around.
- Walking speed varies ±10% per person (persona pace).
- Ambient behavior is local and free (no tokens). Real work always overrides it within one step.
- Idle choice (`office/behavior.ts`) weighs several factors:
  - needs: energy, social, fun, rest, hunger and thirst, which grow faster after real work;
  - persona affinities: social, caffeine, playful, calm;
  - the local time of day: morning coffee, a lunch peak, evening lounging;
  - per-activity cooldowns;
  - walking distance.

  Pair activities (chats, ping-pong) need a free partner who wants to join. Passing teammates sometimes say hi.
- Meetings in the world are real: the boardroom only fills for a planning session, the focus room only for a consultation in progress.

## UI

The UI has two visual languages, so you can always tell world controls from management controls.

**World HUD** (things floating over the office): dark glass panels, a 1 px inner highlight, the Silkscreen pixel font for labels, square-ish 6 px radius. Covers employee labels, room tooltips and the camera dock.

**Management** (the side panel and dialogs): system UI font, 13 px base, 8 px spacing grid, 10 px radius, 1 px hairline borders at 7% white, at most one accent color per component.

**Status colors** (UI only, never in-world furniture):

| Status | Color |
| --- | --- |
| Info / working | `#7FB6FF` |
| OK / done | `#5EE6A8` |
| Warning / waiting | `#F3B84A` |
| Danger / failed | `#FF6B7A` |

**Motion:** 150–250 ms ease-out. Nothing bounces except world emotes.
