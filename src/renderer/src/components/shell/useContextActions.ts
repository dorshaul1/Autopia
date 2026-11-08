import { useMemo } from 'react'
import { contextActions, type ContextAction } from '@shared/contextActions'
import { stageOf } from '@shared/stages'
import { whatsNext } from '@shared/whatsNext'
import { activeProject, actions, sortedTasks, useApp } from '../../store'
import { confirmAction } from '../ui'

/** Where this product stands and what makes sense now; running one goes through the same machinery as anywhere else. */
export function useContextActions() {
  const project = useApp(activeProject)
  const approvals = useApp((s) => s.approvals)
  const deliveries = useApp((s) => s.deliveries)
  const tasks = useApp(sortedTasks)
  const employees = useApp((s) => s.employees)
  const stage = useApp((s) => stageOf(s))
  const previewRunning = useApp((s) => s.preview?.status === 'running')
  const top = useApp((s) => s.sheet[s.sheet.length - 1])
  const panelOpen = useApp((s) => s.panelOpen)
  const runs = useApp((s) => s.runs)
  const next = useMemo(
    () => (project ? whatsNext({ project, approvals: Object.values(approvals).filter((a) => a.projectId === project.id), deliveries, tasks: tasks.filter((t) => t.status !== 'proposed'), nameOf: (id) => employees.find((e) => e.id === id)?.name }) : null),
    [project, approvals, deliveries, tasks, employees]
  )
  const list = useMemo(() => {
    const panel = !panelOpen || !top ? null : top.kind === 'employee' ? { kind: 'employee', id: top.id, name: employees.find((e) => e.id === top.id)?.name.split(' ')[0] } : top.kind === 'task' ? { kind: 'task', id: top.id, runId: Object.values(runs).filter((r) => r.taskId === top.id).sort((a, b) => b.startedAt - a.startedAt)[0]?.id ?? null } : { kind: top.kind }
    return contextActions({ next, stage, previewRunning, panel })
  }, [next, stage, previewRunning, top, panelOpen, employees, runs])

  const run = async (a: ContextAction) => {
    if (!project) return
    switch (a.kind) {
      case 'stop':
        if (await confirmAction({ title: `Stop the team on ${project.name}?`, body: 'Running work stops now and nothing new starts. What they finished is kept.', action: 'Stop', danger: true })) await actions.run(() => window.autopia.stopProject(project.id))
        return
      case 'resume':
      case 'pause':
        return void actions.run(() => window.autopia.setProjectControls(project.id, { paused: a.kind === 'pause' }))
      case 'cancel_planning':
        return void actions.run(() => window.autopia.cancelPlanning(project.id))
      case 'retry':
        return void actions.run(() => window.autopia.retryTask(a.taskId!))
      case 'open_task':
        return actions.openSheet({ kind: 'task', id: a.taskId! })
      case 'review':
        return actions.openResult(a.deliveryId)
      case 'execution':
      case 'work':
        return actions.goStage('overview')
      case 'preview':
        return actions.goStage('preview')
      case 'message':
        return actions.talkTo(a.employeeId ?? null)
      case 'log':
        return actions.openSheet({ kind: 'log', runId: a.runId! })
      case 'decide':
        // decisions live in the conversation, which comes to wherever you are
        actions.openSheet({ kind: 'conversation' })
        requestAnimationFrame(() => document.querySelector('.thread-card .approval')?.scrollIntoView({ block: 'center', behavior: 'smooth' }))
    }
  }
  return { project, next, list, run }
}
