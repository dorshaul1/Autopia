// Builds the monthly sales report as plain text from a list of orders.
// The sections live in lib/report/; this file keeps the public entry point.
import { summarise } from './report/orders.js'
import { header, regionSection, customerSection, monthSection, bestSellerLine } from './report/sections.js'

export function buildReport(orders, options = {}) {
  const fmt = { currency: options.currency || '$', top: options.top || 3 }
  const s = summarise(orders)
  return [header(s, fmt), regionSection(s, fmt), customerSection(s, fmt), monthSection(s, fmt), bestSellerLine(s)].join('')
}
