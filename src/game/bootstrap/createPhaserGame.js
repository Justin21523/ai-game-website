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

export function createPhaserGame({ parent, btJsonText, onDebugSnapshot, debug } = {}) {
  const log = createDebugLogger('PhaserGame')

  // Instantiate the scene with dependencies we want to inject (BT JSON + debug callback).
  const battleScene = new BattleScene({ btJsonText, onDebugSnapshot })

  const config = {
    type: Phaser.AUTO,
    parent,
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
    const parentRect = parent?.getBoundingClientRect?.()
    log.groupCollapsed('create', {
      width: GAME_WIDTH,
      height: GAME_HEIGHT,
      scaleMode: 'FIT',
      autoCenter: 'CENTER_BOTH',
      parent: {
        clientWidth: parent?.clientWidth ?? 0,
        clientHeight: parent?.clientHeight ?? 0,
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
        const parentEl = game.scale?.parent ?? parent
        log.error('READY_canvas-size-zero', {
          canvasClient: { w: canvasClientWidth, h: canvasClientHeight },
          parentClient: { w: parentEl?.clientWidth ?? 0, h: parentEl?.clientHeight ?? 0 },
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
