// This React component is responsible for mounting and unmounting the Phaser game instance.
// Keeping Phaser lifecycle contained here prevents React re-renders from interfering with the game loop.
import { useEffect, useRef } from 'react'

// createPhaserGame builds a Phaser.Game configured for our battle prototype.
import { createPhaserGame } from '../game/bootstrap/createPhaserGame.js'
import { createDebugLogger } from '../game/debug/debugLogger.js'

export default function GameHost({
  btJsonText,
  controlMode,
  aiProfiles,
  restartToken,
  replayCommand,
  stageCommand,
  benchmarkCommand,
  onReplayData,
  onBenchmarkData,
  onDebugSnapshot,
}) {
  // This div is where Phaser will inject its canvas element.
  const containerRef = useRef(null)

  // Store the Phaser.Game instance so we can destroy it on unmount.
  const gameRef = useRef(null)

  // Keep one logger instance so throttling state survives re-renders.
  const logRef = useRef(null)
  if (!logRef.current) logRef.current = createDebugLogger('GameHost')
  const log = logRef.current

  useEffect(() => {
    // Guard against running before the DOM node exists.
    if (!containerRef.current) return

    // Capture the DOM node so cleanup doesn't depend on a possibly-changed ref value.
    const parentEl = containerRef.current

    if (log.enabled) {
      log.groupCollapsed('mount', {
        parentClientWidth: parentEl.clientWidth,
        parentClientHeight: parentEl.clientHeight,
        childCount: parentEl.childNodes.length,
        existingCanvasCount: parentEl.querySelectorAll?.('canvas')?.length ?? 0,
      })
      log.groupEnd()

      // If the parent has 0 size, Phaser FIT will produce a 0-sized canvas (blank screen).
      // This is a common root cause when CSS height isn't applied as expected.
      if (!parentEl.clientWidth || !parentEl.clientHeight) {
        log.error('parent-size-zero', {
          parentClientWidth: parentEl.clientWidth,
          parentClientHeight: parentEl.clientHeight,
        })
      }
    }

    // Defensive: ensure we never accumulate multiple canvases in the same container.
    // This can happen during React StrictMode dev double-invocation or hot reload edge cases.
    parentEl.innerHTML = ''

    // Create the Phaser game only once per mount.
    // React StrictMode mounts/unmounts effects twice in development, so cleanup must be correct.
    const game = createPhaserGame({
      parent: parentEl,
      btJsonText,
      onDebugSnapshot,
      debug: log.enabled,
    })

    gameRef.current = game

    if (log.enabled) {
      // Delay one tick so Phaser has a chance to inject the canvas.
      requestAnimationFrame(() => {
        const canvases = parentEl.querySelectorAll?.('canvas') ?? []
        const canvas = canvases[0] ?? null
        const canvasClientWidth = canvas?.clientWidth ?? 0
        const canvasClientHeight = canvas?.clientHeight ?? 0
        log.groupCollapsed('phaser-created', {
          canvasCount: canvases.length,
          canvasClientWidth,
          canvasClientHeight,
          parentClientWidth: parentEl.clientWidth,
          parentClientHeight: parentEl.clientHeight,
        })
        log.groupEnd()

        // A 0-sized canvas means you won't see anything even if the game is running.
        if (!canvasClientWidth || !canvasClientHeight) {
          log.error('canvas-size-zero', {
            canvasClientWidth,
            canvasClientHeight,
            parentClientWidth: parentEl.clientWidth,
            parentClientHeight: parentEl.clientHeight,
          })
        }
      })
    }

    return () => {
      if (log.enabled) log.groupCollapsed('unmount')

      // Destroy the Phaser instance and remove the canvas from the DOM.
      // `true` also removes any event listeners managed by Phaser.
      gameRef.current?.destroy(true)
      gameRef.current = null

      // Extra safety: clear any leftover DOM nodes if Phaser didn't fully clean up.
      parentEl.innerHTML = ''

      if (log.enabled) {
        log.log({
          remainingCanvasCount: parentEl.querySelectorAll?.('canvas')?.length ?? 0,
          remainingChildCount: parentEl.childNodes.length,
        })
        log.groupEnd()
      }
    }
    // We intentionally do NOT depend on btJsonText here.
    // Re-creating the entire game whenever the JSON changes would be slow and disruptive.
    // Later we will add a method to apply updated BT data to the running scene.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onDebugSnapshot])

  useEffect(() => {
    // Apply control mode updates to the running BattleScene.
    // This allows switching between AI and human control without re-creating the Phaser game.
    let cancelled = false

    function tryApplyMode() {
      if (cancelled) return true

      const game = gameRef.current
      if (!game) return false

      // BattleScene is created by Phaser asynchronously during boot.
      // We retry for a short time to avoid race conditions on first mount.
      const scene = game.scene?.getScene?.('BattleScene')
      if (!scene || typeof scene.setControlMode !== 'function') return false

      scene.setControlMode(controlMode)
      return true
    }

    // Try immediately (works in most cases).
    if (tryApplyMode()) return () => {}

    // Retry on animation frames for up to ~1 second (60 frames).
    let tries = 0
    function rafLoop() {
      if (cancelled) return
      tries += 1
      if (tryApplyMode()) return
      if (tries >= 60) return
      requestAnimationFrame(rafLoop)
    }

    requestAnimationFrame(rafLoop)

    return () => {
      cancelled = true
    }
  }, [controlMode])

  useEffect(() => {
    // Apply AI profile updates (playstyle presets) to the running BattleScene.
    // This allows switching styles without re-creating the Phaser game.
    let cancelled = false

    function tryApplyProfiles() {
      if (cancelled) return true

      const game = gameRef.current
      if (!game) return false

      const scene = game.scene?.getScene?.('BattleScene')
      if (!scene || typeof scene.setAiProfiles !== 'function') return false

      scene.setAiProfiles(aiProfiles)
      return true
    }

    // Try immediately; if the scene isn't ready yet, retry briefly.
    if (tryApplyProfiles()) return () => {}

    let tries = 0
    function rafLoop() {
      if (cancelled) return
      tries += 1
      if (tryApplyProfiles()) return
      if (tries >= 60) return
      requestAnimationFrame(rafLoop)
    }

    requestAnimationFrame(rafLoop)

    return () => {
      cancelled = true
    }
  }, [aiProfiles])

  useEffect(() => {
    // Reset the match on demand (e.g., user clicks "restart match" in the UI).
    let cancelled = false

    function tryResetMatch() {
      if (cancelled) return true

      const game = gameRef.current
      if (!game) return false

      const scene = game.scene?.getScene?.('BattleScene')
      if (!scene || typeof scene.resetMatch !== 'function') return false

      scene.resetMatch()
      return true
    }

    // Do nothing on the initial render (restartToken starts at 0).
    if (!restartToken) return () => {}

    // Try immediately; if the scene isn't ready yet, retry briefly.
    if (tryResetMatch()) return () => {}

    let tries = 0
    function rafLoop() {
      if (cancelled) return
      tries += 1
      if (tryResetMatch()) return
      if (tries >= 60) return
      requestAnimationFrame(rafLoop)
    }

    requestAnimationFrame(rafLoop)

    return () => {
      cancelled = true
    }
  }, [restartToken])

  useEffect(() => {
    // Execute replay-related commands on the running BattleScene.
    // Commands are "fire and forget" except stopRecording, which returns data.
    if (!replayCommand) return () => {}

    let cancelled = false

    function tryRunCommand() {
      if (cancelled) return true

      const game = gameRef.current
      if (!game) return false

      const scene = game.scene?.getScene?.('BattleScene')
      if (!scene) return false

      // Scene API is implemented in BattleScene.
      // We check for methods defensively so the UI never hard-crashes.
      switch (replayCommand.type) {
        case 'startRecording': {
          if (typeof scene.startRecording === 'function') {
            scene.startRecording(replayCommand.payload)
          }
          break
        }
        case 'stopRecording': {
          if (typeof scene.stopRecording === 'function') {
            const data = scene.stopRecording()
            if (data && typeof onReplayData === 'function') onReplayData(data)
          }
          break
        }
        case 'setReplayData': {
          if (typeof scene.setReplayData === 'function') {
            scene.setReplayData(replayCommand.payload)
          }
          break
        }
        case 'clearReplayData': {
          if (typeof scene.clearReplayData === 'function') {
            scene.clearReplayData(replayCommand.payload)
          }
          break
        }
        default: {
          break
        }
      }

      return true
    }

    // Try immediately; if the scene isn't ready yet, retry briefly.
    if (tryRunCommand()) return () => {}

    let tries = 0
    function rafLoop() {
      if (cancelled) return
      tries += 1
      if (tryRunCommand()) return
      if (tries >= 60) return
      requestAnimationFrame(rafLoop)
    }

    requestAnimationFrame(rafLoop)

    return () => {
      cancelled = true
    }
  }, [replayCommand, onReplayData])

  useEffect(() => {
    // Execute stage-related commands (e.g., regenerate tilemap with a new seed/style).
    if (!stageCommand) return () => {}

    let cancelled = false

    function tryRunCommand() {
      if (cancelled) return true

      const game = gameRef.current
      if (!game) return false

      const scene = game.scene?.getScene?.('BattleScene')
      if (!scene) return false

      switch (stageCommand.type) {
        case 'setStageConfig': {
          if (typeof scene.setStageConfig === 'function') {
            scene.setStageConfig(stageCommand.payload)
          }
          break
        }
        case 'setStageRotationConfig': {
          if (typeof scene.setStageRotationConfig === 'function') {
            scene.setStageRotationConfig(stageCommand.payload)
          }
          break
        }
        default: {
          break
        }
      }

      return true
    }

    // Try immediately; if the scene isn't ready yet, retry briefly.
    if (tryRunCommand()) return () => {}

    let tries = 0
    function rafLoop() {
      if (cancelled) return
      tries += 1
      if (tryRunCommand()) return
      if (tries >= 60) return
      requestAnimationFrame(rafLoop)
    }

    requestAnimationFrame(rafLoop)

    return () => {
      cancelled = true
    }
  }, [stageCommand])

  useEffect(() => {
    // Execute benchmark-related commands on the running BattleScene.
    // Benchmark mode is used for AI tuning: run N rounds and collect stats.
    if (!benchmarkCommand) return () => {}

    let cancelled = false

    function tryRunCommand() {
      if (cancelled) return true

      const game = gameRef.current
      if (!game) return false

      const scene = game.scene?.getScene?.('BattleScene')
      if (!scene) return false

      switch (benchmarkCommand.type) {
        case 'startBenchmark': {
          if (typeof scene.startBenchmark === 'function') {
            scene.startBenchmark(benchmarkCommand.payload)
          }
          break
        }
        case 'stopBenchmark': {
          if (typeof scene.stopBenchmark === 'function') {
            scene.stopBenchmark()
          }
          break
        }
        case 'exportBenchmark': {
          if (typeof scene.exportBenchmark === 'function') {
            const data = scene.exportBenchmark()
            if (data && typeof onBenchmarkData === 'function') onBenchmarkData(data)
          }
          break
        }
        default: {
          break
        }
      }

      return true
    }

    // Try immediately; if the scene isn't ready yet, retry briefly.
    if (tryRunCommand()) return () => {}

    let tries = 0
    function rafLoop() {
      if (cancelled) return
      tries += 1
      if (tryRunCommand()) return
      if (tries >= 60) return
      requestAnimationFrame(rafLoop)
    }

    requestAnimationFrame(rafLoop)

    return () => {
      cancelled = true
    }
  }, [benchmarkCommand, onBenchmarkData])

  useEffect(() => {
    // Optional debug: track container resizing and DOM mutations.
    // This is useful for diagnosing "canvas jitter" caused by layout feedback loops.
    if (!log.enabled) return () => {}
    if (!containerRef.current) return () => {}

    const el = containerRef.current

    // ResizeObserver catches size changes that may cause Phaser ScaleManager to resize.
    let ro = null
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => {
        log.throttle('container-resize', 200, () => {
          const rect = el.getBoundingClientRect()
          const canvasCount = el.querySelectorAll?.('canvas')?.length ?? 0
          log.info('container-resize', {
            clientWidth: el.clientWidth,
            clientHeight: el.clientHeight,
            rect: {
              x: Math.round(rect.x * 10) / 10,
              y: Math.round(rect.y * 10) / 10,
              width: Math.round(rect.width * 10) / 10,
              height: Math.round(rect.height * 10) / 10,
            },
            canvasCount,
          })
        })
      })
      ro.observe(el)
    } else {
      log.warn('ResizeObserver not available; container resize logs disabled.')
    }

    // MutationObserver helps confirm we do not accidentally accumulate multiple canvases.
    const mo =
      typeof MutationObserver !== 'undefined'
        ? new MutationObserver(() => {
            log.throttle('container-mutation', 200, () => {
              const canvases = el.querySelectorAll?.('canvas') ?? []
              log.info('container-mutation', {
                childCount: el.childNodes.length,
                canvasCount: canvases.length,
              })
            })
          })
        : null

    mo?.observe?.(el, { childList: true, subtree: false })

    return () => {
      ro?.disconnect?.()
      mo?.disconnect?.()
    }
  }, [log])

  return <div className="gameCanvas" ref={containerRef} />
}
