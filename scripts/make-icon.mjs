// Draws the app icon from the same idea as the AUTOPIA wall in reception: a warm pixel letter glowing on walnut
// slats. Plain Node: no image tools needed, except iconutil (macOS) for the .icns.
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const A = ['01110', '10001', '10001', '11111', '10001', '10001', '10001']

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc = (b) => {
  let c = 0xffffffff
  for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type), data])
  const end = Buffer.alloc(4)
  end.writeUInt32BE(crc(body))
  return Buffer.concat([len, body, end])
}
function png(size, rgba) {
  const head = Buffer.alloc(13)
  head.writeUInt32BE(size, 0)
  head.writeUInt32BE(size, 4)
  head.set([8, 6, 0, 0, 0], 8)
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))])
}

const hex = (c) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)]
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t)

/** One icon, drawn on a 1024 grid so every size comes from the same shapes. */
function draw(size, { plate = 824 } = {}) {
  const out = Buffer.alloc(size * size * 4)
  const s = size / 1024
  const inset = (1024 - plate) / 2
  const radius = plate * 0.2237
  const cell = 92 // one letter pixel
  const lw = 5 * cell
  const lh = 7 * cell
  const lx = (1024 - lw) / 2
  const ly = (1024 - lh) / 2 - 8
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const x = (px + 0.5) / s
      const y = (py + 0.5) / s
      const dx = Math.max(inset + radius - x, x - (1024 - inset - radius), 0)
      const dy = Math.max(inset + radius - y, y - (1024 - inset - radius), 0)
      const edge = radius - Math.hypot(dx, dy)
      const alpha = Math.max(0, Math.min(1, edge * s + 0.5))
      if (!alpha) continue
      // walnut slats, lit from the letter
      const col = Math.floor((x - inset) / 56)
      const seam = (x - inset) % 56 < 6
      let c = mix(hex('#3a2519'), hex('#2a1a12'), col % 3 === 0 ? 0.9 : col % 3 === 1 ? 0.25 : 0.55)
      if (seam) c = hex('#160d09')
      const glow = Math.max(0, 1 - Math.hypot((x - 512) / 560, (y - 505) / 560))
      c = mix(c, hex('#d9863a'), glow * glow * 0.75)
      // a top edge of light, like the rest of the office's furniture
      if (y - inset < 18) c = mix(c, hex('#ffe2a0'), 0.18)
      // the letter's soft glow and its bright face
      const gx = Math.floor((x - lx) / cell)
      const gy = Math.floor((y - ly) / cell)
      const on = gy >= 0 && gy < 7 && gx >= 0 && gx < 5 && A[gy][gx] === '1'
      if (on) {
        const fx = (x - lx) / cell - gx
        const fy = (y - ly) / cell - gy
        c = hex('#ffd98f')
        if (fy < 0.14) c = hex('#fff4d9')
        if (fy > 0.86 || (fx > 0.88 && gx < 4 && A[gy][gx + 1] !== '1')) c = hex('#e9a443')
      }
      const i = (py * size + px) * 4
      out[i] = c[0]
      out[i + 1] = c[1]
      out[i + 2] = c[2]
      out[i + 3] = Math.round(alpha * 255)
    }
  }
  return png(size, out)
}

mkdirSync(join(root, 'build'), { recursive: true })
writeFileSync(join(root, 'build/icon.png'), draw(1024))
const set = join(root, 'build/icon.iconset')
rmSync(set, { recursive: true, force: true })
mkdirSync(set)
for (const size of [16, 32, 64, 128, 256, 512, 1024]) {
  if (size < 1024) writeFileSync(join(set, `icon_${size}x${size}.png`), draw(size))
  if (size > 16) writeFileSync(join(set, `icon_${size / 2}x${size / 2}@2x.png`), draw(size))
}
if (process.platform === 'darwin') execFileSync('iconutil', ['-c', 'icns', set, '-o', join(root, 'build/icon.icns')])
rmSync(set, { recursive: true, force: true })
console.log('icons written to build/')
