export function formatTask(task) {
  return `${task.done ? '[x]' : '[ ]'} ${task.id}. ${task.title}`
}

export function formatList(tasks) {
  return tasks.length ? tasks.map(formatTask).join('\n') : 'Nothing to do.'
}
