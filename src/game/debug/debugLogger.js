// Small console logger with optional throttling.
//
// Why:
// - Debugging canvas "jitter" often requires correlating logs across:
//   React layout changes, Phaser scale events, camera scroll changes, and physics bounds.
// - Raw `console.log` in hot paths will spam and slow the game.
// - This helper provides a consistent prefix + basic throttling.

import { getGameDebugConfig } from './debugConfig.js'

export function createDebugLogger(scope) {
  const cfg = getGameDebugConfig()
  const prefix = `[${scope}]`

  // Per-logger throttle memory.
  const lastAtByKey = new Map()

  function canLog() {
    return Boolean(cfg.enabled)
  }

  function log(...args) {
    if (!canLog()) return
    console.log(prefix, ...args)
  }

  function info(...args) {
    if (!canLog()) return
    console.info(prefix, ...args)
  }

  function warn(...args) {
    if (!canLog()) return
    console.warn(prefix, ...args)
  }

  function error(...args) {
    if (!canLog()) return
    console.error(prefix, ...args)
  }

  function groupCollapsed(title, details) {
    if (!canLog()) return
    console.groupCollapsed(prefix, title)
    if (details !== undefined) log(details)
  }

  function groupEnd() {
    if (!canLog()) return
    console.groupEnd()
  }

  function throttle(key, intervalMs, fn) {
    if (!canLog()) return false

    const now = Date.now()
    const last = Number(lastAtByKey.get(key) ?? 0)
    if (now - last < intervalMs) return false

    lastAtByKey.set(key, now)
    fn()
    return true
  }

  return {
    enabled: Boolean(cfg.enabled),
    verbose: Boolean(cfg.verbose),
    log,
    info,
    warn,
    error,
    groupCollapsed,
    groupEnd,
    throttle,
  }
}
