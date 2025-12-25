// Debug config helpers shared by React and Phaser runtime code.
//
// We intentionally keep this tiny and dependency-free:
// - Debug output must be easy to enable/disable without rebuilding
// - It must be safe when `window` or `localStorage` are unavailable (SSR / tests)

function safeGetSearchParams() {
  try {
    if (typeof window === 'undefined') return null
    return new URLSearchParams(window.location?.search ?? '')
  } catch {
    return null
  }
}

function safeGetLocalStorageItem(key) {
  try {
    if (typeof window === 'undefined') return null
    return window.localStorage?.getItem?.(key) ?? null
  } catch {
    return null
  }
}

function parseTruthy(value) {
  const v = String(value ?? '').trim().toLowerCase()
  if (!v) return false
  return v === '1' || v === 'true' || v === 'yes' || v === 'on' || v === 'verbose'
}

function parseFalsy(value) {
  const v = String(value ?? '').trim().toLowerCase()
  if (!v) return false
  return v === '0' || v === 'false' || v === 'no' || v === 'off'
}

export function getGameDebugConfig() {
  const params = safeGetSearchParams()
  const urlDebug = params?.get?.('debug')
  const urlVerbose = params?.get?.('debugVerbose')

  // Allow localStorage overrides so you can keep debug on across refreshes.
  const storedDebug = safeGetLocalStorageItem('DEBUG_GAME')
  const storedVerbose = safeGetLocalStorageItem('DEBUG_GAME_VERBOSE')

  // Base default:
  // - In dev builds, enable debug by default (easy iteration)
  // - In production builds, default to off unless explicitly enabled
  const defaultEnabled = Boolean(import.meta?.env?.DEV)

  // `?debug=0` (or stored 0) should force-disable debug even in DEV.
  const forcedOff = parseFalsy(urlDebug) || parseFalsy(storedDebug)

  const enabled = forcedOff
    ? false
    : parseTruthy(urlDebug) || parseTruthy(storedDebug) || defaultEnabled

  const verbose = enabled
    ? parseTruthy(urlDebug) || parseTruthy(urlVerbose) || parseTruthy(storedVerbose)
    : false

  return { enabled, verbose }
}

export function isGameDebugEnabled() {
  return Boolean(getGameDebugConfig().enabled)
}

export function isGameDebugVerbose() {
  return Boolean(getGameDebugConfig().verbose)
}
