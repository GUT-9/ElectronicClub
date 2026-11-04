import { inflateSync } from 'node:zlib'
import { ApiError } from '../members/model'
const bad = () => {
  throw new ApiError(
    400,
    'INVALID_IMAGE',
    '图片格式或文件内容不合法，请重新选择图片',
  )
}
export function inspectImage(uri: string, maxBytes = 32768) {
  const match =
    /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(uri)
  if (!match) return bad()
  const buffer = Buffer.from(match[2]!, 'base64')
  if (
    buffer.toString('base64') !== match[2] ||
    buffer.length > maxBytes ||
    buffer.length < 20
  )
    return bad()
  let width = 0,
    height = 0
  if (match[1] === 'png') {
    if (
      !buffer
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    )
      return bad()
    let offset = 8,
      header = false,
      pixels = false,
      ended = false,
      channels = 0
    const chunks: Buffer[] = []
    while (offset + 12 <= buffer.length) {
      const n = buffer.readUInt32BE(offset),
        kind = buffer.toString('ascii', offset + 4, offset + 8)
      if (
        n > buffer.length - offset - 12 ||
        crc32(buffer.subarray(offset + 4, offset + 8 + n)) !==
          buffer.readUInt32BE(offset + 8 + n)
      )
        return bad()
      if (kind === 'IHDR') {
        if (header || offset !== 8 || n !== 13) return bad()
        header = true
        width = buffer.readUInt32BE(offset + 8)
        height = buffer.readUInt32BE(offset + 12)
        channels =
          ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[
            buffer[offset + 17]!
          ] ?? 0
        if (
          buffer[offset + 16] !== 8 ||
          buffer[offset + 18] !== 0 ||
          buffer[offset + 19] !== 0 ||
          buffer[offset + 20] !== 0 ||
          !channels
        )
          return bad()
      }
      if (kind === 'IDAT' && n > 0) {
        pixels = true
        chunks.push(buffer.subarray(offset + 8, offset + 8 + n))
      }
      if (kind === 'IEND') {
        if (n !== 0 || offset + 12 !== buffer.length) return bad()
        ended = true
      }
      if (kind === 'acTL') return bad()
      offset += n + 12
    }
    if (
      !header ||
      !pixels ||
      !ended ||
      offset !== buffer.length ||
      width > 2000 ||
      height > 2000
    )
      return bad()
    try {
      const decoded = inflateSync(Buffer.concat(chunks), {
          maxOutputLength: 16_100_000,
        }),
        stride = width * channels + 1
      if (decoded.length !== stride * height) return bad()
      for (let row = 0; row < height; row++)
        if (decoded[row * stride]! > 4) return bad()
    } catch {
      return bad()
    }
  } else if (match[1] === 'jpeg') {
    if (
      buffer[0] !== 255 ||
      buffer[1] !== 216 ||
      buffer[buffer.length - 2] !== 255 ||
      buffer[buffer.length - 1] !== 217
    )
      return bad()
    let i = 2,
      scan = false
    while (i < buffer.length - 2) {
      if (buffer[i] !== 255) return bad()
      while (buffer[i] === 255) i++
      const marker = buffer[i++]!
      if (marker === 217) return bad()
      if (marker === 0 || marker === 216) return bad()
      if (marker >= 208 && marker <= 215) continue
      if (i + 2 > buffer.length) return bad()
      const n = buffer.readUInt16BE(i)
      if (n < 2 || i + n > buffer.length) return bad()
      if ([192, 193, 194].includes(marker)) {
        if (n < 8) return bad()
        height = buffer.readUInt16BE(i + 3)
        width = buffer.readUInt16BE(i + 5)
      }
      if (marker === 218) {
        scan = true
        i += n
        while (i < buffer.length - 1) {
          if (buffer[i] !== 255) {
            i++
            continue
          }
          const next = buffer[i + 1]!
          if (next === 0 || (next >= 208 && next <= 215)) {
            i += 2
            continue
          }
          break
        }
        continue
      }
      i += n
    }
    if (!scan || !width || !height) return bad()
  } else {
    if (
      buffer.toString('ascii', 0, 4) !== 'RIFF' ||
      buffer.toString('ascii', 8, 12) !== 'WEBP' ||
      buffer.readUInt32LE(4) + 8 !== buffer.length
    )
      return bad()
    let offset = 12,
      frame = false
    while (offset + 8 <= buffer.length) {
      const type = buffer.toString('ascii', offset, offset + 4),
        n = buffer.readUInt32LE(offset + 4),
        p = offset + 8
      if (n > buffer.length - p) return bad()
      if (type === 'ANIM' || type === 'ANMF') return bad()
      if (type === 'VP8X') {
        if (n < 10 || (buffer[p]! & 2) !== 0) return bad()
        width = 1 + buffer.readUIntLE(p + 4, 3)
        height = 1 + buffer.readUIntLE(p + 7, 3)
      }
      if (type === 'VP8 ') {
        if (
          n < 10 ||
          !buffer.subarray(p + 3, p + 6).equals(Buffer.from([157, 1, 42]))
        )
          return bad()
        width = buffer.readUInt16LE(p + 6) & 16383
        height = buffer.readUInt16LE(p + 8) & 16383
        frame = true
      }
      if (type === 'VP8L') {
        if (n < 5 || buffer[p] !== 47) return bad()
        const bits = buffer.readUInt32LE(p + 1)
        width = 1 + (bits & 16383)
        height = 1 + ((bits >>> 14) & 16383)
        frame = true
      }
      offset = p + n + (n % 2)
    }
    if (!frame || offset !== buffer.length) return bad()
  }
  if (
    !width ||
    !height ||
    width > 2000 ||
    height > 2000 ||
    width * height > 4_000_000
  )
    return bad()
  return {
    buffer,
    width,
    height,
    mime: 'image/' + match[1],
    bytes: buffer.length,
  }
}

function crc32(data: Buffer) {
  let crc = 0xffffffff
  for (const byte of data) {
    crc ^= byte
    for (let n = 0; n < 8; n++)
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
  }
  return (crc ^ 0xffffffff) >>> 0
}
