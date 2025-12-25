// Player character sprite + animation helpers.
//
// Goal:
// - Use the existing sprite frame folders under `/assets/sprites/player/`
// - Load frames via Phaser's Loader
// - Create Phaser animations with stable keys
//
// Notes:
// - These sprites are *visual-only* in this project.
// - The physics / hurtbox / hitbox logic still lives in `Fighter` (using a simple rectangle).

// ---- Vite-powered frame URL discovery ----
// Vite will turn each imported PNG into a URL string.
// We use `import.meta.glob(..., { eager: true, import: 'default' })` to get them all at build time.
const DOG_FRAMES = {
  idle: import.meta.glob('../../../assets/sprites/player/Dog/idle/*.png', {
    eager: true,
    import: 'default',
  }),
  run: import.meta.glob('../../../assets/sprites/player/Dog/run/*.png', {
    eager: true,
    import: 'default',
  }),
  jump: import.meta.glob('../../../assets/sprites/player/Dog/jump/*.png', {
    eager: true,
    import: 'default',
  }),
  fall: import.meta.glob('../../../assets/sprites/player/Dog/fall/*.png', {
    eager: true,
    import: 'default',
  }),
  hurt: import.meta.glob('../../../assets/sprites/player/Dog/hurt/*.png', {
    eager: true,
    import: 'default',
  }),
  slide: import.meta.glob('../../../assets/sprites/player/Dog/slide/*.png', {
    eager: true,
    import: 'default',
  }),
  dead: import.meta.glob('../../../assets/sprites/player/Dog/dead/*.png', {
    eager: true,
    import: 'default',
  }),
}

const CAT_FRAMES = {
  idle: import.meta.glob('../../../assets/sprites/player/Cat/idle/*.png', {
    eager: true,
    import: 'default',
  }),
  run: import.meta.glob('../../../assets/sprites/player/Cat/run/*.png', {
    eager: true,
    import: 'default',
  }),
  jump: import.meta.glob('../../../assets/sprites/player/Cat/jump/*.png', {
    eager: true,
    import: 'default',
  }),
  fall: import.meta.glob('../../../assets/sprites/player/Cat/fall/*.png', {
    eager: true,
    import: 'default',
  }),
  hurt: import.meta.glob('../../../assets/sprites/player/Cat/hurt/*.png', {
    eager: true,
    import: 'default',
  }),
  slide: import.meta.glob('../../../assets/sprites/player/Cat/slide/*.png', {
    eager: true,
    import: 'default',
  }),
  dead: import.meta.glob('../../../assets/sprites/player/Cat/dead/*.png', {
    eager: true,
    import: 'default',
  }),
}

// Character ids are string constants so they can be passed around easily.
export const PLAYER_CHARACTER = {
  DOG: 'dog',
  CAT: 'cat',
}

// A stable prefix for all frame texture keys (Phaser Texture Manager keys).
const FRAME_KEY_PREFIX = 'player-frame'

// A stable prefix for all animation keys (Phaser Animation Manager keys).
const ANIM_KEY_PREFIX = 'player-anim'

// Central mapping so we can iterate characters/actions consistently.
const CHARACTER_FRAME_SOURCES = {
  [PLAYER_CHARACTER.DOG]: DOG_FRAMES,
  [PLAYER_CHARACTER.CAT]: CAT_FRAMES,
}

// Preload all player character frames needed for animation.
// Call from `BattleScene.preload()`.
export function preloadPlayerCharacters(scene) {
  // We load every frame as an individual texture.
  // This keeps the implementation straightforward and avoids a complex atlas build step.
  for (const characterId of Object.keys(CHARACTER_FRAME_SOURCES)) {
    const sources = CHARACTER_FRAME_SOURCES[characterId]
    for (const action of Object.keys(sources)) {
      const frames = sortFrameUrlsByNumber(sources[action])
      frames.forEach((url, index) => {
        // Frame numbers are 1-based to match the original file naming convention.
        const frameNumber = index + 1
        scene.load.image(getFrameKey({ characterId, action, frameNumber }), url)
      })
    }
  }
}

// Ensure Phaser animations exist (safe to call multiple times).
// Call from `BattleScene.create()` after preload.
export function ensurePlayerAnimations(scene) {
  // Animation definitions for each action.
  const actionConfig = {
    idle: { frameRate: 10, repeat: -1 },
    run: { frameRate: 14, repeat: -1 },
    jump: { frameRate: 14, repeat: 0 },
    fall: { frameRate: 14, repeat: -1 },
    hurt: { frameRate: 12, repeat: 0 },
    slide: { frameRate: 16, repeat: 0 },
    // "Dead" is used for KO pose. We keep it non-looping so it ends on the last frame.
    dead: { frameRate: 12, repeat: 0 },
  }

  for (const characterId of Object.keys(CHARACTER_FRAME_SOURCES)) {
    const sources = CHARACTER_FRAME_SOURCES[characterId]
    for (const action of Object.keys(sources)) {
      const animKey = getAnimKey({ characterId, action })
      if (scene.anims.exists(animKey)) continue

      const urls = sortFrameUrlsByNumber(sources[action])
      const frames = urls.map((_url, index) => ({
        key: getFrameKey({ characterId, action, frameNumber: index + 1 }),
      }))

      const cfg = actionConfig[action] ?? { frameRate: 12, repeat: -1 }
      scene.anims.create({
        key: animKey,
        frames,
        frameRate: cfg.frameRate,
        repeat: cfg.repeat,
      })
    }
  }
}

// ---- Key helpers ----

export function getFrameKey({ characterId, action, frameNumber }) {
  // Example: player-frame:dog:run:3
  return `${FRAME_KEY_PREFIX}:${characterId}:${action}:${String(frameNumber)}`
}

export function getAnimKey({ characterId, action }) {
  // Example: player-anim:dog:run
  return `${ANIM_KEY_PREFIX}:${characterId}:${action}`
}

export function getDefaultIdleFrameKey(characterId) {
  // Use the first idle frame as the initial texture for the visual sprite.
  return getFrameKey({ characterId, action: 'idle', frameNumber: 1 })
}

// Provide simple frame-count stats for debugging / UI.
// This does NOT touch Phaser; it only inspects the Vite glob maps.
export function getCharacterFrameStats() {
  const stats = {}

  for (const characterId of Object.keys(CHARACTER_FRAME_SOURCES)) {
    const sources = CHARACTER_FRAME_SOURCES[characterId] ?? {}
    stats[characterId] = {}

    for (const action of Object.keys(sources)) {
      // Each glob map key is a filepath; value is the resolved URL string.
      stats[characterId][action] = Object.keys(sources[action] ?? {}).length
    }
  }

  return stats
}

// ---- Internal helpers ----

function sortFrameUrlsByNumber(globMap) {
  // `globMap` is an object: { filepath: urlString }.
  // We sort by the trailing "(N).png" number so animation frames play in the correct order.
  const entries = Object.entries(globMap ?? {})

  entries.sort(([pathA], [pathB]) => {
    const a = extractFrameNumber(pathA)
    const b = extractFrameNumber(pathB)
    if (a !== b) return a - b
    return pathA.localeCompare(pathB)
  })

  return entries.map(([, url]) => url)
}

function extractFrameNumber(path) {
  // Typical file names are like "Idle(10).png" or "Run(3).png".
  const match = String(path).match(/\((\d+)\)\.png$/i)
  if (!match) return Number.MAX_SAFE_INTEGER
  return Number(match[1] ?? Number.MAX_SAFE_INTEGER)
}
