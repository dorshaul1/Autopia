import { useEffect, useMemo, useRef, useState } from 'react'
import { projectNameFrom } from '@shared/composer'
import { readinessOf } from '@shared/readiness'
import { friendlyError } from '@shared/friendlyError'
import { OFFICE_ORDER, OFFICE_TYPES, recommendOffice, type OfficeType } from '@shared/offices'
import { actions, store, useApp } from '../../store'
import { Icon } from '../common'
import { draftKey, prefillDraft } from '../composer/Composer'
import { Switch } from '../ui'
import { OFFICE_PREVIEW } from './officeArt'

const IDEAS = ['A landing page for my bakery, with pre-orders', 'A small top-down game where you escape from zombies', 'An assistant that summarises my support tickets']

/** What you'd written survives a restart: an interrupted start picks up where it was. Kept only until you press Start. */
const DRAFT = 'autopia:creator-draft'
function readDraft(): { text: string; chosen: OfficeType | null } {
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT) ?? '{}') as { text?: unknown; chosen?: unknown }
    return { text: typeof d.text === 'string' ? d.text : '', chosen: OFFICE_ORDER.includes(d.chosen as OfficeType) ? (d.chosen as OfficeType) : null }
  } catch {
    return { text: '', chosen: null }
  }
}
function writeDraft(text: string, chosen: OfficeType | null): void {
  try {
    if (text.trim() || chosen) localStorage.setItem(DRAFT, JSON.stringify({ text, chosen }))
    else localStorage.removeItem(DRAFT)
  } catch {
    // storage unavailable: it only lasts for this session
  }
}

/**
 * Starting something: say what you want, in your own words. Everything else has a sensible answer already, shown plainly
 * and changeable, and nothing happens until you press Start. The team's own planning takes it from there.
 */
export function Creator({ first }: { first: boolean }) {
  const picked = useApp((s) => s.openFolder)
  const focusTick = useApp((s) => s.composerFocus)
  const carried = useApp((s) => s.creatorText)
  const [text, setText] = useState(() => readDraft().text)
  useEffect(() => {
    if (carried) (setText(carried), store.setState({ creatorText: null }))
  }, [carried])
  const [chosen, setChosen] = useState<OfficeType | null>(() => readDraft().chosen)
  useEffect(() => writeDraft(text, chosen), [text, chosen])
  const [name, setName] = useState('')
  const [root, setRoot] = useState<string | null>(null)
  const [home, setHome] = useState('')
  const [initGit, setInitGit] = useState(true)
  const [details, setDetails] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const box = useRef<HTMLTextAreaElement>(null)
  const open = !!picked
  useEffect(() => void window.autopia.defaultProjectsDir().then(setHome), [])
  useEffect(() => box.current?.focus(), [focusTick, picked])
  useEffect(() => {
    const el = box.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`
  }, [text])

  const idea = text.trim()
  const folderName = picked?.split('/').pop() ?? ''
  const finalName = name.trim() || (open ? folderName : idea ? projectNameFrom(idea) : '')
  const rec = useMemo(() => recommendOffice(`${finalName} ${idea}`), [finalName, idea])
  const office = chosen ?? rec.type
  const slug = finalName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  const where = (open ? picked! : `${root ?? home}/${slug || '…'}`).replace(/^\/Users\/[^/]+/, '~')
  const showPlan = open || !!idea
  // a request can't go anywhere without Claude Code: your words wait here until it's there
  const claude = useApp((s) => s.claude)
  const readiness = readinessOf(claude)
  const needsClaude = !!idea && !readiness.canStart
  const [git, setGit] = useState<{ available: boolean } | null>(null)
  useEffect(() => void window.autopia.gitCheck().then(setGit, () => undefined), [])
  // new projects always use Git, and a folder can do without it
  const needsGit = git?.available === false && (!open || initGit)
  const blocked = needsClaude || needsGit

  const reset = () => {
    setText('')
    setChosen(null)
    setName('')
    setRoot(null)
    setDetails(false)
    writeDraft('', null)
    store.setState({ openFolder: null })
  }
  const start = async () => {
    if (busy || !finalName || blocked) return
    setBusy(true)
    setError(null)
    const asked = Date.now()
    try {
      const project = await window.autopia.createProject({ name: finalName, goal: idea, mode: open ? 'open' : 'new', directory: open ? picked! : (root ?? home), initGit, officeType: office })
      const isNew = project.createdAt >= asked - 5000
      store.setState((s) => ({ projects: { ...s.projects, [project.id]: project } }))
      await actions.openProject(project.id)
      store.setState({ view: 'workspace', section: 'overview', panelOpen: true, sheet: [{ kind: 'conversation' }] })
      reset()
      // that folder already was a product: it opens as it is
      if (!isNew) store.setState({ error: `This folder is already the product “${project.name}”, so it opened as it was.` })
      // you said what to build: the team starts on it, through the same request path as anything else
      else if (idea) {
        try {
          await window.autopia.sendMessage({ projectId: project.id, intent: 'build', instruction: true, text: idea, attachments: [], employeeId: null, taskId: null, deliveryId: null })
        } catch {
          // the product exists, and your words wait in its message box, ready to send again
          prefillDraft(draftKey(project.id, { newProject: false, employeeId: null, taskId: null, deliveryId: null }), idea)
          store.setState({ error: 'Your request didn’t reach the team. It’s waiting in the message box, so you can send it again.' })
        }
      }
    } catch (err) {
      // what you wrote stays, so trying again costs nothing
      const raw = String((err as Error).message ?? err)
      setError(friendlyError(raw).message)
      // a folder Autopia can't write to: the way out is another folder, so that's what's in front of you
      if (/EACCES|EPERM|existing folder/.test(raw)) setDetails(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className={`create${showPlan ? ' expanded' : ''}`} aria-label="Start something new">
      <textarea
        ref={box}
        rows={1}
        value={text}
        aria-label={open ? 'What should the team do here?' : 'What do you want to build?'}
        placeholder={open ? `What should the team do in ${folderName}? Optional.` : first ? 'Describe it in your own words' : 'Start something new'}
        onChange={(e) => (setText(e.target.value), setError(null))}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            void start()
          }
        }}
      />
      {!showPlan && first && (
        <div className="create-ideas" aria-label="Ideas">
          {IDEAS.map((i) => (
            <button key={i} onClick={() => setText(i)}>
              {i}
            </button>
          ))}
        </div>
      )}
      {showPlan && (
        <div className="create-plan">
          <div className="create-offices" role="radiogroup" aria-label="Who builds it">
            {OFFICE_ORDER.map((t) => (
              <button key={t} role="radio" aria-checked={office === t} className={`create-office${office === t ? ' active' : ''}`} data-tip={OFFICE_TYPES[t].purpose} onClick={() => setChosen(t)}>
                <img src={OFFICE_PREVIEW[t]} alt="" draggable={false} />
                {OFFICE_TYPES[t].name}
              </button>
            ))}
          </div>
          <p className="create-says">
            {chosen === null && !open ? `${rec.reason} ` : ''}
            {idea ? 'Your team reads this first. Anything big gets a plan for your OK before they build; small things start right away.' : 'Your team gets to know the folder and waits for your first request.'} Everything runs through Claude Code on your plan.
          </p>
          <div className="create-where">
            <Icon name="folder" size={12} />
            <span data-tip={where}>
              <b>{finalName}</b> in {where}
            </span>
            <button className="link small" aria-expanded={details} onClick={() => setDetails(!details)}>
              Change
            </button>
          </div>
          {details && (
            <div className="create-details">
              <label className="label" htmlFor="create-name">
                Name
              </label>
              <input id="create-name" className="input" value={name} maxLength={80} placeholder={finalName} onChange={(e) => setName(e.target.value)} />
              {!open && (
                <button
                  className="btn btn-sm"
                  onClick={async () => {
                    const dir = await window.autopia.pickDirectory()
                    if (dir) setRoot(dir)
                  }}
                >
                  <Icon name="folder" size={12} /> Put it somewhere else
                </button>
              )}
              {open && (
                <Switch className="check small" checked={initGit} onChange={setInitGit}>
                  <span>Use Git so teammates can work in parallel without touching your files (adds a repository if there isn't one)</span>
                </Switch>
              )}
            </div>
          )}
          {open && <p className="faint small">The team works on its own branches and merges finished work into your current branch before you review it. If you have uncommitted changes, it stops and asks.</p>}
        </div>
      )}
      {showPlan && needsGit && (
        <div className="create-need" role="status">
          <Icon name="alert" size={13} />
          <span>
            Your team needs Git, and this Mac doesn’t have it yet. Run <code>xcode-select --install</code> in a terminal, then{' '}
            <button className="link small" onClick={() => void window.autopia.gitCheck().then(setGit)}>
              check again
            </button>
            . What you wrote stays here.
          </span>
        </div>
      )}
      {showPlan && !needsGit && needsClaude && (
        <div className="create-need" role="status">
          {readiness.state === 'checking' ? <span className="spinner spinner-sm" aria-hidden /> : <Icon name="alert" size={13} />}
          <span>{readiness.state === 'checking' ? 'One moment: looking for Claude Code.' : 'Set up Claude Code above to start.'} What you wrote stays here.</span>
        </div>
      )}
      {error && (
        <div className="create-error" role="alert">
          <Icon name="alert" size={13} /> <span>{error}</span>
          <button className="link small" onClick={() => void start()}>
            Try again
          </button>
        </div>
      )}
      <footer className="create-foot">
        {open ? (
          <button className="link small" onClick={reset}>
            Start something new instead
          </button>
        ) : (
          <button className="link small" onClick={() => void actions.openFolder()}>
            Or open a folder you already have
          </button>
        )}
        {showPlan && (
          <button className="btn btn-primary" disabled={busy || !finalName || blocked} onClick={() => void start()}>
            {busy ? (open ? 'Opening…' : 'Setting up…') : open && !idea ? `Open with the ${OFFICE_TYPES[office].name} team` : 'Start'}
          </button>
        )}
      </footer>
    </section>
  )
}
