// Draws drift's soft orb icon with plain Node (no image libraries). Output: resources/icon.png, icon.ico, tray.png
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'resources')

function crc32(buf) {
  let c
  const table = []
  for (let n = 0; n < 256; n++) {
    c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  let crc = 0xffffffff
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}
function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x + 0.5, y + 0.5, size)
      const i = y * (size * 4 + 1) + 1 + x * 4
      raw[i] = r
      raw[i + 1] = g
      raw[i + 2] = b
      raw[i + 3] = a
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t))

// A soft peach-to-lavender orb with a small highlight.
function orb(x, y, size) {
  const c = size / 2
  const r = size * 0.44
  const d = Math.hypot(x - c, y - c)
  const edge = Math.min(1, Math.max(0, r + 0.7 - d))
  if (edge <= 0) return [0, 0, 0, 0]
  const t = Math.min(1, Math.max(0, (x - c + (y - c)) / (2 * r) / 2 + 0.5))
  let col = mix([253, 186, 154], [165, 150, 240], t)
  const hd = Math.hypot(x - (c - r * 0.35), y - (c - r * 0.4)) / (r * 0.5)
  if (hd < 1) col = mix(col, [255, 255, 255], (1 - hd) * 0.65)
  return [...col, Math.round(edge * 255)]
}

fs.mkdirSync(out, { recursive: true })
fs.writeFileSync(path.join(out, 'icon.png'), png(256, orb))
fs.writeFileSync(path.join(out, 'tray.png'), png(32, orb))

// icon.ico: a single 256x256 PNG image inside an ICO container, so the packager needs no icon conversion.
const big = png(256, orb)
const head = Buffer.alloc(22)
head.writeUInt16LE(0, 0) // reserved
head.writeUInt16LE(1, 2) // type: icon
head.writeUInt16LE(1, 4) // one image
head[6] = 0 // width 256
head[7] = 0 // height 256
head.writeUInt16LE(1, 10) // planes
head.writeUInt16LE(32, 12) // bits per pixel
head.writeUInt32LE(big.length, 14)
head.writeUInt32LE(22, 18)
fs.writeFileSync(path.join(out, 'icon.ico'), Buffer.concat([head, big]))
console.log('wrote icons to', out)
