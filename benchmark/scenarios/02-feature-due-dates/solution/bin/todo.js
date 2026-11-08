#!/usr/bin/env node
import { addTask, completeTask, isOverdue, isValidDate, load, save } from '../lib/store.js'
import { formatList, formatTask } from '../lib/format.js'

const [cmd, ...args] = process.argv.slice(2)
const data = load()

switch (cmd) {
  case 'add': {
    const at = args.indexOf('--due')
    const due = at >= 0 ? args[at + 1] : null
    const title = (at >= 0 ? [...args.slice(0, at), ...args.slice(at + 2)] : args).join(' ').trim()
    if (!title) {
      console.error('Usage: todo add <title> [--due YYYY-MM-DD]')
      process.exit(1)
    }
    if (at >= 0 && !isValidDate(due ?? '')) {
      console.error(`Invalid due date: ${due ?? '(missing)'}. Use YYYY-MM-DD.`)
      process.exit(1)
    }
    const task = addTask(data, title, due)
    save(data)
    console.log(`Added ${formatTask(task)}`)
    break
  }
  case 'list':
    console.log(formatList(args.includes('--overdue') ? data.tasks.filter((t) => isOverdue(t)) : data.tasks))
    break
  case 'done': {
    const task = completeTask(data, Number(args[0]))
    if (!task) {
      console.error(`No task ${args[0]}`)
      process.exit(1)
    }
    save(data)
    console.log(`Done ${formatTask(task)}`)
    break
  }
  default:
    console.error('Usage: todo <add|list|done> ...')
    process.exit(1)
}
