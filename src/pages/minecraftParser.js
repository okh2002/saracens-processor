/**
 * Client-side Minecraft world parser.
 * Supports .mca (Anvil region) and .schematic (NBT) files.
 * Extracts block data and produces a 2D top-block map for isometric rendering.
 */

const TAG_END = 0
const TAG_BYTE = 1
const TAG_SHORT = 2
const TAG_INT = 3
const TAG_LONG = 4
const TAG_FLOAT = 5
const TAG_DOUBLE = 6
const TAG_BYTE_ARRAY = 7
const TAG_STRING = 8
const TAG_LIST = 9
const TAG_COMPOUND = 10
const TAG_INT_ARRAY = 11
const TAG_LONG_ARRAY = 12

class NBTReader {
  constructor(buffer) {
    this.view = new DataView(buffer)
    this.offset = 0
  }

  readByte() {
    const v = this.view.getInt8(this.offset)
    this.offset += 1
    return v
  }

  readUByte() {
    const v = this.view.getUint8(this.offset)
    this.offset += 1
    return v
  }

  readShort() {
    const v = this.view.getInt16(this.offset)
    this.offset += 2
    return v
  }

  readInt() {
    const v = this.view.getInt32(this.offset)
    this.offset += 4
    return v
  }

  readLong() {
    const hi = this.view.getInt32(this.offset)
    const lo = this.view.getUint32(this.offset + 4)
    this.offset += 8
    return hi * 0x100000000 + lo
  }

  readFloat() {
    const v = this.view.getFloat32(this.offset)
    this.offset += 4
    return v
  }

  readDouble() {
    const v = this.view.getFloat64(this.offset)
    this.offset += 8
    return v
  }

  readString() {
    const len = this.view.getUint16(this.offset)
    this.offset += 2
    const bytes = new Uint8Array(this.view.buffer, this.offset, len)
    this.offset += len
    return new TextDecoder().decode(bytes)
  }

  readByteArray() {
    const len = this.readInt()
    const arr = new Uint8Array(this.view.buffer.slice(this.offset, this.offset + len))
    this.offset += len
    return arr
  }

  readIntArray() {
    const len = this.readInt()
    const arr = new Int32Array(len)
    for (let i = 0; i < len; i++) arr[i] = this.readInt()
    return arr
  }

  readLongArray() {
    const len = this.readInt()
    const arr = []
    for (let i = 0; i < len; i++) arr.push(this.readLong())
    return arr
  }

  readPayload(tagType) {
    switch (tagType) {
      case TAG_BYTE: return this.readByte()
      case TAG_SHORT: return this.readShort()
      case TAG_INT: return this.readInt()
      case TAG_LONG: return this.readLong()
      case TAG_FLOAT: return this.readFloat()
      case TAG_DOUBLE: return this.readDouble()
      case TAG_BYTE_ARRAY: return this.readByteArray()
      case TAG_STRING: return this.readString()
      case TAG_LIST: return this.readList()
      case TAG_COMPOUND: return this.readCompound()
      case TAG_INT_ARRAY: return this.readIntArray()
      case TAG_LONG_ARRAY: return this.readLongArray()
      default: throw new Error(`Unknown NBT tag type: ${tagType}`)
    }
  }

  readCompound() {
    const result = {}
    while (true) {
      const type = this.readUByte()
      if (type === TAG_END) break
      const name = this.readString()
      result[name] = this.readPayload(type)
    }
    return result
  }

  readList() {
    const itemType = this.readUByte()
    const len = this.readInt()
    const items = []
    for (let i = 0; i < len; i++) {
      items.push(this.readPayload(itemType))
    }
    return items
  }

  readRoot() {
    const type = this.readUByte()
    if (type !== TAG_COMPOUND) throw new Error("Root tag must be TAG_Compound")
    this.readString()
    return this.readCompound()
  }
}

function parseNBT(buffer) {
  const reader = new NBTReader(buffer)
  return reader.readRoot()
}

async function decompressGzip(buffer) {
  const ds = new DecompressionStream("gzip")
  const writer = ds.writable.getWriter()
  writer.write(new Uint8Array(buffer))
  writer.close()
  const reader = ds.readable.getReader()
  const chunks = []
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
  }
  const total = chunks.reduce((s, c) => s + c.length, 0)
  const result = new Uint8Array(total)
  let off = 0
  for (const c of chunks) { result.set(c, off); off += c.length }
  return result.buffer
}

async function decompressZlib(buffer) {
  const ds = new DecompressionStream("deflate")
  const writer = ds.writable.getWriter()
  writer.write(new Uint8Array(buffer))
  writer.close()
  const reader = ds.readable.getReader()
  const chunks = []
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
  }
  const total = chunks.reduce((s, c) => s + c.length, 0)
  const result = new Uint8Array(total)
  let off = 0
  for (const c of chunks) { result.set(c, off); off += c.length }
  return result.buffer
}

/**
 * Parse a .schematic file (NBT format).
 * Returns { width, height, length, blocks: Uint8Array }
 */
export async function parseSchematic(arrayBuffer) {
  let buffer = arrayBuffer
  const firstBytes = new Uint8Array(buffer, 0, 2)
  if (firstBytes[0] === 0x1f && firstBytes[1] === 0x8b) {
    buffer = await decompressGzip(buffer)
  }

  const nbt = parseNBT(buffer)
  const root = nbt.Schematic || nbt

  const width = root.Width
  const height = root.Height
  const length = root.Length
  const blocks = root.Blocks

  if (!blocks || !width || !height || !length) {
    throw new Error("Invalid schematic: missing Width/Height/Length/Blocks")
  }

  return { width, height, length, blocks }
}

/**
 * Parse an .mca region file.
 * Returns array of { cx, cz, sections } where sections contain block data.
 */
export async function parseMCA(arrayBuffer) {
  const view = new DataView(arrayBuffer)
  const chunks = []

  for (let i = 0; i < 1024; i++) {
    const locationEntry = view.getUint32(i * 4)
    if (locationEntry === 0) continue

    const sectorOffset = (locationEntry >> 8) & 0xFFFFFF
    const sectorCount = locationEntry & 0xFF
    if (sectorOffset < 2 || sectorCount === 0) continue

    const byteOffset = sectorOffset * 4096
    if (byteOffset + 5 > arrayBuffer.byteLength) continue

    const chunkLength = view.getUint32(byteOffset)
    const compressionType = view.getUint8(byteOffset + 4)

    if (chunkLength <= 1) continue
    const dataStart = byteOffset + 5
    const dataEnd = dataStart + chunkLength - 1
    if (dataEnd > arrayBuffer.byteLength) continue

    const compressedData = arrayBuffer.slice(dataStart, dataEnd)

    let decompressed
    try {
      if (compressionType === 1) {
        decompressed = await decompressGzip(compressedData)
      } else if (compressionType === 2) {
        decompressed = await decompressZlib(compressedData)
      } else {
        continue
      }
    } catch {
      continue
    }

    let nbt
    try {
      nbt = parseNBT(decompressed)
    } catch {
      continue
    }

    const level = nbt.Level || nbt
    const cx = i % 32
    const cz = Math.floor(i / 32)

    chunks.push({ cx, cz, level })
  }

  return chunks
}

const BLOCK_NAME_TO_ID = {
  grass_block: 2, grass: 2, stone: 1, dirt: 3, sand: 12,
  water: 9, flowing_water: 9, snow: 80, snow_block: 80,
  gravel: 13, bedrock: 7, oak_log: 17, log: 17,
  oak_leaves: 18, leaves: 18, cobblestone: 4, planks: 5,
  oak_planks: 5, spruce_log: 17, birch_log: 17,
  spruce_leaves: 18, birch_leaves: 18, clay: 82,
  sandstone: 24, iron_ore: 15, coal_ore: 16,
  gold_ore: 14, diamond_ore: 56, obsidian: 49,
  netherrack: 87, soul_sand: 88, glowstone: 89,
  ice: 79, packed_ice: 174, blue_ice: 174,
  terracotta: 172, red_sand: 12, red_sandstone: 179,
  deepslate: 1, tuff: 1, calcite: 1, dripstone_block: 1,
  moss_block: 2, rooted_dirt: 3, mud: 3,
}

/**
 * Extract top-down block map from parsed MCA chunks.
 * Returns { topBlocks: Uint8Array, width, height } where topBlocks[z * width + x] = blockId
 */
export function extractTopBlocksFromMCA(chunks, sampleSize = 64) {
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity
  for (const { cx, cz } of chunks) {
    minX = Math.min(minX, cx * 16)
    minZ = Math.min(minZ, cz * 16)
    maxX = Math.max(maxX, (cx + 1) * 16)
    maxZ = Math.max(maxZ, (cz + 1) * 16)
  }
  const worldW = maxX - minX
  const worldH = maxZ - minZ
  if (worldW <= 0 || worldH <= 0) return null

  const topBlocks = new Uint8Array(sampleSize * sampleSize)

  for (const { cx, cz, level } of chunks) {
    const sections = level.Sections || level.sections || []
    if (!sections.length) continue

    for (let lx = 0; lx < 16; lx++) {
      for (let lz = 0; lz < 16; lz++) {
        const worldX = cx * 16 + lx
        const worldZ = cz * 16 + lz

        const sx = Math.floor(((worldX - minX) / worldW) * sampleSize)
        const sz = Math.floor(((worldZ - minZ) / worldH) * sampleSize)
        if (sx >= sampleSize || sz >= sampleSize || sx < 0 || sz < 0) continue

        let topBlock = 0
        for (let si = sections.length - 1; si >= 0; si--) {
          const section = sections[si]
          const _sectionY = section.Y !== undefined ? section.Y : si // eslint-disable-line no-unused-vars

          if (section.Blocks) {
            for (let y = 15; y >= 0; y--) {
              const idx = y * 256 + lz * 16 + lx
              const bid = section.Blocks[idx]
              if (bid && bid !== 0) {
                topBlock = bid
                break
              }
            }
            if (topBlock) break
          }

          if (section.block_states || section.BlockStates) {
            const palette = section.block_states?.palette || section.Palette || []
            const data = section.block_states?.data || section.BlockStates
            if (palette.length > 0) {
              for (let y = 15; y >= 0; y--) {
                const blockIdx = y * 256 + lz * 16 + lx
                let paletteIdx = 0
                if (data && palette.length > 1) {
                  const bitsPerBlock = Math.max(4, Math.ceil(Math.log2(palette.length)))
                  const longIdx = Math.floor((blockIdx * bitsPerBlock) / 64)
                  const bitOffset = (blockIdx * bitsPerBlock) % 64
                  if (longIdx < data.length) {
                    const mask = (1 << bitsPerBlock) - 1
                    paletteIdx = Number((BigInt(data[longIdx]) >> BigInt(bitOffset)) & BigInt(mask))
                  }
                }
                if (paletteIdx >= 0 && paletteIdx < palette.length) {
                  const entry = palette[paletteIdx]
                  const name = (typeof entry === "string" ? entry : entry.Name || "")
                    .replace("minecraft:", "")
                  if (name && name !== "air" && name !== "cave_air" && name !== "void_air") {
                    topBlock = BLOCK_NAME_TO_ID[name] || 1
                    break
                  }
                }
              }
              if (topBlock) break
            }
          }
        }

        if (topBlock) {
          topBlocks[sz * sampleSize + sx] = topBlock
        }
      }
    }
  }

  return { topBlocks, width: sampleSize, height: sampleSize }
}

/**
 * Extract top-down block map from a parsed schematic.
 */
export function extractTopBlocksFromSchematic(schematic, sampleSize = 64) {
  const { width, height, length, blocks } = schematic
  const topBlocks = new Uint8Array(sampleSize * sampleSize)

  for (let sz = 0; sz < sampleSize; sz++) {
    for (let sx = 0; sx < sampleSize; sx++) {
      const worldX = Math.floor((sx / sampleSize) * width)
      const worldZ = Math.floor((sz / sampleSize) * length)

      for (let y = height - 1; y >= 0; y--) {
        const idx = y * width * length + worldZ * width + worldX
        const bid = blocks[idx]
        if (bid && bid !== 0) {
          topBlocks[sz * sampleSize + sx] = bid
          break
        }
      }
    }
  }

  return { topBlocks, width: sampleSize, height: sampleSize }
}

/**
 * Parse any Minecraft world file (.mca, .schematic, or .zip containing region files).
 * Returns { topBlocks, width, height }
 */
export async function parseMinecraftWorld(file) {
  const buffer = await file.arrayBuffer()
  const name = file.name.toLowerCase()

  if (name.endsWith(".schematic") || name.endsWith(".schem")) {
    const schematic = await parseSchematic(buffer)
    return extractTopBlocksFromSchematic(schematic)
  }

  if (name.endsWith(".mca")) {
    const chunks = await parseMCA(buffer)
    if (!chunks.length) throw new Error("No valid chunks found in region file")
    return extractTopBlocksFromMCA(chunks)
  }

  if (name.endsWith(".zip")) {
    const { entries } = await readZip(buffer)
    const mcaEntries = entries.filter(e => e.name.endsWith(".mca"))
    if (!mcaEntries.length) throw new Error("No .mca region files found in zip")

    const allChunks = []
    for (const entry of mcaEntries) {
      const chunks = await parseMCA(entry.data)
      allChunks.push(...chunks)
    }
    if (!allChunks.length) throw new Error("No valid chunks found in world")
    return extractTopBlocksFromMCA(allChunks)
  }

  throw new Error("Unsupported file type. Use .mca, .schematic, or .zip")
}

async function readZip(buffer) {
  const view = new DataView(buffer)
  const entries = []
  let offset = 0

  while (offset < buffer.byteLength - 4) {
    const sig = view.getUint32(offset, true)
    if (sig !== 0x04034b50) break

    const compressionMethod = view.getUint16(offset + 8, true)
    const compressedSize = view.getUint32(offset + 18, true)
    view.getUint32(offset + 22, true) // uncompressedSize - read to advance parsing
    const nameLen = view.getUint16(offset + 26, true)
    const extraLen = view.getUint16(offset + 28, true)

    const nameBytes = new Uint8Array(buffer, offset + 30, nameLen)
    const name = new TextDecoder().decode(nameBytes)

    const dataStart = offset + 30 + nameLen + extraLen
    const rawData = buffer.slice(dataStart, dataStart + compressedSize)

    let data
    if (compressionMethod === 0) {
      data = rawData
    } else if (compressionMethod === 8) {
      try {
        data = await decompressZlib(rawData)
      } catch {
        data = rawData
      }
    } else {
      data = rawData
    }

    entries.push({ name, data })
    offset = dataStart + compressedSize
  }

  return { entries }
}
