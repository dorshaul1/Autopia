// Returns { field: message } for every invalid field; empty object when valid.
export function validate({ displayName = '', email = '', password = '' }) {
  const errors = {}
  if (!displayName.trim()) errors.displayName = 'Please enter your name.'
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = 'Please enter a valid email address.'
  if (password.length < 8) errors.password = 'Password must be at least 8 characters.'
  return errors
}
