import { validate } from './validate.js'

const form = document.getElementById('signup')
form.addEventListener('submit', (e) => {
  e.preventDefault()
  const values = Object.fromEntries(new FormData(form))
  const errors = validate(values)
  for (const name of ['displayName', 'email', 'password']) {
    const input = form.elements[name]
    input.setAttribute('aria-invalid', errors[name] ? 'true' : 'false')
    document.getElementById(`${name}-error`).textContent = errors[name] ?? ''
  }
  const first = Object.keys(errors)[0]
  if (first) return form.elements[first].focus()
  document.getElementById('status').textContent = `Welcome, ${values.displayName}!`
})
