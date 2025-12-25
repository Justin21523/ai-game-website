// Default Behavior Tree JSON used when no custom BT is provided.
// This tree is intentionally small:
// - If offstage: recover
// - Evade if threatened
// - Punish opponent recovery
// - Prefer heavy/light attacks when in range
// - Otherwise: maintain spacing + strafe, or navigate toward the target

export const DEFAULT_BT_JSON = {
  type: 'Selector',
  children: [
    {
      type: 'Sequence',
      children: [{ type: 'IsOffstage' }, { type: 'RecoverToStage' }],
    },
    // Defensive reaction (returns SUCCESS only when it triggers).
    { type: 'Evade' },

    // Whiff punish / recovery punish (RUNNING while closing, SUCCESS when attack is issued).
    { type: 'Punish' },

    // Hit-confirm / pressure:
    // When the opponent is in hitstun, try to land a follow-up using a faster utility choice.
    {
      type: 'Sequence',
      children: [
        { type: 'IsTargetInHitstun' },
        { type: 'UtilityAttack', params: { mode: 'combo' } },
      ],
    },

    // Main combat decision: pick the best move by utility scoring.
    { type: 'UtilityAttack' },

    // Neutral movement: keep a reasonable distance band and strafe a bit while waiting for cooldowns.
    {
      type: 'Sequence',
      children: [
        // No params: let the AI profile decide the spacing band.
        { type: 'KeepDistance' },
        { type: 'Strafe' },
      ],
    },
    { type: 'MoveToTargetX' },
  ],
}
