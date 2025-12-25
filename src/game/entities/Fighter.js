// Fighter is a controllable character entity built on top of Arcade Physics.
//
// Design goals:
// - "Intent-driven": input/AI produces intents (move/jump/attack), and the fighter executes them.
// - Data-driven combat: attacks use move data (startup/active/recovery, hitbox shape, damage).
// - Teachability: lots of English comments explaining why each piece exists.

import Phaser from 'phaser'

import { getMoveTotalMs, MOVES } from '../combat/moves.js'
import { getAnimKey, getDefaultIdleFrameKey } from '../assets/playerCharacters.js'
import { createDebugLogger } from '../debug/debugLogger.js'

// Simple enums used by the fighter state machine.
export const ATTACK_PHASE = {
  STARTUP: 'startup',
  ACTIVE: 'active',
  RECOVERY: 'recovery',
}

// A small helper so we don't accidentally mutate a shared object.
export function createEmptyIntent() {
  return {
    // Horizontal movement intent: -1 (left) .. 0 (idle) .. +1 (right)
    moveX: 0,

    // Jump is edge-triggered: true for the frame/tick you want to press jump.
    jumpPressed: false,

    // Fast-fall is a sustained intent while in the air.
    fastFall: false,

    // Dash is an edge-triggered burst movement (common in platform fighters).
    // It is intentionally separate from moveX so AI can "decide to dash" explicitly.
    dashPressed: false,

    // Dodge is an edge-triggered defensive action that grants brief invincibility.
    // We support both ground dodge and air dodge (1 per airtime).
    dodgePressed: false,

    // Guard is held (continuous). When active, hits from the front are blocked.
    guardHeld: false,

    // Attack is a move kind string (see MOVES).
    // Example values: 'light', 'heavy', 'jab', 'sweep', 'uppercut', 'airKick'
    attackPressed: null,
  }
}

export class Fighter extends Phaser.Physics.Arcade.Sprite {
  constructor(
    scene,
    {
      id,
      x,
      y,
      tint,
      width = 44,
      height = 66,
      facing = 1,
      maxHp = 100,
      characterId = 'dog',
    },
  ) {
    // We assume the scene has already created a small "pixel" texture.
    super(scene, x, y, 'pixel')

    // Add the sprite to the scene display list and physics world.
    scene.add.existing(this)
    scene.physics.add.existing(this)

    // Public identity (useful for debug panels and logs).
    this.id = id

    // Optional debug logger for this fighter instance.
    // It is enabled via `?debug=1` (or localStorage DEBUG_GAME=1).
    this._log = createDebugLogger(`Fighter:${String(id ?? 'unknown')}`)

    // Visual configuration (we use tint instead of sprite art for MVP).
    this.setTint(tint)
    this.setDisplaySize(width, height)

    // The physics body sprite is not the "pretty" sprite.
    // We render a separate animated sprite on top, but we also keep this rectangle faintly visible:
    // - It helps with learning/debugging (you can see the collision body).
    // - It guarantees you can still see the fighters even if sprite frames fail to load.
    this.setVisible(true)
    this.setDepth(49)

    // Arcade Physics uses an internal body size for collisions.
    // We keep the body size aligned with display size for simplicity.
    this.body.setSize(width, height, true)

    // Movement tuning: these values are intentionally conservative for a prototype.
    this._moveSpeed = 340
    this._jumpVelocity = 640
    this._fastFallVelocity = 980

    // Platformer "feel" helpers:
    // - Coyote time: allow jump shortly after leaving the ground.
    // - Jump buffer: allow jump slightly before landing.
    this._coyoteTimeMs = 90
    this._jumpBufferMs = 120

    // Track last ground contact time for coyote time.
    this._lastOnGroundMs = 0

    // Track buffered jump request expiry time.
    this._jumpBufferedUntilMs = 0

    // Combat state.
    this._maxHp = maxHp
    this._hp = maxHp

    // Track recent impacts for debug/explainability.
    // This is not used for gameplay logic directly.
    this._lastImpact = null

    // Hitstun: while active, the fighter cannot act (movement/attacks).
    this._hitstunUntilMs = 0

    // Hitstop: brief freeze to add impact feeling (we apply per-fighter for MVP).
    this._hitstopUntilMs = 0

    // Attack state (null means not attacking).
    this._attack = null

    // Attack cooldown: prevents immediate re-attacks after finishing a move.
    this._attackCooldownUntilMs = 0

    // ---- Defense / mobility mechanics (platform fighter essentials) ----
    //
    // These mechanics are intentionally simple at first:
    // - Dash: short burst of horizontal speed (ground only for MVP)
    // - Dodge: short burst with invincibility (ground + air; air dodge is limited to 1 per airtime)
    // - Guard: hold to reduce/negate damage when hit from the front
    //
    // The AI will use these to create recognizable "attack/defense rhythm".

    // Guard state is derived from the current intent each frame.
    // We store it here so hit resolution can query it without needing the intent object.
    this._isGuarding = false

    // Guard movement is slower (common in fighting games to keep blocking a commitment).
    this._guardMoveSpeedFactor = 0.55

    // Dash tuning.
    this._dashSpeed = 620
    this._dashDurationMs = 120
    this._dashCooldownMs = 260
    this._dashEndLagMs = 90
    this._dash = null
    this._dashCooldownUntilMs = 0

    // Dodge tuning.
    this._dodgeSpeed = 460
    this._airDodgeSpeed = 420
    this._dodgeDurationMs = 240
    this._dodgeInvincibleMs = 170
    this._dodgeCooldownMs = 340
    this._dodgeEndLagMs = 120
    this._dodge = null
    this._dodgeCooldownUntilMs = 0
    this._airDodgeUsed = false

    // Generic action lock:
    // Used for landing lag, dash endlag, dodge endlag, etc.
    // While active, the fighter cannot start new actions and horizontal movement is dampened.
    this._actionLockUntilMs = 0

    // Track grounding transitions so we can apply landing lag deterministically.
    this._wasOnGround = false

    // Track "air actions" so landing lag can depend on what happened in the air.
    this._airFlags = {
      attacked: false,
      dodged: false,
      // Per-airtime landing lag contributions (set when actions happen in the air).
      attackLandingLagMs: 0,
      dodgeLandingLagMs: 0,
    }

    // Facing direction affects attack hitbox placement and knockback direction.
    this._facing = facing >= 0 ? 1 : -1
    this.setFlipX(this._facing < 0)

    // Character visuals (Dog/Cat sprite animations).
    // These keys are created by `ensurePlayerAnimations()` in BattleScene.
    this._characterId = String(characterId)
    const initialFrameKey = getDefaultIdleFrameKey(this._characterId)

    // If the expected frame texture doesn't exist, we skip visual sprite creation.
    // The physics sprite stays visible as a fallback.
    const hasInitialFrame =
      typeof scene?.textures?.exists === 'function' ? scene.textures.exists(initialFrameKey) : false

    this._visual = hasInitialFrame ? scene.add.sprite(x, y, initialFrameKey) : null
    this._forcedVisualAction = null

    // If we have a visual sprite, configure it for animation rendering.
    if (this._visual) {
      // Use bottom origin so the character stands on the physics body's feet.
      this._visual.setOrigin(0.5, 1)

      // Put the character above all stage layers and the faint physics rectangle.
      // (Foreground tiles can still exist, but we prefer character readability for MVP.)
      this._visual.setDepth(50)

      // Scale the huge source frames down to roughly match the physics body size.
      // (Dog/Cat frames are ~547x481 px, while the physics body is ~44x66 px.)
      const desiredVisualHeight = height * 1.55
      const srcHeight = Math.max(1, this._visual.height)
      this._visual.setScale(desiredVisualHeight / srcHeight)

      // Apply facing to the visual sprite too.
      this._visual.setFlipX(this._facing < 0)
    }

    // Decide how visible the physics-body rectangle should be.
    //
    // Why:
    // - If sprite frames fail to load, the animated visual sprite will be missing.
    //   In that case we MUST keep the physics sprite clearly visible so the player is never "invisible".
    // - If the visual sprite exists, keep the physics sprite faint so the art remains readable,
    //   but still leave it visible for learning/debugging.
    //
    // Debug mode (enabled in dev or via `?debug=1`) makes the body slightly easier to see.
    const bodyAlphaWhenVisualMissing = this._log.enabled ? 0.9 : 0.78
    const bodyAlphaWhenVisualPresent = this._log.enabled ? 0.55 : 0.45
    this.setAlpha(this._visual ? bodyAlphaWhenVisualPresent : bodyAlphaWhenVisualMissing)

    // Create a small, always-visible name tag above the fighter.
    //
    // Why:
    // - When you are debugging camera / scale issues, it's easy to lose track of the fighters.
    // - Even if sprites fail to load (or are hard to see), this text should remain readable.
    //
    // This is intentionally a world-space object (scrollFactor 1) so it moves with the fighter.
    const tagText = this.id === 'left' ? 'P1' : this.id === 'right' ? 'P2' : String(this.id ?? 'P')
    this._nameTag = scene.add
      .text(x, y, tagText, {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '14px',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 3,
        backgroundColor: 'rgba(0, 0, 0, 0.35)',
        padding: { x: 6, y: 2 },
      })
      .setOrigin(0.5, 1)
      .setDepth(80)

    // Spawn point used for round resets.
    this._spawn = { x, y, facing: this._facing }

    // Default intent (will be replaced by AI every tick).
    this._intent = createEmptyIntent()

    // One-way platform drop-through:
    // - When active, the fighter will ignore collisions with one-way tiles (e.g., cloud platform).
    // - We keep it time-based so it is deterministic and easy to reason about.
    this._ignoreOneWayUntilMs = 0

    // Physics tuning for platform feel.
    this.body.setMaxVelocity(600, 1400)
    this.body.setDragX(1300)

    // World bounds collisions:
    // - Keep all sides enabled so fighters can never fall forever due to a bad stage/collider.
    // - Keep bounce at 0 so world bounds behave like solid walls/floor, not trampolines.
    //
    // NOTE:
    // `Body.setCollideWorldBounds(value, bounceX, bounceY, onWorldBounds)` only enables collisions.
    // Which sides are "active" is controlled by `physics.world.setBounds(..., checkLeft, checkRight, checkUp, checkDown)`.
    this.body.setCollideWorldBounds(true, 0, 0, true)

    if (this._log.enabled) {
      this._log.groupCollapsed('create', {
        id: this.id,
        characterId: this._characterId,
        spawn: { x: Math.round(x), y: Math.round(y) },
        size: { width, height },
        hasInitialFrame,
        initialFrameKey,
        hasVisualSprite: Boolean(this._visual),
        render: {
          body: { visible: this.visible, alpha: this.alpha, depth: this.depth },
          visual: this._visual
            ? {
                textureKey: this._visual.texture?.key ?? '',
                depth: this._visual.depth,
                scaleX: this._visual.scaleX,
                scaleY: this._visual.scaleY,
              }
            : null,
        },
      })
      this._log.groupEnd()
    }
  }

  // ---- Read-only-ish public accessors (used by AI and debug UI) ----

  get hp() {
    return this._hp
  }

  get maxHp() {
    return this._maxHp
  }

  get facing() {
    return this._facing
  }

  isInHitstun(nowMs) {
    return nowMs < this._hitstunUntilMs
  }

  isInHitstop(nowMs) {
    return nowMs < this._hitstopUntilMs
  }

  get attackState() {
    return this._attack
  }

  isGuarding() {
    // Guard state is updated every frame in updateFighter().
    // Consumers (BattleScene hit resolution, AI) use this as a cheap query.
    return Boolean(this._isGuarding)
  }

  isActionLocked(nowMs) {
    // Action lock includes landing lag and endlag.
    // While locked, the fighter should not start new actions like dash/dodge/attack.
    return (nowMs ?? 0) < this._actionLockUntilMs
  }

  isDodging(nowMs) {
    // Dodging is the full dodge duration (includes vulnerable end frames).
    return Boolean(this._dodge && (nowMs ?? 0) < (this._dodge.endsAtMs ?? 0))
  }

  isInvincible(nowMs) {
    // Invincibility is the i-frame window inside a dodge.
    return Boolean(this._dodge && (nowMs ?? 0) < (this._dodge.invincibleUntilMs ?? 0))
  }

  isDashing(nowMs) {
    return Boolean(this._dash && (nowMs ?? 0) < (this._dash.endsAtMs ?? 0))
  }

  // ---- Lifecycle / round control ----

  resetForNewRound({ x, y, facing, nowMs } = {}) {
    // Reset combat state.
    this._hp = this._maxHp
    this._hitstunUntilMs = 0
    this._hitstopUntilMs = 0
    this._attack = null
    this._attackCooldownUntilMs = 0
    this._lastImpact = null

    // Reset movement helpers.
    this._lastOnGroundMs = nowMs ?? 0
    this._jumpBufferedUntilMs = 0

    // Clear any temporary one-way collision override.
    this._ignoreOneWayUntilMs = 0

    // Reset defense/mobility state so the new round starts neutral.
    this._isGuarding = false
    this._dash = null
    this._dashCooldownUntilMs = 0
    this._dodge = null
    this._dodgeCooldownUntilMs = 0
    this._airDodgeUsed = false
    this._actionLockUntilMs = 0
    this._wasOnGround = false
    this._airFlags = {
      attacked: false,
      dodged: false,
      attackLandingLagMs: 0,
      dodgeLandingLagMs: 0,
    }

    // Clear any forced visual state (e.g., KO pose).
    this._forcedVisualAction = null

    // Reset position & velocity.
    this.setPosition(x ?? this._spawn.x, y ?? this._spawn.y)
    this.body.setVelocity(0, 0)

    // Reset facing so early-frame AI can be deterministic.
    const newFacing = (facing ?? this._spawn.facing) >= 0 ? 1 : -1
    this._facing = newFacing
    this.setFlipX(this._facing < 0)

    // Sync visuals immediately so the new round starts in the correct position.
    this._syncVisual()
  }

  // ---- Intent-driven update ----

  setIntent(intent) {
    // We keep a reference so we can apply the latest AI intent every frame.
    // Intents should be treated as immutable snapshots for a single tick.
    this._intent = intent ?? createEmptyIntent()
  }

  getIntentRef() {
    // Expose the *current* intent reference for stage-level helpers (e.g., one-way drop-through).
    // Callers should treat this as read-only in general.
    return this._intent
  }

  enableDropThrough({ nowMs, durationMs = 220 } = {}) {
    // Temporarily ignore one-way tile collisions.
    // This is triggered by "down + jump" on a one-way platform.
    this._ignoreOneWayUntilMs = Math.max(this._ignoreOneWayUntilMs, (nowMs ?? 0) + durationMs)
  }

  isIgnoringOneWay(nowMs) {
    return (nowMs ?? 0) < this._ignoreOneWayUntilMs
  }

  setForcedVisualAction(action) {
    // Force the visual sprite to a specific action/animation until cleared.
    // This is mainly used by the scene for KO poses without running full Fighter updates.
    this._forcedVisualAction = action ? String(action) : null

    // Apply immediately so the caller can see the change on the same frame.
    this._syncVisual()

    if (!this._forcedVisualAction || !this._visual) return
    const animKey = getAnimKey({ characterId: this._characterId, action: this._forcedVisualAction })
    this._visual.play(animKey, true)
  }

  clearForcedVisualAction() {
    // Remove forced visual state so normal state selection resumes.
    this._forcedVisualAction = null
  }

  updateFighter({ nowMs, opponent }) {
    // If hitstop is active, we freeze control and dampen motion.
    // We still keep the visual sprite synced so it never drifts away from the physics body.
    if (nowMs < this._hitstopUntilMs) {
      this.body.setVelocity(0, 0)
      this._syncVisual()
      return
    }

    // Update facing based on opponent position (common in brawlers).
    if (opponent) this._faceTowardX(opponent.x)

    // ---- Grounding + landing detection ----
    const onGround = this._isOnGround()
    if (onGround) this._lastOnGroundMs = nowMs

    // Detect landing (air -> ground transition) so we can apply landing lag.
    const justLanded = onGround && !this._wasOnGround
    if (justLanded) this._applyLandingLag({ nowMs })

    // Reset "once per airtime" resources when grounded.
    if (onGround) this._airDodgeUsed = false

    // Persist for the next frame.
    this._wasOnGround = onGround

    // ---- Consume edge-trigger intents ----
    //
    // AI intents can be applied for multiple frames because AI ticks slower than rendering.
    // Consuming edge-trigger flags here makes "press" semantics deterministic.
    const dashPressed = Boolean(this._intent.dashPressed)
    if (dashPressed) this._intent.dashPressed = false

    const dodgePressed = Boolean(this._intent.dodgePressed)
    if (dodgePressed) this._intent.dodgePressed = false

    // Buffer jump input (so press-before-landing still results in a jump).
    if (this._intent.jumpPressed) {
      this._jumpBufferedUntilMs = nowMs + this._jumpBufferMs
      this._intent.jumpPressed = false
    }

    // ---- End state transitions (dash/dodge) ----
    // If a dash/dodge expired since the last frame, apply endlag via actionLock.
    if (this._dash && nowMs >= (this._dash.endsAtMs ?? 0)) {
      this._dash = null
      this._actionLockUntilMs = Math.max(this._actionLockUntilMs, nowMs + this._dashEndLagMs)
    }

    if (this._dodge && nowMs >= (this._dodge.endsAtMs ?? 0)) {
      this._dodge = null
      this._actionLockUntilMs = Math.max(this._actionLockUntilMs, nowMs + this._dodgeEndLagMs)
    }

    // ---- Ongoing dash / dodge overrides ----
    // While actively dashing/dodging, we ignore normal movement/attacks.
    if (this.isDodging(nowMs)) {
      this._applyDodgePhysics({ nowMs })
      this._updateVisual({ nowMs, onGround })
      return
    }

    if (this.isDashing(nowMs)) {
      this._applyDashPhysics({ nowMs })
      this._updateVisual({ nowMs, onGround })
      return
    }

    // ---- Action permission gating ----
    const inHitstun = nowMs < this._hitstunUntilMs
    const inActionLock = this.isActionLocked(nowMs)

    // Guard is a held state. We allow it only on the ground and only when not attacking.
    // (You can later add crouch-guard / air-guard variants if desired.)
    this._isGuarding = Boolean(this._intent.guardHeld) && onGround && !inHitstun && !this._attack

    // Start dodge/dash BEFORE applying normal movement so they can override velocity immediately.
    // We also disallow starting these while action-locked or in hitstun.
    const canStartActions = !inHitstun && !inActionLock

    if (canStartActions && dodgePressed) {
      const started = this._tryStartDodge({ nowMs, onGround })
      if (started) {
        this._applyDodgePhysics({ nowMs })
        this._updateVisual({ nowMs, onGround })
        return
      }
    }

    if (canStartActions && dashPressed && !this._isGuarding) {
      const started = this._tryStartDash({ nowMs, onGround })
      if (started) {
        this._applyDashPhysics({ nowMs })
        this._updateVisual({ nowMs, onGround })
        return
      }
    }

    // ---- Normal movement ----
    // If we are action-locked, dampen horizontal control on the ground.
    // We still allow gravity/vertical velocity to resolve naturally.
    if (!inHitstun) {
      if (inActionLock && onGround) {
        this.body.setVelocityX(0)
      } else {
        this._applyMovementIntent({ nowMs, onGround })
      }
    }

    // ---- Attacks ----
    // Update attack state machine (startup -> active -> recovery).
    this._updateAttackState({ nowMs })

    // Start a new attack if requested and allowed.
    // Attack is treated as edge-triggered for the same reason as jump/dash/dodge.
    const requestedAttack = this._intent.attackPressed
    if (requestedAttack) this._intent.attackPressed = null

    // Guarding is a commitment; for MVP we disallow attacking while guard is held.
    if (canStartActions && requestedAttack && !this._isGuarding) {
      this._tryStartAttack({ kind: requestedAttack, nowMs, onGround })
    }

    // Visual sprite update happens last so it can reflect the final state this frame.
    this._updateVisual({ nowMs, onGround })
  }

  // ---- Combat helpers ----

  canAttack(kind, nowMs, onGround) {
    // You cannot attack during hitstun/hitstop, while already attacking, or during cooldown.
    if (nowMs < this._hitstunUntilMs) return false
    if (nowMs < this._hitstopUntilMs) return false
    if (this.isActionLocked(nowMs)) return false
    if (this.isDodging(nowMs)) return false
    if (this.isDashing(nowMs)) return false
    if (this._isGuarding) return false
    if (this._attack) return false
    if (nowMs < this._attackCooldownUntilMs) return false

    // The move kind must exist.
    const move = MOVES[kind]
    if (!move) return false

    // Optional: if the caller provides onGround, enforce ground/air restrictions.
    // This keeps AI/BT checks consistent with `_tryStartAttack`.
    if (typeof onGround === 'boolean') {
      if (onGround && move.allowedGround === false) return false
      if (!onGround && move.allowedAir === false) return false
    }

    return true
  }

  takeHit({
    damage,
    knockbackX,
    knockbackY,
    hitstunMs,
    hitstopMs,
    fromFacing,
    nowMs,
    // Used only for debug/telemetry (e.g., "hit" vs "blocked").
    impactKind = 'hit',
  } = {}) {
    // Reduce HP.
    const safeDamage = Number.isFinite(damage) ? Math.max(0, damage) : 0
    this._hp = Math.max(0, this._hp - safeDamage)

    // Apply hitstun so the victim temporarily loses control.
    const safeHitstunMs = Number.isFinite(hitstunMs) ? Math.max(0, hitstunMs) : 0
    this._hitstunUntilMs = Math.max(this._hitstunUntilMs, (nowMs ?? 0) + safeHitstunMs)

    // Apply hitstop (freeze) to enhance impact.
    const safeHitstopMs = Number.isFinite(hitstopMs) ? Math.max(0, hitstopMs) : 0
    this._hitstopUntilMs = Math.max(this._hitstopUntilMs, (nowMs ?? 0) + safeHitstopMs)

    // Cancel any current attack on hit (common in fighting games).
    this._attack = null

    // Getting hit cancels mobility commitments (dash/dodge) and landing locks.
    // This keeps state transitions easier to reason about for MVP.
    this._dash = null
    this._dodge = null
    this._actionLockUntilMs = 0

    // Apply knockback away from the attacker.
    const direction = (fromFacing ?? 1) >= 0 ? 1 : -1
    const safeKnockbackX = Number.isFinite(knockbackX) ? knockbackX : 0
    const safeKnockbackY = Number.isFinite(knockbackY) ? knockbackY : 0
    this.body.setVelocity(direction * safeKnockbackX, -Math.abs(safeKnockbackY))

    // Store the last impact so debug UI can show what happened recently.
    this._lastImpact = { kind: String(impactKind ?? 'hit'), atMs: nowMs ?? 0 }
  }

  // Returns a hurtbox rectangle in world coordinates.
  getHurtboxRect() {
    // Arcade sprites are centered by default, so we convert to top-left origin.
    const width = this.displayWidth
    const height = this.displayHeight
    return new Phaser.Geom.Rectangle(
      this.x - width / 2,
      this.y - height / 2,
      width,
      height,
    )
  }

  // Returns the current attack hitbox (only during ACTIVE phase and only if not already hit).
  getAttackHitboxRect() {
    if (!this._attack) return null
    if (this._attack.phase !== ATTACK_PHASE.ACTIVE) return null
    if (this._attack.hasHit) return null

    const move = MOVES[this._attack.kind]
    if (!move) return null

    // Compute hitbox center relative to fighter center.
    const centerX =
      this.x + this._facing * (move.hitboxOffsetX + move.hitboxWidth / 2)
    const centerY = this.y + move.hitboxOffsetY

    return new Phaser.Geom.Rectangle(
      centerX - move.hitboxWidth / 2,
      centerY - move.hitboxHeight / 2,
      move.hitboxWidth,
      move.hitboxHeight,
    )
  }

  markAttackHit() {
    // Ensures a single attack cannot multi-hit in a single active window (MVP simplification).
    if (this._attack) this._attack.hasHit = true
  }

  // ---- Internal movement methods ----

  _applyMovementIntent({ nowMs, onGround }) {
    // Horizontal movement: direct setVelocityX is simple and predictable for a prototype.
    const speedFactor = this._isGuarding ? this._guardMoveSpeedFactor : 1
    this.body.setVelocityX(this._intent.moveX * this._moveSpeed * speedFactor)

    // Jump execution: if jump is buffered AND we are allowed to jump now, perform it.
    const jumpBuffered = nowMs <= this._jumpBufferedUntilMs
    const inCoyoteWindow = nowMs - this._lastOnGroundMs <= this._coyoteTimeMs
    const canJump = onGround || inCoyoteWindow

    // Guarding prevents jumping for MVP (release guard first).
    if (jumpBuffered && canJump && !this._isGuarding) {
      this.body.setVelocityY(-this._jumpVelocity)
      this._jumpBufferedUntilMs = 0
    }

    // Fast-fall: if in air and requested, force downward velocity (helps AI land quickly).
    if (!onGround && this._intent.fastFall) {
      this.body.setVelocityY(Math.max(this.body.velocity.y, this._fastFallVelocity))
    }
  }

  _applyLandingLag({ nowMs }) {
    // Landing lag is what makes aerial commitments matter:
    // - If you air-dodge, you should not be able to instantly act on landing.
    // - If you attack in the air, landing should not be "free".
    //
    // This is a simplified model:
    // - we only care whether *any* air attack happened
    // - and whether an air dodge happened
    const didAirAttack = Boolean(this._airFlags?.attacked)
    const didAirDodge = Boolean(this._airFlags?.dodged)
    const attackLandingLagMs = Number(this._airFlags?.attackLandingLagMs ?? 0)
    const dodgeLandingLagMs = Number(this._airFlags?.dodgeLandingLagMs ?? 0)

    // Always reset flags on landing so the next airtime starts fresh.
    this._airFlags = {
      attacked: false,
      dodged: false,
      attackLandingLagMs: 0,
      dodgeLandingLagMs: 0,
    }

    // No landing lag needed.
    if (!didAirAttack && !didAirDodge) return

    // Tune landing lag in milliseconds (roughly "frames" * 16.67ms).
    const baseAttackLagMs = Number.isFinite(attackLandingLagMs) && attackLandingLagMs > 0 ? attackLandingLagMs : 110
    const baseDodgeLagMs = Number.isFinite(dodgeLandingLagMs) && dodgeLandingLagMs > 0 ? dodgeLandingLagMs : 150

    // Stack lag lightly so "air dodge + air attack" is meaningfully punishable.
    let lagMs = 0
    if (didAirAttack) lagMs += baseAttackLagMs
    if (didAirDodge) lagMs += baseDodgeLagMs

    // Clamp to a reasonable range so we never lock the player too long.
    lagMs = clampNumber(lagMs, 0, 420)

    this._actionLockUntilMs = Math.max(this._actionLockUntilMs, (nowMs ?? 0) + lagMs)
  }

  _tryStartDash({ nowMs, onGround }) {
    // Ground dash only for MVP.
    if (!onGround) return false

    // Don't allow dash if we are on cooldown.
    if ((nowMs ?? 0) < this._dashCooldownUntilMs) return false

    // Choose dash direction:
    // - If the player is holding a direction, dash that way.
    // - Otherwise dash toward the current facing direction.
    const rawDir = Number(this._intent.moveX ?? 0)
    const dir = rawDir ? Math.sign(rawDir) : this._facing
    if (!dir) return false

    this._dash = {
      dir,
      startedAtMs: nowMs ?? 0,
      endsAtMs: (nowMs ?? 0) + this._dashDurationMs,
    }

    // Cooldown starts immediately so repeated dash presses don't chain too fast.
    this._dashCooldownUntilMs = (nowMs ?? 0) + this._dashCooldownMs

    // Dashing cancels guarding.
    this._isGuarding = false

    return true
  }

  _applyDashPhysics() {
    // Apply dash movement as a simple constant horizontal velocity.
    if (!this._dash) return
    const dir = Math.sign(Number(this._dash.dir ?? this._facing)) || 1
    this.body.setVelocityX(dir * this._dashSpeed)
  }

  _tryStartDodge({ nowMs, onGround }) {
    // Don't allow dodge if we are on cooldown.
    if ((nowMs ?? 0) < this._dodgeCooldownUntilMs) return false

    const isAir = !onGround

    // Air dodge is limited to 1 per airtime.
    if (isAir && this._airDodgeUsed) return false

    // Choose dodge direction (same heuristic as dash).
    const rawDir = Number(this._intent.moveX ?? 0)
    const dir = rawDir ? Math.sign(rawDir) : this._facing
    if (!dir) return false

    const speed = isAir ? this._airDodgeSpeed : this._dodgeSpeed

    this._dodge = {
      dir,
      isAir,
      startedAtMs: nowMs ?? 0,
      endsAtMs: (nowMs ?? 0) + this._dodgeDurationMs,
      invincibleUntilMs: (nowMs ?? 0) + this._dodgeInvincibleMs,
      speed,
    }

    // Cooldown starts immediately; air dodge shares the same cooldown for simplicity.
    this._dodgeCooldownUntilMs = (nowMs ?? 0) + this._dodgeCooldownMs

    // Track air usage so we can't chain air dodges without landing.
    if (isAir) {
      this._airDodgeUsed = true
      this._airFlags.dodged = true
      this._airFlags.dodgeLandingLagMs = Math.max(Number(this._airFlags.dodgeLandingLagMs ?? 0), 160)
    }

    // Dodging cancels guarding.
    this._isGuarding = false

    return true
  }

  _applyDodgePhysics() {
    // Apply dodge as a burst velocity + optional "stall" in the air.
    if (!this._dodge) return

    const dir = Math.sign(Number(this._dodge.dir ?? this._facing)) || 1
    const speed = Number(this._dodge.speed ?? this._dodgeSpeed)

    this.body.setVelocityX(dir * speed)

    // Air dodge stalls vertical velocity slightly (common in platform fighters).
    // This makes the move feel distinct from a simple air drift.
    if (this._dodge.isAir) {
      this.body.setVelocityY(0)
    }
  }

  _isOnGround() {
    // `blocked.down` is reliable for world bounds; `touching.down` captures platform colliders.
    return Boolean(this.body.blocked.down || this.body.touching.down)
  }

  _faceTowardX(targetX) {
    // Face the target: if target is to the right, face right; else face left.
    const nextFacing = targetX >= this.x ? 1 : -1
    if (nextFacing === this._facing) return

    this._facing = nextFacing
    this.setFlipX(this._facing < 0)

    // Mirror the visual sprite too.
    if (this._visual) this._visual.setFlipX(this._facing < 0)
  }

  // ---- Internal attack methods ----

  _tryStartAttack({ kind, nowMs, onGround }) {
    if (!this.canAttack(kind, nowMs)) return

    const move = MOVES[kind]
    if (!move) return

    // Some moves are restricted to ground/air to keep the move set readable.
    // (Example: uppercut is ground-only, airKick is air-only.)
    const allowGround = move.allowedGround !== false
    const allowAir = move.allowedAir !== false
    if (onGround && !allowGround) return
    if (!onGround && !allowAir) return

    // Enter startup phase.
    this._attack = {
      kind,
      phase: ATTACK_PHASE.STARTUP,
      phaseEndsAtMs: nowMs + move.startupMs,
      hasHit: false,
    }

    // Record that we committed to an air attack so landing lag can apply.
    if (!onGround) {
      this._airFlags.attacked = true

      // Store landing lag contribution so different air moves can have different risk.
      const landingLagMs = Number(move.landingLagMs ?? 0)
      if (Number.isFinite(landingLagMs) && landingLagMs > 0) {
        this._airFlags.attackLandingLagMs = Math.max(
          Number(this._airFlags.attackLandingLagMs ?? 0),
          landingLagMs,
        )
      }
    }

    // Cooldown lasts through the end of recovery (plus a tiny buffer).
    this._attackCooldownUntilMs = nowMs + getMoveTotalMs(kind) + 40
  }

  _updateAttackState({ nowMs }) {
    if (!this._attack) return

    // If we are still within the current phase, nothing changes.
    if (nowMs < this._attack.phaseEndsAtMs) return

    const move = MOVES[this._attack.kind]
    if (!move) {
      this._attack = null
      return
    }

    // Transition to the next phase.
    if (this._attack.phase === ATTACK_PHASE.STARTUP) {
      this._attack.phase = ATTACK_PHASE.ACTIVE
      this._attack.phaseEndsAtMs = nowMs + move.activeMs
      return
    }

    if (this._attack.phase === ATTACK_PHASE.ACTIVE) {
      this._attack.phase = ATTACK_PHASE.RECOVERY
      this._attack.phaseEndsAtMs = nowMs + move.recoveryMs
      return
    }

    // End of recovery: attack is finished.
    this._attack = null
  }

  // ---- Visual sprite helpers ----

  _syncVisual() {
    // Keep the animated sprite positioned on the physics body's feet.
    if (this._visual) {
      this._visual.setPosition(this.x, this.y + this.displayHeight / 2)
      this._visual.setFlipX(this._facing < 0)
    }

    // Keep the name tag above the fighter's head.
    if (this._nameTag) {
      const headY = this.y - this.displayHeight / 2 - 6
      this._nameTag.setPosition(this.x, headY)
    }
  }

  _updateVisual({ nowMs, onGround }) {
    if (!this._visual) return

    // Always keep position synced (even when idle).
    this._syncVisual()

    // If the scene forced a specific action (e.g., KO pose), respect it.
    if (this._forcedVisualAction) {
      const animKey = getAnimKey({ characterId: this._characterId, action: this._forcedVisualAction })
      this._visual.play(animKey, true)
      return
    }

    // Decide which animation should be displayed.
    // This is a simple state selection, not a full animation state machine.
    let action = 'idle'

    // Mobility states are higher priority than basic movement.
    // We reuse "slide" as a placeholder for dash/dodge visuals.
    if (this.isDodging(nowMs) || this.isDashing(nowMs)) {
      action = 'slide'
    } else if (this._isGuarding) {
      // Guarding is visually similar to idle for now.
      // (Later you can add a dedicated guard animation.)
      action = 'idle'
    } else
    // Hit reactions have the highest priority.
    if (nowMs < this._hitstunUntilMs) {
      action = 'hurt'
    } else if (this._attack) {
      // We reuse "slide" as an attack animation placeholder.
      action = 'slide'
    } else if (!onGround) {
      // Airborne: choose jump vs fall based on vertical velocity.
      action = this.body.velocity.y < -20 ? 'jump' : 'fall'
    } else if (Math.abs(this.body.velocity.x) > 12) {
      action = 'run'
    }

    const animKey = getAnimKey({ characterId: this._characterId, action })
    this._visual.play(animKey, true)
  }

  destroy(fromScene) {
    // Ensure the visual sprite is cleaned up with the physics sprite.
    if (this._visual) {
      this._visual.destroy()
      this._visual = null
    }

    // Ensure the name tag is cleaned up too.
    if (this._nameTag) {
      this._nameTag.destroy()
      this._nameTag = null
    }

    if (this._log.enabled) this._log.info('destroy')

    super.destroy(fromScene)
  }
}

function clampNumber(value, min, max) {
  // Tiny helper used for gameplay tuning inputs.
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, value))
}
