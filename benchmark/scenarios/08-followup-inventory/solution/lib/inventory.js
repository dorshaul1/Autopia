export class InsufficientStockError extends Error {
  constructor(sku, requested, available) {
    super(`Only ${available} of ${sku} in stock; cannot remove ${requested}`)
    this.name = 'InsufficientStockError'
    Object.assign(this, { sku, requested, available })
  }
}

export function createInventory() {
  return new Map()
}

export function addStock(inventory, sku, qty) {
  if (!Number.isInteger(qty) || qty <= 0) throw new RangeError('qty must be a positive integer')
  inventory.set(sku, (inventory.get(sku) ?? 0) + qty)
  return inventory.get(sku)
}

export function removeStock(inventory, sku, qty) {
  if (!Number.isInteger(qty) || qty <= 0) throw new RangeError('qty must be a positive integer')
  const available = stockOf(inventory, sku)
  if (qty > available) throw new InsufficientStockError(sku, qty, available)
  inventory.set(sku, available - qty)
  return available - qty
}

export function stockOf(inventory, sku) {
  return inventory.get(sku) ?? 0
}
