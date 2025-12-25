// Tile-based stage generator (procedural + presets).
//
// Goals:
// - Use the existing tileset art in `/assets/freetileset/` to render a real Tilemap stage.
// - Provide multiple "styles" AND a deterministic seed so we can reproduce bugs.
// - Keep layouts simple and symmetric so AI-vs-AI matches stay readable.
//
// Important terminology:
// - tileNumber: 1..18 (as defined in `/assets/tileset.json`)
// - tileIndex:  0..17 (Phaser Tilemap indices, 0-based)
// - empty tile: -1 (Phaser convention for "no tile" when using `make.tilemap({ data })`)

// ---- Preset maps (exported from Tiled) ----
// These are optional "hand-made" maps the repo already contains.
// We crop them to fit our gameplay viewport.
import PRESET_LEVEL_1 from '../../../assets/levels/Level1.json'
import PRESET_LEVEL_1_2 from '../../../assets/levels/Level1-2.json'

import { DEFAULT_TILE_SIZE_PX, STAGE_OBJECT_KEYS } from './tilesetAtlas.js'

// Stage styles are string constants so they can travel across the React → Phaser boundary.
export const STAGE_STYLE = {
  PROCEDURAL_CLASSIC: 'procedural:classic',
  PROCEDURAL_SKY: 'procedural:sky',
  PROCEDURAL_BOXES: 'procedural:boxes',
  PROCEDURAL_RANDOM: 'procedural:random',

  PRESET_LEVEL_1: 'preset:level1',
  PRESET_LEVEL_1_2: 'preset:level1-2',
}

export const STAGE_STYLE_LABEL = {
  [STAGE_STYLE.PROCEDURAL_CLASSIC]: '經典（對稱平台）',
  [STAGE_STYLE.PROCEDURAL_SKY]: '天空（雲平台）',
  [STAGE_STYLE.PROCEDURAL_BOXES]: '箱子（障礙方塊）',
  [STAGE_STYLE.PROCEDURAL_RANDOM]: '隨機（可重現）',
  [STAGE_STYLE.PRESET_LEVEL_1]: '預設：Level1（Tiled）',
  [STAGE_STYLE.PRESET_LEVEL_1_2]: '預設：Level1-2（Tiled）',
}

// Default stage dimensions are chosen to match the current Phaser resolution:
// - width:  1280px => 40 tiles at 32px each
// - height: 720px  => 23 tiles at 32px each (736px), then we offset -16px to align the bottom.
const DEFAULT_WIDTH_TILES = 40
const DEFAULT_HEIGHT_TILES = 23

// We offset the tilemap slightly upward so 23*32=736 fits into a 720px viewport.
// This keeps the bottom of the map aligned with the bottom of the visible stage.
const DEFAULT_OFFSET_Y = -16

// Internal tile indices (0-based) used by procedural layouts.
// These indices match our atlas packing order: tileNumber 1..18 -> tileIndex 0..17.
const TILE = {
  // Ground / terrain
  GROUND_TOP: 0, // tileset id 1

  // Platform segments
  PLATFORM_LEFT: 3, // tileset id 4
  PLATFORM_MIDDLE: 4, // tileset id 5
  PLATFORM_RIGHT: 5, // tileset id 6

  // Blocks / obstacles
  BLOCK_STONE: 10, // tileset id 11
  BLOCK_WOOD: 11, // tileset id 12
  BRICK: 13, // tileset id 14

  // One-way platform
  CLOUD_PLATFORM: 17, // tileset id 18
}

// Decorative (non-colliding) tiles.
// These tile indices are non-solid according to `assets/tileset.json`.
const DECOR_TILE = {
  BACKGROUND_1: 7, // tileset id 8
  BACKGROUND_2: 8, // tileset id 9
  FOREGROUND_1: 9, // tileset id 10
  GRASS: 12, // tileset id 13
}

// Normalize the stage style so callers can pass unknown strings safely.
export function normalizeStageStyle(value) {
  const v = String(value ?? '')
  const known = Object.values(STAGE_STYLE)
  return known.includes(v) ? v : STAGE_STYLE.PROCEDURAL_RANDOM
}

// Create a full stage definition used by the Tilemap builder.
export function createStageDefinition({
  style,
  seed,
  widthTiles = DEFAULT_WIDTH_TILES,
  heightTiles = DEFAULT_HEIGHT_TILES,
  tileSizePx = DEFAULT_TILE_SIZE_PX,
  offsetX = 0,
  offsetY = DEFAULT_OFFSET_Y,
} = {}) {
  // Normalize style early so downstream logic stays simple.
  const normalizedStyle = normalizeStageStyle(style)

  // Normalize and generate the deterministic seed integer.
  const seedInfo = normalizeSeed(seed)
  const rng = createMulberry32(seedInfo.seedInt)

  // Choose final style if we are in "random" mode.
  // This still stays deterministic due to the seed.
  const pickedStyle =
    normalizedStyle === STAGE_STYLE.PROCEDURAL_RANDOM
      ? pickOne(rng, [
          STAGE_STYLE.PROCEDURAL_CLASSIC,
          STAGE_STYLE.PROCEDURAL_SKY,
          STAGE_STYLE.PROCEDURAL_BOXES,
          STAGE_STYLE.PRESET_LEVEL_1,
          STAGE_STYLE.PRESET_LEVEL_1_2,
        ])
      : normalizedStyle

  // Build the terrain layer grid (2D array of tile indices).
  const terrain =
    pickedStyle === STAGE_STYLE.PRESET_LEVEL_1
      ? buildFromPreset({ presetMap: PRESET_LEVEL_1, widthTiles, heightTiles })
      : pickedStyle === STAGE_STYLE.PRESET_LEVEL_1_2
        ? buildFromPreset({ presetMap: PRESET_LEVEL_1_2, widthTiles, heightTiles })
        : buildProcedural({
            style: pickedStyle,
            widthTiles,
            heightTiles,
            rng,
          })

  // Build lightweight decoration layers (non-colliding).
  // These layers increase visual variety without affecting gameplay.
  const { background, foreground } = buildDecorationTileLayers({
    terrain,
    widthTiles,
    heightTiles,
    rng,
  })

  // Compute spawn points (in world pixels).
  // We keep spawns near the top so fighters drop onto platforms naturally.
  const stageWidthPx = widthTiles * tileSizePx
  const spawnY = offsetY + tileSizePx * 3

  const spawns = {
    left: { x: offsetX + stageWidthPx * 0.28, y: spawnY, facing: 1 },
    right: { x: offsetX + stageWidthPx * 0.72, y: spawnY, facing: -1 },
  }

  // Place a few stage decoration objects (trees, rocks, crates...).
  // These are sprites (not tiles) so they can be larger than one tile.
  const decorations = buildStageDecorations({
    widthTiles,
    heightTiles,
    tileSizePx,
    offsetX,
    offsetY,
    rng,
    spawns,
  })

  return {
    meta: {
      style: pickedStyle,
      styleLabel: STAGE_STYLE_LABEL[pickedStyle] ?? pickedStyle,
      seed: seedInfo.seedInt,
      seedLabel: seedInfo.seedLabel,
    },
    tileSizePx,
    widthTiles,
    heightTiles,
    offsetX,
    offsetY,
    layers: {
      terrain,
      background,
      foreground,
    },
    decorations,
    spawns,
  }
}

// ---- Preset conversion (Tiled JSON -> Phaser data grid) ----

function buildFromPreset({ presetMap, widthTiles, heightTiles }) {
  // The preset maps are exported from Tiled and store tiles as "global IDs" (gids).
  // In this repo's PlatformSet.tsx tileset, the first usable gid is 19:
  // - gid 0  => empty
  // - gid 19 => tileset tileNumber 1 => tileIndex 0 in our atlas
  const GID_TO_TILE_INDEX_OFFSET = 19

  const sourceWidth = Number(presetMap?.width ?? 0)
  const sourceHeight = Number(presetMap?.height ?? 0)
  const layerData = presetMap?.layers?.[0]?.data ?? []

  // If the preset is missing or malformed, fall back to an empty grid with ground.
  if (!sourceWidth || !sourceHeight || !Array.isArray(layerData)) {
    const grid = createEmptyGrid(widthTiles, heightTiles)
    addGroundRow(grid, heightTiles - 1)
    return grid
  }

  // Crop from the bottom so we keep the "fight area" near the bottom of the stage.
  const cropStartRow = Math.max(0, sourceHeight - heightTiles)

  const grid = createEmptyGrid(widthTiles, heightTiles)

  for (let y = 0; y < heightTiles; y += 1) {
    const sourceY = cropStartRow + y
    for (let x = 0; x < widthTiles; x += 1) {
      const sourceIndex = sourceY * sourceWidth + x
      const gid = Number(layerData[sourceIndex] ?? 0)

      // Empty tile.
      if (!gid) {
        grid[y][x] = -1
        continue
      }

      // Convert gid -> tileIndex.
      const tileIndex = gid - GID_TO_TILE_INDEX_OFFSET

      // Ignore out-of-range tiles to keep rendering safe.
      grid[y][x] = tileIndex >= 0 && tileIndex < 18 ? tileIndex : -1
    }
  }

  // Ensure we always have some kind of ground at the bottom if the preset is sparse.
  // This prevents "spawn -> fall forever" situations in edge cases.
  if (grid[heightTiles - 1].every((n) => n === -1)) addGroundRow(grid, heightTiles - 1)

  return grid
}

// ---- Procedural layouts ----

function buildProcedural({ style, widthTiles, heightTiles, rng }) {
  const grid = createEmptyGrid(widthTiles, heightTiles)

  // Always place ground at the bottom row.
  addGroundRow(grid, heightTiles - 1)

  // Place style-specific platforms/obstacles.
  if (style === STAGE_STYLE.PROCEDURAL_CLASSIC) {
    placeClassicPlatforms(grid, { widthTiles, heightTiles })
  } else if (style === STAGE_STYLE.PROCEDURAL_SKY) {
    placeSkyPlatforms(grid, { widthTiles, heightTiles })
  } else if (style === STAGE_STYLE.PROCEDURAL_BOXES) {
    placeBoxArena(grid, { widthTiles, heightTiles, rng })
  } else {
    // Defensive fallback.
    placeClassicPlatforms(grid, { widthTiles, heightTiles })
  }

  // Add a small random "bonus" platform with symmetry (keeps matches fair).
  if (rng() < 0.7) {
    placeSymmetricPlatformPair(grid, {
      widthTiles,
      heightTiles,
      y: clampInt(heightTiles - 11 + randInt(rng, -1, 1), 3, heightTiles - 5),
      length: clampInt(randInt(rng, 3, 6), 2, 8),
      variant: rng() < 0.35 ? 'cloud' : 'wood',
    })
  }

  return grid
}

function buildDecorationTileLayers({ terrain, widthTiles, heightTiles, rng }) {
  // Create empty decoration grids.
  const background = createEmptyGrid(widthTiles, heightTiles)
  const foreground = createEmptyGrid(widthTiles, heightTiles)

  // ---- Foreground grass on top of ground ----
  // Place a small amount of grass just above the ground row.
  const groundRow = heightTiles - 1
  const grassRow = Math.max(0, groundRow - 1)

  for (let x = 1; x < widthTiles - 1; x += 1) {
    // Only place grass if the terrain is empty at this cell.
    if (terrain[grassRow]?.[x] !== -1) continue

    // Add some randomness so the grass pattern isn't uniform.
    if (rng() < 0.18) foreground[grassRow][x] = DECOR_TILE.GRASS
  }

  // ---- Background decorations (floating) ----
  // Scatter a few low-impact decorative tiles in the background layer.
  // We bias placement toward mid-height so they don't overlap the HUD area too often.
  const minY = Math.max(2, Math.floor(heightTiles * 0.25))
  const maxY = Math.min(heightTiles - 4, Math.floor(heightTiles * 0.7))

  const desiredCount = clampInt(Math.floor(widthTiles / 6), 4, 16)
  for (let i = 0; i < desiredCount; i += 1) {
    const x = randInt(rng, 1, widthTiles - 2)
    const y = randInt(rng, minY, maxY)

    // Don't place background tiles where the terrain is solid.
    if (terrain[y]?.[x] !== -1) continue

    background[y][x] = rng() < 0.5 ? DECOR_TILE.BACKGROUND_1 : DECOR_TILE.BACKGROUND_2
  }

  // ---- Foreground decoration tiles ----
  // Place a few foreground tiles near the lower half of the stage.
  const desiredFgCount = clampInt(Math.floor(widthTiles / 10), 2, 10)
  for (let i = 0; i < desiredFgCount; i += 1) {
    const x = randInt(rng, 2, widthTiles - 3)
    const y = randInt(rng, Math.max(2, heightTiles - 10), heightTiles - 4)
    if (terrain[y]?.[x] !== -1) continue
    if (foreground[y]?.[x] !== -1) continue
    foreground[y][x] = DECOR_TILE.FOREGROUND_1
  }

  return { background, foreground }
}

function buildStageDecorations({ widthTiles, heightTiles, tileSizePx, offsetX, offsetY, rng, spawns }) {
  // Place a few non-colliding sprites so the stage feels more alive.
  // Positions are deterministic because they use the stage RNG.
  const decorations = []

  // Ground top in world pixels (top of the bottom tile row).
  const groundTopY = offsetY + (heightTiles - 1) * tileSizePx

  // Avoid putting big objects directly on top of spawns.
  const spawnXs = [Number(spawns?.left?.x ?? 0), Number(spawns?.right?.x ?? 0)]

  function isNearSpawn(x) {
    return spawnXs.some((sx) => Math.abs(sx - x) < tileSizePx * 4)
  }

  // Helper for adding a decoration object.
  function add({ key, x, y, depth, scale }) {
    decorations.push({
      key,
      x,
      y,
      // Depth controls render order (higher draws on top).
      depth,
      // Scale is optional; we use it to keep large sprites reasonable.
      scale,
      // Use a bottom origin so the object "stands" on the ground.
      origin: [0.5, 1],
    })
  }

  const stageWidthPx = widthTiles * tileSizePx
  const stageLeftX = offsetX

  // Place 2-3 trees near the sides.
  for (let i = 0; i < 3; i += 1) {
    const x = randInt(
      rng,
      Math.floor(stageLeftX + stageWidthPx * 0.08),
      Math.floor(stageLeftX + stageWidthPx * 0.92),
    )
    if (isNearSpawn(x)) continue

    const key = pickOne(rng, [
      STAGE_OBJECT_KEYS.TREE_1,
      STAGE_OBJECT_KEYS.TREE_2,
      STAGE_OBJECT_KEYS.TREE_3,
    ])

    add({
      key,
      x,
      y: groundTopY,
      depth: -5,
      scale: 0.7,
    })
  }

  // Place a few small props (crate / stone / mushrooms) closer to the camera.
  const propCount = clampInt(Math.floor(widthTiles / 12), 2, 6)
  for (let i = 0; i < propCount; i += 1) {
    const x = randInt(
      rng,
      Math.floor(stageLeftX + stageWidthPx * 0.12),
      Math.floor(stageLeftX + stageWidthPx * 0.88),
    )
    if (isNearSpawn(x)) continue

    const key = pickOne(rng, [
      STAGE_OBJECT_KEYS.CRATE,
      STAGE_OBJECT_KEYS.STONE,
      STAGE_OBJECT_KEYS.MUSHROOM_1,
      STAGE_OBJECT_KEYS.MUSHROOM_2,
      STAGE_OBJECT_KEYS.SIGN_1,
      STAGE_OBJECT_KEYS.SIGN_2,
    ])

    add({
      key,
      x,
      y: groundTopY,
      depth: 8,
      scale: 0.9,
    })
  }

  return decorations
}

function placeClassicPlatforms(grid, { widthTiles, heightTiles }) {
  // This mirrors the original rectangle-platform layout used in the MVP.
  // (Two side platforms + one central top platform.)
  placeSymmetricPlatformPair(grid, {
    widthTiles,
    heightTiles,
    y: clampInt(heightTiles - 6, 2, heightTiles - 4),
    length: 8,
    variant: 'normal',
  })

  placeCenteredPlatform(grid, {
    widthTiles,
    y: clampInt(heightTiles - 9, 2, heightTiles - 5),
    length: 6,
    variant: 'normal',
  })
}

function placeSkyPlatforms(grid, { widthTiles, heightTiles }) {
  // Same geometry as classic, but uses one-way cloud tiles for platforms.
  placeSymmetricPlatformPair(grid, {
    widthTiles,
    heightTiles,
    y: clampInt(heightTiles - 6, 2, heightTiles - 4),
    length: 8,
    variant: 'cloud',
  })

  placeCenteredPlatform(grid, {
    widthTiles,
    y: clampInt(heightTiles - 9, 2, heightTiles - 5),
    length: 6,
    variant: 'cloud',
  })
}

function placeBoxArena(grid, { widthTiles, heightTiles, rng }) {
  // This layout adds simple obstacle pillars to encourage positioning around cover.
  // We still keep symmetry to avoid biasing either side.
  const baseY = heightTiles - 1
  const pillarHeight = clampInt(randInt(rng, 2, 4), 2, 5)

  // Two symmetric pillars.
  placePillar(grid, { x: 6, baseY, height: pillarHeight, tileIndex: TILE.BRICK })
  placePillar(grid, { x: widthTiles - 7, baseY, height: pillarHeight, tileIndex: TILE.BRICK })

  // Add a mid platform and a top platform so vertical chasing still matters.
  placeSymmetricPlatformPair(grid, {
    widthTiles,
    heightTiles,
    y: clampInt(heightTiles - 7, 3, heightTiles - 5),
    length: 7,
    variant: rng() < 0.5 ? 'wood' : 'normal',
  })

  placeCenteredPlatform(grid, {
    widthTiles,
    y: clampInt(heightTiles - 10, 2, heightTiles - 6),
    length: 5,
    variant: rng() < 0.5 ? 'normal' : 'cloud',
  })
}

// ---- Tile placement helpers ----

function createEmptyGrid(widthTiles, heightTiles) {
  // Fill with -1 which Phaser interprets as empty tile.
  const grid = []
  for (let y = 0; y < heightTiles; y += 1) {
    const row = new Array(widthTiles)
    row.fill(-1)
    grid.push(row)
  }
  return grid
}

function addGroundRow(grid, y) {
  // Fill the entire row with the ground-top tile.
  // (We keep it simple; later we can add more decorative ground layers.)
  for (let x = 0; x < grid[y].length; x += 1) grid[y][x] = TILE.GROUND_TOP
}

function placePillar(grid, { x, baseY, height, tileIndex }) {
  // Create a vertical column of solid blocks ending at `baseY - 1` (above ground).
  for (let dy = 1; dy <= height; dy += 1) {
    const y = baseY - dy
    if (y < 0) break
    if (x < 0 || x >= grid[y].length) continue
    grid[y][x] = tileIndex
  }
}

function placeCenteredPlatform(grid, { widthTiles, y, length, variant }) {
  const startX = Math.floor(widthTiles / 2 - length / 2)
  placePlatform(grid, { x: startX, y, length, variant })
}

function placeSymmetricPlatformPair(grid, { widthTiles, heightTiles, y, length, variant }) {
  // Keep platforms inside the "safe" region away from the edges.
  const minPadding = 3

  const leftX = clampInt(4, minPadding, widthTiles - minPadding - length)
  const rightX = widthTiles - minPadding - length - (leftX - minPadding)

  const clampedY = clampInt(y, 1, heightTiles - 2)

  placePlatform(grid, { x: leftX, y: clampedY, length, variant })
  placePlatform(grid, { x: rightX, y: clampedY, length, variant })
}

function placePlatform(grid, { x, y, length, variant }) {
  // Bounds checks so generation never throws.
  if (y < 0 || y >= grid.length) return
  if (length <= 0) return

  const row = grid[y]
  const start = clampInt(x, 0, row.length - 1)
  const end = clampInt(x + length - 1, 0, row.length - 1)

  // Choose which tile indices represent this platform style.
  const tiles = getPlatformTilesByVariant(variant)

  // If the platform gets truncated by bounds, we still draw it safely.
  for (let tx = start; tx <= end; tx += 1) {
    const isLeft = tx === start
    const isRight = tx === end

    // Single-tile platform uses the "middle" tile.
    if (isLeft && isRight) row[tx] = tiles.middle
    else if (isLeft) row[tx] = tiles.left
    else if (isRight) row[tx] = tiles.right
    else row[tx] = tiles.middle
  }
}

function getPlatformTilesByVariant(variant) {
  // `variant` is a tiny style selector so we can reuse the same geometry with different art.
  const v = String(variant ?? 'normal')

  if (v === 'cloud') {
    return {
      left: TILE.CLOUD_PLATFORM,
      middle: TILE.CLOUD_PLATFORM,
      right: TILE.CLOUD_PLATFORM,
    }
  }

  if (v === 'wood') {
    return {
      left: TILE.BLOCK_WOOD,
      middle: TILE.BLOCK_WOOD,
      right: TILE.BLOCK_WOOD,
    }
  }

  // Default "normal platform" uses the platform edge/middle tiles.
  return {
    left: TILE.PLATFORM_LEFT,
    middle: TILE.PLATFORM_MIDDLE,
    right: TILE.PLATFORM_RIGHT,
  }
}

// ---- RNG helpers ----

function normalizeSeed(seed) {
  // If the user provides nothing, we generate a random seed (based on time).
  if (seed == null || seed === '') {
    const seedInt = Date.now() >>> 0
    return { seedInt, seedLabel: String(seedInt) }
  }

  // If the user provides a number, clamp to uint32.
  if (typeof seed === 'number' && Number.isFinite(seed)) {
    const seedInt = seed >>> 0
    return { seedInt, seedLabel: String(seedInt) }
  }

  // Otherwise treat as string (stable hash).
  const seedLabel = String(seed)
  const seedInt = fnv1a32(seedLabel)
  return { seedInt, seedLabel }
}

function createMulberry32(seed) {
  // Mulberry32 is a small fast deterministic PRNG for gameplay/content generation.
  let t = seed >>> 0
  return function next() {
    t += 0x6d2b79f5
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r)
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

function fnv1a32(str) {
  // FNV-1a 32-bit hash (deterministic, simple, good enough for seeds).
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

function randInt(rng, minInclusive, maxInclusive) {
  const min = Math.ceil(minInclusive)
  const max = Math.floor(maxInclusive)
  return Math.floor(rng() * (max - min + 1)) + min
}

function clampInt(value, min, max) {
  return Math.max(min, Math.min(max, Math.floor(value)))
}

function pickOne(rng, items) {
  const idx = clampInt(Math.floor(rng() * items.length), 0, items.length - 1)
  return items[idx]
}
