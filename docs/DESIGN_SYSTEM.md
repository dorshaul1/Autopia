# Autopia design system

One visual language, "Night shift" (see [AUTOPIA_NEXT.md](AUTOPIA_NEXT.md)), for the application UI around the office. The office artwork itself follows [ART_DIRECTION.md](ART_DIRECTION.md) and is not governed by this document.

## Where things live

| File | What it holds | Rule |
| --- | --- | --- |
| `src/renderer/src/design/tokens.css` | Every raw value: colors, type, space, radii, shadows, motion, layers | The only place hex and rgba values belong |
| `src/renderer/src/design/primitives.css` | The one definition of each shared control | Built only from tokens |
| `src/renderer/src/components/ui/index.tsx` | React wrappers with roles and keyboard behavior | Use these for new UI |
| `src/renderer/src/styles.css` | Feature styles | May place and size primitives, never re-skin them |

They load in that order from `main.tsx`. `test/design41.test.ts` enforces the rules: every `var()` resolves, text meets WCAG AA on every surface, and `styles.css` has no raw colors, font sizes or font weights.

## Color rules

- **Neutrals first.** Hierarchy comes from surfaces and text tones, not hue.
- **Display type is rare.** `--font-display` is for product names and page titles only.
- **Accent means action.** Verdigris is for the primary action in a view, links, focus and selected or live state. Never decoration.
- **Status colors mean status.** `ok`, `warn`, `danger` and `info` report state. Each has a base, `-soft` fill, `-line` border and `-text`.
- **Role colors are identity marks.** Avatar rings and timeline bars only.
- **Text floor.** `--text-faint` is the lowest tone for anything people need to read. `--text-disabled` is decorative.
- **One primary per view.** A `btn-primary` means "this is the next step".

## Tokens

| Group | Names |
| --- | --- |
| Surfaces, back to front | `--bg-deep`, `--bg-app`, `--bg-chrome`, `--bg-panel`, `--bg-elevated`, `--bg-raised`, `--bg-control`, `--bg-sunken` |
| Over the office | `--bg-glass`, `--bg-glass-strong`, `--scrim` |
| Fills (hover, selected, pressed) | `--fill-1` to `--fill-5`, `--fill-strong` |
| Shades | `--shade-1` to `--shade-4` |
| Borders | `--border-subtle`, `--border`, `--border-strong` |
| Text | `--text-strong`, `--text-primary`, `--text-secondary`, `--text-muted`, `--text-faint`, `--text-disabled` |
| Accent | `--accent`, `--accent-hover`, `--accent-press`, `--accent-text`, `--on-accent`, `--accent-faint`, `--accent-soft`, `--accent-muted`, `--accent-line`, `--accent-strong` |
| Type size | `--text-micro` and `--text-micro-lg` (pixel HUD only), `--text-2xs` 10.5, `--text-xs` 11.5, `--text-sm` 12.5, `--text-base` 13, `--text-md` 14, `--text-lg` 15, `--text-xl` 18, `--text-2xl` 22, `--text-3xl` 24 |
| Weight | `--weight-regular`, `--weight-medium`, `--weight-semibold`, `--weight-bold` |
| Space (4px rhythm) | `--space-0_5` 2, `--space-1` 4, `--space-1_5` 6, `--space-2` 8, `--space-2_5` 10, `--space-3` 12, `--space-4` 16, `--space-5` 20, `--space-6` 24, `--space-8` 32 |
| Radius | `--radius-xs` 4, `--radius-sm` 6, `--radius-md` 8, `--radius-lg` 10, `--radius-xl` 12, `--radius-2xl` 16, `--radius-pill` |
| Elevation | `--shadow-sm`, `--shadow-md`, `--shadow-lg`, `--shadow-xl`, `--shadow-float`, `--highlight-inset` |
| Sizes | `--control-xs` 22, `--control-sm` 26, `--control-md` 30, `--control-lg` 36; `--icon-xs` 11, `--icon-sm` 13, `--icon-md` 15, `--icon-lg` 18 |
| Motion | `--dur-instant`, `--dur-fast`, `--dur-mid`, `--dur-slow`, `--dur-slower`, `--ease`, `--ease-out` (durations drop to 0 under reduced motion) |
| Layers | `--z-hud`, `--z-popover`, `--z-toast`, `--z-dialog`, `--z-tooltip` |

## Primitives

| Component | Class contract | Behavior |
| --- | --- | --- |
| `Button` | `.btn` + `.btn-primary`, `.btn-ghost`, `.btn-danger`, `.btn-link`; `.btn-xs`, `.btn-sm`, `.btn-lg`; `.btn-block`, `.active` | `loading` shows a spinner and blocks clicks |
| `IconButton` | `.icon-btn`, `.icon-btn-sm`, `.active`, `.danger` | `label` is required: it is the accessible name and the tooltip |
| Bar button (class only) | `.btn-bar`, `.btn-bar-sm`, `.tone-ok`, `.tone-warn`, `.tone-danger`, `.tone-ai` | Compact status and action controls in toolbars |
| `Input`, `Textarea`, `Select` | `.input`, `.input-sm`, `.select`, `.select-sm`, `.select-ghost` | `invalid` sets `aria-invalid` |
| `Field` | `.field`, `.label`, `.field-hint`, `.field-error` | Links label, control and note for screen readers |
| `Switch` | `.switch`, `.switch-track` | `role="switch"`. For on/off preferences; use a native checkbox for multi-select lists |
| `Segmented` | `.segmented`, `.segmented-sm`, `.segmented-icon` | `radiogroup`, arrow keys, Home and End. No outer margin: the parent places it |
| `Tabs` | `.tabs`, `.tab` | `tablist`, same keys |
| `Card` | `.card`, `.card-head`, `.card-title`, `.card-interactive` | |
| `Badge` | `.badge`, `.badge-ok`, `.badge-warn`, `.badge-accent` | A count |
| `Pill` (in `common.tsx`) | `.pill`, `.pill-{muted,info,ok,warn,danger,accent}`, `.pill-dot` | A status with a dot |
| `Chip` | `.chip`, `.chip-{tone}`, `.chip-caps` | A skill, a trait, a file |
| Tag (class only) | `.tag`, `.tag-caps`, `.tag-accent`, `.tag-outline`, `.tag-dashed`, `.tag-mono` | A tiny label on a row |
| `Callout` | `.callout`, `.callout-{info,ok,warn,danger}` | Danger announces as an alert |
| `Dialog` | `.modal-backdrop`, `.modal`, `.modal-wide`, `.modal-actions`, `.modal-lightbox` | Escape and the backdrop close it, Tab stays inside, focus returns to the opener. `dismissable={false}` when it must be answered |
| `usePopover`, `menuKeys` | `.popover`, `.popover-label`, `.popover-sep`, `.menu-item` | Outside click and Escape close it, focus returns to the trigger, arrows move through the menu |
| Tooltip | `data-tip="…"` on any element | One layer (`Tooltip.tsx`): opens on hover and keyboard focus, stays on screen |
| `Toast` | `.toast`, `.toast-error`, `.toast-attn`, `.toast-result` | Errors announce as alerts |
| `Spinner`, `Kbd` | `.spinner`, `.spinner-sm`, `kbd` | |

Focus is global: `:focus-visible` draws a 2px accent outline, and inputs use a soft ring instead. Do not remove it. When a control sits inside a clipped row, inset it with a negative `outline-offset`.

## The office HUD

Controls drawn over the office (room labels, the team dock, inspector actions, sound toggles) keep the pixel language: Silkscreen labels, dark glass and small radii. They use the same tokens. Their look is deliberate, and the office artwork is never flattened to match the panels.

## Adding UI

1. Reach for a primitive first. If one nearly fits, add a variant to it rather than a one-off class.
2. A feature class in `styles.css` should describe placement and size. If it sets `background`, `border` and `color` on a control, it is probably a new variant.
3. Need a new value? Add a semantic token to `tokens.css` and say what it is for.
4. Icon-only buttons need an accessible name. Use `IconButton`.
5. Colors from data (an office's accent, a chart series) may be inline. Everything else comes from tokens.

## Known gaps

- About 300 buttons use the `.btn` classes directly rather than `<Button>`. They get the same look and states, so they can move when each screen is redesigned.
- Padding and gaps in `styles.css` still use px values. Spacing tokens are used by the primitives; feature layouts move to them as screens are redesigned.
- Some feature cards (project cards, result cards, office cards) keep their own layouts, built from tokens rather than `.card`.

## Component patterns (refinement 2)

| Pattern | Rule |
| --- | --- |
| `EmptyState`, `Loading` (`components/ui`) | The only way to show "nothing here", "waiting" or a failed view. `tone="danger"` for errors. Never a bare grey sentence |
| Messages | A teammate speaks in plain text beside an avatar; only your own messages get a bubble. Time and actions appear on hover. A message shows a state only when it is queued, working or failed |
| Composer | Text first, then one quiet row (who it goes to). The label for what will happen appears only once there is text; its explanation is a tooltip |
| Action cards (`.approval`) | Same shell for every decision: what it is, the title, the evidence, one short line, buttons right-aligned with one primary. Color only on the icon and border |
| Execution | One line per request; steps directly underneath. Older requests stay folded. No card inside a card |
| Lists of work | Each person appears once per row. Avatar on the left, metadata in muted text, one status pill on the right |
| Long agent-written text | Clamp it (`LongText`): the start, and the rest on request |
| Preferences | `Switch` with the label on one line and the explanation below in muted text. A note shared by many rows appears once |
| Notifications | No `btn-primary` in lists: when everything is primary, nothing is |

## Screen layout (refinement 3)

Everything sits under one top bar, so there is one way around the app:

- **Top bar:** the project switcher, then the project's four areas, labeled, with live counts; on the right, what needs you, then search, the conversation toggle, Company and Settings. `⌘1` to `⌘4` move between areas. Esc returns to the office.
- **Office:** the office and the side panel (Conversation, Execution, Task, Teammate, Details).
- **Results:** one result at a time: Preview, Changes, Checks, All results, with what was built and "Does it work?" beside the first two. Link here with `actions.openPane(pane)`; `actions.openResult(id)` opens a result at Preview.
- **Work:** Tasks, Session logs, Product brief. **Project:** Files, Memory, Time and cost. Each reopens where you left it.
- **Company** and **Settings** are outside any one project, so they name themselves.

Rules for a new screen: sections go in `FocusShell` (a row of tabs, never a sidebar). Reading content uses `.ws-page` so it keeps its measure on wide screens. Don't add a second way back to the office, and don't repeat what the top bar already says.

## Interaction rules (refinement 4)

- **Always say what's next.** `NextUp` (from `shared/whatsNext.ts`) is the one line above the composer: what only you can do comes first, then paused, stuck, planning, verifying, working, ready to review. It only reports real state, and it stays silent when nothing is going on.
- **Ask once.** A question you've answered (running this exact dev command, for this project) isn't asked again until the answer could change.
- **Good defaults over questions.** New projects go in `~/Autopia`, the name comes from the idea, and the recommended office is preselected. All of it can be changed, none of it has to be.
- **Changes apply.** Preferences save as you make them. Values that can't be right wait, with the reason beside them. There is no Save button to forget.
- **After a decision, go where the next thing happens.** Accepting or discarding a result returns you to the conversation with the composer focused.
- **Never make people retype what Autopia knows.** A crash goes to the team in one click, with its real error.
- **Asking before the irreversible.** Use `confirmAction`, never a native `confirm()`. Reversible actions don't ask.
- **Errors say what to do.** `friendlyError` translates what it recognizes and keeps the original as a tooltip. Error toasts stay above dialogs and have a close button.
- **Shortcuts:** `?` lists them all. A new shortcut goes in that list and in the palette's hints.

## Motion and feel (refinement 5)

| Moving thing | Duration | Easing |
| --- | --- | --- |
| Hover, press, color | `--dur-fast` | none |
| Arriving (message, line, panel content) | `--dur-mid` | `--ease` |
| Moving within the screen | `--dur-slow` | `--ease-standard` |
| Leaving | `--dur-fast` | `--ease-in` |
| Looping indicators | `--dur-spin`, `--dur-pulse` | linear |

- **Motion never delays an action.** The click takes effect first, and the animation follows. Only the side panel has an exit (`useLinger`).
- **Only what is new animates.** History doesn't replay when you open a conversation.
- **Nothing jumps.** Reserve space, keep showing the old value until the new one arrives, use `Skeleton` where the shape is known, and let `Loading` wait 180ms so fast loads never flash. A skeleton says nothing about progress.
- **Reading isn't interrupted.** New messages only scroll you if you're at the bottom; otherwise "Latest" appears.
- **Desktop manners.** Controls use the arrow cursor; only links get a hand. What people read and copy is selectable, the interface around it isn't.
- **Reduced motion.** Everything finishes instantly, and spinners stay visible but still. State must still be readable without movement.
- **Cost.** Log lines land together every 50ms. List rows are memoized. Project switching loads everything, then changes once. The office renders at 60fps, 20 when the window isn't focused, and not at all behind another view.
