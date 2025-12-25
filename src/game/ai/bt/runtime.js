// Behavior Tree (BT) runtime.
//
// This is intentionally small for MVP:
// - SUCCESS / FAILURE / RUNNING statuses
// - Composite nodes: Selector, Sequence
// - Decorators: Inverter (optional), Cooldown (optional)
// - Leaf nodes: Condition / Action (provided via factories)
//
// The most important design choice:
// - The BT does not directly move physics bodies.
// - Instead it writes to an "intent" object (move/jump/attack), which the Fighter executes.

export const BT_STATUS = {
  SUCCESS: 'SUCCESS',
  FAILURE: 'FAILURE',
  RUNNING: 'RUNNING',
}

// Base node class with trace support.
export class BtNode {
  constructor(name) {
    this.name = name
  }

  tick(ctx) {
    // Run the node and record the result in ctx.trace for explainability.
    const status = this.run(ctx)
    if (ctx?.trace) ctx.trace.push({ name: this.name, status })
    return status
  }

  // Subclasses implement run(ctx) and return a BT_STATUS value.
  run() {
    throw new Error('BtNode.run not implemented')
  }
}

export class SelectorNode extends BtNode {
  constructor({ name = 'Selector', children = [] } = {}) {
    super(name)
    this.children = children
  }

  run(ctx) {
    for (const child of this.children) {
      const status = child.tick(ctx)
      if (status === BT_STATUS.SUCCESS) return BT_STATUS.SUCCESS
      if (status === BT_STATUS.RUNNING) return BT_STATUS.RUNNING
    }
    return BT_STATUS.FAILURE
  }
}

export class SequenceNode extends BtNode {
  constructor({ name = 'Sequence', children = [] } = {}) {
    super(name)
    this.children = children
  }

  run(ctx) {
    for (const child of this.children) {
      const status = child.tick(ctx)
      if (status === BT_STATUS.FAILURE) return BT_STATUS.FAILURE
      if (status === BT_STATUS.RUNNING) return BT_STATUS.RUNNING
    }
    return BT_STATUS.SUCCESS
  }
}

export class InverterNode extends BtNode {
  constructor({ name = 'Inverter', child } = {}) {
    super(name)
    this.child = child
  }

  run(ctx) {
    const status = this.child.tick(ctx)
    if (status === BT_STATUS.SUCCESS) return BT_STATUS.FAILURE
    if (status === BT_STATUS.FAILURE) return BT_STATUS.SUCCESS
    return BT_STATUS.RUNNING
  }
}

export class CooldownNode extends BtNode {
  constructor({ name = 'Cooldown', child, cooldownMs = 250 } = {}) {
    super(name)
    this.child = child
    this.cooldownMs = cooldownMs

    // Store last success time on the node instance.
    // IMPORTANT: do not share a single BT tree instance between multiple agents,
    // otherwise cooldown state would leak across agents.
    this._lastSuccessAtMs = -Infinity
  }

  run(ctx) {
    const nowMs = ctx?.nowMs ?? 0

    // If we are still within cooldown, fail fast.
    if (nowMs - this._lastSuccessAtMs < this.cooldownMs) return BT_STATUS.FAILURE

    const status = this.child.tick(ctx)

    // Only start cooldown when the child succeeds (common pattern).
    if (status === BT_STATUS.SUCCESS) this._lastSuccessAtMs = nowMs

    return status
  }
}

export class LeafNode extends BtNode {
  constructor({ name, fn }) {
    super(name)
    this._fn = fn
  }

  run(ctx) {
    return this._fn(ctx)
  }
}

// Build a BT tree from JSON.
// - json must be an object with at least `{ type: string }`
// - leafFactories maps leaf `type` to a function that returns a BtNode
export function buildBtTreeFromJson(json, leafFactories) {
  if (!json || typeof json !== 'object') throw new Error('BT JSON root must be an object')
  if (typeof json.type !== 'string') throw new Error('BT JSON node must have string "type"')

  const type = json.type
  const params = typeof json.params === 'object' && json.params ? json.params : {}
  const childrenJson = Array.isArray(json.children) ? json.children : []

  // Composite nodes.
  if (type === 'Selector') {
    return new SelectorNode({
      name: 'Selector',
      children: childrenJson.map((child) => buildBtTreeFromJson(child, leafFactories)),
    })
  }

  if (type === 'Sequence') {
    return new SequenceNode({
      name: 'Sequence',
      children: childrenJson.map((child) => buildBtTreeFromJson(child, leafFactories)),
    })
  }

  // Decorators.
  if (type === 'Inverter') {
    if (childrenJson.length !== 1) throw new Error('Inverter must have exactly 1 child')
    return new InverterNode({
      name: 'Inverter',
      child: buildBtTreeFromJson(childrenJson[0], leafFactories),
    })
  }

  if (type === 'Cooldown') {
    if (childrenJson.length !== 1) throw new Error('Cooldown must have exactly 1 child')
    return new CooldownNode({
      name: `Cooldown(${Number(params.ms ?? 250)}ms)`,
      cooldownMs: Number(params.ms ?? 250),
      child: buildBtTreeFromJson(childrenJson[0], leafFactories),
    })
  }

  // Leaf nodes (conditions/actions) are created through factories.
  const factory = leafFactories?.[type]
  if (typeof factory !== 'function') {
    throw new Error(`Unknown BT node type: "${type}"`)
  }

  return factory(params)
}
