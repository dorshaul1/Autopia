import { validate } from './validate.js'

window.submitForm = () => {
  const form = document.getElementById('signup')
  const values = Object.fromEntries(new FormData(form))
  const errors = validate(values)
  const first = Object.values(errors)[0]
  if (first) return alert(first)
  alert('Welcome, ' + values.displayName + '!')
}
