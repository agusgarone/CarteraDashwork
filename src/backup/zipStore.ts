const LOCAL_HEADER = 0x04034b50
const CENTRAL_HEADER = 0x02014b50
const EOCD_HEADER = 0x06054b50

export interface ZipEntry {
  name: string
  bytes: Uint8Array
}

/** ZIP sin comprimir. Cualquier descompresor lo lee y no hace falta otra librería. */
export function zipStored(entries: readonly ZipEntry[]): Uint8Array {
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0

  for (const entry of entries) {
    const name = new TextEncoder().encode(entry.name)
    const crc = crc32(entry.bytes)
    const local = new Uint8Array(30 + name.length + entry.bytes.length)
    const view = new DataView(local.buffer)
    view.setUint32(0, LOCAL_HEADER, true)
    view.setUint16(4, 20, true)
    view.setUint16(8, 0, true)
    view.setUint32(14, crc, true)
    view.setUint32(18, entry.bytes.length, true)
    view.setUint32(22, entry.bytes.length, true)
    view.setUint16(26, name.length, true)
    local.set(name, 30)
    local.set(entry.bytes, 30 + name.length)
    locals.push(local)

    const central = new Uint8Array(46 + name.length)
    const centralView = new DataView(central.buffer)
    centralView.setUint32(0, CENTRAL_HEADER, true)
    centralView.setUint16(4, 20, true)
    centralView.setUint16(6, 20, true)
    centralView.setUint32(16, crc, true)
    centralView.setUint32(20, entry.bytes.length, true)
    centralView.setUint32(24, entry.bytes.length, true)
    centralView.setUint16(28, name.length, true)
    centralView.setUint32(42, offset, true)
    central.set(name, 46)
    centrals.push(central)
    offset += local.length
  }

  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0)
  const eocd = new Uint8Array(22)
  const eocdView = new DataView(eocd.buffer)
  eocdView.setUint32(0, EOCD_HEADER, true)
  eocdView.setUint16(8, entries.length, true)
  eocdView.setUint16(10, entries.length, true)
  eocdView.setUint32(12, centralSize, true)
  eocdView.setUint32(16, offset, true)

  const total = offset + centralSize + eocd.length
  const archive = new Uint8Array(total)
  let cursor = 0
  for (const part of locals) {
    archive.set(part, cursor)
    cursor += part.length
  }
  for (const part of centrals) {
    archive.set(part, cursor)
    cursor += part.length
  }
  archive.set(eocd, cursor)
  return archive
}

export function unzipStored(archive: Uint8Array): ZipEntry[] {
  const eocd = findEocd(archive)
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength)
  const count = view.getUint16(eocd + 10, true)
  let cursor = view.getUint32(eocd + 16, true)
  const entries: ZipEntry[] = []
  let total = 0

  for (let index = 0; index < count; index += 1) {
    if (view.getUint32(cursor, true) !== CENTRAL_HEADER) {
      throw new Error('El archivo zip está incompleto.')
    }
    const method = view.getUint16(cursor + 10, true)
    const compressed = view.getUint32(cursor + 20, true)
    const size = view.getUint32(cursor + 24, true)
    const nameLength = view.getUint16(cursor + 28, true)
    const extraLength = view.getUint16(cursor + 30, true)
    const commentLength = view.getUint16(cursor + 32, true)
    const localOffset = view.getUint32(cursor + 42, true)
    const name = new TextDecoder().decode(archive.subarray(cursor + 46, cursor + 46 + nameLength))
    if (method !== 0 || compressed !== size) {
      throw new Error('El backup usa archivos sin comprimir.')
    }
    total += size
    if (total > 200_000_000) {
      throw new Error('El backup supera el tamaño admitido.')
    }
    const expectedCrc = view.getUint32(cursor + 16, true)
    const localNameLength = view.getUint16(localOffset + 26, true)
    const localExtraLength = view.getUint16(localOffset + 28, true)
    const dataStart = localOffset + 30 + localNameLength + localExtraLength
    const bytes = archive.slice(dataStart, dataStart + size)
    if (bytes.length !== size) {
      throw new Error('El archivo zip está incompleto.')
    }
    if (crc32(bytes) !== expectedCrc) {
      throw new Error('El archivo zip está dañado.')
    }
    entries.push({ name, bytes })
    cursor += 46 + nameLength + extraLength + commentLength
  }

  return entries
}

function findEocd(archive: Uint8Array): number {
  const min = Math.max(0, archive.length - 22 - 65_535)
  for (let offset = archive.length - 22; offset >= min; offset -= 1) {
    if (
      archive[offset] === 0x50 &&
      archive[offset + 1] === 0x4b &&
      archive[offset + 2] === 0x05 &&
      archive[offset + 3] === 0x06
    ) {
      return offset
    }
  }
  throw new Error('El archivo no es un zip.')
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      const mask = -(crc & 1)
      crc = (crc >>> 1) ^ (0xedb88320 & mask)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}
