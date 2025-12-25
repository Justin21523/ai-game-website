// Platform graph utilities (MVP).
//
// Goal:
// - Give AI a simple "map" of platforms so it can chase vertically (up/down platforms).
//
// What this is NOT (yet):
// - A full physics-accurate path planner
// - A* with jump arcs
//
// Instead we build a small graph where nodes are platforms and edges represent
// "likely reachable" moves based on approximate jump height and horizontal drift.

// Convert a Phaser rectangle-like platform into a plain node object.
export function buildPlatformNodes(platformObjects) {
  return platformObjects.map((p, id) => {
    const width = Number(p.width ?? 0)
    const height = Number(p.height ?? 0)

    const x = Number(p.x ?? 0)
    const y = Number(p.y ?? 0)

    const left = x - width / 2
    const right = x + width / 2
    const top = y - height / 2
    const bottom = y + height / 2

    return {
      id,
      left,
      right,
      top,
      bottom,
      centerX: x,
      width,
      height,
      // Optional platform metadata used by AI.
      // - oneWay surfaces support "drop-through" navigation.
      oneWay: Boolean(p.oneWay),
    }
  })
}

// Build directed edges between platforms.
// - Upward edges require jump ability (height + horizontal reach).
// - Downward edges are easier (walk off + fall), so they are more permissive.
export function buildPlatformGraph(platformNodes, { maxJumpHeight, maxJumpDistance }) {
  const edges = new Map()
  for (const node of platformNodes) edges.set(node.id, [])

  for (const from of platformNodes) {
    for (const to of platformNodes) {
      if (from.id === to.id) continue

      const dx = Math.abs(to.centerX - from.centerX)

      // Positive means "to is higher" because y increases downward.
      const rise = from.top - to.top

      // Upward travel: limited by jump height and a conservative horizontal reach.
      if (rise > 0) {
        if (rise <= maxJumpHeight && dx <= maxJumpDistance) edges.get(from.id).push(to.id)
        continue
      }

      // Downward travel: you can usually walk off and fall while drifting.
      // We allow a longer horizontal reach because falling gives more time.
      if (dx <= maxJumpDistance * 1.8) edges.get(from.id).push(to.id)
    }
  }

  return { nodes: platformNodes, edges }
}

// Find the platform id a fighter is currently standing on.
// We use geometry + an onGround flag to avoid expensive collision queries.
export function getPlatformIdForFighter({
  x,
  y,
  displayHeight,
  onGround,
  platformNodes,
  epsilonPx = 10,
}) {
  if (!onGround) return null

  const feetY = y + displayHeight / 2

  let best = null
  let bestDist = Infinity

  for (const p of platformNodes) {
    // Must be horizontally above the platform.
    if (x < p.left || x > p.right) continue

    // Must be close to the top surface.
    const dist = Math.abs(feetY - p.top)
    if (dist > epsilonPx) continue

    if (dist < bestDist) {
      bestDist = dist
      best = p.id
    }
  }

  return best
}

// Simple BFS path on the platform graph (small graphs only).
export function findPlatformPath(graph, startId, goalId) {
  if (startId == null || goalId == null) return null
  if (startId === goalId) return [startId]

  const queue = [startId]
  const cameFrom = new Map([[startId, null]])

  while (queue.length) {
    const current = queue.shift()
    const neighbors = graph.edges.get(current) ?? []

    for (const next of neighbors) {
      if (cameFrom.has(next)) continue
      cameFrom.set(next, current)
      if (next === goalId) return reconstructPath(cameFrom, startId, goalId)
      queue.push(next)
    }
  }

  return null
}

function reconstructPath(cameFrom, startId, goalId) {
  const path = [goalId]
  let current = goalId
  while (current !== startId) {
    current = cameFrom.get(current)
    if (current == null) return null
    path.push(current)
  }
  path.reverse()
  return path
}
