/**
 * Isometric voxel renderer for Minecraft world data on octagonal islands.
 * Uses PixiJS Graphics to draw isometric blocks clipped to an octagonal boundary.
 */
import * as PIXI from "pixi.js"

/**
 * Block ID → { top, left, right } hex colors for isometric faces.
 * Matches the backend BLOCK_COLORS palette in app.py.
 */
const BLOCK_COLORS = {
  2:  { top: 0x6A7F4B, left: 0x4F6038, right: 0x5B6F40 },  // grass
  1:  { top: 0x7D7D7D, left: 0x646464, right: 0x707070 },  // stone
  3:  { top: 0x866043, left: 0x6B4D36, right: 0x78563C },  // dirt
  4:  { top: 0x7A7A7A, left: 0x606060, right: 0x6D6D6D },  // cobblestone
  5:  { top: 0xBC9862, left: 0x967A4E, right: 0xA98958 },  // planks
  7:  { top: 0x151515, left: 0x111111, right: 0x131313 },  // bedrock
  9:  { top: 0x4093D4, left: 0x3375A9, right: 0x3984BE },  // water
  12: { top: 0xDBCFA3, left: 0xAFA682, right: 0xC5BA92 },  // sand
  13: { top: 0x887E7E, left: 0x6D6565, right: 0x7A7171 },  // gravel
  14: { top: 0x8A7A5A, left: 0x6E6248, right: 0x7C6E51 },  // gold ore
  15: { top: 0x87776B, left: 0x6C5F56, right: 0x796B60 },  // iron ore
  16: { top: 0x636363, left: 0x4F4F4F, right: 0x595959 },  // coal ore
  17: { top: 0x6B5439, left: 0x56432E, right: 0x604C33 },  // log
  18: { top: 0x4A7A32, left: 0x3B6228, right: 0x426E2D },  // leaves
  24: { top: 0xD4C68A, left: 0xAA9E6E, right: 0xBFB27C },  // sandstone
  49: { top: 0x1B0B27, left: 0x16091F, right: 0x180A23 },  // obsidian
  56: { top: 0x6DB5A4, left: 0x579183, right: 0x62A393 },  // diamond ore
  79: { top: 0x7DADEB, left: 0x648ABC, right: 0x709BD3 },  // ice
  80: { top: 0xFFFFFF, left: 0xCCCCCC, right: 0xE5E5E5 },  // snow
  82: { top: 0x9EA4B0, left: 0x7E838C, right: 0x8E939E },  // clay
  87: { top: 0x6F3232, left: 0x592828, right: 0x642D2D },  // netherrack
  172:{ top: 0x985C43, left: 0x7A4A36, right: 0x89533C },  // terracotta
  174:{ top: 0x7DADEB, left: 0x648ABC, right: 0x709BD3 },  // packed/blue ice
}

const DEFAULT_BLOCK = { top: 0x7D7D7D, left: 0x646464, right: 0x707070 }

function getBlockColors(blockId) {
  return BLOCK_COLORS[blockId] || DEFAULT_BLOCK
}

/**
 * Check if point (px, py) is inside a regular octagon centered at (0, 0)
 * with the given semi-width and semi-height.
 */
function isInsideOctagon(px, py, halfW, halfH) {
  const steps = 8
  const points = []
  for (let i = 0; i < steps; i++) {
    const angle = (i / steps) * Math.PI * 2 - Math.PI / 2
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
 * Render a Minecraft world's top-block data as an isometric view
 * inside an octagonal boundary, returning a PIXI.Container.
 *
 * @param {Uint8Array} topBlocks - 2D block IDs array (z * gridSize + x)
 * @param {number} gridSize - Width/height of the top-blocks grid
 * @param {number} octWidth - Half-width of the octagon in pixels
 * @param {number} octHeight - Half-height of the octagon (isometric, typically smaller)
 * @param {number} cityColor - Fallback city color (hex)
 * @returns {PIXI.Container}
 */
export function renderWorldIsometric(topBlocks, gridSize, octWidth, octHeight) {
  const container = new PIXI.Container()

  const tw = Math.max(1, Math.floor((octWidth * 1.6) / gridSize))
  const th = Math.max(1, Math.floor(tw * 0.5))
  const blockH = Math.max(1, th)

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

      const bid = topBlocks[gz * gridSize + gx]

      const { sx, sy } = isoToScreen(gx, gz)
      const px = sx - centerOff.sx
      const py = sy - centerOff.sy

      if (!isInsideOctagon(px, py, octWidth * 0.88, octHeight * 0.88)) continue

      if (bid === 0) {
        gfx.beginFill(0x0A1628, 0.6)
        gfx.drawPolygon([px, py - th, px + tw, py, px, py + th, px - tw, py])
        gfx.endFill()
        continue
      }

      const colors = getBlockColors(bid)

      gfx.beginFill(colors.top)
      gfx.drawPolygon([px, py - th, px + tw, py, px, py + th, px - tw, py])
      gfx.endFill()

      gfx.beginFill(colors.left)
      gfx.drawPolygon([px - tw, py, px, py + th, px, py + th + blockH, px - tw, py + blockH])
      gfx.endFill()

      gfx.beginFill(colors.right)
      gfx.drawPolygon([px + tw, py, px, py + th, px, py + th + blockH, px + tw, py + blockH])
      gfx.endFill()
    }
  }

  container.addChild(gfx)
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
    const angle = (i / steps) * Math.PI * 2 - Math.PI / 2
    points.push(Math.cos(angle) * halfW, Math.sin(angle) * halfH)
  }
  mask.beginFill(0xFFFFFF)
  mask.drawPolygon(points)
  mask.endFill()
  return mask
}
