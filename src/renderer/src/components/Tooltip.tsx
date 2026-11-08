import { useEffect, useRef, useState } from 'react'

const GAP = 8
const MARGIN = 8
const DELAY_MS = 350
/** Just after a tip was showing, the next one appears at once. */
const SKIP_DELAY_MS = 400
let lastShown = 0

interface Tip {
  text: string
  anchor: DOMRect
  /** HUD controls sit at the bottom of the office, so their tips prefer to open upwards. */
  prefer: 'above' | 'below'
}

/**
 * One tooltip for every `[data-tip]` element. It is placed against the viewport: it opens on the
 * preferred side, flips when that side has no room, and slides sideways to stay fully on screen.
 */
export function TooltipLayer() {
  const [tip, setTip] = useState<Tip | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const tipOn = useRef(false)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  useEffect(() => {
    let timer: number | undefined
    let current: Element | null = null
    const show = (el: Element) => {
      if (el === current) return
      current = el
      window.clearTimeout(timer)
      setTip(null)
      timer = window.setTimeout(() => {
        const text = el.getAttribute('data-tip')
        if (!text || !el.isConnected) return
        tipOn.current = true
        setTip({ text, anchor: el.getBoundingClientRect(), prefer: el.closest('.hud') ? 'above' : 'below' })
      }, Date.now() - lastShown < SKIP_DELAY_MS ? 0 : DELAY_MS)
    }
    const hide = () => {
      if (tipOn.current) lastShown = Date.now()
      tipOn.current = false
      current = null
      window.clearTimeout(timer)
      setTip(null)
    }
    const onOver = (e: Event) => {
      const el = (e.target as Element | null)?.closest?.('[data-tip]')
      if (el) show(el)
      else if (current) hide()
    }
    const onFocus = (e: FocusEvent) => {
      const el = (e.target as Element | null)?.closest?.('[data-tip]')
      if (el && (e.target as HTMLElement).matches(':focus-visible')) show(el)
    }
    document.addEventListener('pointerover', onOver)
    document.addEventListener('focusin', onFocus)
    document.addEventListener('focusout', hide)
    document.addEventListener('pointerdown', hide, true)
    window.addEventListener('scroll', hide, true)
    window.addEventListener('blur', hide)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('pointerover', onOver)
      document.removeEventListener('focusin', onFocus)
      document.removeEventListener('focusout', hide)
      document.removeEventListener('pointerdown', hide, true)
      window.removeEventListener('scroll', hide, true)
      window.removeEventListener('blur', hide)
    }
  }, [])

  // measure, then place: preferred side if it fits, else the other side, then clamp into view
  useEffect(() => {
    if (!tip || !box.current) return setPos(null)
    const w = box.current.offsetWidth
    const h = box.current.offsetHeight
    setPos(placeTip(tip.anchor, w, h, window.innerWidth, window.innerHeight, tip.prefer))
  }, [tip])

  if (!tip) return null
  return (
    <div ref={box} className="tooltip" role="tooltip" style={pos ? { left: pos.left, top: pos.top } : { left: 0, top: 0, visibility: 'hidden' }}>
      {tip.text}
    </div>
  )
}

/** Where a floating box of size w×h goes next to an anchor, kept inside a vw×vh viewport. */
export function placeTip(
  a: { left: number; right: number; top: number; bottom: number; width: number },
  w: number,
  h: number,
  vw: number,
  vh: number,
  prefer: 'above' | 'below'
): { left: number; top: number } {
  const above = a.top - GAP - h
  const below = a.bottom + GAP
  const fitsAbove = above >= MARGIN
  const fitsBelow = below + h <= vh - MARGIN
  let top = prefer === 'above' ? (fitsAbove || !fitsBelow ? above : below) : fitsBelow || !fitsAbove ? below : above
  top = Math.min(Math.max(MARGIN, top), Math.max(MARGIN, vh - MARGIN - h))
  const left = Math.min(Math.max(MARGIN, a.left + a.width / 2 - w / 2), Math.max(MARGIN, vw - MARGIN - w))
  return { left: Math.round(left), top: Math.round(top) }
}
