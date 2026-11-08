// The first-run touches: what Autopia is, on an empty Home, and a word about the office the first time you see it. No wizard
// and no tour. Who gets them is decided once, at launch, and only someone who started with no products ever does.

import { useEffect, useRef, useState } from 'react'
import { readinessOf, type FirstRunStage } from '@shared/readiness'
import { DOG_H, DOG_ROW, DOG_W, corgiSheet } from '../../office/art/corgi'
import { actions, useApp } from '../../store'
import { finishFirstRun, firstRunStage, onFirstRunChange } from './firstRunStage'
import { OFFICE_PREVIEW } from './officeArt'

function useFirstRun(): FirstRunStage {
  const [, tick] = useState(0)
  useEffect(() => onFirstRunChange(() => tick((n) => n + 1)), [])
  return firstRunStage()
}

/** Puffy, drawn by the app's own art, crossing the bottom of the picture. */
function Puffy() {
  const url = useRef<string | null>(null)
  url.current ??= corgiSheet().toDataURL('image/png')
  const scale = 2
  return <i className="welcome-puffy" aria-hidden style={{ width: DOG_W * scale, height: DOG_H * scale, backgroundImage: `url(${url.current})`, backgroundSize: `${DOG_W * 4 * scale}px auto`, backgroundPositionY: -DOG_ROW.walkR * DOG_H * scale }} />
}

/** An empty Home says what this is, in a sentence, over the real office. The one action is the box below it. */
export function Welcome() {
  const needsSetup = useApp((s) => !readinessOf(s.claude).canStart)
  return (
    <header className={`welcome${needsSetup ? ' needs-setup' : ''}`}>
      <div className="welcome-window">
        <img src={OFFICE_PREVIEW.startup} alt="A pixel-art office seen from above, with desks, a boardroom, a kitchen and a reception." draggable={false} />
        <Puffy />
      </div>
      <h1>What do you want to build?</h1>
      <p>Autopia is a small software company that lives on your Mac. Tell your team what you want. They plan it, build it with Claude Code and bring you the result, and you can watch them do it in this office.</p>
    </header>
  )
}

/** One card, the first time you see the office, and only then. It stays out of the way of the office itself. */
export function OfficeHint() {
  const first = useFirstRun() === 'new'
  const project = useApp((s) => s.activeProjectId)
  const editing = useApp((s) => s.editOffice)
  const playing = useApp((s) => !!s.playing)
  if (!first || !project || editing || playing) return null
  return (
    <aside className="hud office-hint" aria-label="About the office">
      <b>This is your team.</b>
      <ul>
        <li>Each person has their own job. Click anyone to talk to them.</li>
        <li>Someone at a desk with a status over their head is really working on your product.</li>
        <li>Breaks, games and the dog are just for fun, and use none of your Claude plan.</li>
      </ul>
      <button className="btn btn-sm" onClick={finishFirstRun}>
        Got it
      </button>
    </aside>
  )
}

/** On your first product's Overview: the office is one click away, if you'd like to watch. */
export function SeeTheOffice() {
  const first = useFirstRun() === 'new'
  if (!first) return null
  return (
    <p className="first-office">
      Your team is in the office. <button className="link" onClick={() => actions.goStage('office')}>Go and see them</button>
    </p>
  )
}
