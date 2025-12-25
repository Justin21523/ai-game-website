// Human-friendly (Traditional Chinese) explanations for AI decisions.
//
// The goal is NOT to be a perfect natural-language generator.
// The goal is to turn "reason codes" + a small blackboard snapshot into
// clear, actionable explanations for learning and debugging.

// Convert a single agent snapshot (from debugSnapshot.ai.left/right) into display strings.
export function explainAiAgentSnapshot(agent) {
  if (!agent) {
    return {
      headline: '（此邊目前不是 AI 控制）',
      details: [],
    }
  }

  const reasons = Array.isArray(agent.reasons) ? agent.reasons : []
  const blackboard = agent.blackboard ?? {}

  const dx = Number(blackboard.targetDx ?? 0)
  const dy = Number(blackboard.targetDy ?? 0)
  const hp = Number(blackboard.selfHp ?? 0)
  const onGround = Boolean(blackboard.onGround)

  // Pick a primary explanation based on the highest-priority reason.
  const headline = pickHeadline({ reasons })

  // Provide supporting context so you can connect the decision to the game state.
  const details = [
    `距離：dx=${dx}、dy=${dy}`,
    `自身：HP=${hp}、${onGround ? '著地' : '空中'}`,
  ]

  // If there is a BT error, surface it clearly.
  const errorReason = reasons.find((r) => typeof r === 'string' && r.startsWith('BT_ERROR:'))
  if (errorReason) details.unshift(`BT 錯誤：${errorReason.replace('BT_ERROR:', '')}`)

  return { headline, details }
}

function pickHeadline({ reasons }) {
  // Helpers:
  // - Some reason codes are dynamic strings (e.g., "KEEP_DISTANCE_RETREAT(min=70)"),
  //   so we match by prefix instead of exact equality.
  const has = (code) => reasons.includes(code)
  const hasPrefix = (prefix) =>
    reasons.some((r) => typeof r === 'string' && r.startsWith(prefix))

  // Recovery (highest priority)
  if (has('RECOVER_TO_STAGE')) return '回場：因為目前離開舞台邊界，需要先回到安全區域。'

  // Defense / threat response
  if (has('DEFEND_DODGE')) return '迴避：偵測到即將命中，使用 Dodge 躲避並拉開距離。'
  if (has('DEFEND_BLOCK')) return '防守：偵測到威脅但有時間反應，選擇 Guard 擋下攻擊。'
  if (has('DEFEND_JUMP')) return '脫離：偵測到威脅且有時間，跳躍位移改變節奏。'

  // Attacks (next priority)
  if (has('PUNISH')) return '懲罰：對手收招中，嘗試靠近並用高回報招式反擊。'
  if (has('HIT_CONFIRM_COMBO')) return '連段：命中確認後，嘗試追加追擊/連段輸出。'
  if (has('HIT_CONFIRM_PRESSURE')) return '壓制：對手擋下攻擊後，改用較安全的壓制選擇。'
  if (has('TARGET_IN_HITSTUN')) return '加壓：對手在硬直中，嘗試貼身追擊並追加輸出。'
  if (hasPrefix('ATTACK_SELECT:')) {
    const raw = reasons.find((r) => typeof r === 'string' && r.startsWith('ATTACK_SELECT:'))
    const kind = String(raw ?? '').replace('ATTACK_SELECT:', '')
    const label = moveLabelZh(kind)
    return `出招：選擇「${label}」因為目前距離/高度/風險回報最合適。`
  }
  if (has('ATTACK_HEAVY')) return '出招：重攻擊（舊版 BT 節點）。'
  if (has('ATTACK_LIGHT')) return '出招：輕攻擊（舊版 BT 節點）。'

  // Platform navigation (platform fighter specific)
  if (has('JUMP_TO_PLATFORM')) return '跳上平台：對手在更高處，嘗試取得制高點/追擊路線。'
  if (has('DROP_THROUGH_PLATFORM'))
    return '下穿平台：對手在更低處，從單向平台下穿以追擊/換位。'
  if (has('NAV_DROP_WALK_TO_EDGE') || has('WALK_TO_DROP_EDGE'))
    return '下追：對手在更低的平台，先走到邊緣準備落下。'
  if (has('NAV_DROP_FAST_FALL') || has('FAST_FALL_TO_LAND'))
    return '下追：離開平台後快速下落，縮短落地時間以追擊。'
  if (has('NAVIGATE_PLATFORM')) return '平台導航：對手在不同平台，正在移動到下一個平台接近對手。'

  // Movement / chase
  if (hasPrefix('KEEP_DISTANCE_RETREAT')) return '控距：距離太近，先後退拉開到安全距離。'
  if (hasPrefix('KEEP_DISTANCE_APPROACH')) return '控距：距離太遠，先靠近到理想距離。'
  if (has('STRAFE')) return '走位：在理想距離內左右微調，等待更好的出手機會。'
  if (has('PUNISH_APPROACH')) return '追擊：對手收招中，嘗試靠近以便懲罰。'
  if (has('DASH_PUNISH')) return '追擊：用 Dash 加速接近，以把握懲罰窗口。'
  if (has('DASH_IN')) return '追擊：用 Dash 快速接近，進入可出招距離。'
  if (has('DASH_COMBO')) return '追擊：命中後用 Dash 追擊，延長輸出窗口。'
  if (has('DASH_CHASE')) return '追擊：距離很遠，用 Dash 加速追上對手。'
  if (has('DASH_APPROACH')) return '追擊：距離偏遠，用 Dash 加速接近。'
  if (has('APPROACH_FOR_ATTACK')) return '接近：為了進入招式距離，先向對手靠近。'
  if (has('APPROACH')) return '追擊：朝向對手位置靠近。'
  if (has('MOVE_TO_TARGET')) return '接近：目前不在攻擊距離內，先靠近對手。'

  // Fallback
  return '待機/調整：目前沒有足夠條件做出更明確的行為。'
}

function moveLabelZh(kind) {
  // A small label table for the current move set.
  // Keep it robust to unknown values so older replays/BT JSON won't crash the UI.
  const k = String(kind ?? '')
  if (k === 'jab') return 'Jab（快拳）'
  if (k === 'light') return 'Light（輕攻擊）'
  if (k === 'sweep') return 'Sweep（下段掃）'
  if (k === 'heavy') return 'Heavy（重攻擊）'
  if (k === 'uppercut') return 'Uppercut（對空）'
  if (k === 'airKick') return 'AirKick（空中踢）'
  return k || '（未知招式）'
}
