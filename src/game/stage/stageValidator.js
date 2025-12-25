// Stage validation for procedural generation.
//
// Why this exists:
// - Procedural stages can occasionally generate "bad" layouts:
//   - spawn has no platform below → fighters fall forever
//   - left/right spawns are on disconnected platform islands → cannot reach each other
// - For AI-vs-AI watching (and for deterministic replay regression testing),
//   we want every generated stage to be playable.
//
// This module is intentionally pure:
// - no Phaser imports
// - no scene state
// - easy to unit-test later if desired

import { findPlatformPath } from './platformGraph.js'

export function validateBrawlStage({
  platformNodes,
  platformGraph,
  spawns,
  minPlatforms = 2,
} = {}) {
  const errors = []

  // Basic sanity: we need at least a couple of platforms.
  if (!Array.isArray(platformNodes) || platformNodes.length < minPlatforms) {
    errors.push(`PLATFORMS_TOO_FEW:${platformNodes?.length ?? 0}`)
    return { ok: false, errors, spawnPlatformIds: { left: null, right: null } }
  }

  // Find which platform each spawn will land on (nearest platform below the spawn point).
  const leftSpawn = spawns?.left
  const rightSpawn = spawns?.right

  const leftId = leftSpawn
    ? findNearestPlatformBelowPoint({
        platformNodes,
        x: leftSpawn.x,
        y: leftSpawn.y,
      })
    : null

  const rightId = rightSpawn
    ? findNearestPlatformBelowPoint({
        platformNodes,
        x: rightSpawn.x,
        y: rightSpawn.y,
      })
    : null

  if (leftId == null) errors.push('SPAWN_LEFT_NO_PLATFORM_BELOW')
  if (rightId == null) errors.push('SPAWN_RIGHT_NO_PLATFORM_BELOW')

  if (leftId == null || rightId == null) {
    return { ok: false, errors, spawnPlatformIds: { left: leftId, right: rightId } }
  }

  // Connectivity:
  // We require reachability in *both* directions because the platform graph is directed.
  // (Upward edges are stricter than downward edges.)
  const leftToRight = findPlatformPath(platformGraph, leftId, rightId)
  if (!leftToRight) errors.push('NO_PATH_LEFT_TO_RIGHT')

  const rightToLeft = findPlatformPath(platformGraph, rightId, leftId)
  if (!rightToLeft) errors.push('NO_PATH_RIGHT_TO_LEFT')

  return {
    ok: errors.length === 0,
    errors,
    spawnPlatformIds: { left: leftId, right: rightId },
  }
}

export function findNearestPlatformBelowPoint({
  platformNodes,
  x,
  y,
  epsilonPx = 8,
  maxDropPx = Infinity,
} = {}) {
  // Returns the platform id whose top surface is:
  // - horizontally covering the point (x)
  // - below the point (y)
  // - and closest in vertical distance.
  //
  // This approximates where a fighter would land if spawned at (x, y).
  if (!Array.isArray(platformNodes) || !platformNodes.length) return null

  const px = Number(x ?? 0)
  const py = Number(y ?? 0)

  let bestId = null
  let bestDrop = Infinity

  for (const p of platformNodes) {
    if (!p) continue

    // Must be horizontally above the platform.
    if (px < p.left || px > p.right) continue

    // Platform top must be below (or very slightly above) the point.
    const drop = p.top - py
    if (drop < -epsilonPx) continue
    if (drop > maxDropPx) continue

    if (drop < bestDrop) {
      bestDrop = drop
      bestId = p.id
    }
  }

  return bestId
}

