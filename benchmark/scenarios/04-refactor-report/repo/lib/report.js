// Builds the monthly sales report as plain text from a list of orders:
// { id, customer, region, date: 'YYYY-MM-DD', items: [{ sku, qty, price }], status: 'paid' | 'refunded' | 'pending' }
export function buildReport(orders, options = {}) {
  const currency = options.currency || '$'
  const top = options.top || 3
  let out = ''
  const paid = []
  let refunded = 0
  let refundedValue = 0
  let pending = 0
  for (let i = 0; i < orders.length; i++) {
    const o = orders[i]
    let value = 0
    for (let j = 0; j < o.items.length; j++) {
      value += o.items[j].qty * o.items[j].price
    }
    value = Math.round(value * 100) / 100
    if (o.status === 'paid') {
      paid.push({ ...o, value })
    } else if (o.status === 'refunded') {
      refunded++
      refundedValue += value
    } else {
      pending++
    }
  }
  refundedValue = Math.round(refundedValue * 100) / 100
  let total = 0
  for (const o of paid) total += o.value
  total = Math.round(total * 100) / 100
  out += 'SALES REPORT\n'
  out += '============\n'
  out += 'Paid orders: ' + paid.length + '\n'
  out += 'Revenue: ' + currency + total.toFixed(2) + '\n'
  if (paid.length > 0) {
    out += 'Average order: ' + currency + (Math.round((total / paid.length) * 100) / 100).toFixed(2) + '\n'
  }
  out += 'Refunded: ' + refunded + ' (' + currency + refundedValue.toFixed(2) + ')\n'
  out += 'Pending: ' + pending + '\n'
  const regions = {}
  for (const o of paid) {
    if (!regions[o.region]) regions[o.region] = { count: 0, value: 0 }
    regions[o.region].count++
    regions[o.region].value += o.value
  }
  const regionNames = Object.keys(regions).sort((a, b) => {
    const d = regions[b].value - regions[a].value
    return d !== 0 ? d : a.localeCompare(b)
  })
  out += '\nBy region\n'
  for (const r of regionNames) {
    const v = Math.round(regions[r].value * 100) / 100
    const share = total > 0 ? Math.round((v / total) * 1000) / 10 : 0
    out += '  ' + r.padEnd(10) + String(regions[r].count).padStart(4) + '  ' + (currency + v.toFixed(2)).padStart(12) + '  ' + share.toFixed(1) + '%\n'
  }
  const customers = {}
  for (const o of paid) {
    customers[o.customer] = (customers[o.customer] || 0) + o.value
  }
  const ranked = Object.entries(customers).sort((a, b) => (b[1] - a[1] !== 0 ? b[1] - a[1] : a[0].localeCompare(b[0])))
  out += '\nTop customers\n'
  for (let k = 0; k < Math.min(top, ranked.length); k++) {
    out += '  ' + (k + 1) + '. ' + ranked[k][0] + ' — ' + currency + (Math.round(ranked[k][1] * 100) / 100).toFixed(2) + '\n'
  }
  if (ranked.length === 0) out += '  (none)\n'
  const months = {}
  for (const o of paid) {
    const m = o.date.slice(0, 7)
    months[m] = (months[m] || 0) + o.value
  }
  const monthKeys = Object.keys(months).sort()
  out += '\nBy month\n'
  let max = 0
  for (const m of monthKeys) if (months[m] > max) max = months[m]
  for (const m of monthKeys) {
    const v = Math.round(months[m] * 100) / 100
    const bar = max > 0 ? '#'.repeat(Math.max(1, Math.round((months[m] / max) * 20))) : ''
    out += '  ' + m + '  ' + (currency + v.toFixed(2)).padStart(12) + '  ' + bar + '\n'
  }
  const skus = {}
  for (const o of paid) {
    for (const it of o.items) {
      skus[it.sku] = (skus[it.sku] || 0) + it.qty
    }
  }
  const bestSku = Object.entries(skus).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]
  out += '\nBest seller: ' + (bestSku ? bestSku[0] + ' (' + bestSku[1] + ' units)' : 'n/a') + '\n'
  return out
}
