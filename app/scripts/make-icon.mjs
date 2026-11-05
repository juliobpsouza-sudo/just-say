// Gera o ícone do Just Say (resources/icon.png e resources/icon.ico) sem dependências:
// quadrado arredondado com gradiente violeta→verde-azulado e cinco barras de onda sonora.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'resources')

const FROM = [109, 93, 246] // violeta
const TO = [31, 184, 166] // verde-azulado
const BARS = [0.3, 0.52, 0.74, 0.52, 0.3]

function roundedRectSdf(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - hw + r
  const qy = Math.abs(py - cy) - hh + r
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0))
  return outside + Math.min(Math.max(qx, qy), 0) - r
}

function render(size) {
  const ss = 4
  const pixels = Buffer.alloc(size * size * 4)
  const barW = 0.085
  const gap = 0.06
  const total = BARS.length * barW + (BARS.length - 1) * gap
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let a = 0
      let r = 0
      let g = 0
      let b = 0
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const u = (x + (sx + 0.5) / ss) / size
          const v = (y + (sy + 0.5) / ss) / size
          if (roundedRectSdf(u, v, 0.5, 0.5, 0.47, 0.47, 0.22) > 0) continue
          const t = Math.min(1, Math.max(0, (u + v) / 2))
          let col = FROM.map((c, i) => c + (TO[i] - c) * t)
          let start = 0.5 - total / 2
          for (const h of BARS) {
            const cx = start + barW / 2
            if (roundedRectSdf(u, v, cx, 0.5, barW / 2, h / 2, barW / 2) <= 0) col = [255, 255, 255]
            start += barW + gap
          }
          r += col[0]
          g += col[1]
          b += col[2]
          a += 1
        }
      }
      const i = (y * size + x) * 4
      const n = ss * ss
      if (a > 0) {
        pixels[i] = Math.round(r / a)
        pixels[i + 1] = Math.round(g / a)
        pixels[i + 2] = Math.round(b / a)
      }
      pixels[i + 3] = Math.round((a / n) * 255)
    }
  }
  return pixels
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
function crc32(buf) {
  let c = 0xffffffff
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}
function png(size) {
  const rgba = render(size)
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}
function ico(sizes) {
  const images = sizes.map(png)
  const header = Buffer.alloc(6 + 16 * sizes.length)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(sizes.length, 4)
  let offset = header.length
  sizes.forEach((s, i) => {
    const e = 6 + i * 16
    header[e] = s >= 256 ? 0 : s
    header[e + 1] = s >= 256 ? 0 : s
    header.writeUInt16LE(1, e + 4)
    header.writeUInt16LE(32, e + 6)
    header.writeUInt32LE(images[i].length, e + 8)
    header.writeUInt32LE(offset, e + 12)
    offset += images[i].length
  })
  return Buffer.concat([header, ...images])
}

mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, 'icon.png'), png(256))
writeFileSync(join(outDir, 'icon.ico'), ico([16, 24, 32, 48, 64, 128, 256]))
console.log('ícones gerados em resources/')
