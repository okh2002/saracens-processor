/**
 * Isometric voxel renderer for Minecraft world data on octagonal islands.
 * Enhanced art style with terrain depth, edge shading, and rich color palette.
 */
import * as PIXI from "pixi.js"

/**
 * Rich block color palette — top face, left face (shadow), right face (mid).
 * Tuned for visual contrast at small isometric scale.
 */
const BLOCK_COLORS = {
  1:  { top: 0x8A8A8A, left: 0x5C5C5C, right: 0x6E6E6E },  // stone
  2:  { top: 0x7DA653, left: 0x4B7A2E, right: 0x5F8A38 },  // grass — vivid green
  3:  { top: 0x9B7653, left: 0x6B5038, right: 0x836340 },  // dirt
  4:  { top: 0x7F7F7F, left: 0x555555, right: 0x6A6A6A },  // cobblestone
  5:  { top: 0xC8A868, left: 0x8B7548, right: 0xA98F58 },  // planks
  7:  { top: 0x1A1A1A, left: 0x0A0A0A, right: 0x121212 },  // bedrock
  9:  { top: 0x3F76C4, left: 0x2B5694, right: 0x3566AC },  // water — deeper blue
  12: { top: 0xE8D8A0, left: 0xB8A870, right: 0xD0C088 },  // sand — warm tan
  13: { top: 0x908080, left: 0x605858, right: 0x786C6C },  // gravel
  14: { top: 0x9A8A60, left: 0x6A6040, right: 0x827550 },  // gold ore
  15: { top: 0x908070, left: 0x606050, right: 0x787060 },  // iron ore
  16: { top: 0x505050, left: 0x383838, right: 0x444444 },  // coal ore
  17: { top: 0x785A38, left: 0x4A3820, right: 0x614A2C },  // log — warm brown
  18: { top: 0x3D8A28, left: 0x286818, right: 0x327820 },  // leaves — forest green
  24: { top: 0xDACF90, left: 0xA89E68, right: 0xC1B87C },  // sandstone
  31: { top: 0x7DA653, left: 0x4B7A2E, right: 0x5F8A38 },  // tallgrass → same as grass
  35: { top: 0xE8E8E8, left: 0xB8B8B8, right: 0xD0D0D0 },  // wool
  43: { top: 0x9A9A9A, left: 0x6A6A6A, right: 0x828282 },  // double stone slab
  44: { top: 0x9A9A9A, left: 0x6A6A6A, right: 0x828282 },  // stone slab
  45: { top: 0x9A5A4A, left: 0x6A3A2A, right: 0x824A3A },  // bricks
  48: { top: 0x688068, left: 0x486048, right: 0x587058 },  // moss stone
  49: { top: 0x201028, left: 0x100818, right: 0x180C20 },  // obsidian
  56: { top: 0x70B8A8, left: 0x509080, right: 0x60A490 },  // diamond ore
  79: { top: 0x90C8F0, left: 0x68A0C8, right: 0x7CB4DC },  // ice
  80: { top: 0xF8F8FF, left: 0xC8C8D8, right: 0xE0E0F0 },  // snow
  82: { top: 0xA0A8B8, left: 0x707880, right: 0x889098 },  // clay
  87: { top: 0x7A3838, left: 0x4A2020, right: 0x622C2C },  // netherrack
  98: { top: 0x909090, left: 0x606060, right: 0x787878 },  // stone bricks
  155:{ top: 0xE0D8C8, left: 0xB0A898, right: 0xC8C0B0 },  // quartz
  172:{ top: 0xA06848, left: 0x704830, right: 0x88583C },  // terracotta
  174:{ top: 0x90C8F0, left: 0x68A0C8, right: 0x7CB4DC },  // packed/blue ice
}

const DEFAULT_BLOCK = { top: 0x808080, left: 0x585858, right: 0x6C6C6C }

function getBlockColors(blockId) {
  return BLOCK_COLORS[blockId] || DEFAULT_BLOCK
}

/**
 * Darken a hex color by a factor (0 = black, 1 = original).
 */
function darkenColor(hex, factor) {
  const r = Math.floor(((hex >> 16) & 0xFF) * factor)
  const g = Math.floor(((hex >> 8) & 0xFF) * factor)
  const b = Math.floor((hex & 0xFF) * factor)
  return (r << 16) | (g << 8) | b
}

/**
 * Lighten a hex color toward white by a factor (0 = original, 1 = white).
 */
function lightenColor(hex, factor) {
  const r = Math.min(255, Math.floor(((hex >> 16) & 0xFF) + (255 - ((hex >> 16) & 0xFF)) * factor))
  const g = Math.min(255, Math.floor(((hex >> 8) & 0xFF) + (255 - ((hex >> 8) & 0xFF)) * factor))
  const b = Math.min(255, Math.floor((hex & 0xFF) + (255 - (hex & 0xFF)) * factor))
  return (r << 16) | (g << 8) | b
}

/**
 * Angle offset for octagon rotation — π/8 aligns flat edges with isometric axes.
 */
const OCT_ANGLE_OFFSET = Math.PI / 8

/**
 * Check if point is inside a rotated octagon centered at origin.
 */
function isInsideOctagon(px, py, halfW, halfH) {
  const steps = 8
  const points = []
  for (let i = 0; i < steps; i++) {
    const angle = (i / steps) * Math.PI * 2 - Math.PI / 2 + OCT_ANGLE_OFFSET
    points.push({ x: Math.cos(angle) * halfW, y: Math.sin(angle) * halfH })
  }
  let inside = false
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const xi = points[i].x, yi = points[i].y
    const xj = points[j].x, yj = points[j].y
    const intersect = (yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi
    if (intersect) inside = !inside
  }
  return inside
}

/**
 * Render a Minecraft world's top-block data as a richly shaded isometric view.
 *
 * @param {Uint8Array} topBlocks - Block IDs array (z * gridSize + x)
 * @param {number} gridSize - Width/height of the top-blocks grid
 * @param {number} octWidth - Half-width of the octagon in pixels
 * @param {number} octHeight - Half-height of the octagon
 * @param {Uint8Array} [topHeights] - Y heights for 3D elevation
 * @returns {PIXI.Container}
 */
export function renderWorldIsometric(topBlocks, gridSize, octWidth, octHeight, topHeights) {
  const container = new PIXI.Container()

  const renderScale = 5
  const internalW = octWidth * renderScale
  const internalH = octHeight * renderScale

  const tw = Math.max(1, Math.floor((internalW * 1.6) / gridSize))
  const th = Math.max(1, Math.floor(tw * 0.5))
  const blockH = Math.max(2, Math.floor(th * 1.8))

  // Compute height normalization
  let minH = 255, maxH = 0
  if (topHeights) {
    for (let i = 0; i < topBlocks.length; i++) {
      if (topBlocks[i] !== 0) {
        if (topHeights[i] < minH) minH = topHeights[i]
        if (topHeights[i] > maxH) maxH = topHeights[i]
      }
    }
  }
  const heightRange = Math.max(1, maxH - minH)
  const maxElevation = Math.floor(internalH * 0.4)

  const isoToScreen = (gx, gz) => ({
    sx: (gx - gz) * tw,
    sy: (gx + gz) * th * 0.5,
  })

  const centerOff = isoToScreen(gridSize / 2, gridSize / 2)

  const gfx = new PIXI.Graphics()

  for (let diag = 0; diag < gridSize * 2 - 1; diag++) {
    for (let gx = Math.max(0, diag - gridSize + 1); gx < Math.min(diag + 1, gridSize); gx++) {
      const gz = diag - gx
      if (gz < 0 || gz >= gridSize) continue

      const arrIdx = gz * gridSize + gx
      const bid = topBlocks[arrIdx]

      const { sx, sy } = isoToScreen(gx, gz)
      const px = sx - centerOff.sx
      let py = sy - centerOff.sy

      if (!isInsideOctagon(px, py, internalW * 0.93, internalH * 0.93)) continue
      if (bid === 0) continue

      // Height-based elevation
      let elevation = 0
      let normalizedH = 0
      if (topHeights && heightRange > 1) {
        normalizedH = (topHeights[arrIdx] - minH) / heightRange
        elevation = normalizedH * maxElevation
      }
      py -= elevation

      const colors = getBlockColors(bid)

      // Apply subtle height-based tinting — higher blocks are slightly brighter
      const brightFactor = 0.03 * normalizedH
      const topColor = lightenColor(colors.top, brightFactor)
      const leftColor = darkenColor(colors.left, 0.85 + 0.15 * (1 - normalizedH))
      const rightColor = colors.right

      // Top face (diamond)
      gfx.beginFill(topColor)
      gfx.drawPolygon([px, py - th, px + tw, py, px, py + th, px - tw, py])
      gfx.endFill()

      // Top face edge highlight (subtle bright line at top)
      gfx.lineStyle(0.5, lightenColor(topColor, 0.2), 0.4)
      gfx.moveTo(px, py - th)
      gfx.lineTo(px + tw, py)
      gfx.lineStyle(0)

      // Left face (shadow side)
      gfx.beginFill(leftColor)
      gfx.drawPolygon([px - tw, py, px, py + th, px, py + th + blockH, px - tw, py + blockH])
      gfx.endFill()

      // Right face
      gfx.beginFill(rightColor)
      gfx.drawPolygon([px + tw, py, px, py + th, px, py + th + blockH, px + tw, py + blockH])
      gfx.endFill()

      // Bottom edge darkening (ambient occlusion hint)
      gfx.lineStyle(0.5, 0x000000, 0.15)
      gfx.moveTo(px - tw, py + blockH)
      gfx.lineTo(px, py + th + blockH)
      gfx.lineTo(px + tw, py + blockH)
      gfx.lineStyle(0)
    }
  }

  container.addChild(gfx)
  container.scale.set(1 / renderScale)
  return container
}

/**
 * Create an octagonal clipping mask as a PIXI.Graphics.
 */
export function createOctagonMask(halfW, halfH) {
  const mask = new PIXI.Graphics()
  const steps = 8
  const points = []
  for (let i = 0; i < steps; i++) {
    const angle = (i / steps) * Math.PI * 2 - Math.PI / 2 + OCT_ANGLE_OFFSET
    points.push(Math.cos(angle) * halfW, Math.sin(angle) * halfH)
  }
  mask.beginFill(0xFFFFFF)
  mask.drawPolygon(points)
  mask.endFill()
  return mask
}
