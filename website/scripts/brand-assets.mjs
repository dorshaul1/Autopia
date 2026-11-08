// Favicons and the sharing image, made from the real app icon and a real render of the office. Run when those change.
import sharp from 'sharp'
const pub = new URL('../public/', import.meta.url).pathname
const icon = new URL('../../build/icon.png', import.meta.url).pathname
const night = new URL('../src/assets/app/office-startup-night.png', import.meta.url).pathname
await sharp(icon).resize(180, 180).png().toFile(`${pub}apple-touch-icon.png`)
await sharp(icon).resize(64, 64).png().toFile(`${pub}favicon.png`)
const m = await sharp(night).metadata()
// the reception wall, with its sign, is the brand: frame it
const crop = { left: Math.round(m.width * 0.1), top: Math.round(m.height * 0.3), width: Math.round(m.width * 0.8), height: Math.round((m.width * 0.8 * 630) / 1200) }
await sharp(night).extract(crop).resize(1200, 630, { kernel: 'nearest' }).jpeg({ quality: 86 }).toFile(`${pub}og.jpg`)
console.log('brand assets written')
