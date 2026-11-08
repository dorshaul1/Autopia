// Customizing the office: opened only from the toolbar's Customize button. It takes the side column while
// it's open. Pick something from the catalog and place it, or click a piece in the office to change it or
// drag it somewhere new. Cosmetic only, saved per project, and never in the way of ordinary office use.

import { useEffect, useRef, useState } from 'react'
import { CATALOG, DOG_BEDS, DOG_TOYS, FLOOR_DECOR, LIGHTS, MAX_ITEMS, MAX_WALL, PICTURE_H, PICTURE_W, SIGN_MAX, changesIn, cleanSign, decorDef, encodePicture, layoutReset, signFor, wallDef, type CatalogTab, type DecorDef, type DogBedId, type DogToyId, type LightId, type OfficeConfig } from '@shared/officeDecor'
import { decorArt } from '../office/art/packs'
import { wallArt } from '../office/art/decor'
import { TOY_ART, dogBed } from '../office/art/corgi'
import { DOG } from '../office/layout'
import { officeActions } from '../office/OfficeView'
import { actions, store, useApp } from '../store'
import { Button, IconButton, Input } from './ui'
import { Icon } from './common'

const FABRICS: { id: OfficeConfig['accent']; label: string; color: string }[] = [
  { id: 'terracotta', label: 'Terracotta', color: '#c96a43' },
  { id: 'sage', label: 'Sage', color: '#7f9a7c' },
  { id: 'slate', label: 'Slate', color: '#5f6b80' },
  { id: 'mustard', label: 'Mustard', color: '#d9a440' }
]
const POSTERS: { id: OfficeConfig['art']; label: string }[] = [
  { id: 'grid', label: 'Bauhaus' },
  { id: 'ship', label: 'Launch' },
  { id: 'bloom', label: 'Bloom' },
  { id: 'wave', label: 'Wave' }
]

/** A piece's own drawing: whole-pixel scaling where it fits, so the art stays crisp. */
function Thumb({ draw, stamp, className = 'cz-thumb' }: { draw: () => HTMLCanvasElement; stamp: string; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current
    if (!c) return
    const art = draw()
    const box = 104
    const raw = box / Math.max(art.width, art.height)
    const fit = raw >= 1 ? Math.min(4, Math.floor(raw)) : raw
    c.width = box
    c.height = box
    const ctx = c.getContext('2d')!
    ctx.imageSmoothingEnabled = false
    const w = art.width * fit
    const h = art.height * fit
    ctx.drawImage(art, Math.round((box - w) / 2), Math.round((box - h) / 2), w, h)
    // draw changes with the office's colours, which stamp names
  }, [stamp]) // eslint-disable-line react-hooks/exhaustive-deps
  return <canvas ref={ref} className={className} aria-hidden />
}

function useWallOptions() {
  const office = useApp((s) => s.office)
  const name = useApp((s) => (s.activeProjectId ? s.projects[s.activeProjectId]?.name : '')) ?? ''
  return { light: LIGHTS[office.light].color, picture: office.picture, sign: office.sign || signFor(name) || 'AUTOPIA' }
}

/** The one Esc: stop placing, then let go of the selection, then leave. */
function useEscape(active: boolean) {
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const s = store.getState()
      if (s.palette || s.showShortcuts) return
      const field = (e.target as Element | null)?.closest?.('input, textarea')
      if (field) return void (field as HTMLElement).blur()
      if (s.placing) store.setState({ placing: null, arrangeNote: null })
      else if (s.arrange) store.setState({ arrange: null, arrangeNote: null })
      else actions.setCustomizing(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active])
}

export function CustomizePanel({ closing }: { closing: boolean }) {
  const office = useApp((s) => s.office)
  const target = useApp((s) => s.arrange)
  const [tab, setTab] = useState<CatalogTab>('decor')
  const [undo, setUndo] = useState<OfficeConfig | null>(null)
  const body = useRef<HTMLDivElement>(null)
  useEscape(!closing)
  // the bed or the poster in the office leads to their options here
  useEffect(() => {
    if (body.current) body.current.scrollTop = 0
  }, [tab])
  useEffect(() => {
    if (target?.kind === 'dog') setTab('furniture')
    if (target?.kind === 'poster') setTab('walls')
  }, [target])
  useEffect(() => {
    if (target?.kind !== 'dog' && target?.kind !== 'poster') return
    const t = setTimeout(() => body.current?.querySelector(`[data-reveal="${target.kind}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 30)
    return () => clearTimeout(t)
  }, [target, tab])
  const changes = changesIn(office)
  return (
    <aside className={`sheet cz${closing ? ' closing' : ''}`} aria-label="Customize office">
      <div className="cz-head">
        <div className="cz-title">Customize office</div>
        <Button variant="primary" size="sm" onClick={() => actions.setCustomizing(false)}>
          Done
        </Button>
      </div>
      {(target?.kind === 'piece' || target?.kind === 'hung') && <Selected />}
      <div className="cz-tabs" role="tablist" aria-label="Catalog">
        {CATALOG.map((c) => (
          <button key={c.id} className="cz-tab" role="tab" aria-selected={tab === c.id} onClick={() => setTab(c.id)}>
            {c.label}
          </button>
        ))}
      </div>
      <div className="cz-body" ref={body} role="tabpanel">
        <Catalog tab={tab} />
      </div>
      <div className="cz-foot">
        <span>{undo ? 'Back to how this office came.' : changes ? `${changes} change${changes > 1 ? 's' : ''} in this office` : 'Saved for this project'}</span>
        {undo ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              void actions.saveOffice(undo)
              setUndo(null)
            }}
          >
            Undo
          </Button>
        ) : (
          changes > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setUndo(office)
                store.setState({ arrange: null, placing: null })
                void actions.saveOffice(layoutReset(office))
              }}
            >
              Reset
            </Button>
          )
        )}
      </div>
    </aside>
  )
}

function Catalog({ tab }: { tab: CatalogTab }) {
  const office = useApp((s) => s.office)
  const placing = useApp((s) => s.placing)
  const wallOptions = useWallOptions()
  const stamp = `${office.accent}|${wallOptions.light}|${wallOptions.sign}|${office.picture.length}`
  const page = CATALOG.find((c) => c.id === tab)!
  const pick = (key: string) => store.setState({ placing: placing === key ? null : key, arrange: null, arrangeNote: null })
  return (
    <>
      {tab === 'furniture' && <Swatches label="Fabrics" hint="Sofas, chairs and rugs" items={FABRICS.map((f) => ({ id: f.id, label: f.label, color: f.color }))} value={office.accent} onPick={(id) => void actions.saveOffice({ accent: id as OfficeConfig['accent'] })} />}
      {tab === 'lighting' && <Swatches label="Light colour" hint="Lamps and wall lights, best after dark" items={(Object.keys(LIGHTS) as LightId[]).map((l) => ({ id: l, label: LIGHTS[l].label, color: LIGHTS[l].color }))} value={office.light} onPick={(id) => void actions.saveOffice({ light: id as LightId })} />}
      {page.sections.map((sec) => (
        <section className="cz-section" key={sec.label}>
          <div className="cz-label">{sec.label}</div>
          <div className={`cz-grid${sec.keys.length === 4 ? ' four' : ''}`}>
            {sec.keys.map((key) => {
              const floor = decorDef(key)
              const wall = wallDef(key)
              const full = floor ? office.items.length >= MAX_ITEMS : office.wall.length >= MAX_WALL
              const noRoom = !!wall && !officeActions.wallHasRoom(key)
              const label = floor?.label ?? wall?.label ?? key
              return (
                <button key={key} className="cz-card" aria-pressed={placing === key} disabled={full || noRoom} title={full ? 'This office is full. Take something away first.' : undefined} onClick={() => pick(key)}>
                  <Thumb stamp={`${key}|${stamp}`} draw={() => (floor ? decorArt(key) : wallArt(key, wallOptions))} />
                  {label}
                  {noRoom && <small className="cz-card-why">No room</small>}
                </button>
              )
            })}
          </div>
          {sec.keys.includes('wall:sign') && !officeActions.wallHasRoom('wall:sign') && <p className="cz-note">No room for a wall sign here. Decor has a standing one.</p>}
        </section>
      ))}
      {tab === 'walls' && (
        <section className="cz-section" data-reveal="poster">
          <div className="cz-label">Main poster</div>
          <div className="cz-grid four">
            {POSTERS.map((p) => (
              <button key={p.id} className="cz-card" aria-pressed={office.art === p.id} onClick={() => void actions.saveOffice({ art: p.id })}>
                <Thumb stamp={p.id} draw={() => wallArt(`wall:poster:${p.id}`, { light: '', picture: '', sign: '' })} />
                {p.label}
              </button>
            ))}
          </div>
        </section>
      )}
      {tab === 'furniture' && DOG && <DogCorner />}
    </>
  )
}

function Swatches({ label, hint, items, value, onPick }: { label: string; hint: string; items: { id: string; label: string; color: string }[]; value: string; onPick: (id: string) => void }) {
  return (
    <section className="cz-section">
      <div className="cz-label">
        {label}
        <em>{items.find((i) => i.id === value)?.label}</em>
      </div>
      <div className="cz-swatches">
        {items.map((i) => (
          <button key={i.id} className="cz-swatch" style={{ background: i.color }} aria-pressed={value === i.id} aria-label={`${label}: ${i.label}`} data-tip={i.label} onClick={() => onPick(i.id)} />
        ))}
      </div>
      <p className="cz-note">{hint}</p>
    </section>
  )
}

function DogCorner() {
  const office = useApp((s) => s.office)
  return (
    <section className="cz-section" data-reveal="dog">
      <div className="cz-label">Puffy’s bed</div>
      <div className="cz-grid four">
        {(Object.keys(DOG_BEDS) as DogBedId[]).map((b) => (
          <button key={b} className="cz-card" aria-pressed={office.dog.bedStyle === b} onClick={() => void actions.saveOffice({ dog: { ...office.dog, bedStyle: b } })}>
            <Thumb stamp={b} draw={() => dogBed(DOG_BEDS[b].rim)} />
            {DOG_BEDS[b].label}
          </button>
        ))}
      </div>
      <div className="cz-label" style={{ marginTop: 14 }}>
        Puffy’s favourite toy
      </div>
      <div className="cz-grid four">
        {(Object.keys(DOG_TOYS) as DogToyId[]).map((t) => (
          <button key={t} className="cz-card" aria-pressed={office.dog.toy === t} onClick={() => void actions.saveOffice({ dog: { ...office.dog, toy: t } })}>
            <Thumb stamp={t} draw={TOY_ART[t]} />
            {DOG_TOYS[t].label}
          </button>
        ))}
      </div>
      <p className="cz-note">Drag his bed in the office to give him a new place to rest.</p>
    </section>
  )
}

/** What you've selected in the office, and what you can do with it. */
function Selected() {
  const target = useApp((s) => s.arrange)
  const office = useApp((s) => s.office)
  const wallOptions = useWallOptions()
  const clear = () => store.setState({ arrange: null, arrangeNote: null })
  if (target?.kind === 'hung') {
    const item = office.wall.find((h) => h.id === target.id)
    if (!item) return null
    const def = wallDef(item.key)
    return (
      <div className="cz-selected">
        <SelectedHead onClose={clear} title={def?.label ?? 'On the wall'} hint="Drag it along the wall to move it." thumb={<Thumb className="cz-selected-art" stamp={`${item.key}|${wallOptions.light}|${wallOptions.sign}|${office.picture.length}`} draw={() => wallArt(item.key, wallOptions)} />} />
        {item.key === 'wall:sign' && <SignWords />}
        {item.key === 'wall:picture' && <PictureChoice />}
        {def?.lit && <p className="cz-note">Takes the office’s light colour.</p>}
        <div className="cz-actions">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              clear()
              void actions.saveOffice({ wall: office.wall.filter((h) => h.id !== target.id) })
            }}
          >
            Take down
          </Button>
        </div>
      </div>
    )
  }
  if (target?.kind !== 'piece') return null
  return <SelectedPiece uid={target.uid} pieceKey={target.key} onClose={clear} />
}

function SelectedHead({ title, hint, thumb, onClose }: { title: string; hint: string; thumb: React.ReactNode; onClose: () => void }) {
  return (
    <div className="cz-selected-head">
      {thumb}
      <div className="cz-selected-name">
        <b>{title}</b>
        <span>{hint}</span>
      </div>
      <IconButton icon="close" label="Clear selection" size="sm" onClick={onClose} />
    </div>
  )
}

function SelectedPiece({ uid, pieceKey, onClose }: { uid: string; pieceKey: string; onClose: () => void }) {
  const office = useApp((s) => s.office)
  const added = office.items.find((i) => i.id === uid)
  const key = added?.key ?? office.swaps[uid] ?? pieceKey
  const def = decorDef(key)
  const moved = !!office.moves[uid]
  const swap = (next: DecorDef) => {
    store.setState({ arrange: { kind: 'piece', uid, key: next.key } })
    if (added) {
      const to = officeActions.fitNear(next.key, added.tx, added.ty, uid) ?? added
      void actions.saveOffice({ items: office.items.map((i) => (i.id === uid ? { ...i, key: next.key, tx: to.tx, ty: to.ty } : i)) })
    } else void actions.saveOffice({ swaps: { ...office.swaps, [uid]: next.key } })
  }
  const remove = () => {
    onClose()
    if (added) void actions.saveOffice({ items: office.items.filter((i) => i.id !== uid) })
    else void actions.saveOffice({ removed: [...office.removed, uid] })
  }
  const home = () => {
    const moves = { ...office.moves }
    delete moves[uid]
    void actions.saveOffice({ moves })
  }
  const family = def ? FLOOR_DECOR.filter((d) => d.group === def.group && (added ? true : d.tw === 1 && d.th === 1)) : []
  return (
    <div className="cz-selected">
      <SelectedHead onClose={onClose} title={def?.label ?? 'This piece'} hint="Drag it in the office to move it." thumb={<Thumb className="cz-selected-art" stamp={`${key}|${office.accent}|${office.sign}|${office.picture.length}`} draw={() => decorArt(key)} />} />
      {key === 'decor:sign' && <SignWords />}
      {key === 'decor:easel' && <PictureChoice />}
      {family.length > 1 && (
        <div className="cz-options">
          <div className="cz-label">Swap for</div>
          <div className="cz-strip">
            {family.map((d) => (
              <button key={d.key} className="cz-card" aria-pressed={d.key === key} disabled={d.key !== key && !!added && !officeActions.fitNear(d.key, added.tx, added.ty, uid)} data-tip={d.label} aria-label={d.label} onClick={() => d.key !== key && swap(d)}>
                <Thumb stamp={`${d.key}|${office.accent}|${office.picture.length}`} draw={() => decorArt(d.key)} />
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="cz-actions">
        {moved && (
          <Button variant="ghost" size="sm" onClick={home}>
            Back to its spot
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={remove}>
          Take away
        </Button>
      </div>
    </div>
  )
}

function SignWords() {
  const office = useApp((s) => s.office)
  const name = useApp((s) => (s.activeProjectId ? s.projects[s.activeProjectId]?.name : '')) ?? ''
  return (
    <div className="cz-field">
      <Input autoFocus value={office.sign} maxLength={SIGN_MAX} placeholder={signFor(name) || 'YOUR WORDS'} aria-label="What the sign says" onChange={(e) => void actions.saveOffice({ sign: cleanSign(e.target.value) })} />
      <p className="cz-note">Up to {SIGN_MAX} letters and numbers.</p>
    </div>
  )
}

/** Any picture you choose is shrunk and redrawn in the office's own colours: only those little colour numbers are kept. */
async function pictureFrom(file: File): Promise<string> {
  if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type) || file.size > 25 * 1024 * 1024) throw new Error('Choose a PNG, JPEG, WebP or GIF under 25 MB.')
  const bitmap = await createImageBitmap(file)
  const c = document.createElement('canvas')
  c.width = PICTURE_W
  c.height = PICTURE_H
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  // crop to the frame's shape, from the middle
  const k = Math.min(bitmap.width / PICTURE_W, bitmap.height / PICTURE_H)
  const sw = PICTURE_W * k
  const sh = PICTURE_H * k
  ctx.drawImage(bitmap, (bitmap.width - sw) / 2, (bitmap.height - sh) / 2, sw, sh, 0, 0, PICTURE_W, PICTURE_H)
  bitmap.close()
  return encodePicture(ctx.getImageData(0, 0, PICTURE_W, PICTURE_H).data)
}

function PictureChoice() {
  const office = useApp((s) => s.office)
  const [error, setError] = useState<string | null>(null)
  const file = useRef<HTMLInputElement>(null)
  return (
    <div className="cz-field">
      <input
        ref={file}
        type="file"
        hidden
        accept="image/png,image/jpeg,image/webp,image/gif"
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (!f) return
          setError(null)
          pictureFrom(f).then(
            (picture) => void actions.saveOffice({ picture }),
            (err: Error) => setError(err.message.startsWith('Choose') ? err.message : 'That picture couldn’t be read. Try another.')
          )
        }}
      />
      <Button size="sm" onClick={() => file.current?.click()}>
        {office.picture ? 'Choose another picture' : 'Choose a picture'}
      </Button>
      <p className="cz-note">{error ?? 'It’s repainted in the office’s pixel colours.'}</p>
    </div>
  )
}

/** Over the office, out of its way: what you're placing, and why a spot won't do. */
export function CustomizeStatus() {
  const editing = useApp((s) => s.editOffice)
  const placing = useApp((s) => s.placing)
  const note = useApp((s) => s.arrangeNote)
  // a refused drop says why, then gets out of the way; while placing, the note follows the pointer instead
  useEffect(() => {
    if (!note || placing) return
    const t = setTimeout(() => store.setState({ arrangeNote: null }), 3500)
    return () => clearTimeout(t)
  }, [note, placing])
  if (!editing) return null
  const piece = placing ? (decorDef(placing)?.label ?? wallDef(placing)?.label) : null
  const onWall = !!placing && !!wallDef(placing)
  return (
    <>
      <div className="cz-frame" />
      {(placing || note) && (
        <div className={`cz-status${note ? ' problem' : ''}`} role="status">
          {note ? (
            <span>{note}</span>
          ) : (
            <>
              <Icon name="paintbrush" size={13} />
              <span>
                Placing {piece}
                <span className="cz-status-dim"> · click {onWall ? 'a marked spot on the wall' : 'a spot on the floor'}</span>
              </span>
            </>
          )}
          {placing && <kbd>Esc</kbd>}
        </div>
      )}
    </>
  )
}
