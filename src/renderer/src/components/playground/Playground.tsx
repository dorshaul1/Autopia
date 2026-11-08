import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { DOG_H, DOG_ROW, DOG_W, corgiSheet } from '../../office/art/corgi'
import { FH, FW, GOAL_H, RODS, newFoos, stepFoos, type FoosState } from '../../office/games/foosball'
import { HH, HW, LANES, laneX, newHotfix, stepHotfix, type HotfixState } from '../../office/games/hotfix'
import { H, PADDLE_H, W, newPong, replayPoint, stepPong, type PongState } from '../../office/games/pong'
import type { Game } from '../../office/games/playful'
import { officeActions } from '../../office/OfficeView'
import { activeProject, store, useApp } from '../../store'
import { Icon } from '../common'

const FRAME = 1000 / 60
const NAME: Record<Game, string> = { pong: 'Ping pong', foosball: 'Foosball', hotfix: 'HOTFIX' }
const HOW: Record<Game, string> = {
  pong: 'Move the mouse or press ↑ ↓. First to 5.',
  foosball: 'Move the mouse or press ↑ ↓. Click or Space to kick. First to 3.',
  hotfix: 'Move the mouse or press ← →. Hold click or Space to patch. Catch the coffee, don’t patch it.'
}
const KONAMI = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight']
const BEST = 'autopia:hotfix-best'

/** Each office's own table, so a match looks like it's being played on the one you clicked. */
const TABLE: Record<string, { pong: [string, string]; felt: [string, string]; line: string }> = {
  startup: { pong: ['#2f5fa8', '#28528f'], felt: ['#2f7d4f', '#2a7147'], line: '#f4f6f9' },
  studio: { pong: ['#2a1d52', '#241848'], felt: ['#1d2a52', '#192448'], line: '#5ff0ff' },
  lab: { pong: ['#1f5e63', '#1a5155'], felt: ['#25584a', '#204d40'], line: '#e8f7f4' }
}

type Spark = { x: number; y: number; vx: number; vy: number; life: number; c: string }

const DIGITS = ['111101101101111', '010110010010111', '111001111100111', '111001111001111', '101101111001001', '111100111001111', '111100111101111', '111001001001001', '111101111101111', '111101111001111']
function digit(ctx: CanvasRenderingContext2D, n: number, x: number, y: number, c: string, s = 3): void {
  ctx.fillStyle = c
  const on = DIGITS[n] ?? DIGITS[0]
  for (let i = 0; i < 15; i++) if (on[i] === '1') ctx.fillRect(x + (i % 3) * s, y + Math.floor(i / 3) * s, s, s)
}
function number(ctx: CanvasRenderingContext2D, n: number, right: number, y: number, c: string, s = 2): void {
  const text = String(n)
  ;[...text].forEach((d, i) => digit(ctx, +d, right - (text.length - i) * 4 * s, y, c, s))
}

/**
 * The mini-games, on a small panel over the office. The office keeps running behind it, and the team's real work isn't
 * touched: this reads nothing from a project, writes nothing to one, and the only AI involved is the one in the paddle.
 */
export function Playground() {
  const playing = useApp((s) => s.playing)
  const project = useApp(activeProject)
  if (!playing || !project) return null
  return <Match key={`${project.id}:${playing.game}`} game={playing.game} night={!!playing.night} office={project.officeType ?? 'startup'} />
}

function Match({ game, office, night }: { game: Game; office: string; night: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(3)
  const [round, setRound] = useState(0)
  const [over, setOver] = useState<{ won: boolean; line: string; said: string | null } | null>(null)
  const [paused, setPaused] = useState(false)
  const [waiting, setWaiting] = useState(game === 'hotfix')
  const [toast, setToast] = useState<string | null>(null)
  const [decaf, setDecaf] = useState(false)
  const [opponent, setOpponent] = useState<string | null>(null)
  const employees = useApp((s) => s.employees)
  const called = useApp((s) => (opponent ? !!s.statuses[opponent]?.runId && s.statuses[opponent]?.activity !== 'idle' : false))
  const who = opponent && !called ? employees.find((e) => e.id === opponent) : null
  const theirName = game === 'hotfix' ? null : who ? who.name.split(' ')[0] : 'Autopilot'
  const live = useRef({ to: 0, lane: LANES / 2, kick: false, fire: false, keyUp: false, keyDown: false, keyLeft: false, keyRight: false })
  const close = () => store.setState({ playing: null })
  const reduced = useRef(window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const secret = useRef({ typed: '', puffy: false, konami: 0 })

  // someone free comes over; if real work calls them away, the game carries on without pretending they're still playing
  useEffect(() => {
    setOpponent(officeActions.startMatch(game))
  }, [game])
  useEffect(() => {
    if (called) {
      setToast('They got called away to real work. Autopilot takes over.')
      const t = setTimeout(() => setToast(null), 3000)
      return () => clearTimeout(t)
    }
    return undefined
  }, [called])

  // the biggest whole-number scale that fits the stage: pixels stay even
  useLayoutEffect(() => {
    const stage = panel.current?.parentElement
    if (!stage) return
    const fit = () => setScale(Math.max(2, Math.min(4, Math.floor(Math.min((stage.clientWidth * 0.72) / W, (stage.clientHeight * 0.72 - 90) / H)))))
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(stage)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const canvasEl = canvas.current
    if (!canvasEl) return
    const ctx = canvasEl.getContext('2d')!
    ctx.imageSmoothingEnabled = false
    const seed = Math.floor(Math.random() * 1e9)
    const pong: PongState | null = game === 'pong' ? newPong(seed) : null
    const foos: FoosState | null = game === 'foosball' ? newFoos(seed) : null
    const fix: HotfixState | null = game === 'hotfix' ? newHotfix(seed, decaf) : null
    const palette = TABLE[office] ?? TABLE.startup
    const sparks: Spark[] = []
    const trail: { x: number; y: number }[] = []
    let shake = 0
    let flash = 0
    let squashYou = 0
    let squashThem = 0
    let frame = 0
    let raf = 0
    let last = performance.now()
    let acc = 0
    let ended = false
    let stolen = false
    let thief: { x: number; until: number } | null = null
    const dog = corgiSheet()

    const burst = (x: number, y: number, c: string, n = 6) => {
      if (reduced.current) return
      for (let i = 0; i < n; i++) sparks.push({ x, y, vx: (Math.random() - 0.5) * 90, vy: (Math.random() - 0.5) * 90, life: 240 + Math.random() * 180, c })
    }
    const finish = (won: boolean, line: string) => {
      if (ended) return
      ended = true
      setOver({ won, line, said: officeActions.endMatch(opponent, won) })
    }

    const stepAll = () => {
      const k = live.current
      if (pong) {
        const dt = 300 * (FRAME / 1000)
        if (k.keyUp) k.to = Math.max(0, pong.youY - dt * 1.4)
        if (k.keyDown) k.to = Math.min(H, pong.youY + dt * 1.4)
        const before = pong.vx
        for (const e of stepPong(pong, k.to, FRAME, 0.7)) {
          if (e === 'hit') {
            const left = before < 0
            burst(pong.bx, pong.by, '#f4f6f9', 5)
            if (left) squashYou = 5
            else squashThem = 5
            shake = Math.min(3, 1 + pong.rally / 8)
          } else if (e === 'wall') burst(pong.bx, pong.by, palette.line, 2)
          else if (e === 'point-you' || e === 'point-them') {
            flash = 10
            shake = 4
          } else if (e === 'win') finish(true, `You won ${pong.you}–${pong.them}.`)
          else if (e === 'lose') finish(false, `You lost ${pong.you}–${pong.them}.`)
        }
        // a long rally is more than a dog can take. Once a match, at most.
        if (!stolen && pong.rally >= 14 && !reduced.current) {
          stolen = true
          thief = { x: -30, until: 0 }
          setToast('Puffy has the ball. Point replayed.')
          setTimeout(() => setToast(null), 2600)
          replayPoint(pong)
          pong.serveIn = 2200
        }
        if (thief) {
          thief.x += 3
          if (thief.x > W + 30) thief = null
        }
      }
      if (foos) {
        if (k.keyUp) k.to = Math.max(-30, foos.youY - 4)
        if (k.keyDown) k.to = Math.min(30, foos.youY + 4)
        for (const e of stepFoos(foos, k.to, k.kick, FRAME, 0.6)) {
          if (e === 'man') {
            burst(foos.bx, foos.by, '#f7f3e7', 4)
            shake = Math.max(shake, 1)
          } else if (e === 'goal-you' || e === 'goal-them') {
            flash = 14
            shake = 5
          } else if (e === 'win') finish(true, `You won ${foos.you}–${foos.them}.`)
          else if (e === 'lose') finish(false, `You lost ${foos.you}–${foos.them}.`)
        }
        k.kick = false
      }
      if (fix) {
        if (k.keyLeft) k.lane = fix.lane - 1
        else if (k.keyRight) k.lane = fix.lane + 1
        for (const e of stepHotfix(fix, k.lane, k.fire, FRAME)) {
          if (e === 'squash') burst(laneX(fix.lane), 60, '#7cf29a', 7)
          else if (e === 'coffee') flash = 8
          else if (e === 'miss') {
            shake = 5
            flash = 10
          } else if (e === 'over') {
            let best = 0
            try {
              best = Number(localStorage.getItem(BEST) ?? 0)
              if (fix.score > best) localStorage.setItem(BEST, String(fix.score))
            } catch {
              // nowhere to keep it: it's just this game's score
            }
            finish(fix.score > best, fix.score > best && best > 0 ? `New best: ${fix.score}.` : `Score ${fix.score}.${best ? ` Best ${Math.max(best, fix.score)}.` : ''}`)
          }
        }
      }
    }

    const drawPong = (s: PongState) => {
      for (let y = 0; y < H; y++) {
        ctx.fillStyle = y % 2 ? palette.pong[0] : palette.pong[1]
        ctx.fillRect(0, y, W, 1)
      }
      ctx.fillStyle = palette.line
      ctx.fillRect(2, 2, W - 4, 1)
      ctx.fillRect(2, H - 3, W - 4, 1)
      ctx.fillRect(2, 2, 1, H - 4)
      ctx.fillRect(W - 3, 2, 1, H - 4)
      ctx.fillRect(3, H / 2, W - 6, 1)
      ctx.globalAlpha = 0.85
      for (let y = 3; y < H - 3; y += 4) ctx.fillRect(W / 2, y, 1, 2)
      ctx.globalAlpha = 1
      digit(ctx, Math.min(9, s.you), W / 2 - 20, 8, palette.line)
      digit(ctx, Math.min(9, s.them), W / 2 + 12, 8, palette.line)
      const paddle = (x: number, y: number, c: string, squash: number) => {
        const h = PADDLE_H - squash
        ctx.fillStyle = 'rgba(0,0,0,.3)'
        ctx.fillRect(x + 1, y - h / 2 + 2, 4, h)
        ctx.fillStyle = c
        ctx.fillRect(x, y - h / 2, 4, h)
        ctx.fillStyle = 'rgba(255,255,255,.4)'
        ctx.fillRect(x, y - h / 2, 1, h)
      }
      paddle(12, s.youY, '#e04f5f', squashYou)
      paddle(W - 16, s.themY, '#2b2f3a', squashThem)
      trail.push({ x: s.bx, y: s.by })
      if (trail.length > 6) trail.shift()
      if (!reduced.current) {
        trail.forEach((t, i) => {
          ctx.globalAlpha = (i / trail.length) * 0.3
          ctx.fillStyle = '#ffffff'
          ctx.fillRect(Math.round(t.x) - 1, Math.round(t.y) - 1, 2, 2)
        })
        ctx.globalAlpha = 1
      }
      if (!thief && s.serveIn <= 0) {
        ctx.fillStyle = 'rgba(0,0,0,.3)'
        ctx.fillRect(Math.round(s.bx) - 1, Math.round(s.by), 4, 4)
      }
      if (!thief) {
        ctx.fillStyle = secret.current.puffy ? '#c8e04f' : '#ffffff'
        ctx.fillRect(Math.round(s.bx) - 2, Math.round(s.by) - 2, 4, 4)
      }
      if (thief) {
        ctx.drawImage(dog, (Math.floor(frame / 5) % 4) * DOG_W, DOG_ROW.runR * DOG_H, DOG_W, DOG_H, Math.round(thief.x), H / 2 - 16, DOG_W, DOG_H)
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(Math.round(thief.x) + 23, H / 2 - 2, 3, 3)
      }
      if (secret.current.puffy && !thief) ctx.drawImage(dog, 0, DOG_ROW.walkR * DOG_H, DOG_W, DOG_H, W / 2 - 13, H - 24, DOG_W, DOG_H)
    }

    const drawFoos = (s: FoosState) => {
      for (let x = 0; x < FW; x += 20) {
        ctx.fillStyle = Math.floor(x / 20) % 2 ? palette.felt[0] : palette.felt[1]
        ctx.fillRect(x, 0, 20, FH)
      }
      ctx.fillStyle = palette.line
      ctx.fillRect(2, 2, FW - 4, 1)
      ctx.fillRect(2, FH - 3, FW - 4, 1)
      ctx.fillRect(FW / 2, 2, 1, FH - 4)
      for (let a = 0; a < 40; a++) ctx.fillRect(Math.round(FW / 2 + Math.cos((a / 40) * 6.283) * 16), Math.round(FH / 2 + Math.sin((a / 40) * 6.283) * 16), 1, 1)
      ctx.fillStyle = '#12110e'
      ctx.fillRect(0, FH / 2 - GOAL_H / 2, 3, GOAL_H)
      ctx.fillRect(FW - 3, FH / 2 - GOAL_H / 2, 3, GOAL_H)
      digit(ctx, s.you, FW / 2 - 18, 8, palette.line)
      digit(ctx, s.them, FW / 2 + 10, 8, palette.line)
      ctx.fillStyle = 'rgba(0,0,0,.3)'
      ctx.fillRect(Math.round(s.bx) - 2, Math.round(s.by), 5, 4)
      ctx.fillStyle = '#f7f3e7'
      ctx.fillRect(Math.round(s.bx) - 3, Math.round(s.by) - 3, 6, 6)
      ctx.fillStyle = '#2b2f3a'
      ctx.fillRect(Math.round(s.bx) - 1, Math.round(s.by) - 1, 2, 2)
      for (const rod of RODS) {
        const y0 = FH / 2 + (rod.yours ? s.youY : s.themY)
        const kicking = (rod.yours ? s.youKick : s.themKick) > 0
        ctx.fillStyle = '#c9ced6'
        ctx.fillRect(rod.x, 0, 1, FH)
        ctx.fillStyle = 'rgba(0,0,0,.25)'
        ctx.fillRect(rod.x + 1, 0, 1, FH)
        for (const m of rod.men) {
          const y = Math.round(y0 + m)
          const lean = kicking ? rod.dir * 4 : 0
          ctx.fillStyle = 'rgba(0,0,0,.3)'
          ctx.fillRect(rod.x - 3 + lean, y - 3, 8, 8)
          ctx.fillStyle = rod.yours ? '#e04f5f' : '#3f6fd8'
          ctx.fillRect(rod.x - 3 + lean, y - 4, 7, 8)
          ctx.fillStyle = '#f2c9a0'
          ctx.fillRect(rod.x - 1, y - 2, 3, 3)
        }
      }
    }

    const drawFix = (s: HotfixState) => {
      ctx.fillStyle = s.calm > 0 ? '#1a1612' : night ? '#160a18' : '#0c1016'
      ctx.fillRect(0, 0, HW, HH)
      ctx.fillStyle = night ? '#32153a' : '#1b2430'
      for (let l = 1; l < LANES; l++) ctx.fillRect((HW / LANES) * l, 0, 1, HH)
      ctx.fillStyle = night ? '#ff5fa2' : '#3df08a'
      ctx.fillRect(0, HH - 12, HW, 1)
      ctx.globalAlpha = 0.5
      ctx.fillRect(0, HH - 11, HW, 11)
      ctx.globalAlpha = 1
      for (const b of s.bugs) {
        const x = Math.round(b.x)
        const y = Math.round(b.y)
        const wiggle = Math.floor(frame / 8) % 2
        if (b.kind === 'coffee') {
          ctx.fillStyle = '#f4f6f9'
          ctx.fillRect(x - 4, y - 4, 8, 8)
          ctx.fillRect(x + 4, y - 2, 2, 3)
          ctx.fillStyle = '#6b3f22'
          ctx.fillRect(x - 3, y - 3, 6, 2)
          continue
        }
        const c = b.kind === 'fast' ? '#ff6b6b' : b.kind === 'flaky' ? '#c78bff' : '#ffd166'
        ctx.fillStyle = c
        ctx.fillRect(x - 3, y - 3, 6, 6)
        ctx.fillRect(x - 5 - wiggle, y - 2, 2, 1)
        ctx.fillRect(x + 3 + wiggle, y - 2, 2, 1)
        ctx.fillRect(x - 5 + wiggle, y + 2, 2, 1)
        ctx.fillRect(x + 3 - wiggle, y + 2, 2, 1)
        ctx.fillStyle = '#0c1016'
        ctx.fillRect(x - 2, y - 2, 1, 1)
        ctx.fillRect(x + 1, y - 2, 1, 1)
      }
      ctx.fillStyle = night ? '#ffb0d0' : '#7cf29a'
      for (const p of s.patches) ctx.fillRect(Math.round(p.x) - 1, Math.round(p.y) - 3, 2, 6)
      const px = Math.round(laneX(s.lane))
      ctx.fillStyle = '#f4f6f9'
      ctx.fillRect(px - 7, HH - 9, 14, 4)
      ctx.fillRect(px - 2, HH - 13, 4, 4)
      ctx.fillStyle = night ? '#ff5fa2' : '#3df08a'
      ctx.fillRect(px - 5, HH - 8, 10, 2)
      number(ctx, s.score, HW - 4, 4, '#f4f6f9')
      for (let i = 0; i < s.lives; i++) {
        ctx.fillStyle = '#ff6b6b'
        ctx.fillRect(4 + i * 8, 4, 6, 6)
      }
      if (s.decaf) {
        ctx.fillStyle = '#6b3f22'
        ctx.fillRect(4, 13, 20, 2)
      }
      // the cabinet's glass
      ctx.fillStyle = 'rgba(0,0,0,.18)'
      for (let y = 0; y < HH; y += 2) ctx.fillRect(0, y, HW, 1)
    }

    const draw = () => {
      ctx.save()
      if (shake > 0 && !reduced.current) ctx.translate(Math.round((Math.random() - 0.5) * shake), Math.round((Math.random() - 0.5) * shake))
      if (pong) drawPong(pong)
      if (foos) drawFoos(foos)
      if (fix) drawFix(fix)
      for (const p of sparks) {
        ctx.fillStyle = p.c
        ctx.fillRect(Math.round(p.x), Math.round(p.y), 2, 2)
      }
      ctx.restore()
      if (flash > 0 && !reduced.current) {
        ctx.fillStyle = `rgba(255,255,255,${(flash / 14) * 0.35})`
        ctx.fillRect(0, 0, W, H)
      }
    }

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick)
      const hold = document.hidden || !document.hasFocus()
      if (hold !== pausedRef.current) {
        pausedRef.current = hold
        setPaused(hold)
      }
      const dt = Math.min(100, now - last)
      last = now
      if (!hold && !waitingRef.current && !ended) {
        acc += dt
        while (acc >= FRAME) {
          stepAll()
          acc -= FRAME
          frame++
          shake = Math.max(0, shake - 0.2)
          flash = Math.max(0, flash - 1)
          squashYou = Math.max(0, squashYou - 0.5)
          squashThem = Math.max(0, squashThem - 0.5)
          for (const p of sparks) {
            p.x += (p.vx * FRAME) / 1000
            p.y += (p.vy * FRAME) / 1000
            p.life -= FRAME
          }
          for (let i = sparks.length - 1; i >= 0; i--) if (sparks[i].life <= 0) sparks.splice(i, 1)
        }
      } else frame += 0
      draw()
    }
    raf = requestAnimationFrame(tick)
    if (import.meta.env.DEV) (window as unknown as { __match: unknown }).__match = { pong, foos, fix, live: live.current }
    return () => cancelAnimationFrame(raf)
  }, [round, game, office, decaf, opponent, night])

  const pausedRef = useRef(false)
  const waitingRef = useRef(waiting)
  waitingRef.current = waiting

  const again = () => {
    setOver(null)
    setWaiting(game === 'hotfix')
    setRound((r) => r + 1)
  }

  // while it's open, the keys are the game's. Typing to the team still works: the composer keeps its own.
  useEffect(() => {
    const k = live.current
    const onKey = (e: KeyboardEvent, down: boolean) => {
      const t = e.target instanceof Element ? e.target : null
      if (t?.closest('input, textarea, select, [contenteditable="true"]') || e.metaKey || e.ctrlKey || e.altKey) return
      e.stopImmediatePropagation()
      e.preventDefault()
      if (e.key === 'ArrowUp' || e.key === 'w') k.keyUp = down
      else if (e.key === 'ArrowDown' || e.key === 's') k.keyDown = down
      else if (e.key === 'ArrowLeft' || e.key === 'a') k.keyLeft = down
      else if (e.key === 'ArrowRight' || e.key === 'd') k.keyRight = down
      else if (e.key === ' ') {
        k.fire = down
        if (down) k.kick = true
      }
      if (!down || e.repeat) return
      if (e.key === 'Escape') return close()
      if (e.key === 'r' || e.key === 'R') return again()
      if (waitingRef.current && (e.key === ' ' || e.key === 'Enter')) return setWaiting(false)
      // the cabinet remembers an old code
      if (game === 'hotfix' && waitingRef.current) {
        secret.current.konami = e.key === KONAMI[secret.current.konami] ? secret.current.konami + 1 : e.key === KONAMI[0] ? 1 : 0
        if (secret.current.konami === KONAMI.length) {
          secret.current.konami = 0
          setDecaf((d) => !d)
          setToast('Decaf mode.')
          setTimeout(() => setToast(null), 2200)
        }
      }
      if (game === 'pong' && /^[a-z]$/i.test(e.key)) {
        secret.current.typed = (secret.current.typed + e.key.toLowerCase()).slice(-5)
        if (secret.current.typed === 'puffy') {
          secret.current.puffy = true
          setToast('Woof!')
          setTimeout(() => setToast(null), 1600)
        }
      }
    }
    const down = (e: KeyboardEvent) => onKey(e, true)
    const up = (e: KeyboardEvent) => onKey(e, false)
    window.addEventListener('keydown', down, true)
    window.addEventListener('keyup', up, true)
    return () => {
      window.removeEventListener('keydown', down, true)
      window.removeEventListener('keyup', up, true)
    }
  }, [game])

  const aim = (e: React.PointerEvent) => {
    const r = e.currentTarget.getBoundingClientRect()
    const x = ((e.clientX - r.left) / r.width) * W
    const y = ((e.clientY - r.top) / r.height) * H
    const k = live.current
    if (game === 'pong') k.to = y
    else if (game === 'foosball') k.to = ((y - H / 2) / (H / 2 - 8)) * 30
    else k.lane = Math.floor((x / W) * LANES)
  }

  return (
    <div className="pg" ref={panel} role="dialog" aria-label={NAME[game]}>
      <div className={`pg-card pg-${game}`} style={{ width: W * scale + 24 }}>
        <header className="pg-head">
          <span className="pg-title">{night ? 'HOTFIX: NIGHT SHIFT' : NAME[game]}</span>
          {theirName && <span className="pg-vs">You vs {theirName}</span>}
          <span className="grow" />
          <button className="icon-btn" onClick={again} aria-label="Start again" data-tip="Start again (R)">
            <Icon name="retry" size={13} />
          </button>
          <button className="icon-btn" onClick={close} aria-label="Back to the office" data-tip="Back to the office (Esc)">
            <Icon name="close" size={13} />
          </button>
        </header>
        <div className="pg-screen" style={{ width: W * scale, height: H * scale }}>
          <canvas
            ref={canvas}
            width={W}
            height={H}
            style={{ width: W * scale, height: H * scale }}
            onPointerMove={aim}
            onPointerDown={(e) => {
              aim(e)
              if (waiting) return setWaiting(false)
              live.current.kick = true
              live.current.fire = true
            }}
            onPointerUp={() => (live.current.fire = false)}
            onPointerLeave={() => (live.current.fire = false)}
          />
          {waiting && !over && (
            <div className="pg-over">
              <strong>{night ? 'NIGHT SHIFT' : NAME[game]}</strong>
              <span>{night ? 'It’s 3am. The bugs don’t sleep either.' : 'Bugs are heading for production.'}</span>
              <button className="btn btn-primary btn-sm" onClick={() => setWaiting(false)}>
                Press Space
              </button>
            </div>
          )}
          {paused && !over && !waiting && <div className="pg-over pg-paused">Paused</div>}
          {toast && <div className="pg-toast">{toast}</div>}
          {over && (
            <div className="pg-over">
              <strong>{game === 'hotfix' ? 'Production is down.' : over.won ? 'You win!' : `${theirName ?? 'They'} wins.`}</strong>
              <span>{over.line}</span>
              {over.said && <span className="pg-said">{over.said}</span>}
              <div className="row gap">
                <button className="btn btn-primary btn-sm" onClick={again}>
                  Play again
                </button>
                <button className="btn btn-ghost btn-sm" onClick={close}>
                  Back to the office
                </button>
              </div>
            </div>
          )}
        </div>
        <footer className="pg-how">{HOW[game]}</footer>
      </div>
    </div>
  )
}
