// This file defines move data ("frame data" simplified into milliseconds).
// Keeping moves data-driven makes balancing easier and makes AI decisions inspectable.

export const MOVE_KIND = {
  // "Button-style" legacy moves (kept for compatibility with early BT JSON).
  LIGHT: 'light',
  HEAVY: 'heavy',

  // Additional moves to give AI richer combat choices.
  JAB: 'jab',
  SWEEP: 'sweep',
  UPPERCUT: 'uppercut',
  AIR_KICK: 'airKick',
}

// A small move set is enough for MVP:
// - light: fast, short range
// - heavy: slower, higher damage/knockback
export const MOVES = {
  // ---- Legacy / compatibility moves ----
  [MOVE_KIND.LIGHT]: {
    kind: MOVE_KIND.LIGHT,

    // Timing (in ms). You can think of 60 FPS as ~16.67ms per frame.
    startupMs: 90,
    activeMs: 90,
    recoveryMs: 170,

    // Combat numbers.
    damage: 10,
    hitstunMs: 220,
    hitstopMs: 50,

    // Knockback applied to the victim on hit.
    knockbackX: 420,
    knockbackY: 320,

    // Hitbox size and placement relative to the fighter.
    // X offsets are applied in the facing direction.
    hitboxWidth: 62,
    hitboxHeight: 44,
    hitboxOffsetX: 36,
    hitboxOffsetY: -6,

    // Allow this move both on the ground and in the air for simplicity.
    allowedGround: true,
    allowedAir: true,

    // If used in the air, landing will apply this extra endlag.
    landingLagMs: 90,

    // Tags are for AI heuristics / explainability (not strict gameplay rules).
    tags: ['fast', 'horizontal', 'neutral'],
  },

  [MOVE_KIND.HEAVY]: {
    kind: MOVE_KIND.HEAVY,

    startupMs: 200,
    activeMs: 90,
    recoveryMs: 260,

    damage: 18,
    hitstunMs: 300,
    hitstopMs: 70,

    knockbackX: 560,
    knockbackY: 380,

    hitboxWidth: 86,
    hitboxHeight: 56,
    hitboxOffsetX: 44,
    hitboxOffsetY: -10,

    allowedGround: true,
    allowedAir: false,
    landingLagMs: 0,
    tags: ['slow', 'horizontal', 'power'],
  },

  // ---- Extended move set ----
  [MOVE_KIND.JAB]: {
    kind: MOVE_KIND.JAB,

    startupMs: 60,
    activeMs: 70,
    recoveryMs: 140,

    damage: 7,
    hitstunMs: 190,
    hitstopMs: 40,

    knockbackX: 320,
    knockbackY: 240,

    hitboxWidth: 54,
    hitboxHeight: 40,
    hitboxOffsetX: 28,
    hitboxOffsetY: -8,

    allowedGround: true,
    allowedAir: false,
    landingLagMs: 0,
    tags: ['fast', 'close', 'poke'],
  },

  [MOVE_KIND.SWEEP]: {
    kind: MOVE_KIND.SWEEP,

    startupMs: 140,
    activeMs: 80,
    recoveryMs: 220,

    damage: 11,
    hitstunMs: 240,
    hitstopMs: 55,

    knockbackX: 460,
    knockbackY: 220,

    // Low hitbox: sits below the fighter center.
    hitboxWidth: 86,
    hitboxHeight: 26,
    hitboxOffsetX: 44,
    hitboxOffsetY: 22,

    allowedGround: true,
    allowedAir: false,
    landingLagMs: 0,
    tags: ['low', 'midrange', 'whiffPunish'],
  },

  [MOVE_KIND.UPPERCUT]: {
    kind: MOVE_KIND.UPPERCUT,

    startupMs: 150,
    activeMs: 80,
    recoveryMs: 240,

    damage: 14,
    hitstunMs: 280,
    hitstopMs: 60,

    knockbackX: 360,
    knockbackY: 520,

    // Tall hitbox: good as an anti-air.
    hitboxWidth: 58,
    hitboxHeight: 98,
    hitboxOffsetX: 22,
    hitboxOffsetY: -44,

    allowedGround: true,
    allowedAir: false,
    landingLagMs: 0,
    tags: ['antiAir', 'vertical', 'commit'],
  },

  [MOVE_KIND.AIR_KICK]: {
    kind: MOVE_KIND.AIR_KICK,

    startupMs: 90,
    activeMs: 90,
    recoveryMs: 180,

    damage: 9,
    hitstunMs: 210,
    hitstopMs: 45,

    knockbackX: 380,
    knockbackY: 260,

    // Downward-leaning air hitbox.
    hitboxWidth: 66,
    hitboxHeight: 56,
    hitboxOffsetX: 24,
    hitboxOffsetY: 28,

    allowedGround: false,
    allowedAir: true,
    landingLagMs: 140,
    tags: ['air', 'down', 'approach'],
  },
}

// Helper: total duration is useful for cooldown decisions.
export function getMoveTotalMs(kind) {
  const move = MOVES[kind]
  return move ? move.startupMs + move.activeMs + move.recoveryMs : 0
}
