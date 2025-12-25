// ReplayRecorder records a stream of Fighter intents over time.
//
// We record "intent snapshots" instead of raw keyboard events because:
// - It keeps the human/AI control pipeline consistent (both produce intents).
// - It is easy to replay deterministically enough for regression testing.
//
// Recording granularity:
// - We record one intent per Phaser update() (frame) along with delta time.
// - This makes playback roughly time-accurate even if frame rate fluctuates.

import { createEmptyIntent } from '../entities/Fighter.js'

export const REPLAY_VERSION = 1

export class ReplayRecorder {
  constructor({ maxFrames = 60 * 60 * 10 } = {}) {
    // Safety limit: prevent unbounded memory growth during long sessions.
    this._maxFrames = maxFrames

    this._isRecording = false
    this._frames = []
    this._durationMs = 0

    // Metadata is optional but helps later (debugging, migrations, UI).
    this._meta = {
      version: REPLAY_VERSION,
      startedAtIso: null,
      notes: null,
    }
  }

  get isRecording() {
    return this._isRecording
  }

  get frameCount() {
    return this._frames.length
  }

  get durationMs() {
    return this._durationMs
  }

  start({ notes } = {}) {
    // Reset previous data.
    this._frames = []
    this._durationMs = 0

    // Mark as active.
    this._isRecording = true

    // Store metadata.
    this._meta = {
      version: REPLAY_VERSION,
      startedAtIso: new Date().toISOString(),
      notes: notes ?? null,
    }
  }

  stop() {
    // Stop recording but keep data available for export().
    this._isRecording = false
    return this.export()
  }

  recordFrame({ dtMs, intent }) {
    // Ignore frames when not recording.
    if (!this._isRecording) return

    // Clamp dt to reasonable bounds to avoid weirdness during tab switching.
    const safeDtMs = clampNumber(dtMs, 0, 200)

    // Enforce max frame count to avoid memory blow-ups.
    if (this._frames.length >= this._maxFrames) {
      this._isRecording = false
      return
    }

    // Store a deep-ish copy so future intent mutations do not affect history.
    const safeIntent = sanitizeIntent(intent)

    this._frames.push({
      dtMs: safeDtMs,
      intent: safeIntent,
    })

    this._durationMs += safeDtMs
  }

  export() {
    // Export a plain JSON-serializable structure.
    return {
      version: REPLAY_VERSION,
      meta: this._meta,
      durationMs: this._durationMs,
      frameCount: this._frames.length,
      frames: this._frames,
    }
  }
}

function sanitizeIntent(intent) {
  // Use defaults so missing fields don't break playback.
  const safe = intent ?? createEmptyIntent()

  return {
    moveX: clampNumber(Number(safe.moveX ?? 0), -1, 1),
    jumpPressed: Boolean(safe.jumpPressed),
    fastFall: Boolean(safe.fastFall),
    dashPressed: Boolean(safe.dashPressed),
    dodgePressed: Boolean(safe.dodgePressed),
    guardHeld: Boolean(safe.guardHeld),
    // Keep null when not pressing an attack.
    attackPressed: typeof safe.attackPressed === 'string' ? safe.attackPressed : null,
  }
}

function clampNumber(value, min, max) {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, value))
}
