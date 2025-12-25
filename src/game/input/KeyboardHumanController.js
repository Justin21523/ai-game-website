// KeyboardHumanController converts keyboard state into a Fighter "intent" snapshot.
//
// Why this exists:
// - We want the same control pipeline for humans and AI.
// - Humans and AI both output an intent object (move/jump/attack).
// - The Fighter is the only thing that turns intent into physics + combat.
//
// This separation makes:
// - AI vs AI testing easy (no manual input required)
// - Human takeover easy (toggle one side to "human" at runtime)
// - Debugging clearer (we can display intents in a panel)

import Phaser from 'phaser'

import { createEmptyIntent } from '../entities/Fighter.js'

export const HUMAN_CONTROL_SCHEME = {
  P1: 'p1',
  P2: 'p2',
}

// Keymaps are intentionally simple for MVP.
// - P1 uses WASD + J/K
// - P2 uses Arrows + 1/2
const KEYMAP = {
  [HUMAN_CONTROL_SCHEME.P1]: {
    left: Phaser.Input.Keyboard.KeyCodes.A,
    right: Phaser.Input.Keyboard.KeyCodes.D,
    jump1: Phaser.Input.Keyboard.KeyCodes.W,
    jump2: Phaser.Input.Keyboard.KeyCodes.SPACE,
    down: Phaser.Input.Keyboard.KeyCodes.S,
    dash: Phaser.Input.Keyboard.KeyCodes.U,
    guard: Phaser.Input.Keyboard.KeyCodes.H,
    dodge: Phaser.Input.Keyboard.KeyCodes.L,
    light: Phaser.Input.Keyboard.KeyCodes.J,
    heavy: Phaser.Input.Keyboard.KeyCodes.K,
  },
  [HUMAN_CONTROL_SCHEME.P2]: {
    left: Phaser.Input.Keyboard.KeyCodes.LEFT,
    right: Phaser.Input.Keyboard.KeyCodes.RIGHT,
    jump1: Phaser.Input.Keyboard.KeyCodes.UP,
    jump2: Phaser.Input.Keyboard.KeyCodes.ENTER,
    down: Phaser.Input.Keyboard.KeyCodes.DOWN,
    dash: Phaser.Input.Keyboard.KeyCodes.FIVE,
    guard: Phaser.Input.Keyboard.KeyCodes.THREE,
    dodge: Phaser.Input.Keyboard.KeyCodes.FOUR,
    light: Phaser.Input.Keyboard.KeyCodes.ONE,
    heavy: Phaser.Input.Keyboard.KeyCodes.TWO,
  },
}

export class KeyboardHumanController {
  constructor(scene, { scheme = HUMAN_CONTROL_SCHEME.P1 } = {}) {
    this._scene = scene
    this._scheme = scheme

    const map = KEYMAP[scheme] ?? KEYMAP[HUMAN_CONTROL_SCHEME.P1]

    // Create Phaser Key objects.
    // Using addKey gives us access to isDown and "just down" (edge-trigger) detection.
    this._keys = {
      left: scene.input.keyboard.addKey(map.left),
      right: scene.input.keyboard.addKey(map.right),
      jump1: scene.input.keyboard.addKey(map.jump1),
      jump2: scene.input.keyboard.addKey(map.jump2),
      down: scene.input.keyboard.addKey(map.down),
      dash: scene.input.keyboard.addKey(map.dash),
      guard: scene.input.keyboard.addKey(map.guard),
      dodge: scene.input.keyboard.addKey(map.dodge),
      light: scene.input.keyboard.addKey(map.light),
      heavy: scene.input.keyboard.addKey(map.heavy),
    }

    // Prevent the browser from scrolling when using arrow keys / space.
    // This is especially important when the Phaser canvas does not have focus.
    scene.input.keyboard.addCapture(Object.values(map))
  }

  readIntent() {
    const intent = createEmptyIntent()

    // ---- Horizontal movement (continuous) ----
    const leftDown = this._keys.left.isDown
    const rightDown = this._keys.right.isDown

    // If both are held, we cancel out to 0 (neutral).
    if (leftDown && !rightDown) intent.moveX = -1
    else if (rightDown && !leftDown) intent.moveX = 1
    else intent.moveX = 0

    // ---- Jump (edge-trigger) ----
    // We use JustDown so holding the key does not repeatedly buffer jumps.
    const jumpPressed =
      Phaser.Input.Keyboard.JustDown(this._keys.jump1) ||
      Phaser.Input.Keyboard.JustDown(this._keys.jump2)
    intent.jumpPressed = Boolean(jumpPressed)

    // ---- Fast-fall (continuous while held) ----
    intent.fastFall = Boolean(this._keys.down.isDown)

    // ---- Dash (edge-trigger) ----
    intent.dashPressed = Phaser.Input.Keyboard.JustDown(this._keys.dash)

    // ---- Dodge (edge-trigger) ----
    intent.dodgePressed = Phaser.Input.Keyboard.JustDown(this._keys.dodge)

    // ---- Guard (continuous while held) ----
    intent.guardHeld = Boolean(this._keys.guard.isDown)

    // ---- Attacks (edge-trigger) ----
    // If both are pressed in the same frame, heavy wins by default.
    const heavyPressed = Phaser.Input.Keyboard.JustDown(this._keys.heavy)
    const lightPressed = Phaser.Input.Keyboard.JustDown(this._keys.light)

    if (heavyPressed) intent.attackPressed = 'heavy'
    else if (lightPressed) intent.attackPressed = 'light'

    return intent
  }
}
