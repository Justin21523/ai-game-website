// Platform-brawl specific Behavior Tree builder.
//
// This file defines the "leaf node vocabulary" (conditions/actions) that the BT JSON can use.
// The BT runtime itself is generic and lives under src/game/ai/bt/runtime.js.

import Phaser from 'phaser'

import { MOVES } from '../combat/moves.js'
import { findPlatformPath, getPlatformIdForFighter } from '../stage/platformGraph.js'
import { BT_STATUS, buildBtTreeFromJson, LeafNode } from './bt/runtime.js'
import { DEFAULT_BT_JSON } from './defaultBt.js'

// Parse a BT JSON string with a safe fallback.
export function parseBtJsonText(btJsonText) {
  if (!btJsonText) return DEFAULT_BT_JSON

  try {
    const parsed = JSON.parse(btJsonText)
    // The runtime will validate shape further; we only ensure "object-ish" here.
    return parsed && typeof parsed === 'object' ? parsed : DEFAULT_BT_JSON
  } catch {
    return DEFAULT_BT_JSON
  }
}

// Build a BT tree for this game from a JSON object.
export function createPlatformBrawlBtTree(btJsonObject) {
  // Factories create LeafNode instances. Each instance must be independent per agent.
  const leafFactories = {
    // ---- Conditions ----
    IsOffstage: () =>
      new LeafNode({
        name: 'IsOffstage',
        fn: (ctx) => (isOffstage(ctx) ? BT_STATUS.SUCCESS : BT_STATUS.FAILURE),
      }),

    IsTargetAttacking: () =>
      new LeafNode({
        name: 'IsTargetAttacking',
        fn: (ctx) => {
          const ok = isTargetAttacking(ctx)
          if (ok && ctx.reasons) ctx.reasons.push('TARGET_ATTACKING')
          return ok ? BT_STATUS.SUCCESS : BT_STATUS.FAILURE
        },
      }),

    IsTargetRecovering: () =>
      new LeafNode({
        name: 'IsTargetRecovering',
        fn: (ctx) => {
          const ok = isTargetRecovering(ctx)
          if (ok && ctx.reasons) ctx.reasons.push('TARGET_RECOVERING')
          return ok ? BT_STATUS.SUCCESS : BT_STATUS.FAILURE
        },
      }),

    IsTargetInHitstun: () =>
      new LeafNode({
        name: 'IsTargetInHitstun',
        fn: (ctx) => {
          const ok = isTargetInHitstun(ctx)
          if (ok && ctx.reasons) ctx.reasons.push('TARGET_IN_HITSTUN')
          return ok ? BT_STATUS.SUCCESS : BT_STATUS.FAILURE
        },
      }),

    CanAttack: (params) =>
      new LeafNode({
        name: `CanAttack(${String(params.kind)})`,
        fn: (ctx) => (canAttack(ctx, params) ? BT_STATUS.SUCCESS : BT_STATUS.FAILURE),
      }),

    IsInRange: (params) =>
      new LeafNode({
        name: `IsInRange(${String(params.kind)})`,
        fn: (ctx) => (isInRange(ctx, params) ? BT_STATUS.SUCCESS : BT_STATUS.FAILURE),
      }),

    // ---- Actions ----
    RecoverToStage: () =>
      new LeafNode({
        name: 'RecoverToStage',
        fn: (ctx) => {
          recoverToStage(ctx)
          return BT_STATUS.RUNNING
        },
      }),

    // Keep a desired spacing band.
    // This is a common "neutral game" primitive in fighting games.
    KeepDistance: (params) =>
      new LeafNode({
        name: `KeepDistance(min=${Number(params.min)}, max=${Number(params.max)})`,
        fn: (ctx) => keepDistance(ctx, params),
      }),

    // Micro-movement / footsies: strafe for a short duration to look less robotic.
    Strafe: (params) =>
      new LeafNode({
        name: `Strafe(${String(params?.dir ?? 'auto')})`,
        fn: (ctx) => strafe(ctx, params),
      }),

    // Approach is a lighter-weight chase helper than full navigation.
    // It returns SUCCESS when we are within a configurable horizontal distance.
    Approach: (params) =>
      new LeafNode({
        name: `Approach(${Number(params?.distance ?? 120)}px)`,
        fn: (ctx) => approach(ctx, params),
      }),

    // Defensive reaction: if the opponent is mid-attack and we are close, back off or jump.
    // This leaf returns SUCCESS only when it actually triggers an evade.
    Evade: () =>
      new LeafNode({
        name: 'Evade',
        fn: (ctx) => evade(ctx),
      }),

    // Whiff punish / punish recovery:
    // If the opponent is in recovery, approach and try to land a heavy hit.
    // Returns RUNNING while closing distance, SUCCESS when the punish attack is issued.
    Punish: () =>
      new LeafNode({
        name: 'Punish',
        fn: (ctx) => punish(ctx),
      }),

    MoveToTargetX: () =>
      new LeafNode({
        name: 'MoveToTargetX',
        fn: (ctx) => moveToTargetX(ctx),
      }),

    LightAttack: () =>
      new LeafNode({
        name: 'LightAttack',
        fn: (ctx) => {
          ctx.intent.attackPressed = 'light'
          if (ctx.reasons) ctx.reasons.push('ATTACK_LIGHT')
          return BT_STATUS.SUCCESS
        },
      }),

    HeavyAttack: () =>
      new LeafNode({
        name: 'HeavyAttack',
        fn: (ctx) => {
          ctx.intent.attackPressed = 'heavy'
          if (ctx.reasons) ctx.reasons.push('ATTACK_HEAVY')
          return BT_STATUS.SUCCESS
        },
      }),

    // Utility-based attack selection:
    // - scores multiple moves based on distance/height/risk/reward
    // - optionally uses dash to close distance
    // - supports different "modes" via params (neutral/punish/combo)
    UtilityAttack: (params) =>
      new LeafNode({
        name: `UtilityAttack(${String(params?.mode ?? 'neutral')})`,
        fn: (ctx) => utilityAttack(ctx, params),
      }),
  }

  return buildBtTreeFromJson(btJsonObject, leafFactories)
}

// ---- Leaf implementations (game-specific logic) ----

function isOffstage(ctx) {
  const self = ctx.self
  const stage = ctx.stage

  // "Offstage" definition for MVP:
  // if you are far outside the visible play area, you are offstage.
  const margin = stage.offstageMargin ?? 40
  const offBottom = self.y > stage.height + margin
  const offLeft = self.x < -margin
  const offRight = self.x > stage.width + margin

  return offBottom || offLeft || offRight
}

function recoverToStage(ctx) {
  const self = ctx.self
  const stage = ctx.stage

  // Move toward the center.
  const dx = stage.centerX - self.x
  ctx.intent.moveX = Math.abs(dx) > 8 ? Math.sign(dx) : 0

  // If we are below the "safe" zone, try to jump.
  if (self.y > stage.height - 160) ctx.intent.jumpPressed = true

  // Avoid fast-falling while recovering.
  ctx.intent.fastFall = false

  if (ctx.reasons) ctx.reasons.push('RECOVER_TO_STAGE')
}

function isTargetAttacking(ctx) {
  // Treat only startup/active as "threatening".
  // Recovery is usually *punishable*, so we exclude it to avoid "evade during punish windows".
  const phase = ctx.target?.attackState?.phase
  return phase === 'startup' || phase === 'active'
}

function isTargetRecovering(ctx) {
  // Recovery phase is the easiest time to punish in fighting games.
  return ctx.target?.attackState?.phase === 'recovery'
}

function isTargetInHitstun(ctx) {
  // BotAgent stashes this on the blackboard so leaves stay cheap.
  return Boolean(ctx.blackboard?.target?.inHitstun)
}

function canAttack(ctx, params) {
  const kind = String(params.kind)
  const onGround = Boolean(ctx.blackboard?.self?.onGround)
  return ctx.self.canAttack(kind, ctx.nowMs, onGround)
}

function isInRange(ctx, params) {
  const kind = String(params.kind)
  const move = MOVES[kind]
  if (!move) return false

  const self = ctx.self
  const target = ctx.target

  // Predict facing toward the target for range tests.
  const facing = target.x >= self.x ? 1 : -1

  // Compute a "would-be" hitbox if we attacked right now.
  const hitbox = new Phaser.Geom.Rectangle(
    self.x + facing * (move.hitboxOffsetX + move.hitboxWidth / 2) - move.hitboxWidth / 2,
    self.y + move.hitboxOffsetY - move.hitboxHeight / 2,
    move.hitboxWidth,
    move.hitboxHeight,
  )

  const hurtbox = target.getHurtboxRect()
  return Phaser.Geom.Rectangle.Overlaps(hitbox, hurtbox)
}

function moveToTargetX(ctx) {
  const self = ctx.self

  // Prefer a short-horizon prediction for smoother chasing.
  // This helps the bot "lead" slightly instead of oscillating around the exact x position.
  const predicted = getPredictedTargetPosition(ctx)
  const desiredTargetX = predicted.x
  const desiredTargetY = predicted.y

  // If the stage provides a platform graph, prefer platform-aware navigation.
  // This makes the bot much better at "chasing up/down platforms" in platform fighters.
  const platformGraph = ctx.stage.platformGraph
  if (platformGraph?.nodes?.length) {
    const navStatus = moveUsingPlatformGraph(ctx)
    if (navStatus) return navStatus
  }

  // Move toward the target until we are "close enough".
  const dx = desiredTargetX - self.x
  const dy = desiredTargetY - self.y

  ctx.intent.moveX = Math.abs(dx) > 12 ? Math.sign(dx) : 0

  // Optional: dash while chasing when far away (style-dependent).
  const onGround = Boolean(ctx.blackboard?.self?.onGround)
  const profile = ctx.blackboard?.ai?.profile ?? {}
  const dashChance = clampNumber(Number(profile?.dashChance ?? 0.3), 0, 1)
  if (onGround && Math.abs(dx) > 280 && dashChance >= 0.4) {
    ctx.intent.dashPressed = true
    if (ctx.reasons) ctx.reasons.push('DASH_CHASE')
  }

  // Jump if the target is significantly above us (simple platform-chase heuristic).
  if (dy < -70) ctx.intent.jumpPressed = true

  if (ctx.reasons) ctx.reasons.push('MOVE_TO_TARGET')

  // If we are already close, return SUCCESS to allow Sequences to continue.
  return Math.abs(dx) < 22 ? BT_STATUS.SUCCESS : BT_STATUS.RUNNING
}

function moveUsingPlatformGraph(ctx) {
  const self = ctx.self
  const target = ctx.target

  const platformGraph = ctx.stage.platformGraph
  const platformNodes = platformGraph.nodes

  // ---- Hysteresis / caching ----
  // Platform IDs can flicker due to small physics jitter (feet epsilon).
  // Also, replanning every BT tick can cause "left-right-left-right" oscillation.
  //
  // We store a tiny navigation memory object in the blackboard so:
  // - we can re-use the last valid path for a short time
  // - we can "lock" a decision (like walking to an edge) for 200-400ms
  const nav = getNavMemory(ctx)
  const nowMs = Number(ctx.nowMs ?? 0)

  // Continue an active "drop off edge" plan even if platform-id detection fails mid-air.
  // This prevents the bot from immediately switching back to simple chase and cancelling fast-fall.
  if (nav.dropPlan && nowMs <= nav.dropPlan.expiresAtMs) {
    const onGround = Boolean(ctx.blackboard?.self?.onGround)

    if (onGround) {
      // Still on the platform: keep walking toward the planned edge.
      const dxToEdge = nav.dropPlan.edgeX - self.x
      ctx.intent.moveX = Math.abs(dxToEdge) > 6 ? Math.sign(dxToEdge) : Math.sign(dxToEdge || nav.dropPlan.fallbackDir)
      if (ctx.reasons) ctx.reasons.push('NAV_DROP_WALK_TO_EDGE')
      return BT_STATUS.RUNNING
    }

    // Airborne: fast-fall until we land.
    ctx.intent.fastFall = true
    if (ctx.reasons) ctx.reasons.push('NAV_DROP_FAST_FALL')
    return BT_STATUS.RUNNING
  }

  const selfPlatformId = getPlatformIdForFighter({
    x: self.x,
    y: self.y,
    displayHeight: self.displayHeight,
    onGround: Boolean(ctx.blackboard?.self?.onGround),
    platformNodes,
  })

  const targetPlatformId = getPlatformIdForFighter({
    x: target.x,
    y: target.y,
    displayHeight: target.displayHeight,
    onGround: Boolean(ctx.blackboard?.target?.onGround),
    platformNodes,
  })

  // Remember last known platform IDs while grounded (helps reduce flicker).
  if (selfPlatformId != null && ctx.blackboard?.self?.onGround) nav.lastSelfPlatformId = selfPlatformId
  if (targetPlatformId != null && ctx.blackboard?.target?.onGround) nav.lastTargetPlatformId = targetPlatformId

  // Use last-known IDs as a fallback when detection fails (common with tiny epsilon mismatches).
  const stableSelfPlatformId =
    selfPlatformId ?? (ctx.blackboard?.self?.onGround ? nav.lastSelfPlatformId : null)
  const stableTargetPlatformId =
    targetPlatformId ?? (ctx.blackboard?.target?.onGround ? nav.lastTargetPlatformId : null)

  // If we cannot identify either platform, fall back to simple chase.
  if (stableSelfPlatformId == null || stableTargetPlatformId == null) return null

  // Same platform: simple chase is fine.
  if (stableSelfPlatformId === stableTargetPlatformId) return null

  // If we are within a short lock window, keep using the existing plan.
  // This is the core anti-oscillation measure.
  const isLocked = nowMs < (nav.lockedUntilMs ?? 0)

  // Replan when:
  // - not locked, AND
  // - (platform ids changed) OR (plan expired) OR (no path yet)
  const shouldReplan =
    !isLocked &&
    (nav.fromId !== stableSelfPlatformId ||
      nav.toId !== stableTargetPlatformId ||
      nowMs >= (nav.replanAtMs ?? 0) ||
      !Array.isArray(nav.path) ||
      nav.path.length < 2)

  if (shouldReplan) {
    const path = findPlatformPath(platformGraph, stableSelfPlatformId, stableTargetPlatformId)
    if (!path || path.length < 2) return null

    nav.path = path
    nav.fromId = stableSelfPlatformId
    nav.toId = stableTargetPlatformId
    nav.nextPlatformId = path[1]

    // Replan at most ~4 times per second to avoid thrashing.
    nav.replanAtMs = nowMs + 250

    // Short lock so the bot commits to a direction and doesn't jitter.
    nav.lockedUntilMs = nowMs + 280

    // Clear any drop plan when we recompute the path.
    nav.dropPlan = null
  }

  const nextId = nav.nextPlatformId
  if (nextId == null) return null

  const nextPlatform = platformNodes[nextId]
  const currentPlatform = platformNodes[stableSelfPlatformId]

  if (!nextPlatform || !currentPlatform) return null

  // Move horizontally toward the next platform's center.
  const dxToNext = nextPlatform.centerX - self.x
  ctx.intent.moveX = Math.abs(dxToNext) > 12 ? Math.sign(dxToNext) : 0

  // If the next platform is higher, jump when reasonably aligned.
  const goingUp = nextPlatform.top < currentPlatform.top - 8
  if (goingUp && ctx.blackboard?.self?.onGround) {
    if (Math.abs(dxToNext) < 34) {
      ctx.intent.jumpPressed = true
      if (ctx.reasons) ctx.reasons.push('JUMP_TO_PLATFORM')
    }
  }

  // If going down, we need an intentional "drop strategy":
  // - one-way platforms: Down + Jump triggers our drop-through logic (implemented in BattleScene)
  // - solid platforms: choose an edge, walk to it, then fast-fall once airborne
  const goingDown = nextPlatform.top > currentPlatform.top + 8
  if (goingDown) {
    // If the current platform is one-way (e.g., cloud platform),
    // we can intentionally drop through by using "Down + Jump".
    if (ctx.blackboard?.self?.onGround && currentPlatform.oneWay) {
      ctx.intent.fastFall = true
      ctx.intent.jumpPressed = true
      if (ctx.reasons) ctx.reasons.push('DROP_THROUGH_PLATFORM')
      return BT_STATUS.RUNNING
    }

    const onGround = Boolean(ctx.blackboard?.self?.onGround)
    if (!onGround) {
      // Once airborne (walked off, got knocked, etc.), fast-fall helps us land faster.
      ctx.intent.fastFall = true
      if (ctx.reasons) ctx.reasons.push('FAST_FALL_TO_LAND')
      return BT_STATUS.RUNNING
    }

    // Solid platform down-chase:
    // Pick a side and commit for a short time so we don't oscillate.
    const dropPlan = buildOrReuseDropPlan(ctx, {
      nowMs,
      currentPlatform,
      nextPlatform,
      stableSelfPlatformId,
      stableTargetPlatformId,
    })

    if (dropPlan) {
      nav.dropPlan = dropPlan
      nav.lockedUntilMs = Math.max(nav.lockedUntilMs ?? 0, nowMs + 320)

      const dxToEdge = dropPlan.edgeX - self.x
      ctx.intent.moveX = Math.abs(dxToEdge) > 6 ? Math.sign(dxToEdge) : Math.sign(dxToEdge || dropPlan.fallbackDir)
      if (ctx.reasons) ctx.reasons.push('WALK_TO_DROP_EDGE')
      return BT_STATUS.RUNNING
    }
  }

  if (ctx.reasons) ctx.reasons.push('NAVIGATE_PLATFORM')
  return BT_STATUS.RUNNING
}

function keepDistance(ctx, params) {
  const self = ctx.self
  const target = ctx.target

  // Params are in pixels.
  // If params are omitted, we fall back to the active AI profile spacing band.
  const profile = ctx.blackboard?.ai?.profile ?? {}
  const defaultMin = Number(profile.spacingMin ?? 70)
  const defaultMax = Number(profile.spacingMax ?? 140)

  const min = clampNumber(Number(params?.min ?? defaultMin), 10, 400)
  const max = clampNumber(Number(params?.max ?? defaultMax), min + 10, 700)

  // Only apply spacing when we are roughly on the same vertical level.
  // If the opponent is far above/below, navigation should take over instead.
  const absDy = Number(ctx.blackboard?.target?.absDy ?? Math.abs(target.y - self.y))
  if (!Number.isFinite(absDy) || absDy > 110) return BT_STATUS.FAILURE

  const absDx = Number(ctx.blackboard?.target?.absDx ?? Math.abs(target.x - self.x))
  if (!Number.isFinite(absDx)) return BT_STATUS.FAILURE

  // Too close: retreat.
  if (absDx < min) {
    ctx.intent.moveX = Math.sign(self.x - target.x) || -1
    if (ctx.reasons) ctx.reasons.push(`KEEP_DISTANCE_RETREAT(min=${min})`)
    return BT_STATUS.RUNNING
  }

  // Too far: approach.
  if (absDx > max) {
    ctx.intent.moveX = Math.sign(target.x - self.x) || 1
    if (ctx.reasons) ctx.reasons.push(`KEEP_DISTANCE_APPROACH(max=${max})`)
    return BT_STATUS.RUNNING
  }

  // Inside the band: hold position (SUCCESS lets a Sequence continue into attacks).
  ctx.intent.moveX = 0
  if (ctx.reasons) ctx.reasons.push('KEEP_DISTANCE_OK')
  return BT_STATUS.SUCCESS
}

function strafe(ctx, params) {
  const self = ctx.self
  const stage = ctx.stage
  const nowMs = Number(ctx.nowMs ?? 0)

  // Store short-lived state on the blackboard so Strafe can be RUNNING for a moment.
  const ai = ctx.blackboard?.ai
  if (!ai) return BT_STATUS.FAILURE

  if (!ai.strafe) {
    ai.strafe = {
      untilMs: 0,
      dir: 0,
    }
  }

  // If the previous strafe finished, start a new short burst.
  if (nowMs >= ai.strafe.untilMs) {
    const durationMs = 220

    // Choose direction:
    // - respect explicit params.dir when provided
    // - otherwise auto-pick a direction that avoids drifting offstage
    const requestedDir = String(params?.dir ?? 'auto')

    let dir = 0
    if (requestedDir === 'left') dir = -1
    else if (requestedDir === 'right') dir = 1
    else {
      const margin = Number(stage.offstageMargin ?? 40) + 90
      if (self.x < margin) dir = 1
      else if (self.x > stage.width - margin) dir = -1
      else {
        // Deterministic oscillation gives variety without randomness.
        dir = Math.sin(nowMs / 350) >= 0 ? 1 : -1
      }
    }

    ai.strafe.dir = dir || 1
    ai.strafe.untilMs = nowMs + durationMs
  }

  // Apply the currently active strafe.
  ctx.intent.moveX = ai.strafe.dir
  if (ctx.reasons) ctx.reasons.push('STRAFE')

  // Stay RUNNING until the burst ends.
  return nowMs < ai.strafe.untilMs ? BT_STATUS.RUNNING : BT_STATUS.SUCCESS
}

function approach(ctx, params) {
  const self = ctx.self

  const predicted = getPredictedTargetPosition(ctx)
  const desiredX = predicted.x
  const desiredY = predicted.y

  const distance = clampNumber(Number(params?.distance ?? 120), 20, 800)

  const dx = desiredX - self.x
  const dy = desiredY - self.y

  ctx.intent.moveX = Math.abs(dx) > 12 ? Math.sign(dx) : 0
  if (dy < -70) ctx.intent.jumpPressed = true

  // Optional: use dash to close large gaps faster (style-dependent).
  const onGround = Boolean(ctx.blackboard?.self?.onGround)
  const profile = ctx.blackboard?.ai?.profile ?? {}
  const dashChance = clampNumber(Number(profile?.dashChance ?? 0.3), 0, 1)
  if (onGround && Math.abs(dx) > distance + 160 && dashChance >= 0.35) {
    ctx.intent.dashPressed = true
    if (ctx.reasons) ctx.reasons.push('DASH_APPROACH')
  }

  if (ctx.reasons) ctx.reasons.push('APPROACH')

  // SUCCESS means "we are close enough" (useful in Sequences).
  return Math.abs(dx) <= distance ? BT_STATUS.SUCCESS : BT_STATUS.RUNNING
}

function evade(ctx) {
  const self = ctx.self
  const target = ctx.target
  const nowMs = Number(ctx.nowMs ?? 0)

  // Prefer the BotAgent threat model if available (more accurate than raw distance checks).
  const threat = ctx.blackboard?.ai?.threat
  if (!threat?.willHit) return BT_STATUS.FAILURE

  const profile = ctx.blackboard?.ai?.profile ?? {}
  const onGround = Boolean(ctx.blackboard?.self?.onGround)

  // Commit to a defensive intent for a short window to avoid oscillation.
  const combat = getCombatMemory(ctx)
  combat.lockedUntilMs = Math.max(combat.lockedUntilMs ?? 0, nowMs + 260)
  combat.mode = 'defend'

  const timeToHitMs = Number(threat.timeToHitMs ?? 0)

  // Defensive choice heuristic:
  // - If we have time and we're grounded, blocking is simple and stable.
  // - If the hit is imminent (or we're airborne), dodge is safer.
  // - If we're aggressive, sometimes jump instead of blocking to reposition.
  const defenseBias = clampNumber(Number(profile.defense ?? 0.55), 0, 1)
  const aggression = clampNumber(Number(profile.aggression ?? 0.55), 0, 1)

  const awayDir = Math.sign(self.x - target.x) || -1

  // Aggressive "jump out" when we have time (acts like a reposition rather than pure defense).
  if (onGround && timeToHitMs >= 140 && aggression >= 0.75) {
    ctx.intent.moveX = awayDir
    ctx.intent.jumpPressed = true
    ctx.intent.fastFall = false
    if (ctx.reasons) ctx.reasons.push('DEFEND_JUMP')
    return BT_STATUS.SUCCESS
  }

  // Prefer block when grounded and the threat isn't instantaneous.
  if (onGround && timeToHitMs >= 80 && defenseBias >= 0.55) {
    ctx.intent.guardHeld = true
    ctx.intent.moveX = 0
    ctx.intent.fastFall = false
    if (ctx.reasons) ctx.reasons.push('DEFEND_BLOCK')
    return BT_STATUS.SUCCESS
  }

  // Default: dodge away from the threat.
  // NOTE: Fighter chooses dodge direction from intent.moveX or facing, so we set moveX explicitly.
  ctx.intent.dodgePressed = true
  ctx.intent.moveX = awayDir
  ctx.intent.fastFall = false
  if (ctx.reasons) ctx.reasons.push('DEFEND_DODGE')
  return BT_STATUS.SUCCESS
}

function punish(ctx) {
  // Only punish when the opponent is in recovery (classic whiff punish window).
  if (!isTargetRecovering(ctx)) return BT_STATUS.FAILURE

  // Reuse the utility attack selector in a "punish" mode.
  // This tends to choose higher-reward moves and dash in more often.
  const status = utilityAttack(ctx, { mode: 'punish' })
  if (status !== BT_STATUS.FAILURE && ctx.reasons) ctx.reasons.push('PUNISH')
  return status
}

function utilityAttack(ctx, params) {
  // Utility-based attack selection.
  //
  // Why:
  // - Pure BT "if in range -> light/heavy" feels robotic and weak.
  // - Utility scoring lets us choose between multiple moves based on:
  //   distance, height difference, risk (startup/recovery), and reward (damage/knockback).
  //
  // The BT still controls *when* we want to attack.
  // UtilityAttack controls *which move* to use and how to close distance.
  const self = ctx.self
  const target = ctx.target
  const nowMs = Number(ctx.nowMs ?? 0)

  // If we are currently unable to act, don't produce attack intents.
  if (ctx.blackboard?.self?.inHitstun || ctx.blackboard?.self?.inHitstop) return BT_STATUS.FAILURE

  const profile = ctx.blackboard?.ai?.profile ?? {}
  const requestedMode = String(params?.mode ?? 'neutral')

  const onGround = Boolean(ctx.blackboard?.self?.onGround)
  const targetOnGround = Boolean(ctx.blackboard?.target?.onGround)

  // Avoid fighting the platform navigation system:
  // If the vertical gap is large and we have a platform graph, let MoveToTargetX handle it.
  const predicted = getPredictedTargetPosition(ctx)
  const dx = predicted.x - self.x
  const dy = predicted.y - self.y
  const absDx = Math.abs(dx)
  const absDy = Math.abs(dy)

  const hasPlatformGraph = Boolean(ctx.stage?.platformGraph?.nodes?.length)
  if (hasPlatformGraph && absDy > 170) return BT_STATUS.FAILURE

  // Combat memory contains:
  // - anti-jitter "planned move" lock
  // - hit-confirm signals (combo window, last outcome)
  const combat = getCombatMemory(ctx)

  // If we recently landed a hit, we enter a short "combo/chase" window.
  // If our last move was blocked, we enter a short "safe pressure" window.
  const lastOutcome = String(combat.lastAttackEvent?.outcome ?? '')
  const inComboWindow = nowMs < Number(combat.comboWindowUntilMs ?? 0) && lastOutcome === 'hit'
  const inBlockPressure = nowMs < Number(combat.blockPressureUntilMs ?? 0) && lastOutcome === 'blocked'

  // Effective mode can be upgraded from neutral based on hit-confirm signals.
  // This makes the AI feel smarter even with a small BT.
  let mode = requestedMode
  if (mode === 'neutral' && inComboWindow) mode = 'combo'
  else if (mode === 'neutral' && inBlockPressure) mode = 'pressure'

  // Combat hysteresis: keep one planned move for a short time to reduce jitter.
  // Only reuse the plan when the mode matches (prevents "pressure lock" leaking into neutral).
  const isLocked =
    nowMs < (combat.lockedUntilMs ?? 0) && combat.desiredMoveKind && String(combat.mode ?? '') === mode

  // Target hurtbox approximation at the predicted location.
  const targetRect = getHurtboxRectAt({
    x: predicted.x,
    y: predicted.y,
    width: target.displayWidth,
    height: target.displayHeight,
  })

  // Candidate move list depends on:
  // - ground/air availability
  // - "mode" (combo prefers fast, pressure prefers safe)
  const candidates = onGround
    ? mode === 'pressure'
      ? ['jab', 'light', 'sweep']
      : ['jab', 'light', 'sweep', 'heavy', 'uppercut']
    : ['airKick', 'light']

  // Combo preferences make follow-ups look intentional instead of random.
  const comboCount = Number(combat.comboCount ?? 0)
  const comboPreferences =
    mode === 'combo' && onGround
      ? dy < -55
        ? ['uppercut', 'light', 'jab']
        : comboCount <= 1
          ? ['jab', 'light']
          : comboCount === 2
            ? ['sweep', 'heavy', 'light']
            : ['heavy', 'uppercut', 'sweep']
      : []

  // If we are locked, try to execute/approach for the planned move kind.
  if (isLocked) {
    const plannedKind = String(combat.desiredMoveKind)
    return approachAndAttack(ctx, {
      kind: plannedKind,
      nowMs,
      onGround,
      predictedTarget: predicted,
      targetRect,
      profile,
      mode,
    })
  }

  // Pick the highest scoring move.
  let best = null

  for (const kind of candidates) {
    const move = MOVES[kind]
    if (!move) continue

    // Respect move ground/air restrictions here to keep scoring sane.
    if (onGround && move.allowedGround === false) continue
    if (!onGround && move.allowedAir === false) continue

    // Skip moves we cannot perform right now (cooldown, endlag, etc).
    if (!self.canAttack(kind, nowMs, onGround)) continue

    const facing = predicted.x >= self.x ? 1 : -1
    const hitbox = getMoveHitboxRect({ move, x: self.x, y: self.y, facing })
    const inRange = Phaser.Geom.Rectangle.Overlaps(hitbox, targetRect)

    let score = scoreMove({
      move,
      inRange,
      absDx,
      dy,
      onGround,
      targetOnGround,
      profile,
      mode,
    })

    // Bias toward a "structured" follow-up during combos.
    if (mode === 'combo' && comboPreferences.length) {
      const idx = comboPreferences.indexOf(kind)
      if (idx !== -1) score += (comboPreferences.length - idx) * 6
    }

    if (!best || score > best.score) {
      best = { kind, score, inRange }
    }
  }

  if (!best) return BT_STATUS.FAILURE

  // Commit to the chosen move briefly (anti-oscillation).
  combat.desiredMoveKind = best.kind
  combat.mode = mode
  combat.lockedUntilMs = nowMs + (mode === 'combo' ? 240 : 320)

  // If in range, issue the attack immediately.
  if (best.inRange) {
    ctx.intent.attackPressed = best.kind
    if (ctx.reasons) ctx.reasons.push(`ATTACK_SELECT:${best.kind}`)
    if (mode === 'combo' && ctx.reasons) ctx.reasons.push('HIT_CONFIRM_COMBO')
    if (mode === 'pressure' && ctx.reasons) ctx.reasons.push('HIT_CONFIRM_PRESSURE')
    return BT_STATUS.SUCCESS
  }

  // Otherwise, approach until the move can connect.
  return approachAndAttack(ctx, {
    kind: best.kind,
    nowMs,
    onGround,
    predictedTarget: predicted,
    targetRect,
    profile,
    mode,
  })
}

function approachAndAttack(ctx, { kind, nowMs, onGround, predictedTarget, targetRect, profile, mode }) {
  // Approach helper used by UtilityAttack:
  // - Move toward the predicted target x
  // - Use dash opportunistically for large gaps
  // - Attack once in range
  const self = ctx.self

  const move = MOVES[kind]
  if (!move) return BT_STATUS.FAILURE

  const dx = predictedTarget.x - self.x
  const dy = predictedTarget.y - self.y
  const absDx = Math.abs(dx)

  // If we can attack and are in range, do it.
  if (self.canAttack(kind, nowMs, onGround)) {
    const facing = predictedTarget.x >= self.x ? 1 : -1
    const hitbox = getMoveHitboxRect({ move, x: self.x, y: self.y, facing })
    const inRange = Phaser.Geom.Rectangle.Overlaps(hitbox, targetRect)

    if (inRange) {
      ctx.intent.attackPressed = kind
      if (ctx.reasons) ctx.reasons.push(`ATTACK_SELECT:${kind}`)
      return BT_STATUS.SUCCESS
    }
  }

  // Approach movement.
  const dir = Math.sign(dx) || 1
  ctx.intent.moveX = absDx > 10 ? dir : 0

  // Jump if the target is substantially above us (simple chase heuristic).
  if (onGround && dy < -80) ctx.intent.jumpPressed = true

  // Dash in when far and grounded.
  // We avoid randomness; dashChance is treated as a "tendency" threshold.
  const dashChance = clampNumber(Number(profile?.dashChance ?? 0.3), 0, 1)
  const dashDistance = mode === 'combo' ? 140 : mode === 'pressure' ? 180 : 220
  const dashThreshold = mode === 'combo' ? 0.18 : mode === 'pressure' ? 0.24 : 0.28
  if (onGround && absDx > dashDistance && dashChance >= dashThreshold) {
    ctx.intent.dashPressed = true
    if (ctx.reasons) {
      ctx.reasons.push(
        mode === 'punish' ? 'DASH_PUNISH' : mode === 'combo' ? 'DASH_COMBO' : 'DASH_IN',
      )
    }
  }

  if (ctx.reasons) ctx.reasons.push(mode === 'punish' ? 'PUNISH_APPROACH' : 'APPROACH_FOR_ATTACK')
  return BT_STATUS.RUNNING
}

function scoreMove({ move, inRange, absDx, dy, onGround, targetOnGround, profile, mode }) {
  // Basic utility score:
  // - reward: damage + knockback
  // - risk: startup + recovery
  // - fit: range + vertical context
  const aggression = clampNumber(Number(profile?.aggression ?? 0.55), 0, 1)
  const defense = clampNumber(Number(profile?.defense ?? 0.55), 0, 1)

  const reward = Number(move.damage ?? 0) * 2 + (Number(move.knockbackX ?? 0) + Number(move.knockbackY ?? 0) * 0.6) / 80
  const risk = (Number(move.startupMs ?? 0) * 0.75 + Number(move.recoveryMs ?? 0)) / 60

  // Aggressive profiles care more about reward, less about risk.
  const rewardWeight = 0.9 + aggression * 0.8
  const riskWeight = 0.9 + defense * 0.9

  let score = reward * rewardWeight - risk * riskWeight

  // Range fit: being in range is a huge boost; being far away is a penalty.
  if (inRange) score += 28
  else score -= clampNumber(absDx, 0, 260) * 0.09

  // Mode tweaks:
  // - punish: prefer higher reward (whiff punish) moves
  // - combo: prefer faster moves
  // - pressure: prefer safer moves (shorter recovery)
  if (mode === 'punish') score += reward * 0.35
  if (mode === 'combo') score -= Number(move.startupMs ?? 0) * 0.03
  if (mode === 'pressure') score -= Number(move.recoveryMs ?? 0) * 0.02

  // Tag-based bonuses (contextual).
  const tags = Array.isArray(move.tags) ? move.tags : []

  // Anti-air wants the opponent above us.
  if (tags.includes('antiAir') && dy < -45) score += 18

  // Low moves are better when the target is grounded and on similar height.
  if (tags.includes('low') && targetOnGround && Math.abs(dy) < 60) score += 10

  // Air moves are only meaningful while airborne.
  if (tags.includes('air') && !onGround) score += 10

  return score
}

function getHurtboxRectAt({ x, y, width, height }) {
  // Approximate a fighter hurtbox using display size.
  const w = Number(width ?? 0)
  const h = Number(height ?? 0)
  return new Phaser.Geom.Rectangle(Number(x ?? 0) - w / 2, Number(y ?? 0) - h / 2, w, h)
}

function getMoveHitboxRect({ move, x, y, facing }) {
  // Build a would-be hitbox rect for a move at the given position.
  const centerX = Number(x ?? 0) + (facing >= 0 ? 1 : -1) * (move.hitboxOffsetX + move.hitboxWidth / 2)
  const centerY = Number(y ?? 0) + move.hitboxOffsetY

  return new Phaser.Geom.Rectangle(
    centerX - move.hitboxWidth / 2,
    centerY - move.hitboxHeight / 2,
    move.hitboxWidth,
    move.hitboxHeight,
  )
}

function clampNumber(value, min, max) {
  // Clamp helper used for BT params so bad JSON can't create extreme behavior.
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, value))
}

function getCombatMemory(ctx) {
  // Ensure `blackboard.ai.combat` exists and has a stable shape.
  // This object persists across BT ticks for the same agent.
  const ai = ctx.blackboard?.ai
  if (!ai) return { lockedUntilMs: 0 }

  if (!ai.combat) {
    ai.combat = {
      lockedUntilMs: 0,
      mode: null,
      desiredMoveKind: null,
      // Hit-confirm / combo info (populated by BotAgent).
      lastAttackEvent: null,
      lastProcessedAttackEventAtMs: 0,
      lastLandedHitAtMs: 0,
      comboWindowUntilMs: 0,
      comboCount: 0,
      blockPressureUntilMs: 0,
    }
  } else {
    // Backfill new fields on existing objects so older sessions don't crash.
    if (ai.combat.comboWindowUntilMs == null) ai.combat.comboWindowUntilMs = 0
    if (ai.combat.comboCount == null) ai.combat.comboCount = 0
    if (ai.combat.blockPressureUntilMs == null) ai.combat.blockPressureUntilMs = 0
    if (ai.combat.lastAttackEvent == null) ai.combat.lastAttackEvent = null
    if (ai.combat.lastProcessedAttackEventAtMs == null) ai.combat.lastProcessedAttackEventAtMs = 0
    if (ai.combat.lastLandedHitAtMs == null) ai.combat.lastLandedHitAtMs = 0
  }

  return ai.combat
}

function getNavMemory(ctx) {
  // Ensure `blackboard.ai.nav` exists and has a stable shape.
  // This object persists across BT ticks for the same agent.
  const ai = ctx.blackboard?.ai
  if (!ai) return { lockedUntilMs: 0 }

  if (!ai.nav) {
    ai.nav = {
      // IDs of the last planned (from -> to) navigation request.
      fromId: null,
      toId: null,
      // Cached BFS path and the "next" platform id along that path.
      path: null,
      nextPlatformId: null,
      // Anti-jitter timers.
      lockedUntilMs: 0,
      replanAtMs: 0,
      // Last-known platform ids while grounded (used as a fallback when detection flickers).
      lastSelfPlatformId: null,
      lastTargetPlatformId: null,
      // Active "walk to edge then drop" plan (for going down from solid platforms).
      dropPlan: null,
    }
  }

  return ai.nav
}

function buildOrReuseDropPlan(
  ctx,
  { nowMs, currentPlatform, nextPlatform, stableSelfPlatformId, stableTargetPlatformId },
) {
  const nav = getNavMemory(ctx)

  // If we already have a compatible plan, keep it (hysteresis).
  const existing = nav.dropPlan
  if (
    existing &&
    nowMs <= existing.expiresAtMs &&
    existing.fromPlatformId === stableSelfPlatformId &&
    existing.toPlatformId === stableTargetPlatformId
  ) {
    return existing
  }

  // Pick which edge to drop from.
  //
  // Heuristic:
  // - If the desired X is clearly left/right of us, drop that side.
  // - If desired X is roughly "under" us, drop the nearest edge (faster).
  const self = ctx.self
  const predicted = getPredictedTargetPosition(ctx)
  const desiredX = predicted.x

  const leftEdgeX = currentPlatform.left - 8
  const rightEdgeX = currentPlatform.right + 8

  const dxToDesired = desiredX - self.x

  let side = null
  if (dxToDesired < -10) side = 'left'
  else if (dxToDesired > 10) side = 'right'
  else {
    // Desired X is near us: pick the closer edge.
    const distLeft = Math.abs(self.x - leftEdgeX)
    const distRight = Math.abs(self.x - rightEdgeX)
    if (distLeft < distRight) side = 'left'
    else if (distRight < distLeft) side = 'right'
    else side = self.facing < 0 ? 'left' : 'right'
  }

  const edgeX = side === 'left' ? leftEdgeX : rightEdgeX

  // Keep the plan alive long enough to reach the edge at run speed.
  // If we fail to drop within this window, the next replan will try again.
  const maxPlanMs = 1200

  return {
    kind: 'dropEdge',
    fromPlatformId: stableSelfPlatformId,
    toPlatformId: stableTargetPlatformId,
    edgeX,
    side,
    // If dx is zero, fall back to the chosen side direction so moveX isn't 0.
    fallbackDir: side === 'left' ? -1 : 1,
    createdAtMs: nowMs,
    expiresAtMs: nowMs + maxPlanMs,
    // Useful debug info (not used directly yet).
    nextPlatformCenterX: nextPlatform.centerX,
    currentPlatformCenterX: currentPlatform.centerX,
  }
}

function getPredictedTargetPosition(ctx) {
  // Prefer BotAgent's blackboard prediction if available.
  // Fall back to the current target position.
  const target = ctx.target
  const predictedX = Number(ctx.blackboard?.target?.predictedX)
  const predictedY = Number(ctx.blackboard?.target?.predictedY)

  return {
    x: Number.isFinite(predictedX) ? predictedX : target.x,
    y: Number.isFinite(predictedY) ? predictedY : target.y,
  }
}
