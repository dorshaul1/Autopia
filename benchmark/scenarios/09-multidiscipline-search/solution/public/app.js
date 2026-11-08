const list = document.getElementById('notes')
const search = document.getElementById('search')

async function load(q = '') {
  const notes = await (await fetch(`/api/notes?q=${encodeURIComponent(q)}`)).json()
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

search.addEventListener('input', () => load(search.value))
load()
