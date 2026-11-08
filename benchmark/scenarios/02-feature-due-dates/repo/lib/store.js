import { existsSync, readFileSync, writeFileSync } from 'node:fs'

// Tasks live in a JSON file: TODO_FILE, or todo.json in the current directory.
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

export function addTask(data, title) {
  const task = { id: data.nextId++, title, done: false }
  data.tasks.push(task)
  return task
}

export function completeTask(data, id) {
  const task = data.tasks.find((t) => t.id === id)
  if (!task) return null
  task.done = true
  return task
}
