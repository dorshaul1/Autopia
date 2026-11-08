export const cents = (v) => Math.round(v * 100) / 100

export function orderValue(order) {
  let value = 0
  for (const it of order.items) value += it.qty * it.price
  return cents(value)
}

export function summarise(orders) {
  const paid = []
  let refunded = 0, refundedValue = 0, pending = 0
  for (const o of orders) {
    const value = orderValue(o)
    if (o.status === 'paid') paid.push({ ...o, value })
    else if (o.status === 'refunded') (refunded++, (refundedValue += value))
    else pending++
  }
  let total = 0
  for (const o of paid) total += o.value
  return { paid, refunded, refundedValue: cents(refundedValue), pending, total: cents(total) }
}

/** Sums `valueOf(order)` per `keyOf(order)` over paid orders, keeping insertion order. */
export function sumBy(paid, keyOf, valueOf = (o) => o.value) {
  const out = {}
  for (const o of paid) out[keyOf(o)] = (out[keyOf(o)] || 0) + valueOf(o)
  return out
}
