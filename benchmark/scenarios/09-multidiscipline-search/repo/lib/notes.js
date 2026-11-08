export function createNotes(seed = []) {
  const notes = seed.map((n, i) => ({ id: i + 1, ...n }))
  return {
    all: () => notes.slice(),
    add(title, body = '') {
      if (!title || typeof title !== 'string') throw new TypeError('title is required')
      const note = { id: notes.length + 1, title, body }
      notes.push(note)
      return note
    }
  }
}
