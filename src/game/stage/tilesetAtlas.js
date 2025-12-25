// Tileset atlas builder for Phaser Tilemap.
//
// Why this exists:
// - The project currently has a "collection of tile images" under `/assets/freetileset/png/Tiles/`.
// - Phaser Tilemap works best with a *single* tileset texture (a grid of tiles).
// - So we load the 18 source images, then draw them into a small canvas texture atlas.
//
// Result:
// - We can create Tilemaps with `tileWidth = tileHeight = 32` (or other sizes later).
// - We keep the original art (128px) but downscale into the atlas for performance and consistency.

import TILESET_META from '../../../assets/tileset.json'

// ---- Background layers (optional) ----
// These are simple parallax-like PNGs provided in `/assets/background/`.
import BG_LAYER_1_URL from '../../../assets/background/layer-1.png'
import BG_LAYER_2_URL from '../../../assets/background/layer-2.png'
import BG_LAYER_3_URL from '../../../assets/background/layer-3.png'
import BG_LAYER_4_URL from '../../../assets/background/layer-4.png'

// ---- Stage object sprites (optional) ----
// Large decorative sprites (trees, crates...) provided in `/assets/freetileset/png/Object/`.
import OBJ_CRATE_URL from '../../../assets/freetileset/png/Object/Crate.png'
import OBJ_MUSHROOM_1_URL from '../../../assets/freetileset/png/Object/Mushroom_1.png'
import OBJ_MUSHROOM_2_URL from '../../../assets/freetileset/png/Object/Mushroom_2.png'
import OBJ_SIGN_1_URL from '../../../assets/freetileset/png/Object/Sign_1.png'
import OBJ_SIGN_2_URL from '../../../assets/freetileset/png/Object/Sign_2.png'
import OBJ_STONE_URL from '../../../assets/freetileset/png/Object/Stone.png'
import OBJ_TREE_1_URL from '../../../assets/freetileset/png/Object/Tree_1.png'
import OBJ_TREE_2_URL from '../../../assets/freetileset/png/Object/Tree_2.png'
import OBJ_TREE_3_URL from '../../../assets/freetileset/png/Object/Tree_3.png'

// ---- Tile source images (1..18) ----
// IMPORTANT: Keep these as explicit imports so Vite can include them in the build output.
import TILE_1_URL from '../../../assets/freetileset/png/Tiles/1.png'
import TILE_2_URL from '../../../assets/freetileset/png/Tiles/2.png'
import TILE_3_URL from '../../../assets/freetileset/png/Tiles/3.png'
import TILE_4_URL from '../../../assets/freetileset/png/Tiles/4.png'
import TILE_5_URL from '../../../assets/freetileset/png/Tiles/5.png'
import TILE_6_URL from '../../../assets/freetileset/png/Tiles/6.png'
import TILE_7_URL from '../../../assets/freetileset/png/Tiles/7.png'
import TILE_8_URL from '../../../assets/freetileset/png/Tiles/8.png'
import TILE_9_URL from '../../../assets/freetileset/png/Tiles/9.png'
import TILE_10_URL from '../../../assets/freetileset/png/Tiles/10.png'
import TILE_11_URL from '../../../assets/freetileset/png/Tiles/11.png'
import TILE_12_URL from '../../../assets/freetileset/png/Tiles/12.png'
import TILE_13_URL from '../../../assets/freetileset/png/Tiles/13.png'
import TILE_14_URL from '../../../assets/freetileset/png/Tiles/14.png'
import TILE_15_URL from '../../../assets/freetileset/png/Tiles/15.png'
import TILE_16_URL from '../../../assets/freetileset/png/Tiles/16.png'
import TILE_17_URL from '../../../assets/freetileset/png/Tiles/17.png'
import TILE_18_URL from '../../../assets/freetileset/png/Tiles/18.png'

// A stable texture key used by the combined tileset atlas.
export const TILESET_ATLAS_KEY = 'tileset-atlas'

// Tilemaps treat tile indices as 0-based indices into the tileset image grid.
// Our tileset meta uses 1..18 IDs, so the conversion is: tileIndex = tileNumber - 1.
export const TILE_COUNT = 18

// We keep the in-game tile size small so the stage fits nicely in 960x540.
// The atlas builder will downscale 128px art to this size.
export const DEFAULT_TILE_SIZE_PX = 32

// Background texture keys (kept stable for re-use across scene rebuilds).
export const BACKGROUND_KEYS = {
  LAYER_1: 'bg-layer-1',
  LAYER_2: 'bg-layer-2',
  LAYER_3: 'bg-layer-3',
  LAYER_4: 'bg-layer-4',
}

// Object sprite texture keys (kept stable for deterministic stage generation).
export const STAGE_OBJECT_KEYS = {
  CRATE: 'obj-crate',
  MUSHROOM_1: 'obj-mushroom-1',
  MUSHROOM_2: 'obj-mushroom-2',
  SIGN_1: 'obj-sign-1',
  SIGN_2: 'obj-sign-2',
  STONE: 'obj-stone',
  TREE_1: 'obj-tree-1',
  TREE_2: 'obj-tree-2',
  TREE_3: 'obj-tree-3',
}

// Tile source texture key prefix.
const TILE_SOURCE_KEY_PREFIX = 'tile-src-'

// Provide the list of tile source URLs in 1-based order.
const TILE_SOURCE_URLS = [
  TILE_1_URL,
  TILE_2_URL,
  TILE_3_URL,
  TILE_4_URL,
  TILE_5_URL,
  TILE_6_URL,
  TILE_7_URL,
  TILE_8_URL,
  TILE_9_URL,
  TILE_10_URL,
  TILE_11_URL,
  TILE_12_URL,
  TILE_13_URL,
  TILE_14_URL,
  TILE_15_URL,
  TILE_16_URL,
  TILE_17_URL,
  TILE_18_URL,
]

// Preload all stage assets used by BattleScene.
// This should be called from `BattleScene.preload()`.
export function preloadStageAssets(scene) {
  // ---- Background ----
  // These are optional; if you don't use them, they still remain cached and harmless.
  scene.load.image(BACKGROUND_KEYS.LAYER_1, BG_LAYER_1_URL)
  scene.load.image(BACKGROUND_KEYS.LAYER_2, BG_LAYER_2_URL)
  scene.load.image(BACKGROUND_KEYS.LAYER_3, BG_LAYER_3_URL)
  scene.load.image(BACKGROUND_KEYS.LAYER_4, BG_LAYER_4_URL)

  // ---- Large object sprites (non-colliding decorations) ----
  scene.load.image(STAGE_OBJECT_KEYS.CRATE, OBJ_CRATE_URL)
  scene.load.image(STAGE_OBJECT_KEYS.MUSHROOM_1, OBJ_MUSHROOM_1_URL)
  scene.load.image(STAGE_OBJECT_KEYS.MUSHROOM_2, OBJ_MUSHROOM_2_URL)
  scene.load.image(STAGE_OBJECT_KEYS.SIGN_1, OBJ_SIGN_1_URL)
  scene.load.image(STAGE_OBJECT_KEYS.SIGN_2, OBJ_SIGN_2_URL)
  scene.load.image(STAGE_OBJECT_KEYS.STONE, OBJ_STONE_URL)
  scene.load.image(STAGE_OBJECT_KEYS.TREE_1, OBJ_TREE_1_URL)
  scene.load.image(STAGE_OBJECT_KEYS.TREE_2, OBJ_TREE_2_URL)
  scene.load.image(STAGE_OBJECT_KEYS.TREE_3, OBJ_TREE_3_URL)

  // ---- Tiles ----
  // Load each tile image as a normal Phaser texture.
  // We will later draw them into a single atlas canvas texture.
  for (let tileNumber = 1; tileNumber <= TILE_COUNT; tileNumber += 1) {
    const url = TILE_SOURCE_URLS[tileNumber - 1]
    scene.load.image(getTileSourceKey(tileNumber), url)
  }
}

// Build (or reuse) a canvas-based tileset atlas texture.
//
// How it works:
// - Create a small canvas texture sized to fit `tileCount` tiles.
// - Draw each 128px tile image into a `tileSizePx` cell (downscaling).
// - Refresh the texture so Tilemap can use it.
export function ensureTilesetAtlas(
  scene,
  { tileSizePx = DEFAULT_TILE_SIZE_PX, columns = 6 } = {},
) {
  // If the atlas already exists, do nothing.
  if (scene.textures.exists(TILESET_ATLAS_KEY)) {
    return {
      atlasKey: TILESET_ATLAS_KEY,
      tileSizePx,
      columns,
      rows: Math.ceil(TILE_COUNT / columns),
    }
  }

  // Compute atlas dimensions.
  const rows = Math.ceil(TILE_COUNT / columns)
  const atlasWidthPx = columns * tileSizePx
  const atlasHeightPx = rows * tileSizePx

  // Create the canvas texture that will contain the whole tileset.
  const atlas = scene.textures.createCanvas(TILESET_ATLAS_KEY, atlasWidthPx, atlasHeightPx)
  const ctx = atlas.getContext()

  // Disable smoothing so downscaled pixel art stays crisp.
  // (Even though these tiles are not pure pixel art, crisp sampling is usually preferred for tiles.)
  ctx.imageSmoothingEnabled = false

  // Draw each tile into the correct cell.
  for (let tileNumber = 1; tileNumber <= TILE_COUNT; tileNumber += 1) {
    const srcKey = getTileSourceKey(tileNumber)

    // The tile must have been preloaded, otherwise `getSourceImage()` will fail.
    const srcTexture = scene.textures.get(srcKey)
    const srcImage = srcTexture?.getSourceImage?.()
    if (!srcImage) continue

    // Convert tileNumber to a 0-based tile index.
    const tileIndex = tileNumber - 1

    // Compute the atlas cell position (in pixels).
    const col = tileIndex % columns
    const row = Math.floor(tileIndex / columns)
    const dx = col * tileSizePx
    const dy = row * tileSizePx

    // Draw the source image into the atlas cell (scaled down to tileSizePx).
    ctx.drawImage(srcImage, 0, 0, srcImage.width, srcImage.height, dx, dy, tileSizePx, tileSizePx)
  }

  // Commit canvas pixels to the Phaser texture manager.
  atlas.refresh()

  return { atlasKey: TILESET_ATLAS_KEY, tileSizePx, columns, rows }
}

// Convert the 1-based tile id in `assets/tileset.json` to Phaser's 0-based tile index.
export function toTileIndex(tileNumber) {
  return Number(tileNumber) - 1
}

// Compute collision sets from the canonical tileset metadata file.
// This keeps "what is solid/one-way" in sync with `/assets/tileset.json`.
export function getTilesetCollisionSets() {
  const solid = []
  const oneWay = []

  for (const [tileId, tileDef] of Object.entries(TILESET_META.tiles ?? {})) {
    const index = toTileIndex(tileId)

    // Defensive checks: ignore invalid entries.
    if (!Number.isFinite(index) || index < 0) continue

    if (tileDef?.solid) solid.push(index)
    if (tileDef?.oneWay) oneWay.push(index)
  }

  return {
    solid,
    oneWay,
  }
}

// A tiny helper to keep texture keys consistent across the codebase.
export function getTileSourceKey(tileNumber) {
  return `${TILE_SOURCE_KEY_PREFIX}${String(tileNumber)}`
}
