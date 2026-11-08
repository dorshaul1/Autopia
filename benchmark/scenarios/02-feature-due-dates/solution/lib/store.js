import { existsSync, readFileSync, writeFileSync } from 'node:fs'

export function storePath() {
  return process.env.TODO_FILE || 'todo.json'
}

export function load() {
  const p = storePath()
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : { nextId: 1, tasks: [] }
}

export function save(data) {
  writeFileSync(storePath(), JSON.stringify(data, null, 2))
}

export function addTask(data, title, due = null) {
  const task = { id: data.nextId++, title, done: false, ...(due ? { due } : {}) }
  data.tasks.push(task)
  return task
}

export function completeTask(data, id) {
  const task = data.tasks.find((t) => t.id === id)
  if (!task) return null
  task.done = true
  return task
}

export function isValidDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const d = new Date(`${s}T00:00:00Z`)
  return !isNaN(d) && d.toISOString().slice(0, 10) === s
}

export function today() {
  return process.env.TODO_TODAY || new Date().toISOString().slice(0, 10)
}

export const isOverdue = (task, now = today()) => !task.done && !!task.due && task.due < now
