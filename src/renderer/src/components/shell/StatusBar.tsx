import { DOING_LABEL, doingOf } from '@shared/workActivity'
import { QUIET_LINE } from '@shared/contextActions'
import { actions, isSpace, useApp } from '../../store'
import { Avatar, Icon } from '../common'
import { AttentionTray, AutoMode, UsageMeter } from './SystemTray'
import { useContextActions } from './useContextActions'

/**
 * The bottom of every page: what's happening, who's doing it and the next sensible step. All of it comes from real
 * execution state, nothing is estimated, and it never takes you away from what you're looking at.
 */
export function StatusBar() {
  const view = useApp((s) => s.view)
  const { project, next, list, run } = useContextActions()
  const statuses = useApp((s) => s.statuses)
  const employees = useApp((s) => s.employees)
  const hasWork = useApp((s) => Object.keys(s.tasks).length > 0)
  const inSpace = isSpace(view) && !!project
  const working = employees.flatMap((e) => {
    const st = statuses[e.id]
    return st && st.projectId === project?.id && st.runId && st.activity !== 'idle' ? [{ e, st }] : []
  })
  // a direct session has no task, but it's still someone at work: the line never says otherwise
  const live = !next && working[0] ? { text: working.length > 1 ? `${working[0].e.name.split(' ')[0]} and ${working.length - 1} more are working` : `${working[0].e.name.split(' ')[0]} is working`, detail: working[0].st.detail ?? undefined } : null
  return (
    <footer className={`sbar${inSpace && next ? ` tone-${next.tone}` : ''}`}>
      {inSpace && (
        <div className="sbar-state" role="status">
          {next?.live || live ? <span className="spinner spinner-sm" aria-hidden /> : <span className={`sbar-dot${next ? '' : ' quiet'}`} aria-hidden />}
          <b>{next?.text ?? live?.text ?? (hasWork ? QUIET_LINE.done : QUIET_LINE.fresh)}</b>
          {(next?.detail ?? live?.detail) && <span className="sbar-detail" data-tip={next?.detail ?? live?.detail}>{next?.detail ?? live?.detail}</span>}
        </div>
      )}
      {inSpace && working.length > 0 && (
        <div className="sbar-team" aria-label="Who is working">
          {working.slice(0, 5).map(({ e, st }) => (
            <button key={e.id} onClick={() => actions.select(e.id)} aria-label={`${e.name}: ${DOING_LABEL[doingOf(st) ?? 'coding']}`} data-tip={`${e.name.split(' ')[0]}: ${DOING_LABEL[doingOf(st) ?? 'coding']}${st.detail ? ` · ${st.detail}` : ''}`}>
              <Avatar employee={e} size={18} />
            </button>
          ))}
          {working.length > 5 && <span className="faint small">+{working.length - 5}</span>}
        </div>
      )}
      {inSpace && list.length > 0 && (
        <div className="sbar-actions">
          {list.map((a) => (
            <button key={a.kind} className={`btn btn-xs${a.primary ? ' btn-primary' : ' btn-ghost'}`} onClick={() => void run(a)}>
              {a.kind === 'stop' && <Icon name="stop" size={10} />}
              {a.label}
            </button>
          ))}
        </div>
      )}
      <div className="sbar-spacer" />
      <AutoMode />
      <UsageMeter />
      <AttentionTray />
    </footer>
  )
}
