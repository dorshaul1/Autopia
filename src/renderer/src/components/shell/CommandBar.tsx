import { MORE_STAGES, PRIMARY_STAGES, STAGE_LABEL, STAGE_TIP, stageOf, type Stage } from '@shared/stages'
import { activeProject, actions, isSpace, store, useApp } from '../../store'
import { Icon } from '../common'
import { menuKeys, usePopover } from '../ui'

/**
 * Where you are: the product, and its four places. The rail has the products;
 * the status bar says what's happening.
 */
export function CommandBar() {
  const view = useApp((s) => s.view)
  const project = useApp(activeProject)
  const panelOpen = useApp((s) => s.panelOpen)
  const unread = useApp((s) => s.unread)
  const claude = useApp((s) => s.claude)
  const inSpace = isSpace(view) && !!project
  return (
    <header className="cbar">
      <div className="cbar-left">
        {inSpace ? (
          <>
            <span className="cbar-product">{project.name}</span>
            <Stages />
          </>
        ) : view === 'settings' ? (
          <>
            <button className="cbar-back no-drag" onClick={() => actions.leaveSettings()} data-tip="Back (Esc)">
              <Icon name="back" size={13} /> {project ? project.name : 'Home'}
            </button>
            <span className="cbar-product">Settings</span>
          </>
        ) : (
          <span className="cbar-product">Home</span>
        )}
      </div>
      <div className="cbar-right">
        {view !== 'home' && claude && !claude.available && claude.error !== null && (
          <button className="btn-bar tone-danger cbar-pill" onClick={() => actions.run(() => window.autopia.refreshClaude())} data-tip={claude.error ?? undefined}>
            Claude Code isn’t ready · Check again
          </button>
        )}
        <button className="cbar-find no-drag" onClick={() => actions.openCommand()} aria-label="Ask, tell or find anything" data-tip="Ask, tell or find anything (⌘K)">
          <Icon name="search" size={13} /> <span className="cbar-find-text">Ask or find…</span>
          <kbd>⌘K</kbd>
        </button>
        {inSpace && (
          <>
            <button className={`cbar-team${panelOpen ? ' active' : ''}`} onClick={() => store.setState({ panelOpen: !panelOpen })} aria-pressed={panelOpen} data-tip={`${panelOpen && !focus ? 'Hide' : 'Show'} the team conversation (⌘\\)`}>
              <Icon name="chat" size={13} /> Team
              {unread > 0 && <span className="unread-dot" aria-label={`${unread} new repl${unread === 1 ? 'y' : 'ies'}`} />}
            </button>
          </>
        )}
      </div>
    </header>
  )
}

function Stages() {
  const place = useApp((s) => stageOf(s))
  const working = useApp((s) => Object.values(s.statuses).filter((x) => x.runId && x.activity !== 'idle' && x.projectId === s.activeProjectId).length)
  const toReview = useApp((s) => s.deliveries.filter((d) => d.status === 'review').length)
  const pop = usePopover()
  const badge = (s: Stage) =>
    s === 'office' && working > 0 ? (
      <span className="cbar-count live" data-tip="Teammates running a Claude Code session right now">
        {working}
      </span>
    ) : s === 'review' && toReview > 0 ? (
      <span className="cbar-count accent" aria-label={`${toReview} to review`}>
        {toReview}
      </span>
    ) : null
  const inMore = !!place && MORE_STAGES.includes(place)
  return (
    <nav className="cbar-areas" aria-label="In this product">
      {PRIMARY_STAGES.map((s) => (
        <button key={s} className={`cbar-area${place === s ? ' active' : ''}`} aria-current={place === s ? 'page' : undefined} data-tip={STAGE_TIP[s]} onClick={() => actions.goStage(s)}>
          {STAGE_LABEL[s]}
          {badge(s)}
        </button>
      ))}
      <span className="attn-wrap" ref={pop.ref}>
        <button className={`cbar-area cbar-more${inMore ? ' active' : ''}`} {...pop.triggerProps} aria-label="More in this product">
          {inMore ? STAGE_LABEL[place!] : 'More'} <Icon name="chevron" size={10} />
        </button>
        {pop.open && (
          <div className="popover menu-list" role="menu" onKeyDown={menuKeys}>
            {MORE_STAGES.map((s) => (
              <button key={s} role="menuitem" className={place === s ? 'active' : ''} data-tip={STAGE_TIP[s]} onClick={() => (pop.setOpen(false), actions.goStage(s))}>
                {STAGE_LABEL[s]}
              </button>
            ))}
          </div>
        )}
      </span>
    </nav>
  )
}
