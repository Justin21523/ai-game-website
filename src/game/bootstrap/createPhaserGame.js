// This module creates a Phaser.Game instance configured for our platform-brawl prototype.
import Phaser from 'phaser'

import { BattleScene } from '../scenes/BattleScene.js'
import { createDebugLogger } from '../debug/debugLogger.js'

// Fixed internal resolution keeps physics and feel consistent.
// The canvas can be scaled by Phaser's Scale Manager to fit the container.
// We keep this larger than the typical on-page display size so:
// - the camera can show more of the stage
// - UI text stays crisp when downscaled
const GAME_WIDTH = 1280
const GAME_HEIGHT = 720

// ---- React / hot-reload safety ----
//
// In development (React StrictMode, route transitions, hot reload), it's easy to accidentally
// create multiple Phaser.Game instances for the same DOM parent. That can lead to:
// - multiple canvases stacked in the same container ("flicker")
// - multiple scenes/physics worlds running (duplicate logic, confusing behavior)
//
// GameHost already tries to prevent this, but we keep an extra guardrail here so
// `createPhaserGame()` stays safe even if called more than once.
const PB_GAME_KEY = Symbol.for('reactai-platform-brawl:phaserGame')

function resolveParentElement(parent) {
  if (!parent) return null
  if (typeof parent !== 'string') return parent
  try {
    if (typeof document === 'undefined') return null
    return document.getElementById(parent)
  } catch {
    return null
  }
}

function cleanupParentCanvases(parentEl) {
  // Remove stray canvases left behind by interrupted hot reload / failed cleanup.
  if (!parentEl?.querySelectorAll) return
  const canvases = parentEl.querySelectorAll('canvas')
  for (const canvas of canvases) {
    try {
      canvas.remove?.()
    } catch {
      try {
        parentEl.removeChild(canvas)
      } catch {
        // ignore
      }
    }
  }
}

function isProbablyAlivePhaserGame(game) {
  if (!game) return false
  if (game.isDestroyed || game.destroyed || game.pendingDestroy) return false
  return Boolean(game.canvas && game.events)
}

export function createPhaserGame({ parent, btJsonText, onDebugSnapshot, debug } = {}) {
  const log = createDebugLogger('PhaserGame')

  const parentEl = resolveParentElement(parent) ?? parent

  // Defensive: destroy any previous game bound to the same parent.
  // This prevents multiple game loops from running if something calls createPhaserGame twice.
  const existingGame = parentEl?.[PB_GAME_KEY]
  if (isProbablyAlivePhaserGame(existingGame) && typeof existingGame.destroy === 'function') {
    if (debug || log.enabled) log.warn('destroy-existing-game')
    try {
      existingGame.destroy(true)
    } catch (error) {
      if (debug || log.enabled) {
        log.error('destroy-existing-game-failed', {
          message: error instanceof Error ? error.message : String(error),
        })
      }
    }
  } else if (existingGame) {
    // Clear stale references from older sessions.
    try {
      delete parentEl[PB_GAME_KEY]
    } catch {
      // ignore
    }
  }

  // Clean up any stray canvases regardless of whether we had a stored reference.
  cleanupParentCanvases(parentEl)

  // Instantiate the scene with dependencies we want to inject (BT JSON + debug callback).
  const battleScene = new BattleScene({ btJsonText, onDebugSnapshot })

  const config = {
    type: Phaser.AUTO,
    parent: parentEl,
    width: GAME_WIDTH,
    height: GAME_HEIGHT,
    backgroundColor: '#0d1117',
    // Rendering config:
    // - roundPixels reduces sub-pixel jitter when the camera moves.
    //   This is especially noticeable in platform games with tilemaps.
    render: {
      roundPixels: true,
    },
    physics: {
      default: 'arcade',
      arcade: {
        gravity: { y: 1400 },
        debug: false,
      },
    },
    // Scale the game canvas to fit its parent container while preserving aspect ratio.
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      // Avoid Phaser trying to "help" by changing parent CSS to 100% height.
      // We control container sizing via `.gameCanvas` styles in React.
      expandParent: false,
      // Rounding the computed display size helps prevent sub-pixel resize thrashing
      // (which can look like the canvas is constantly growing/shrinking).
      autoRound: true,
      width: GAME_WIDTH,
      height: GAME_HEIGHT,
    },
    scene: [battleScene],
  }

  if (debug || log.enabled) {
    // Log the initial config and parent element size.
    const parentRect = parentEl?.getBoundingClientRect?.()
    log.groupCollapsed('create', {
      width: GAME_WIDTH,
      height: GAME_HEIGHT,
      scaleMode: 'FIT',
      autoCenter: 'CENTER_BOTH',
      parent: {
        clientWidth: parentEl?.clientWidth ?? 0,
        clientHeight: parentEl?.clientHeight ?? 0,
        rect: parentRect
          ? {
              x: Math.round(parentRect.x * 10) / 10,
              y: Math.round(parentRect.y * 10) / 10,
              width: Math.round(parentRect.width * 10) / 10,
              height: Math.round(parentRect.height * 10) / 10,
            }
          : null,
      },
    })
    log.groupEnd()
  }

  const game = new Phaser.Game(config)

  // Store a reference for safety/idempotency, and clear it on destroy.
  if (parentEl) {
    try {
      parentEl[PB_GAME_KEY] = game
    } catch {
      // ignore
    }

    game.events.once(Phaser.Core.Events.DESTROY, () => {
      try {
        if (parentEl[PB_GAME_KEY] === game) delete parentEl[PB_GAME_KEY]
      } catch {
        // ignore
      }
    })
  }

  if (debug || log.enabled) {
    // ---- Core lifecycle ----
    const onBoot = () => log.info('BOOT')
    const onReady = () => {
      const canvasClientWidth = game.canvas?.clientWidth ?? 0
      const canvasClientHeight = game.canvas?.clientHeight ?? 0

      log.info('READY', {
        config: { width: game.config.width, height: game.config.height },
        canvasClient: { w: canvasClientWidth, h: canvasClientHeight },
      })

      // A 0-sized canvas indicates a parent layout/CSS issue (blank screen).
      if (!canvasClientWidth || !canvasClientHeight) {
        const parentNode = game.scale?.parent ?? parentEl
        log.error('READY_canvas-size-zero', {
          canvasClient: { w: canvasClientWidth, h: canvasClientHeight },
          parentClient: { w: parentNode?.clientWidth ?? 0, h: parentNode?.clientHeight ?? 0 },
        })
      }
    }
    const onDestroy = () => log.info('DESTROY')

    game.events.on(Phaser.Core.Events.BOOT, onBoot)
    game.events.on(Phaser.Core.Events.READY, onReady)
    game.events.once(Phaser.Core.Events.DESTROY, onDestroy)

    // ---- Visibility / focus ----
    game.events.on(Phaser.Core.Events.HIDDEN, () => log.warn('HIDDEN'))
    game.events.on(Phaser.Core.Events.VISIBLE, () => log.info('VISIBLE'))
    game.events.on(Phaser.Core.Events.BLUR, () => log.warn('BLUR'))
    game.events.on(Phaser.Core.Events.FOCUS, () => log.info('FOCUS'))

    // ---- Scale events ----
    // These logs are essential for diagnosing canvas jitter caused by repeated resize cycles.
    const onResize = (gameSize, baseSize, displaySize, prevW, prevH) => {
      // Throttle because resize can fire rapidly when the browser layout changes.
      log.throttle('scale-resize', 150, () => {
        const canvasRect = game.canvas?.getBoundingClientRect?.()
        const parentEl = game.scale?.parent ?? parent
        const parentRect = parentEl?.getBoundingClientRect?.()

        log.warn('SCALE_RESIZE', {
          prev: { w: prevW ?? null, h: prevH ?? null },
          gameSize: gameSize ? { w: gameSize.width, h: gameSize.height } : null,
          baseSize: baseSize ? { w: baseSize.width, h: baseSize.height } : null,
          displaySize: displaySize ? { w: displaySize.width, h: displaySize.height } : null,
          canvasRect: canvasRect
            ? {
                x: Math.round(canvasRect.x * 10) / 10,
                y: Math.round(canvasRect.y * 10) / 10,
                width: Math.round(canvasRect.width * 10) / 10,
                height: Math.round(canvasRect.height * 10) / 10,
              }
            : null,
          parentRect: parentRect
            ? {
                x: Math.round(parentRect.x * 10) / 10,
                y: Math.round(parentRect.y * 10) / 10,
                width: Math.round(parentRect.width * 10) / 10,
                height: Math.round(parentRect.height * 10) / 10,
              }
            : null,
        })
      })
    }

    // Scale manager is available after boot; attach immediately anyway (safe in Phaser 3.90).
    game.scale?.on?.(Phaser.Scale.Events.RESIZE, onResize)

    // Ensure we clean up the scale listener when the game is destroyed.
    game.events.once(Phaser.Core.Events.DESTROY, () => {
      game.scale?.off?.(Phaser.Scale.Events.RESIZE, onResize)
      game.events.off(Phaser.Core.Events.BOOT, onBoot)
      game.events.off(Phaser.Core.Events.READY, onReady)
    })
  }

  return game
}
