// Behavior Tree (BT) JSON validation using Zod.
//
// Why validate in the BT Lab:
// - The runtime builder will throw if a node type is unknown or malformed.
// - Validating early gives friendlier, actionable error messages.
// - It prevents saving broken trees to localStorage.
//
// Scope of validation (MVP):
// - Validate the set of supported node types
// - Validate required children / params
// - Provide readable error paths like: children[1].params.kind

import { z } from 'zod'

// Move kinds must match the move data used by Fighter/Combat.
// We keep this list in sync with `src/game/combat/moves.js`.
const MoveKindSchema = z.enum(['light', 'heavy', 'jab', 'sweep', 'uppercut', 'airKick'])

// Shared helpers for BT leaf params.
const PositiveNumberSchema = z
  .number({ invalid_type_error: 'Expected a number' })
  .finite()
  .nonnegative()

const DirectionSchema = z.enum(['auto', 'left', 'right'])
const UtilityAttackModeSchema = z.enum(['neutral', 'punish', 'combo'])

// Recursive node schema.
// Each node has:
// - type: string
// - params?: object
// - children?: array of nodes
export const BtNodeSchema = z.lazy(() =>
  z.union([
    // ---- Composites ----
    z
      .object({
        type: z.literal('Selector'),
        children: z.array(BtNodeSchema).min(1, 'Selector.children must have at least 1 child'),
      })
      .strict(),
    z
      .object({
        type: z.literal('Sequence'),
        children: z.array(BtNodeSchema).min(1, 'Sequence.children must have at least 1 child'),
      })
      .strict(),

    // ---- Decorators ----
    z
      .object({
        type: z.literal('Inverter'),
        children: z.array(BtNodeSchema).length(1, 'Inverter must have exactly 1 child'),
      })
      .strict(),
    z
      .object({
        type: z.literal('Cooldown'),
        params: z
          .object({
            ms: z
              .number({ invalid_type_error: 'Cooldown.params.ms must be a number' })
              .finite()
              .positive()
              .max(60_000, 'Cooldown.params.ms is too large (max 60000)'),
          })
          .partial()
          .optional(),
        children: z.array(BtNodeSchema).length(1, 'Cooldown must have exactly 1 child'),
      })
      .strict(),

    // ---- Conditions ----
    z.object({ type: z.literal('IsOffstage') }).strict(),
    z.object({ type: z.literal('IsTargetAttacking') }).strict(),
    z.object({ type: z.literal('IsTargetRecovering') }).strict(),
    z.object({ type: z.literal('IsTargetInHitstun') }).strict(),
    z
      .object({
        type: z.literal('CanAttack'),
        params: z.object({ kind: MoveKindSchema }).strict(),
      })
      .strict(),
    z
      .object({
        type: z.literal('IsInRange'),
        params: z.object({ kind: MoveKindSchema }).strict(),
      })
      .strict(),

    // ---- Actions ----
    z.object({ type: z.literal('RecoverToStage') }).strict(),
    z
      .object({
        type: z.literal('KeepDistance'),
        params: z
          .object({
            min: PositiveNumberSchema.max(2000, 'KeepDistance.params.min is too large'),
            max: PositiveNumberSchema.max(2000, 'KeepDistance.params.max is too large'),
          })
          .partial()
          .optional(),
      })
      .strict(),
    z
      .object({
        type: z.literal('Strafe'),
        params: z
          .object({
            dir: DirectionSchema,
          })
          .partial()
          .optional(),
      })
      .strict(),
    z
      .object({
        type: z.literal('Approach'),
        params: z
          .object({
            distance: PositiveNumberSchema.max(5000, 'Approach.params.distance is too large'),
          })
          .partial()
          .optional(),
      })
      .strict(),
    z.object({ type: z.literal('Evade') }).strict(),
    z.object({ type: z.literal('Punish') }).strict(),
    z.object({ type: z.literal('MoveToTargetX') }).strict(),
    z.object({ type: z.literal('LightAttack') }).strict(),
    z.object({ type: z.literal('HeavyAttack') }).strict(),
    z
      .object({
        type: z.literal('UtilityAttack'),
        params: z
          .object({
            mode: UtilityAttackModeSchema,
          })
          .partial()
          .optional(),
      })
      .strict(),
  ]),
)

export const KNOWN_BT_NODE_TYPES = [
  'Selector',
  'Sequence',
  'Inverter',
  'Cooldown',
  'IsOffstage',
  'IsTargetAttacking',
  'IsTargetRecovering',
  'IsTargetInHitstun',
  'CanAttack',
  'IsInRange',
  'RecoverToStage',
  'KeepDistance',
  'Strafe',
  'Approach',
  'Evade',
  'Punish',
  'MoveToTargetX',
  'LightAttack',
  'HeavyAttack',
  'UtilityAttack',
]

export function validateBtJsonText(text) {
  // Parse JSON first so we can validate with Zod.
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    return {
      ok: false,
      value: null,
      issues: [
        `JSON parse error: ${error instanceof Error ? error.message : String(error)}`,
      ],
    }
  }

  const result = BtNodeSchema.safeParse(parsed)

  if (result.success) {
    return { ok: true, value: result.data, issues: [] }
  }

  return {
    ok: false,
    value: null,
    issues: formatZodIssues(result.error),
  }
}

export function formatZodIssues(error) {
  // Convert Zod issues into readable strings with JSON-style paths.
  // Example: children[2].params.kind: Invalid enum value. Expected 'light' | 'heavy'
  return error.issues.map((issue) => {
    const path = formatZodPath(issue.path)
    const prefix = path ? `${path}: ` : ''
    return `${prefix}${issue.message}`
  })
}

function formatZodPath(path) {
  if (!path || !path.length) return ''

  // Build paths like: children[0].params.kind
  let out = ''
  for (const segment of path) {
    if (typeof segment === 'number') out += `[${segment}]`
    else out += out ? `.${segment}` : String(segment)
  }
  return out
}
