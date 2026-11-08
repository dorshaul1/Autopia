const list = document.getElementById('notes')

async function load() {
  const notes = await (await fetch('/api/notes')).json()
  list.replaceChildren(
    ...notes.map((n) => {
      const li = document.createElement('li')
      li.innerHTML = `<strong></strong><br><span></span>`
      li.querySelector('strong').textContent = n.title
      li.querySelector('span').textContent = n.body
      return li
    })
  )
}

load()
