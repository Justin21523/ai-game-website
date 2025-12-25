// AI profile presets ("playstyles") used by BotAgent + BT leaf nodes.
//
// Goal:
// - Let you switch between multiple recognizable playstyles without rewriting the BT.
// - Keep the mechanism stable: profiles only change weights/thresholds, not core rules.
//
// Notes:
// - Values are intentionally simple numbers so they can be displayed, tuned, and learned.
// - A profile is NOT a complete AI. It is a tuning layer on top of the BT + utility scoring.

export const AI_PROFILE_ID = {
  BALANCED: 'balanced',
  AGGRESSIVE: 'aggressive',
  DEFENSIVE: 'defensive',
  PUNISHER: 'punisher',
}

export const AI_PROFILES = {
  [AI_PROFILE_ID.BALANCED]: {
    id: AI_PROFILE_ID.BALANCED,
    labelZh: '平衡',
    descriptionZh: '攻防平均、會追擊也會防守，適合當基準。',

    // How willing the AI is to take risks to get damage.
    aggression: 0.55,

    // How strongly the AI prefers blocking/dodging when threatened.
    defense: 0.55,

    // Spacing band used by "keep distance" and utility scoring (in pixels).
    spacingMin: 75,
    spacingMax: 150,

    // Preferred reaction horizon for threat prediction (ms).
    threatHorizonMs: 220,

    // Movement tendencies.
    dashChance: 0.35,
  },

  [AI_PROFILE_ID.AGGRESSIVE]: {
    id: AI_PROFILE_ID.AGGRESSIVE,
    labelZh: '激進',
    descriptionZh: '更常主動貼身、用 dash 壓制、追擊命中後加壓。',

    aggression: 0.85,
    defense: 0.35,

    spacingMin: 55,
    spacingMax: 120,

    threatHorizonMs: 200,
    dashChance: 0.6,
  },

  [AI_PROFILE_ID.DEFENSIVE]: {
    id: AI_PROFILE_ID.DEFENSIVE,
    labelZh: '保守',
    descriptionZh: '更重視安全距離與防守，偏向 block/dodge 等反應。',

    aggression: 0.35,
    defense: 0.85,

    spacingMin: 95,
    spacingMax: 185,

    threatHorizonMs: 250,
    dashChance: 0.18,
  },

  [AI_PROFILE_ID.PUNISHER]: {
    id: AI_PROFILE_ID.PUNISHER,
    labelZh: '反擊',
    descriptionZh: '更常等對手出招後懲罰，強調 whiff punish 與 anti-air。',

    aggression: 0.5,
    defense: 0.7,

    spacingMin: 90,
    spacingMax: 170,

    threatHorizonMs: 240,
    dashChance: 0.25,
  },
}

export const AI_PROFILE_OPTIONS = Object.values(AI_PROFILES).map((p) => ({
  id: p.id,
  labelZh: p.labelZh,
  descriptionZh: p.descriptionZh,
}))

export function normalizeAiProfileId(value) {
  const v = String(value ?? '')
  return Object.prototype.hasOwnProperty.call(AI_PROFILES, v) ? v : AI_PROFILE_ID.BALANCED
}

export function getAiProfile(profileId) {
  return AI_PROFILES[normalizeAiProfileId(profileId)]
}

