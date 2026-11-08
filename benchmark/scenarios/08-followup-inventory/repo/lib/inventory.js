export function createInventory() {
  return new Map()
}

export function addStock(inventory, sku, qty) {
  if (!Number.isInteger(qty) || qty <= 0) throw new RangeError('qty must be a positive integer')
  inventory.set(sku, (inventory.get(sku) ?? 0) + qty)
  return inventory.get(sku)
}

export function stockOf(inventory, sku) {
  return inventory.get(sku) ?? 0
}
