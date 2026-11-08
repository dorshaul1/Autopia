import { isOverdue } from './store.js'

export function formatTask(task) {
  const due = task.due ? ` (due ${task.due})` : ''
  return `${task.done ? '[x]' : '[ ]'} ${task.id}. ${task.title}${due}${isOverdue(task) ? ' OVERDUE' : ''}`
}

export function formatList(tasks) {
  return tasks.length ? tasks.map(formatTask).join('\n') : 'Nothing to do.'
}
