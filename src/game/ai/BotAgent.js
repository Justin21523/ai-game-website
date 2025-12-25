// BotAgent is a Behavior-Tree-driven AI controller for a Fighter.
//
// Responsibilities:
// - Read the world (self, target, stage) and update a blackboard.
// - Tick the BT at a fixed rate and produce an "intent" snapshot.
// - Record trace + reasons for explainability and debug UI.

import { createEmptyIntent } from '../entities/Fighter.js'
import { MOVES } from '../combat/moves.js'
import { BT_STATUS } from './bt/runtime.js'
import { getAiProfile, normalizeAiProfileId } from './aiProfiles.js'

export class BotAgent {
  constructor({ id, self, target, stage, btRoot, profileId } = {}) {
    this.id = id
    this.self = self
    this.target = target
    this.stage = stage
    this.btRoot = btRoot

    // Profile controls "playstyle" weights without changing the BT structure.
    this.profileId = normalizeAiProfileId(profileId)

    // Blackboard is a plain object shared across ticks.
    // It holds derived values (distances, flags) so leaf nodes can stay simple.
    this.blackboard = {
      self: {},
      target: {},
      stage: {},
      ai: {},
    }

    // Explainability data captured each tick.
    this.lastStatus = BT_STATUS.FAILURE
    this.lastTrace = []
    this.lastReasons = []
  }

  setProfile(profileId) {
    // Allow the UI to switch playstyles at runtime.
    this.profileId = normalizeAiProfileId(profileId)
  }

  tick({ nowMs }) {
    // Create a fresh intent snapshot for this tick.
    const intent = createEmptyIntent()

    // Trace and reasons are per-tick logs used by the UI.
    const trace = []
    const reasons = []

    // Update blackboard (derived observations).
    this._updateBlackboard({ nowMs })

    // Build BT context passed to every node.
    const ctx = {
      nowMs,
      self: this.self,
      target: this.target,
      stage: this.stage,
      blackboard: this.blackboard,
      intent,
      trace,
      reasons,
    }

    // Tick the tree.
    let status = BT_STATUS.FAILURE
    try {
      status = this.btRoot.tick(ctx)
    } catch (error) {
      // Fail safe: if the BT throws, do nothing this tick.
      // We still record the error as a reason for debugging.
      reasons.push(
        `BT_ERROR:${error instanceof Error ? error.message : String(error)}`,
      )
      status = BT_STATUS.FAILURE
    }

    // Clamp intent values to safe ranges.
    intent.moveX = clamp(intent.moveX, -1, 1)

    // Persist explainability info for the debug panel.
    this.lastStatus = status
    this.lastTrace = trace
    this.lastReasons = reasons

    // Also stash a condensed summary on the blackboard for easy consumption.
    this.blackboard.ai.lastStatus = status
    this.blackboard.ai.lastTrace = trace
    this.blackboard.ai.lastReasons = reasons

    return intent
  }

  _updateBlackboard({ nowMs }) {
    const self = this.self
    const target = this.target

    // Resolve the active AI profile for this tick.
    const profile = getAiProfile(this.profileId)

    // Prediction horizon (in ms) used for simple linear "lead" targeting.
    // 150-250ms tends to be a good range for fast platform fighters.
    const predictionHorizonMs = 200
    const predictionT = predictionHorizonMs / 1000

    // Self snapshot.
    this.blackboard.self.hp = self.hp
    this.blackboard.self.maxHp = self.maxHp
    this.blackboard.self.x = self.x
    this.blackboard.self.y = self.y
    // IMPORTANT:
    // BotAgent does not have a physics body. The velocity we want is the fighters velocity.
    // A subtle typo here (`this.body`) can throw every tick and effectively "kill" the AI loop.
    this.blackboard.self.vx = self.body?.velocity ? self.body.velocity.x : 0
    this.blackboard.self.vy = self.body?.velocity ? self.body.velocity.y : 0
    this.blackboard.self.onGround = Boolean(self.body.blocked.down || self.body.touching.down)
    this.blackboard.self.inHitstun = self.isInHitstun(nowMs)
    this.blackboard.self.inHitstop = self.isInHitstop(nowMs)
    this.blackboard.self.attack = self.attackState

    // Target snapshot.
    const dx = target.x - self.x
    const dy = target.y - self.y
    this.blackboard.target.x = target.x
    this.blackboard.target.y = target.y
    this.blackboard.target.vx = target.body?.velocity ? target.body.velocity.x : 0
    this.blackboard.target.vy = target.body?.velocity ? target.body.velocity.y : 0
    this.blackboard.target.dx = dx
    this.blackboard.target.dy = dy
    this.blackboard.target.absDx = Math.abs(dx)
    this.blackboard.target.absDy = Math.abs(dy)
    this.blackboard.target.inHitstun = target.isInHitstun(nowMs)
    this.blackboard.target.attack = target.attackState
    this.blackboard.target.onGround = Boolean(
      target.body.blocked.down || target.body.touching.down,
    )

    // Predicted target position (linear extrapolation).
    // This is intentionally simple and cheap; we just want to reduce "chase jitter".
    //
    // NOTE:
    // - Prediction is least accurate during collisions / landing.
    // - We clamp to stage bounds so it never becomes absurd.
    const stageWidth = Number(this.stage?.width ?? 0)
    const stageHeight = Number(this.stage?.height ?? 0)

    const predictedX = target.x + this.blackboard.target.vx * predictionT
    const predictedY = target.y + this.blackboard.target.vy * predictionT

    this.blackboard.target.predictedX =
      Number.isFinite(stageWidth) && stageWidth > 0 ? clamp(predictedX, 0, stageWidth) : predictedX
    this.blackboard.target.predictedY =
      Number.isFinite(stageHeight) && stageHeight > 0 ? clamp(predictedY, 0, stageHeight) : predictedY

    // Predicted self position (used by threat model and some utility scoring).
    const predictedSelfX = self.x + this.blackboard.self.vx * predictionT
    const predictedSelfY = self.y + this.blackboard.self.vy * predictionT
    this.blackboard.self.predictedX =
      Number.isFinite(stageWidth) && stageWidth > 0 ? clamp(predictedSelfX, 0, stageWidth) : predictedSelfX
    this.blackboard.self.predictedY =
      Number.isFinite(stageHeight) && stageHeight > 0 ? clamp(predictedSelfY, 0, stageHeight) : predictedSelfY

    // Stage snapshot (for leaf nodes that need bounds/center).
    this.blackboard.stage.width = this.stage.width
    this.blackboard.stage.height = this.stage.height
    this.blackboard.stage.centerX = this.stage.centerX

    // Profile snapshot (used by leaf nodes).
    this.blackboard.ai.profileId = profile.id
    this.blackboard.ai.profile = profile

    // Threat model:
    // Predict whether the opponent's current attack could hit us soon (150-250ms window).
    this.blackboard.ai.threat = computeThreat({
      nowMs,
      self,
      target,
      horizonMs: Number(profile.threatHorizonMs ?? 220),
    })

    // Time is occasionally useful for cooldown logic.
    this.blackboard.ai.nowMs = nowMs
  }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function computeThreat({ nowMs, self, target, horizonMs } = {}) {
  // "Threat" is a forward-looking approximation:
  // - If the opponent is attacking (startup/active)
  // - And the attack would overlap our hurtbox in the near future
  // Then we should prefer a defensive option (block/dodge/jump).
  const attack = target?.attackState
  const kind = attack?.kind
  const phase = attack?.phase

  const isThreateningPhase = phase === 'startup' || phase === 'active'
  if (!isThreateningPhase || !kind) {
    return { threatening: false, willHit: false, timeToHitMs: null, moveKind: null, phase: null, severity: 0 }
  }

  // If the attack already hit once, it cannot hit again (single-hit moves in this prototype).
  if (attack?.hasHit) {
    return { threatening: false, willHit: false, timeToHitMs: null, moveKind: kind, phase, severity: 0 }
  }

  const move = MOVES[kind]
  if (!move) {
    return { threatening: false, willHit: false, timeToHitMs: null, moveKind: kind, phase, severity: 0 }
  }

  const safeNowMs = Number(nowMs ?? 0)
  const safeHorizonMs = clamp(Number(horizonMs ?? 220), 60, 600)

  // Estimate when the hitbox becomes active.
  let timeToActiveMs = 0
  if (phase === 'startup') {
    timeToActiveMs = Math.max(0, Number(attack?.phaseEndsAtMs ?? 0) - safeNowMs)
  } else {
    timeToActiveMs = 0
  }

  // If the attack won't become active soon, it's not an immediate threat.
  if (timeToActiveMs > safeHorizonMs) {
    return { threatening: true, willHit: false, timeToHitMs: null, moveKind: kind, phase, severity: 0 }
  }

  // Predict positions at the time the move becomes active.
  const t = timeToActiveMs / 1000
  const selfVx = self?.body?.velocity?.x ?? 0
  const selfVy = self?.body?.velocity?.y ?? 0
  const targetVx = target?.body?.velocity?.x ?? 0
  const targetVy = target?.body?.velocity?.y ?? 0

  const predictedSelfX = Number(self?.x ?? 0) + Number(selfVx) * t
  const predictedSelfY = Number(self?.y ?? 0) + Number(selfVy) * t
  const predictedTargetX = Number(target?.x ?? 0) + Number(targetVx) * t
  const predictedTargetY = Number(target?.y ?? 0) + Number(targetVy) * t

  // Build rectangles in world coordinates.
  const hurtW = Number(self?.displayWidth ?? 0)
  const hurtH = Number(self?.displayHeight ?? 0)
  const hurtbox = {
    left: predictedSelfX - hurtW / 2,
    right: predictedSelfX + hurtW / 2,
    top: predictedSelfY - hurtH / 2,
    bottom: predictedSelfY + hurtH / 2,
  }

  const facing = Number(target?.facing ?? 1) >= 0 ? 1 : -1
  const hitLeft =
    predictedTargetX + facing * (move.hitboxOffsetX + move.hitboxWidth / 2) - move.hitboxWidth / 2
  const hitTop = predictedTargetY + move.hitboxOffsetY - move.hitboxHeight / 2
  const hitbox = {
    left: hitLeft,
    right: hitLeft + move.hitboxWidth,
    top: hitTop,
    bottom: hitTop + move.hitboxHeight,
  }

  const overlaps = rectsOverlap(hurtbox, hitbox)
  const willHit = Boolean(overlaps)

  // Severity is a simple 0..1 scale. (Higher = more urgent.)
  const severity = willHit ? clamp(1 - timeToActiveMs / safeHorizonMs, 0, 1) : 0

  return {
    threatening: true,
    willHit,
    timeToHitMs: willHit ? Math.round(timeToActiveMs) : null,
    moveKind: kind,
    phase,
    severity,
  }
}

function rectsOverlap(a, b) {
  // Axis-aligned rectangle overlap (AABB).
  // Each rect is { left, right, top, bottom } in world coordinates.
  if (!a || !b) return false
  return !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom)
}
