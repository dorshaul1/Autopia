import { cents, sumBy } from './orders.js'

const money = (fmt, v) => fmt.currency + v.toFixed(2)

export function header(s, fmt) {
  let out = 'SALES REPORT\n============\n'
  out += 'Paid orders: ' + s.paid.length + '\n'
  out += 'Revenue: ' + money(fmt, s.total) + '\n'
  if (s.paid.length > 0) out += 'Average order: ' + money(fmt, cents(s.total / s.paid.length)) + '\n'
  out += 'Refunded: ' + s.refunded + ' (' + money(fmt, s.refundedValue) + ')\n'
  return out + 'Pending: ' + s.pending + '\n'
}

export function regionSection(s, fmt) {
  const regions = {}
  for (const o of s.paid) {
    regions[o.region] ??= { count: 0, value: 0 }
    regions[o.region].count++
    regions[o.region].value += o.value
  }
  const names = Object.keys(regions).sort((a, b) => regions[b].value - regions[a].value || a.localeCompare(b))
  let out = '\nBy region\n'
  for (const r of names) {
    const v = cents(regions[r].value)
    const share = s.total > 0 ? Math.round((v / s.total) * 1000) / 10 : 0
    out += '  ' + r.padEnd(10) + String(regions[r].count).padStart(4) + '  ' + money(fmt, v).padStart(12) + '  ' + share.toFixed(1) + '%\n'
  }
  return out
}

export function customerSection(s, fmt) {
  const ranked = Object.entries(sumBy(s.paid, (o) => o.customer)).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  let out = '\nTop customers\n'
  ranked.slice(0, fmt.top).forEach(([name, v], k) => (out += '  ' + (k + 1) + '. ' + name + ' — ' + money(fmt, cents(v)) + '\n'))
  return ranked.length === 0 ? out + '  (none)\n' : out
}

export function monthSection(s, fmt) {
  const months = sumBy(s.paid, (o) => o.date.slice(0, 7))
  const keys = Object.keys(months).sort()
  const max = Math.max(0, ...keys.map((m) => months[m]))
  let out = '\nBy month\n'
  for (const m of keys) {
    const bar = max > 0 ? '#'.repeat(Math.max(1, Math.round((months[m] / max) * 20))) : ''
    out += '  ' + m + '  ' + money(fmt, cents(months[m])).padStart(12) + '  ' + bar + '\n'
  }
  return out
}

export function bestSellerLine(s) {
  const skus = {}
  for (const o of s.paid) for (const it of o.items) skus[it.sku] = (skus[it.sku] || 0) + it.qty
  const best = Object.entries(skus).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]
  return '\nBest seller: ' + (best ? best[0] + ' (' + best[1] + ' units)' : 'n/a') + '\n'
}
