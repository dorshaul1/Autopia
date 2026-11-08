// A shopping cart: lines of { sku, name, price, qty }. Prices are dollars; totals are rounded to cents.

export function createCart() {
  return { lines: [] }
}

export function addItem(cart, product, qty = 1) {
  const existing = cart.lines.find((l) => l.sku === product.sku)
  if (existing) existing.qty += qty
  else cart.lines.push({ sku: product.sku, name: product.name, price: product.price, qty })
  return cart
}

export function lineTotal(line) {
  const quantity = line.quantity ?? 1
  return line.price * quantity
}

export function cartTotal(cart) {
  const sum = cart.lines.reduce((s, l) => s + lineTotal(l), 0)
  return Math.round(sum * 100) / 100
}
