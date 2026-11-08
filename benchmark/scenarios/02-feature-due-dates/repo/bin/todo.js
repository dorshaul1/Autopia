#!/usr/bin/env node
import { addTask, completeTask, load, save } from '../lib/store.js'
import { formatList, formatTask } from '../lib/format.js'

const [cmd, ...args] = process.argv.slice(2)
const data = load()

switch (cmd) {
  case 'add': {
    const title = args.join(' ').trim()
    if (!title) {
      console.error('Usage: todo add <title>')
      process.exit(1)
    }
    const task = addTask(data, title)
    save(data)
    console.log(`Added ${formatTask(task)}`)
    break
  }
  case 'list':
    console.log(formatList(data.tasks))
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
