// ReplayController plays back a ReplayRecorder export (frames of intent + dtMs).
//
// The controller is intentionally "dumb":
// - It does not know about physics or the world.
// - It only returns an intent snapshot appropriate for the current playback time.
//
// This makes it reusable:
// - AI vs Replay
// - Replay vs Replay
// - Regression tests (same input stream after code changes)

import { createEmptyIntent } from '../entities/Fighter.js'

export class ReplayController {
  constructor({ replayData, loop = true } = {}) {
    this._loop = Boolean(loop)

    // Normalize to a predictable structure.
    this._frames = Array.isArray(replayData?.frames) ? replayData.frames : []

    // Playback state.
    this._index = 0
    this._remainingMsInFrame = this._frames.length ? this._frames[0].dtMs : 0
  }

  get loop() {
    return this._loop
  }

  set loop(value) {
    this._loop = Boolean(value)
  }

  get frameCount() {
    return this._frames.length
  }

  reset() {
    this._index = 0
    this._remainingMsInFrame = this._frames.length ? Number(this._frames[0].dtMs ?? 0) : 0
  }

  readIntent({ deltaMs }) {
    // No replay loaded: return empty input.
    if (!this._frames.length) return createEmptyIntent()

    // Advance playback time by deltaMs.
    let remaining = clampNumber(deltaMs, 0, 200)

    // Step through frames until we find the correct current frame.
    while (remaining > 0) {
      // If we are at/after the end, either loop or stop advancing.
      if (this._index >= this._frames.length) {
        if (!this._loop) break
        this.reset()
      }

      // Ensure remaining time is initialized for the current frame.
      if (this._remainingMsInFrame <= 0) {
        this._remainingMsInFrame = Number(this._frames[this._index].dtMs ?? 0)
      }

      // If the current frame can absorb the entire delta, just subtract and stop.
      if (remaining < this._remainingMsInFrame) {
        this._remainingMsInFrame -= remaining
        remaining = 0
        break
      }

      // Otherwise consume this frame and move to the next one.
      remaining -= this._remainingMsInFrame
      this._index += 1
      this._remainingMsInFrame = 0
    }

    // Clamp index to valid range for reading.
    const clampedIndex = Math.min(this._index, this._frames.length - 1)

    // Return a copy to avoid accidental mutation by callers.
    const intent = this._frames[clampedIndex]?.intent
    return {
      moveX: clampNumber(Number(intent?.moveX ?? 0), -1, 1),
      jumpPressed: Boolean(intent?.jumpPressed),
      fastFall: Boolean(intent?.fastFall),
      dashPressed: Boolean(intent?.dashPressed),
      dodgePressed: Boolean(intent?.dodgePressed),
      guardHeld: Boolean(intent?.guardHeld),
      attackPressed:
        typeof intent?.attackPressed === 'string' ? intent.attackPressed : null,
    }
  }
}

function clampNumber(value, min, max) {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, value))
}
