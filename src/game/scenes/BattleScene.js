// BattleScene is the main gameplay scene for the platform-brawl prototype.
// It owns the stage (platforms), fighters, AI ticking, and debug snapshot emission.
import Phaser from 'phaser'

import { MOVES } from '../combat/moves.js'
import { createEmptyIntent, Fighter } from '../entities/Fighter.js'
import { BotAgent } from '../ai/BotAgent.js'
import { normalizeAiProfileId } from '../ai/aiProfiles.js'
import { createPlatformBrawlBtTree, parseBtJsonText } from '../ai/platformBrawlBt.js'
import {
  HUMAN_CONTROL_SCHEME,
  KeyboardHumanController,
} from '../input/KeyboardHumanController.js'
import { ReplayController } from '../input/ReplayController.js'
import { ReplayRecorder } from '../input/ReplayRecorder.js'
import {
  PLAYER_CHARACTER,
  ensurePlayerAnimations,
  preloadPlayerCharacters,
  getAnimKey,
  getCharacterFrameStats,
  getFrameKey,
} from '../assets/playerCharacters.js'
import { buildPlatformGraph, buildPlatformNodes } from '../stage/platformGraph.js'
import { buildTileStage } from '../stage/tileStageBuilder.js'
import { createStageDefinition } from '../stage/tileStageGenerator.js'
import { validateBrawlStage } from '../stage/stageValidator.js'
import { BACKGROUND_KEYS, preloadStageAssets } from '../stage/tilesetAtlas.js'
import { createDebugLogger } from '../debug/debugLogger.js'

// Control modes are string-based so they can be passed easily across the React → Phaser boundary.
export const CONTROL_MODE = {
  AI: 'ai',
  HUMAN: 'human',
  REPLAY: 'replay',
}

// Round phases let us implement "KO pause" without global timeScale hacks.
const ROUND_PHASE = {
  FIGHT: 'fight',
  KO: 'ko',
  DONE: 'done',
}

// BattleScene instances can be created/destroyed multiple times in development
// (React StrictMode, hot reload, route transitions). Giving each instance a stable
// id helps diagnose "multiple games running" bugs from the debug JSON alone.
let NEXT_BATTLE_SCENE_INSTANCE_ID = 1

export class BattleScene extends Phaser.Scene {
  constructor({ btJsonText, onDebugSnapshot } = {}) {
    super({ key: 'BattleScene' })

    // Stable per-instance id for debugging. (Not related to match rounds.)
    this._instanceId = NEXT_BATTLE_SCENE_INSTANCE_ID++

    // Central logger for this scene instance.
    // Use `?debug=1` (or localStorage DEBUG_GAME=1) to enable.
    this._log = createDebugLogger(`BattleScene#${this._instanceId}`)

    if (this._log.enabled) {
      this._log.groupCollapsed('constructor', {
        instanceId: this._instanceId,
        hasBtJsonText: Boolean(btJsonText),
      })
      this._log.groupEnd()
    }

    // Store the initial Behavior Tree JSON text so we can parse it later.
    this._initialBtJsonText = btJsonText ?? null

    // Callback for sending lightweight debug data to React UI.
    this._onDebugSnapshot = typeof onDebugSnapshot === 'function' ? onDebugSnapshot : null

    // Keep references to stage objects we need to update/destroy when regenerating stages.
    // We build multiple Tilemaps (background/terrain/foreground), so we store them in an array.
    // The terrain layer is additionally stored separately because we need it for collisions/queries.
    this._tilemaps = []
    this._tileLayer = null
    this._tileBackgroundLayer = null
    this._tileForegroundLayer = null
    this._tileColliders = []

    // For AI navigation we still keep a list of "top surface" platform rectangles.
    // These are derived from the tilemap collision grid (see tileStageBuilder.js).
    this._platformSurfaces = []

    // Non-colliding stage decorations (sprites).
    this._stageDecorations = []

    // One-way tile indices (0-based) are read from `/assets/tileset.json`.
    // Used by Arcade Physics processCallback to implement "jump through, land on top".
    this._oneWayTileIndices = []
    this._oneWayTileIndexSet = new Set()
    this._leftFighter = null
    this._rightFighter = null

    // Stage metadata used by AI and debug tooling.
    this._stage = {
      // These are fallback values; the tile stage rebuild will overwrite them.
      // Keep them aligned with the Phaser internal resolution for consistent defaults.
      width: 1280,
      height: 720,
      centerX: 640,
      offstageMargin: 40,
    }

    // Stage generation configuration (style + seed).
    // We default to random so every page load can look a bit different,
    // while still allowing deterministic reproduction via explicit seeds.
    this._stageConfig = {
      style: 'procedural:random',
      seed: null,
    }

    // Stage rotation settings (used for "watch AI tournament" mode).
    // When enabled, we generate a new stage after KO based on a deterministic seed sequence.
    this._stageRotation = {
      enabled: false,
      everyNRounds: 1,
    }

    // Derived stage meta (for UI/debug).
    this._stageMeta = null

    // Spawn points derived from the generated stage.
    this._spawns = null

    // AI agents (BT-driven) for both sides.
    this._leftAi = null
    this._rightAi = null

    // Human controllers (keyboard-driven). These are created lazily when a side is set to HUMAN.
    this._leftHuman = null
    this._rightHuman = null

    // Replay controllers (intent playback). These are created when replay data is applied.
    this._leftReplay = null
    this._rightReplay = null

    // Replay recording state (we allow recording one side at a time for MVP).
    this._replayRecorder = null
    this._recordingSide = null

    // Default to AI vs AI so you can run automated-ish matches without manual input.
    this._controlMode = {
      left: CONTROL_MODE.AI,
      right: CONTROL_MODE.AI,
    }

    // AI "playstyle" profiles for each side.
    // These can be switched at runtime from the React UI.
    this._aiProfiles = {
      left: 'balanced',
      right: 'balanced',
    }

    // Tick AI at a lower frequency than physics for stability and readability.
    this._aiTickIntervalMs = 1000 / 15
    this._aiAccumulatorMs = 0

    // Match tracking (HP-based). We keep it minimal but useful for watching long AI-vs-AI runs.
    this._round = 1
    this._score = { leftWins: 0, rightWins: 0, draws: 0 }

    // KO pause state:
    // - When a fighter reaches 0 HP we enter KO phase.
    // - We show a banner, freeze the action briefly, then reset for the next round.
    this._roundPhase = ROUND_PHASE.FIGHT
    this._koWinner = null
    this._koResumeAtMs = 0
    this._koPauseMs = 1500

    // ---- Telemetry / benchmark (evaluation loop) ----
    //
    // Why:
    // - When tuning AI and combat numbers, "it feels better" is not measurable.
    // - A lightweight evaluation loop (run N rounds, collect stats) lets you:
    //   - compare AI profiles objectively
    //   - run regression checks after code changes
    //   - learn by correlating BT decisions with outcomes
    //
    // This telemetry is intentionally simple and computed in BattleScene
    // because it already owns hit resolution and round transitions.
    this._telemetry = {
      // Round start time (ms in Phaser clock).
      roundStartedAtMs: 0,

      // Per-round counters for both sides.
      round: createEmptyRoundStats(),

      // Edge detection: keep last-known state so we count *starts* not frames.
      last: {
        leftAttackRef: null,
        rightAttackRef: null,
        leftDashing: false,
        rightDashing: false,
        leftDodging: false,
        rightDodging: false,
      },
    }

    // Benchmark mode:
    // - When enabled, we collect a per-round summary for a fixed number of rounds.
    // - When complete, we can optionally pause the match and show a "finished" overlay.
    this._benchmark = {
      enabled: false,
      stopOnComplete: true,
      targetRounds: 0,
      completedRounds: 0,
      startedAtRound: 0,
      startedAtMs: 0,
      // Keep full per-round rows in memory; the UI can export them as JSON.
      rounds: [],
      report: null,
    }

    // Time accumulator for throttled debug updates.
    this._debugAccumulatorMs = 0

    // Failsafe counters for diagnosing runaway physics / camera issues.
    // If this triggers, something is wrong (e.g., missing collisions or invalid bounds).
    this._failsafe = {
      count: 0,
      lastTriggeredAtMs: 0,
    }

    // Simple Phaser text objects for quick in-canvas HUD.
    this._hudText = null

    // KO overlay texts (created once and toggled).
    this._koText = null
    this._koSubText = null

    // Background images (optional). We create them once and keep them around.
    this._background = null

    // Camera helper object for tracking the midpoint between fighters.
    // We follow a dummy Zone instead of following one fighter directly.
    this._cameraFocus = null

    // Asset diagnostics (player sprite frames / animations).
    // This is populated in create() after preload completes.
    this._playerAssetStatus = null

    // Keep last-known camera numbers for jitter diagnosis.
    this._debugLastCamera = {
      scrollX: null,
      scrollY: null,
      zoom: null,
    }

    // Optional in-canvas debug drawing (hurtboxes, hitboxes, camera view).
    // This is extremely useful when "I can't see the fighters" because it does not rely on sprite art.
    this._debugGraphics = null

    // Camera rescue state:
    // If fighters end up outside the camera view (due to bad bounds or focus issues),
    // we re-center the camera automatically to keep the match watchable.
    this._cameraRescue = {
      outOfViewSinceMs: null,
      lastRescueAtMs: 0,
      rescueCount: 0,
    }
  }

  preload() {
    if (this._log.enabled) {
      // Loader lifecycle logs help diagnose missing sprites (e.g., 404s, wrong keys).
      // We only log every file when verbose is enabled; otherwise we log errors + a summary.
      const expectedFrames = getCharacterFrameStats()
      this._log.groupCollapsed('preload:start', { expectedFrames })
      this._log.groupEnd()

      // Loader start/complete summary.
      const onStart = (loader) => {
        this._log.info('loader:start', {
          totalToLoad: loader.totalToLoad,
          inflight: loader.inflight?.size ?? 0,
          listSize: loader.list?.size ?? 0,
          queueSize: loader.queue?.size ?? 0,
        })
      }

      const onComplete = (_loader, totalComplete, totalFailed) => {
        this._log.info('loader:complete', { totalComplete, totalFailed })
      }

      const onError = (file) => {
        this._log.error('loader:error', {
          key: file?.key,
          type: file?.type,
          url: file?.src,
        })
      }

      // Optional per-file completion logs (very noisy).
      let fileCompleteCount = 0
      const onFileComplete = (key, type) => {
        fileCompleteCount += 1
        if (!this._log.verbose) return

        // Log the first few, then sample every ~200 files.
        if (fileCompleteCount <= 8 || fileCompleteCount % 200 === 0) {
          this._log.info('loader:filecomplete', { key, type, count: fileCompleteCount })
        }
      }

      this.load.on('start', onStart)
      this.load.once('complete', onComplete)
      this.load.on('loaderror', onError)
      this.load.on('filecomplete', onFileComplete)

      // Clean up listeners if the scene shuts down early.
      this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
        this.load.off('start', onStart)
        this.load.off('loaderror', onError)
        this.load.off('filecomplete', onFileComplete)
      })
    }

    // Preload stage art:
    // - background layers
    // - tileset source images (later packed into a canvas atlas)
    preloadStageAssets(this)

    // Preload fighter character sprites (Dog/Cat frame sequences).
    preloadPlayerCharacters(this)
  }

  resetMatch() {
    // Public API used by React UI: reset score + round and restart immediately.
    const nowMs = this.time?.now ?? 0

    // Reset evaluation tooling too so the UI doesn't show stale numbers.
    this.stopBenchmark()

    this._round = 1
    this._score = { leftWins: 0, rightWins: 0, draws: 0 }

    // Ensure we exit KO state if the user restarts during the pause.
    this._roundPhase = ROUND_PHASE.FIGHT
    this._koWinner = null
    this._koResumeAtMs = 0
    if (this._koText) this._koText.setVisible(false)
    if (this._koSubText) this._koSubText.setVisible(false)

    // If the scene hasn't created fighters yet, there's nothing to reset.
    if (!this._leftFighter || !this._rightFighter) return

    this._resetFighters({ nowMs })
  }

  startRecording({ side = 'left', notes } = {}) {
    // Public API used by React UI: start recording intents for a specific side.
    // Recording is useful for "AI vs Recorded Human" regression testing.
    const normalizedSide = normalizeSide(side)

    // Stop any existing recording first (MVP keeps it single-recorder).
    this._replayRecorder = new ReplayRecorder()
    this._replayRecorder.start({ notes })
    this._recordingSide = normalizedSide
  }

  stopRecording() {
    // Public API used by React UI: stop recording and return the exported replay data.
    if (!this._replayRecorder) return null

    const data = this._replayRecorder.stop()

    const exported = {
      side: this._recordingSide,
      ...data,
    }

    this._replayRecorder = null
    this._recordingSide = null

    return exported
  }

  setReplayData({ side = 'left', replayData, loop = true } = {}) {
    // Public API used by React UI: apply replay data to a side.
    // Once applied, that side can be switched to CONTROL_MODE.REPLAY.
    const normalizedSide = normalizeSide(side)

    const controller = new ReplayController({ replayData, loop })

    if (normalizedSide === 'left') this._leftReplay = controller
    else this._rightReplay = controller
  }

  clearReplayData({ side = 'left' } = {}) {
    // Public API used by React UI: remove replay controller for a side.
    if (side === 'both') {
      this._leftReplay = null
      this._rightReplay = null
      return
    }

    const normalizedSide = normalizeSide(side)
    if (normalizedSide === 'left') this._leftReplay = null
    else this._rightReplay = null
  }

  setControlMode(nextMode = {}) {
    // Normalize input (React may pass undefined / partial updates).
    const left = normalizeControlMode(nextMode.left ?? this._controlMode.left)
    const right = normalizeControlMode(nextMode.right ?? this._controlMode.right)

    this._controlMode = { left, right }

    // Create keyboard controllers only when needed.
    // We keep them around after creation because:
    // - it avoids re-registering keys on every toggle
    // - Phaser will clean everything up when the scene/game is destroyed
    if (left === CONTROL_MODE.HUMAN && !this._leftHuman) {
      this._leftHuman = new KeyboardHumanController(this, {
        scheme: HUMAN_CONTROL_SCHEME.P1,
      })
    }
    if (right === CONTROL_MODE.HUMAN && !this._rightHuman) {
      this._rightHuman = new KeyboardHumanController(this, {
        scheme: HUMAN_CONTROL_SCHEME.P2,
      })
    }

    // When switching modes, clear stale intent to avoid "one extra tick" of the old controller.
    // The correct intent will be applied in the next update() immediately.
    if (this._leftFighter) this._leftFighter.setIntent(createEmptyIntent())
    if (this._rightFighter) this._rightFighter.setIntent(createEmptyIntent())
  }

  setAiProfiles(nextProfiles = {}) {
    // Public API used by React UI: switch AI playstyle presets at runtime.
    // Profiles only affect weights/thresholds, so switching is safe mid-match.
    const left = normalizeAiProfileId(nextProfiles.left ?? this._aiProfiles.left)
    const right = normalizeAiProfileId(nextProfiles.right ?? this._aiProfiles.right)

    this._aiProfiles = { left, right }

    // Apply to running agents if they exist.
    if (this._leftAi && typeof this._leftAi.setProfile === 'function') this._leftAi.setProfile(left)
    if (this._rightAi && typeof this._rightAi.setProfile === 'function') this._rightAi.setProfile(right)

    if (this._log.enabled) this._log.info('ai:profiles', this._aiProfiles)
  }

  setStageConfig(nextConfig = {}) {
    // Public API used by React UI: rebuild the stage with a new style/seed.
    //
    // IMPORTANT:
    // - We do not auto-apply on every keystroke in React.
    // - React should send a "command" (button click) to avoid rebuilding too often.
    const nowMs = this.time?.now ?? 0

    // `resetMatch` is a command option, not part of the persistent stage config.
    const { resetMatch = true, ...config } = nextConfig ?? {}

    // Sanitize numeric fields coming from UI.
    // (React inputs can temporarily produce empty strings / NaN.)
    const normalizedConfig = { ...config }

    const widthTiles = Number(normalizedConfig.widthTiles)
    if (Number.isFinite(widthTiles) && widthTiles > 0) {
      normalizedConfig.widthTiles = Math.max(20, Math.min(120, Math.round(widthTiles)))
    } else {
      delete normalizedConfig.widthTiles
    }

    const heightTiles = Number(normalizedConfig.heightTiles)
    if (Number.isFinite(heightTiles) && heightTiles > 0) {
      normalizedConfig.heightTiles = Math.max(12, Math.min(60, Math.round(heightTiles)))
    } else {
      delete normalizedConfig.heightTiles
    }

    this._stageConfig = {
      ...this._stageConfig,
      ...normalizedConfig,
    }

    // Rebuild the stage and (optionally) restart the match so the result is immediately watchable.
    this._rebuildStage({ nowMs, resetMatch })
  }

  setStageRotationConfig(nextConfig = {}) {
    // Public API used by React UI: configure "auto change stage after KO".
    const enabled = Boolean(nextConfig?.enabled)

    // Clamp to a safe range so the game can't be put in a weird state by bad UI input.
    const rawEvery = Number(nextConfig?.everyNRounds ?? 1)
    const everyNRounds = Number.isFinite(rawEvery) ? Math.max(1, Math.min(20, Math.round(rawEvery))) : 1

    this._stageRotation = { enabled, everyNRounds }
  }

  startBenchmark({ rounds = 20, stopOnComplete = true, resetMatch = true } = {}) {
    // Public API used by React UI:
    // Start a short "evaluation run" that collects per-round stats.
    //
    // We keep this separate from normal gameplay so:
    // - casual watching is unaffected
    // - benchmark can be turned on/off quickly without rebuilding the scene
    const desiredRounds = Number(rounds ?? 0)
    const targetRounds = Number.isFinite(desiredRounds)
      ? Math.max(1, Math.min(500, Math.round(desiredRounds)))
      : 20

    // Reset match first (optional) so benchmark starts from a clean state.
    // IMPORTANT: resetMatch() would otherwise stop the benchmark if we enabled it first.
    if (resetMatch) this.resetMatch()

    const nowMs = this.time?.now ?? 0

    this._benchmark.enabled = true
    this._benchmark.stopOnComplete = Boolean(stopOnComplete)
    this._benchmark.targetRounds = targetRounds
    this._benchmark.completedRounds = 0
    this._benchmark.startedAtRound = this._round
    this._benchmark.startedAtMs = nowMs
    this._benchmark.rounds = []
    this._benchmark.report = null

    // Always start a fresh round stats bucket for the next round.
    this._telemetry.roundStartedAtMs = nowMs
    this._telemetry.round = createEmptyRoundStats()
    this._telemetry.round.roundNumber = this._round
    this._telemetry.last.leftAttackRef = null
    this._telemetry.last.rightAttackRef = null

    if (this._log.enabled) {
      this._log.info('benchmark:start', {
        targetRounds,
        stopOnComplete: this._benchmark.stopOnComplete,
        resetMatch: Boolean(resetMatch),
      })
    }
  }

  stopBenchmark() {
    // Public API used by React UI:
    // Stop collecting benchmark stats but keep any already-collected rounds/report.
    if (!this._benchmark) return

    // Always disable collection (idempotent).
    this._benchmark.enabled = false

    // If we were in "DONE" phase, resume normal fight flow on next round reset.
    // (We don't auto-reset here; the user can click "restart match" from React.)
    if (this._roundPhase === ROUND_PHASE.DONE) {
      this._roundPhase = ROUND_PHASE.FIGHT
      this._setKoOverlayVisible(false)
      this._koResumeAtMs = 0

      // If we leave DONE without resetting fighters, one side may still be at 0 HP,
      // which would instantly re-trigger KO on the next update frame.
      const nowMs = this.time?.now ?? 0
      if (this._leftFighter && this._rightFighter) this._resetFighters({ nowMs })
    }

    if (this._log.enabled) this._log.info('benchmark:stop')
  }

  exportBenchmark() {
    // Public API used by React UI:
    // Export the current benchmark payload as plain JSON data.
    //
    // Notes:
    // - This returns only data already collected in memory.
    // - It does NOT start/stop the benchmark.
    const nowMs = this.time?.now ?? 0
    const b = this._benchmark
    if (!b) return null

    // Include a stable BT hash so benchmark runs can be compared across:
    // - different BT JSON versions
    // - different profile weights
    // - different stage seeds
    //
    // We hash the *canonicalized* JSON (stringified object) so whitespace differences
    // in the source text do not create different hashes.
    let btHash = null
    let btCanonicalLength = 0
    try {
      const btObject = parseBtJsonText(this._initialBtJsonText)
      const canonicalText = JSON.stringify(btObject)
      btCanonicalLength = canonicalText ? canonicalText.length : 0
      btHash = canonicalText ? hashStringFNV1a32(canonicalText) : null
    } catch {
      btHash = null
      btCanonicalLength = 0
    }

    return {
      exportedAtMs: nowMs,
      config: {
        stopOnComplete: Boolean(b.stopOnComplete),
        targetRounds: Number(b.targetRounds ?? 0),
        startedAtRound: Number(b.startedAtRound ?? 0),
        startedAtMs: Number(b.startedAtMs ?? 0),
      },
      bt: {
        hash: btHash,
        canonicalLength: btCanonicalLength,
      },
      aiProfiles: { ...this._aiProfiles },
      stage: this._stageMeta ? { ...this._stageMeta } : null,
      stageConfig: this._stageConfig ? { ...this._stageConfig } : null,
      stageRotation: this._stageRotation ? { ...this._stageRotation } : null,
      rounds: Array.isArray(b.rounds) ? b.rounds.slice() : [],
      report: b.report ?? null,
    }
  }

  create() {
    // React dev mode can create/destroy the Phaser game more than once.
    // Drop the debug callback on shutdown to avoid stale scenes still trying to talk to React.
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this._onDebugSnapshot = null
    })

    if (this._log.enabled) {
      // Listen to scale events at the Scene level too, so we can correlate with BattleScene state.
      const onResize = (gameSize, baseSize, displaySize, prevW, prevH) => {
        // Throttle: resize can fire frequently during layout changes.
        this._log.throttle('scene-scale-resize', 150, () => {
          const canvasRect = this.scale?.canvas?.getBoundingClientRect?.()
          this._log.warn('scene:scale-resize', {
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
          })
        })
      }

      this.scale?.on?.(Phaser.Scale.Events.RESIZE, onResize)
      this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
        this.scale?.off?.(Phaser.Scale.Events.RESIZE, onResize)
      })

      this._log.info('create:start', {
        physicsGravityY: Number(this.physics?.world?.gravity?.y ?? 0),
        stageConfig: this._stageConfig,
      })
    }

    // Create a 1x1 white texture used for rectangle-like sprites.
    // This avoids needing any external art assets for the MVP.
    this._ensurePixelTexture()

    // Create background layers (optional visual polish).
    // We keep scrollFactor at 0 so it stays fixed even if we later add camera movement.
    this._createBackground()

    // Build the tile-based stage (tilemap + collision + AI platform graph).
    // This is separated into a helper so we can regenerate it on demand.
    const nowMs = this.time?.now ?? 0
    this._rebuildStage({ nowMs, resetMatch: false })

    // Build Phaser animations for player character sprites (safe to call multiple times).
    ensurePlayerAnimations(this)

    // Verify player sprite frames + animations exist so we can debug "invisible character" issues.
    // Fighters will fall back to the physics rectangle if frames are missing.
    this._playerAssetStatus = this._checkPlayerAssets()

    if (this._log.enabled) {
      if (!this._playerAssetStatus?.ok) {
        this._log.error('player-assets:missing', this._playerAssetStatus)
      } else {
        this._log.info('player-assets:ok', {
          dogIdleFrames: this._playerAssetStatus?.frameStats?.dog?.idle ?? 0,
          catIdleFrames: this._playerAssetStatus?.frameStats?.cat?.idle ?? 0,
        })
      }
    }

    // Create two fighters. For now both will be controlled by AI (AI vs AI).
    const leftSpawn = this._spawns?.left ?? { x: 260, y: 100, facing: 1 }
    const rightSpawn = this._spawns?.right ?? { x: 700, y: 100, facing: -1 }

    this._leftFighter = new Fighter(this, {
      id: 'left',
      x: leftSpawn.x,
      y: leftSpawn.y,
      tint: 0x58a6ff,
      facing: leftSpawn.facing,
      characterId: PLAYER_CHARACTER.DOG,
    })
    this._rightFighter = new Fighter(this, {
      id: 'right',
      x: rightSpawn.x,
      y: rightSpawn.y,
      tint: 0xff7b72,
      facing: rightSpawn.facing,
      characterId: PLAYER_CHARACTER.CAT,
    })

    if (this._log.enabled) {
      // Log initial fighter render state, spawn points and stage bounds.
      this._log.groupCollapsed('create:fighters', {
        leftSpawn,
        rightSpawn,
        stage: {
          width: this._stage.width,
          height: this._stage.height,
          centerX: this._stage.centerX,
        },
        worldBounds: this.physics?.world?.bounds
          ? {
              x: this.physics.world.bounds.x,
              y: this.physics.world.bounds.y,
              width: this.physics.world.bounds.width,
              height: this.physics.world.bounds.height,
            }
          : null,
      })
      const nowMs = this.time?.now ?? 0
      this._log.log({
        left: this._serializeFighter(this._leftFighter, nowMs),
        right: this._serializeFighter(this._rightFighter, nowMs),
      })
      this._log.groupEnd()
    }

    // Build a BT tree from provided JSON (or fallback to default).
    // IMPORTANT: each agent must get its own tree instance to avoid shared state in decorators.
    const btJsonObject = parseBtJsonText(this._initialBtJsonText)
    const leftTree = createPlatformBrawlBtTree(btJsonObject)
    const rightTree = createPlatformBrawlBtTree(btJsonObject)

    // Create AI agents for both fighters (AI vs AI).
    this._leftAi = new BotAgent({
      id: 'left-ai',
      self: this._leftFighter,
      target: this._rightFighter,
      stage: this._stage,
      btRoot: leftTree,
      profileId: this._aiProfiles.left,
    })
    this._rightAi = new BotAgent({
      id: 'right-ai',
      self: this._rightFighter,
      target: this._leftFighter,
      stage: this._stage,
      btRoot: rightTree,
      profileId: this._aiProfiles.right,
    })

    // Make sure fighters collide with the tile stage.
    this._rebuildStageColliders()

    // Camera: follow the midpoint of both fighters so larger stages remain watchable.
    this._setupCameraFollow()

    // Create an optional debug overlay that draws simple shapes on top of the world.
    // This helps diagnose visibility/collision problems even when sprites are missing.
    if (this._log.enabled) this._ensureDebugOverlay()

    // Lightweight HUD (kept inside Phaser for quick visual feedback).
    this._hudText = this.add
      .text(12, 12, '', {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '14px',
        color: '#c9d1d9',
      })
      .setScrollFactor(0)

    // KO overlay (hidden by default).
    // We keep it inside Phaser so it stays visible even if React UI is minimal.
    const centerX = this.cameras.main.centerX
    const centerY = this.cameras.main.centerY

    this._koText = this.add
      .text(centerX, centerY - 18, '', {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '56px',
        fontStyle: '800',
        color: '#f0f6fc',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(100)
      .setVisible(false)

    this._koSubText = this.add
      .text(centerX, centerY + 34, '', {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '18px',
        color: '#c9d1d9',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(100)
      .setVisible(false)

    // Apply the default control mode after everything is created.
    // This also allows React to override the mode immediately after mounting.
    this.setControlMode(this._controlMode)

    // Initialize telemetry for round 1.
    // We treat the moment the scene finishes `create()` as the "round start".
    const roundNowMs = this.time?.now ?? 0
    this._telemetry.roundStartedAtMs = roundNowMs
    this._telemetry.round = createEmptyRoundStats()
    this._telemetry.round.startedAtMs = roundNowMs
    this._telemetry.round.roundNumber = this._round
  }

  update(_time, delta) {
    // Use Phaser's time source for consistency across the entire scene.
    const nowMs = this.time.now

    // Update camera focus even during KO pause so the finishing moment stays centered.
    this._updateCameraFocus({ delta })

    // If fighters are outside the current camera view for too long, re-center the camera.
    // This is a defensive measure against "blank screen" bugs during rapid iteration.
    this._maybeRescueCamera({ nowMs })

    // Debug: detect camera value oscillations and fighter visibility issues.
    // We keep this throttled so it doesn't spam the console.
    if (this._log.enabled) {
      this._log.throttle('runtime-visibility-check', 900, () => {
        const cam = this.cameras?.main
        if (!cam || !this._leftFighter || !this._rightFighter) return

        const view = cam.worldView
        const leftInView = Phaser.Geom.Rectangle.Contains(view, this._leftFighter.x, this._leftFighter.y)
        const rightInView = Phaser.Geom.Rectangle.Contains(view, this._rightFighter.x, this._rightFighter.y)

        if (!leftInView || !rightInView) {
          this._log.warn('fighters-out-of-view', {
            view: {
              x: Math.round(view.x),
              y: Math.round(view.y),
              width: Math.round(view.width),
              height: Math.round(view.height),
            },
            camera: {
              scrollX: Math.round(cam.scrollX * 10) / 10,
              scrollY: Math.round(cam.scrollY * 10) / 10,
              zoom: Math.round(cam.zoom * 1000) / 1000,
            },
            left: { x: Math.round(this._leftFighter.x), y: Math.round(this._leftFighter.y) },
            right: { x: Math.round(this._rightFighter.x), y: Math.round(this._rightFighter.y) },
          })
        }

        // Track camera values over time to spot oscillation.
        const last = this._debugLastCamera
        if (last.scrollX != null && last.scrollY != null) {
          const dx = cam.scrollX - last.scrollX
          const dy = cam.scrollY - last.scrollY
          const dist = Math.hypot(dx, dy)

          // If the camera is moving a tiny amount but constantly, it can look like jitter.
          if (dist > 0.05 && dist < 6) {
            this._log.info('camera-small-move', {
              dx: Math.round(dx * 1000) / 1000,
              dy: Math.round(dy * 1000) / 1000,
              zoom: Math.round(cam.zoom * 1000) / 1000,
            })
          }
        }

        last.scrollX = cam.scrollX
        last.scrollY = cam.scrollY
        last.zoom = cam.zoom
      })
    }

    // If benchmark mode completed and asked to stop, we freeze the match here.
    // This lets you read the result and export the report from the UI.
    if (this._roundPhase === ROUND_PHASE.DONE) {
      if (this._leftFighter?.body) this._leftFighter.body.setVelocity(0, 0)
      if (this._rightFighter?.body) this._rightFighter.body.setVelocity(0, 0)

      this._emitDebugSnapshot({ delta })
      return
    }

    // If we are in KO pause, freeze the action and wait before restarting the round.
    if (this._roundPhase === ROUND_PHASE.KO) {
      this._updateKoPhase({ nowMs })
      this._emitDebugSnapshot({ delta })
      return
    }

    // ---- AI tick (BT-driven) ----
    // We tick AI at a fixed rate (e.g., 15Hz) and apply the last intent every frame.
    this._aiAccumulatorMs += delta
    if (this._aiAccumulatorMs >= this._aiTickIntervalMs) {
      // Prevent spiral-of-death if the tab lags: cap accumulated time.
      this._aiAccumulatorMs = Math.min(this._aiAccumulatorMs, this._aiTickIntervalMs * 3)

      while (this._aiAccumulatorMs >= this._aiTickIntervalMs) {
        this._aiAccumulatorMs -= this._aiTickIntervalMs

        // Tick AI only for the sides currently controlled by AI.
        // This allows mixed mode (human vs AI) without re-building the scene.
        if (this._controlMode.left === CONTROL_MODE.AI) {
          const leftIntent = this._leftAi ? this._leftAi.tick({ nowMs }) : createEmptyIntent()
          this._leftFighter.setIntent(leftIntent)
        }
        if (this._controlMode.right === CONTROL_MODE.AI) {
          const rightIntent = this._rightAi ? this._rightAi.tick({ nowMs }) : createEmptyIntent()
          this._rightFighter.setIntent(rightIntent)
        }
      }
    }

    // ---- Human / Replay input (every frame) ----
    // Human control should feel responsive, so we sample it at frame rate (not AI tick rate).
    // Replay is also sampled every frame so it "feels" like real input.
    if (this._controlMode.left === CONTROL_MODE.HUMAN && this._leftHuman) {
      const intent = this._leftHuman.readIntent()
      this._leftFighter.setIntent(intent)

      // If we are recording the left side, store the intent for this frame.
      if (this._recordingSide === 'left' && this._replayRecorder?.isRecording) {
        this._replayRecorder.recordFrame({ dtMs: delta, intent })
      }
    } else if (this._controlMode.left === CONTROL_MODE.REPLAY) {
      const intent = this._leftReplay
        ? this._leftReplay.readIntent({ deltaMs: delta })
        : createEmptyIntent()
      this._leftFighter.setIntent(intent)
    }

    if (this._controlMode.right === CONTROL_MODE.HUMAN && this._rightHuman) {
      const intent = this._rightHuman.readIntent()
      this._rightFighter.setIntent(intent)

      // If we are recording the right side, store the intent for this frame.
      if (this._recordingSide === 'right' && this._replayRecorder?.isRecording) {
        this._replayRecorder.recordFrame({ dtMs: delta, intent })
      }
    } else if (this._controlMode.right === CONTROL_MODE.REPLAY) {
      const intent = this._rightReplay
        ? this._rightReplay.readIntent({ deltaMs: delta })
        : createEmptyIntent()
      this._rightFighter.setIntent(intent)
    }

    // ---- One-way "drop-through" handling (every frame) ----
    // Rule (common in platform fighters):
    // - When you are standing on a one-way platform
    // - Holding Down + pressing Jump
    // - You will drop through the platform instead of jumping.
    //
    // We implement this at the scene level because:
    // - it depends on the tilemap's one-way collision rules
    // - AI, human, and replay all share the same intent shape
    this._maybeDropThroughOneWay({ fighter: this._leftFighter, nowMs })
    this._maybeDropThroughOneWay({ fighter: this._rightFighter, nowMs })

    // Update fighters (movement + attack state machine) every frame for smooth physics.
    this._leftFighter.updateFighter({ nowMs, opponent: this._rightFighter })
    this._rightFighter.updateFighter({ nowMs, opponent: this._leftFighter })

    // Update telemetry *after* fighters update so we can detect action starts that happened this frame.
    this._updateTelemetryPerFrame({ nowMs })

    // Optional in-canvas debug drawing (hurtboxes/hitboxes/platforms).
    // Draw after fighters update so positions/state are current.
    this._renderDebugOverlay({ nowMs })

    // Resolve melee hits based on active hitboxes.
    this._resolveHit({ attacker: this._leftFighter, defender: this._rightFighter, nowMs })
    this._resolveHit({ attacker: this._rightFighter, defender: this._leftFighter, nowMs })

    // Failsafe: keep fighters inside reasonable bounds so a bad stage or collision bug
    // doesn't result in a blank screen (fighters falling forever off-camera).
    this._applyFailsafeBounds({ nowMs })

    // End the round if someone reaches 0 HP.
    if (this._leftFighter.hp <= 0 || this._rightFighter.hp <= 0) {
      this._beginKoPause({ nowMs })
    }

    // Update the Phaser HUD text once per frame (cheap enough for now).
    if (this._hudText) {
      const baseLine = `Round ${this._round}  |  Score L:${this._score.leftWins} R:${this._score.rightWins} D:${this._score.draws}  |  Left(${this._controlMode.left}) HP ${this._leftFighter.hp}/${this._leftFighter.maxHp}  |  Right(${this._controlMode.right}) HP ${this._rightFighter.hp}/${this._rightFighter.maxHp}`

      // When debug is enabled, add a few extra lines inside the canvas.
      // This helps even when the browser console is hard to read (or not open).
      if (!this._log.enabled) {
        this._hudText.setText(baseLine)
      } else {
        const cam = this.cameras?.main
        const view = cam?.worldView
        const displaySize = this.scale?.displaySize
        const canvas = this.scale?.canvas
        const parent = this.scale?.parent

        const debugLine1 = cam
          ? `cam scroll(${Math.round(cam.scrollX)}, ${Math.round(cam.scrollY)}) zoom(${Math.round(cam.zoom * 1000) / 1000}) view(${Math.round(view?.x ?? 0)}, ${Math.round(view?.y ?? 0)}, ${Math.round(view?.width ?? 0)}×${Math.round(view?.height ?? 0)})`
          : 'cam (missing)'

        const debugLine2 = displaySize
          ? `scale display(${Math.round(displaySize.width)}×${Math.round(displaySize.height)}) canvas(${canvas?.clientWidth ?? 0}×${canvas?.clientHeight ?? 0}) parent(${parent?.clientWidth ?? 0}×${parent?.clientHeight ?? 0})`
          : 'scale (missing)'

        const debugLine3 = `assets.player=${this._playerAssetStatus?.ok ? 'OK' : 'MISSING'}  failsafe=${this._failsafe?.count ?? 0}`

        this._hudText.setText([baseLine, debugLine1, debugLine2, debugLine3].join('\n'))
      }
    }

    this._emitDebugSnapshot({ delta })
  }

  _applyFailsafeBounds({ nowMs }) {
    // This is a defensive guardrail, not normal gameplay logic.
    // It only runs if we detect NaN/Infinity or extreme out-of-bounds positions.
    const world = this.physics?.world
    const bounds = world?.bounds
    if (!bounds) return

    // Allow some slack outside the physics bounds before we consider it "runaway".
    // This prevents false positives from knockback near walls.
    const marginPx = 900

    const left = this._leftFighter
    const right = this._rightFighter
    if (!left || !right) return

    // Helper to test a fighter position against bounds.
    function isRunaway(f) {
      if (!Number.isFinite(f.x) || !Number.isFinite(f.y)) return true
      if (f.x < bounds.x - marginPx) return true
      if (f.x > bounds.right + marginPx) return true
      if (f.y < bounds.y - marginPx) return true
      if (f.y > bounds.bottom + marginPx) return true
      return false
    }

    const runawayLeft = isRunaway(left)
    const runawayRight = isRunaway(right)
    if (!runawayLeft && !runawayRight) return

    // Record that the failsafe triggered (visible in debug JSON).
    this._failsafe.count += 1
    this._failsafe.lastTriggeredAtMs = nowMs ?? 0

    if (this._log.enabled) {
      this._log.throttle('failsafe-trigger', 800, () => {
        this._log.error('FAILSAFE_TRIGGERED', {
          count: this._failsafe.count,
          runawayLeft,
          runawayRight,
          left: { x: left.x, y: left.y },
          right: { x: right.x, y: right.y },
          worldBounds: {
            x: bounds.x,
            y: bounds.y,
            right: bounds.right,
            bottom: bounds.bottom,
          },
        })
      })
    }

    // Teleport runaway fighters back to their current spawn points.
    // We intentionally do NOT reset HP/score here; this is only to restore visibility.
    const spawns = this._spawns
    if (runawayLeft && spawns?.left) {
      left.setPosition(spawns.left.x, spawns.left.y)
      left.body?.setVelocity?.(0, 0)
    }
    if (runawayRight && spawns?.right) {
      right.setPosition(spawns.right.x, spawns.right.y)
      right.body?.setVelocity?.(0, 0)
    }
  }

  _serializeFighter(fighter, nowMs) {
    if (!fighter?.body) return null

    // Best-effort access to the visual sprite for debugging.
    // (This is intentionally read-only and used only for UI inspection.)
    const visual = fighter._visual

    // Arcade Physics provides both `blocked` and `touching`.
    // - `blocked`: collision with an immovable object (tiles, world bounds)
    // - `touching`: overlap information for the current step
    // When "onGround" flickers, inspecting these flags helps narrow down why.
    const blocked = fighter.body.blocked ?? {}
    const touching = fighter.body.touching ?? {}

    return {
      hp: fighter.hp,
      x: Math.round(fighter.x),
      y: Math.round(fighter.y),
      vx: Math.round(fighter.body.velocity.x),
      vy: Math.round(fighter.body.velocity.y),
      // Grounding is useful for diagnosing collision issues and jump logic.
      onGround: Boolean(fighter.body.blocked.down || fighter.body.touching.down),
      blocked: {
        down: Boolean(blocked.down),
        up: Boolean(blocked.up),
        left: Boolean(blocked.left),
        right: Boolean(blocked.right),
      },
      touching: {
        down: Boolean(touching.down),
        up: Boolean(touching.up),
        left: Boolean(touching.left),
        right: Boolean(touching.right),
      },
      facing: fighter.facing,
      attack: fighter.attackState,
      // Defense/mobility state helps explain why a character "didn't act".
      guarding: typeof fighter.isGuarding === 'function' ? fighter.isGuarding() : false,
      dashing: typeof fighter.isDashing === 'function' ? fighter.isDashing(nowMs) : false,
      dodging: typeof fighter.isDodging === 'function' ? fighter.isDodging(nowMs) : false,
      invincible: typeof fighter.isInvincible === 'function' ? fighter.isInvincible(nowMs) : false,
      actionLocked: typeof fighter.isActionLocked === 'function' ? fighter.isActionLocked(nowMs) : false,
      lastImpact: fighter._lastImpact ?? null,
      render: {
        body: {
          visible: Boolean(fighter.visible),
          alpha: Math.round((Number(fighter.alpha) || 0) * 1000) / 1000,
          depth: Number(fighter.depth) || 0,
        },
        visual: visual
          ? {
              exists: true,
              visible: Boolean(visual.visible),
              alpha: Math.round((Number(visual.alpha) || 0) * 1000) / 1000,
              depth: Number(visual.depth) || 0,
              textureKey: String(visual.texture?.key ?? ''),
              animKey: String(visual.anims?.currentAnim?.key ?? ''),
            }
          : { exists: false },
      },
    }
  }

  _serializeAi(agent) {
    if (!agent) return null

    // Keep only a short tail of the trace so the debug panel stays readable.
    const traceTail = agent.lastTrace.slice(-12)

    return {
      status: agent.lastStatus,
      reasons: agent.lastReasons,
      trace: traceTail,
      profileId: agent.blackboard?.ai?.profileId ?? null,
      threat: agent.blackboard?.ai?.threat
        ? {
            willHit: Boolean(agent.blackboard.ai.threat.willHit),
            timeToHitMs: agent.blackboard.ai.threat.timeToHitMs ?? null,
            moveKind: agent.blackboard.ai.threat.moveKind ?? null,
            phase: agent.blackboard.ai.threat.phase ?? null,
            severity: agent.blackboard.ai.threat.severity ?? 0,
          }
        : null,
      // Expose a small blackboard subset that is useful for learning.
      blackboard: {
        selfHp: agent.blackboard.self.hp,
        onGround: agent.blackboard.self.onGround,
        targetDx: Math.round(agent.blackboard.target.dx),
        targetDy: Math.round(agent.blackboard.target.dy),
      },
    }
  }

  _updateTelemetryPerFrame({ nowMs }) {
    // Per-frame telemetry sampling.
    //
    // We intentionally keep this:
    // - edge-triggered (count starts, not frames)
    // - cheap (only a handful of boolean checks)
    //
    // This runs only during the FIGHT phase.
    const t = this._telemetry
    if (!t) return

    const left = this._leftFighter
    const right = this._rightFighter
    if (!left || !right) return

    // ---- Attack start detection ----
    // Fighter creates a new attack object when a move starts, and mutates it across phases.
    // That means we can detect "attack started" by checking object identity changes.
    const leftAttack = left.attackState
    if (leftAttack && t.last.leftAttackRef !== leftAttack) {
      t.round.left.attacksStarted += 1
      t.last.leftAttackRef = leftAttack
    } else if (!leftAttack) {
      t.last.leftAttackRef = null
    }

    const rightAttack = right.attackState
    if (rightAttack && t.last.rightAttackRef !== rightAttack) {
      t.round.right.attacksStarted += 1
      t.last.rightAttackRef = rightAttack
    } else if (!rightAttack) {
      t.last.rightAttackRef = null
    }

    // ---- Dash / Dodge start detection ----
    // These are implemented as time windows in Fighter, so we detect "start" via rising edges.
    const leftDashingNow = typeof left.isDashing === 'function' ? left.isDashing(nowMs) : false
    if (leftDashingNow && !t.last.leftDashing) t.round.left.dashes += 1
    t.last.leftDashing = leftDashingNow

    const rightDashingNow = typeof right.isDashing === 'function' ? right.isDashing(nowMs) : false
    if (rightDashingNow && !t.last.rightDashing) t.round.right.dashes += 1
    t.last.rightDashing = rightDashingNow

    const leftDodgingNow = typeof left.isDodging === 'function' ? left.isDodging(nowMs) : false
    if (leftDodgingNow && !t.last.leftDodging) t.round.left.dodgesStarted += 1
    t.last.leftDodging = leftDodgingNow

    const rightDodgingNow = typeof right.isDodging === 'function' ? right.isDodging(nowMs) : false
    if (rightDodgingNow && !t.last.rightDodging) t.round.right.dodgesStarted += 1
    t.last.rightDodging = rightDodgingNow
  }

  _resolveHit({ attacker, defender, nowMs }) {
    // Only check hits if the attacker currently has an active hitbox.
    const hitbox = attacker.getAttackHitboxRect()
    if (!hitbox) return

    const hurtbox = defender.getHurtboxRect()
    const overlapped = Phaser.Geom.Rectangle.Overlaps(hitbox, hurtbox)
    if (!overlapped) return

    const move = MOVES[attacker.attackState?.kind]
    if (!move) return

    // Resolve sides for telemetry (left/right).
    // This is used only for benchmark stats and has no gameplay effect.
    const attackerSide =
      attacker === this._leftFighter ? 'left' : attacker === this._rightFighter ? 'right' : null
    const defenderSide =
      defender === this._leftFighter ? 'left' : defender === this._rightFighter ? 'right' : null

    // Defensive mechanics (dodge / guard) are resolved here because:
    // - We have access to BOTH attacker and defender positions/facing.
    // - The fighter entity does not know who hit it, only that it got hit.

    // If the defender is currently invincible (dodge i-frames), ignore the hit.
    // We intentionally do NOT mark the attack as "hit" so it can still connect
    // later in the same active window if the defender becomes vulnerable again.
    if (typeof defender?.isInvincible === 'function' && defender.isInvincible(nowMs)) {
      // Telemetry: count a "successful dodge" (i-frames avoided a hit).
      if (this._telemetry && defenderSide) {
        this._telemetry.round[defenderSide].dodges += 1
        if (attackerSide) this._telemetry.round[attackerSide].hitsDodged += 1
      }
      return
    }

    // Guard check:
    // - Defender must be guarding
    // - And the attacker must be in front of the defender (no blocking from behind)
    const defenderGuarding = typeof defender?.isGuarding === 'function' ? defender.isGuarding() : false
    const defenderFacing = Number(defender?.facing ?? 1) >= 0 ? 1 : -1
    const attackerInFront =
      defenderFacing > 0 ? attacker.x >= defender.x - 2 : attacker.x <= defender.x + 2

    const isBlocked = defenderGuarding && attackerInFront

    // Mark hit so this attack cannot hit again during the same active window.
    // Blocking counts as a "hit" for the attacker (prevents multi-hit spam).
    if (isBlocked) attacker.markAttackHit()

    if (isBlocked) {
      // Blocked hit: apply chip damage + blockstun + smaller knockback.
      const chipDamage = Math.max(0, Math.round(move.damage * 0.15))
      const blockstunMs = Math.round(move.hitstunMs * 0.55)
      const pushbackX = Math.round(move.knockbackX * 0.45)

      // Telemetry: count block (damage is recorded after applying to avoid overcount on KO).
      if (this._telemetry && attackerSide && defenderSide) {
        this._telemetry.round[defenderSide].blocks += 1
        this._telemetry.round[attackerSide].hitsBlocked += 1
      }

      const hpBefore = defender.hp
      defender.takeHit({
        damage: chipDamage,
        knockbackX: pushbackX,
        knockbackY: 0,
        hitstunMs: blockstunMs,
        hitstopMs: Math.round(move.hitstopMs * 0.7),
        fromFacing: attacker.facing,
        nowMs,
        impactKind: 'block',
      })

      // Telemetry: record actual damage dealt (chip).
      if (this._telemetry && attackerSide && defenderSide) {
        const hpAfter = defender.hp
        const actualDamage = Math.max(0, Number(hpBefore ?? 0) - Number(hpAfter ?? 0))
        this._telemetry.round[attackerSide].damageDealt += actualDamage
        this._telemetry.round[attackerSide].chipDamageDealt += actualDamage
      }

      // Optional: small attacker recoil for readability (feels more like a fighting game).
      if (attacker?.body) {
        attacker.body.setVelocityX(attacker.body.velocity.x * 0.2)
      }

      return
    }

    // Unblocked hit: mark hit and apply full damage/knockback.
    attacker.markAttackHit()

    // Telemetry: count a landed hit (damage is recorded after applying to avoid overcount on KO).
    if (this._telemetry && attackerSide && defenderSide) {
      this._telemetry.round[attackerSide].hitsLanded += 1
    }

    const hpBefore = defender.hp
    defender.takeHit({
      damage: move.damage,
      knockbackX: move.knockbackX,
      knockbackY: move.knockbackY,
      hitstunMs: move.hitstunMs,
      hitstopMs: move.hitstopMs,
      fromFacing: attacker.facing,
      nowMs,
      impactKind: 'hit',
    })

    // Telemetry: record actual damage dealt (may be less than move.damage when HP was low).
    if (this._telemetry && attackerSide && defenderSide) {
      const hpAfter = defender.hp
      const actualDamage = Math.max(0, Number(hpBefore ?? 0) - Number(hpAfter ?? 0))
      this._telemetry.round[attackerSide].damageDealt += actualDamage
    }
  }

  _resetFighters({ nowMs }) {
    // Reset fighters to their spawns (and restore HP).
    const leftSpawn = this._spawns?.left ?? { x: 260, y: 100, facing: 1 }
    const rightSpawn = this._spawns?.right ?? { x: 700, y: 100, facing: -1 }

    this._leftFighter.resetForNewRound({
      x: leftSpawn.x,
      y: leftSpawn.y,
      facing: leftSpawn.facing,
      nowMs,
    })
    this._rightFighter.resetForNewRound({
      x: rightSpawn.x,
      y: rightSpawn.y,
      facing: rightSpawn.facing,
      nowMs,
    })

    // If a side is using replay, restart playback each round.
    if (this._leftReplay) this._leftReplay.reset()
    if (this._rightReplay) this._rightReplay.reset()

    // Start a fresh telemetry bucket for the new round.
    // We do this here (instead of in update) so resets are deterministic and easy to reason about.
    if (this._telemetry) {
      this._telemetry.roundStartedAtMs = nowMs ?? 0
      this._telemetry.round = createEmptyRoundStats()
      this._telemetry.round.startedAtMs = nowMs ?? 0
      this._telemetry.round.roundNumber = this._round

      // Clear edge detection so the first actions of the round are counted correctly.
      this._telemetry.last.leftAttackRef = null
      this._telemetry.last.rightAttackRef = null
      this._telemetry.last.leftDashing = false
      this._telemetry.last.rightDashing = false
      this._telemetry.last.leftDodging = false
      this._telemetry.last.rightDodging = false
    }
  }

  _finalizeRoundTelemetry({ nowMs, winner }) {
    // Finalize the current round stats bucket.
    // This is called exactly once per round (when KO triggers).
    const t = this._telemetry
    if (!t) return null

    const round = t.round
    if (!round) return null

    round.endedAtMs = nowMs ?? 0
    const startedAtMs = Number(round.startedAtMs ?? t.roundStartedAtMs ?? 0)
    round.durationMs = Math.max(0, Number(round.endedAtMs ?? 0) - startedAtMs)

    round.winner = winner ?? null
    round.leftHpEnd = this._leftFighter?.hp ?? null
    round.rightHpEnd = this._rightFighter?.hp ?? null

    // Store a small stage identifier so benchmark rows are reproducible.
    round.stage = {
      style: this._stageMeta?.style ?? null,
      seed: this._stageMeta?.seed ?? null,
    }

    return round
  }

  _beginKoPause({ nowMs }) {
    // Prevent double-triggering KO if update() runs multiple frames with HP already at 0.
    if (this._roundPhase !== ROUND_PHASE.FIGHT) return

    // Determine winner based on remaining HP after both hit resolutions have been applied.
    const leftDead = this._leftFighter.hp <= 0
    const rightDead = this._rightFighter.hp <= 0

    let winner = 'draw'
    if (leftDead && rightDead) winner = 'draw'
    else if (leftDead) winner = 'right'
    else if (rightDead) winner = 'left'

    this._koWinner = winner

    // Telemetry: finish the round stats now that we know the winner.
    // We do this here so the numbers reflect the exact KO frame.
    const finishedRound = this._finalizeRoundTelemetry({ nowMs, winner })

    // Benchmark collection: store a copy of the finalized round row.
    // We store *copies* so later resets cannot mutate historical results.
    if (this._benchmark?.enabled && finishedRound) {
      const row = exportRoundStats(finishedRound)
      this._benchmark.rounds.push(row)
      this._benchmark.completedRounds = this._benchmark.rounds.length
      this._benchmark.report = computeBenchmarkReport(this._benchmark.rounds)
    }

    // Update score immediately so it is visible during the KO pause.
    if (winner === 'draw') this._score.draws += 1
    else if (winner === 'left') this._score.leftWins += 1
    else if (winner === 'right') this._score.rightWins += 1

    // Enter KO phase (freeze + banner).
    this._roundPhase = ROUND_PHASE.KO
    this._koResumeAtMs = nowMs + this._koPauseMs

    // Apply KO poses immediately so the result is readable during the pause.
    // We force the "dead" animation on the fighter(s) who reached 0 HP.
    // (We do this here because `updateFighter()` runs *before* hit resolution in the frame.)
    if (leftDead && typeof this._leftFighter?.setForcedVisualAction === 'function') {
      this._leftFighter.setForcedVisualAction('dead')
    }
    if (rightDead && typeof this._rightFighter?.setForcedVisualAction === 'function') {
      this._rightFighter.setForcedVisualAction('dead')
    }

    // Show overlay text.
    const koLabel = winner === 'draw' ? 'DOUBLE KO' : 'KO'
    const winnerLabel =
      winner === 'draw'
        ? '平手'
        : winner === 'left'
          ? '左方獲勝'
          : '右方獲勝'

    if (this._koText) this._koText.setText(koLabel)
    if (this._koSubText) {
      this._koSubText.setText(
        `${winnerLabel} — ${Math.round(this._koPauseMs / 100) / 10} 秒後開始下一回合`,
      )
    }

    this._setKoOverlayVisible(true)
  }

  _updateKoPhase({ nowMs }) {
    // Freeze fighters so the KO moment is visible.
    // (We keep them in place instead of letting them keep sliding.)
    if (this._leftFighter?.body) this._leftFighter.body.setVelocity(0, 0)
    if (this._rightFighter?.body) this._rightFighter.body.setVelocity(0, 0)

    // When the pause ends, start the next round immediately.
    if (nowMs < this._koResumeAtMs) return

    // If benchmark mode is running and we reached the target, freeze on the KO screen.
    // This is the "evaluation loop" end condition.
    const benchmarkDone =
      Boolean(this._benchmark?.enabled) &&
      Boolean(this._benchmark?.stopOnComplete) &&
      Number(this._benchmark?.targetRounds ?? 0) > 0 &&
      Number(this._benchmark?.completedRounds ?? 0) >= Number(this._benchmark?.targetRounds ?? 0)

    if (benchmarkDone) {
      // Stop collecting so the UI can treat the run as complete.
      this._benchmark.enabled = false

      // Switch to DONE phase to freeze the match in update().
      this._roundPhase = ROUND_PHASE.DONE

      // Replace KO overlay with a benchmark completion message.
      if (this._koText) this._koText.setText('FINISH')
      if (this._koSubText) {
        const report = this._benchmark.report
        const avgKoSec = report?.avgKoTimeMs ? Math.round(report.avgKoTimeMs / 100) / 10 : null
        const leftWins = report?.wins?.left ?? 0
        const rightWins = report?.wins?.right ?? 0
        const draws = report?.wins?.draw ?? 0
        this._koSubText.setText(
          `Benchmark 完成：${this._benchmark.completedRounds}/${this._benchmark.targetRounds} 回合  ` +
            `|  勝率 L:${leftWins} R:${rightWins} D:${draws}` +
            (avgKoSec != null ? `  |  平均 KO ${avgKoSec}s` : ''),
        )
      }

      // Keep overlay visible.
      this._setKoOverlayVisible(true)

      // Clear KO timer so we don't re-enter this branch repeatedly.
      this._koResumeAtMs = 0
      return
    }

    // Hide overlay and reset KO state.
    this._setKoOverlayVisible(false)
    this._roundPhase = ROUND_PHASE.FIGHT
    this._koWinner = null
    this._koResumeAtMs = 0

    // Advance round counter after the KO pause (this keeps the HUD less confusing).
    const completedRound = this._round
    this._round += 1

    // Optional: auto-change stage after KO to increase variety when watching AI vs AI.
    // We rotate based on the number of *completed* rounds so:
    // - everyNRounds=1 => rotate after every KO
    // - everyNRounds=3 => rotate after rounds 3, 6, 9, ...
    const shouldRotateStage =
      this._stageRotation?.enabled && completedRound % (this._stageRotation.everyNRounds || 1) === 0

    if (shouldRotateStage) {
      // Advance the seed deterministically so bugs can be reproduced by copying the seed value.
      const currentSeed = Number(this._stageMeta?.seed ?? 0)
      const nextSeed = Number.isFinite(currentSeed) ? (currentSeed + 1) >>> 0 : (Date.now() >>> 0)

      this._stageConfig = {
        ...this._stageConfig,
        seed: nextSeed,
      }

      // Rebuild stage without resetting score/round.
      // `_rebuildStage` will also reset fighters to new spawn points for the next round.
      this._rebuildStage({ nowMs, resetMatch: false })
      return
    }

    this._resetFighters({ nowMs })
  }

  _setKoOverlayVisible(visible) {
    if (this._koText) this._koText.setVisible(visible)
    if (this._koSubText) this._koSubText.setVisible(visible)
  }

  _emitDebugSnapshot({ delta }) {
    // Emit a debug snapshot at ~10Hz to avoid spamming React with updates every frame.
    this._debugAccumulatorMs += delta
    if (this._debugAccumulatorMs < 100) return
    this._debugAccumulatorMs = 0

    if (!this._onDebugSnapshot) return

    const nowMs = this.time?.now ?? 0

    // Camera + scale diagnostics are useful when debugging "I can't see the fighters"
    // or "the canvas keeps resizing" issues in the browser.
    const cam = this.cameras?.main
    const view = cam?.worldView ?? null
    const displaySize = this.scale?.displaySize
    const canvas = this.scale?.canvas
    const parent = this.scale?.parent

    // Physics bounds diagnostics: helps confirm whether the world bounds are valid
    // and whether all 4 sides are enabled for collision checks.
    const world = this.physics?.world
    const worldBounds = world?.bounds
    const worldChecks = world?.checkCollision

    // Keep the snapshot intentionally small (only what the UI needs).
    this._onDebugSnapshot({
      instanceId: this._instanceId,
      left: this._serializeFighter(this._leftFighter, nowMs),
      right: this._serializeFighter(this._rightFighter, nowMs),
      world: {
        // These are helpful for diagnosing falling / collision / camera bounds issues.
        stageWidth: Math.round((Number(this._stage?.width) || 0) * 10) / 10,
        stageHeight: Math.round((Number(this._stage?.height) || 0) * 10) / 10,
        hasTileLayer: Boolean(this._tileLayer),
        tileColliderCount: Array.isArray(this._tileColliders) ? this._tileColliders.length : 0,
      },
      physics: worldBounds
        ? {
            bounds: {
              x: Math.round((Number(worldBounds.x) || 0) * 10) / 10,
              y: Math.round((Number(worldBounds.y) || 0) * 10) / 10,
              width: Math.round((Number(worldBounds.width) || 0) * 10) / 10,
              height: Math.round((Number(worldBounds.height) || 0) * 10) / 10,
            },
            checkCollision: worldChecks
              ? {
                  left: Boolean(worldChecks.left),
                  right: Boolean(worldChecks.right),
                  up: Boolean(worldChecks.up),
                  down: Boolean(worldChecks.down),
                }
              : null,
          }
        : null,
      camera: cam
        ? {
            zoom: Math.round((Number(cam.zoom) || 0) * 1000) / 1000,
            scrollX: Math.round((Number(cam.scrollX) || 0) * 10) / 10,
            scrollY: Math.round((Number(cam.scrollY) || 0) * 10) / 10,
            // worldView is what the camera can currently see (in world coordinates).
            // This is the fastest way to diagnose "fighters exist but I can't see them".
            worldView: view
              ? {
                  x: Math.round((Number(view.x) || 0) * 10) / 10,
                  y: Math.round((Number(view.y) || 0) * 10) / 10,
                  width: Math.round((Number(view.width) || 0) * 10) / 10,
                  height: Math.round((Number(view.height) || 0) * 10) / 10,
                  left: Math.round((Number(view.left) || 0) * 10) / 10,
                  right: Math.round((Number(view.right) || 0) * 10) / 10,
                  top: Math.round((Number(view.top) || 0) * 10) / 10,
                  bottom: Math.round((Number(view.bottom) || 0) * 10) / 10,
                }
              : null,
            // Follow target diagnostics help confirm the camera is actually following something.
            follow: cam._follow
              ? {
                  x: Math.round((Number(cam._follow.x) || 0) * 10) / 10,
                  y: Math.round((Number(cam._follow.y) || 0) * 10) / 10,
                }
              : null,
            followOffset: cam.followOffset
              ? {
                  x: Math.round((Number(cam.followOffset.x) || 0) * 10) / 10,
                  y: Math.round((Number(cam.followOffset.y) || 0) * 10) / 10,
                }
              : null,
            bounds:
              typeof cam.getBounds === 'function'
                ? (() => {
                    const b = cam.getBounds()
                    return {
                      x: Math.round((Number(b.x) || 0) * 10) / 10,
                      y: Math.round((Number(b.y) || 0) * 10) / 10,
                      width: Math.round((Number(b.width) || 0) * 10) / 10,
                      height: Math.round((Number(b.height) || 0) * 10) / 10,
                    }
                  })()
                : null,
            useBounds: Boolean(cam.useBounds),
          }
        : null,
      scale: displaySize
        ? {
            // Phaser's computed "display size" after Scale Manager applies FIT.
            displayWidth: Math.round((Number(displaySize.width) || 0) * 10) / 10,
            displayHeight: Math.round((Number(displaySize.height) || 0) * 10) / 10,
            // DOM-reported canvas size (helps detect CSS/layout feedback loops).
            canvasClientWidth: Number(canvas?.clientWidth ?? 0),
            canvasClientHeight: Number(canvas?.clientHeight ?? 0),
            // Bounding rect can help diagnose sub-pixel resizing jitter.
            // Sampled at ~10Hz to avoid layout thrash.
            canvasRect: canvas?.getBoundingClientRect
              ? {
                  width: Math.round((Number(canvas.getBoundingClientRect().width) || 0) * 10) / 10,
                  height: Math.round((Number(canvas.getBoundingClientRect().height) || 0) * 10) / 10,
                }
              : null,
            // Parent DOM measurements are useful for detecting "multiple canvases"
            // or container sizing issues coming from React/CSS.
            parentClientWidth: Number(parent?.clientWidth ?? 0),
            parentClientHeight: Number(parent?.clientHeight ?? 0),
            parentCanvasCount:
              typeof parent?.querySelectorAll === 'function'
                ? parent.querySelectorAll('canvas').length
                : 0,
          }
        : null,
      ai: {
        left: this._serializeAi(this._leftAi),
        right: this._serializeAi(this._rightAi),
      },
      aiProfiles: this._aiProfiles,
      assets: {
        player: this._playerAssetStatus,
      },
      controlMode: this._controlMode,
      replay: {
        recording: this._replayRecorder
          ? {
              active: this._replayRecorder.isRecording,
              side: this._recordingSide,
              frameCount: this._replayRecorder.frameCount,
              durationMs: this._replayRecorder.durationMs,
            }
          : { active: false, side: null, frameCount: 0, durationMs: 0 },
        left: this._leftReplay
          ? { loaded: true, frameCount: this._leftReplay.frameCount, loop: this._leftReplay.loop }
          : { loaded: false, frameCount: 0, loop: false },
        right: this._rightReplay
          ? { loaded: true, frameCount: this._rightReplay.frameCount, loop: this._rightReplay.loop }
          : { loaded: false, frameCount: 0, loop: false },
      },
      score: this._score,
      round: this._round,
      roundPhase: this._roundPhase,
      koWinner: this._koWinner,
      failsafe: this._failsafe,
      // Telemetry / benchmark: used for AI tuning and regression testing.
      telemetry: this._telemetry?.round
        ? {
            roundNumber: Number(this._telemetry.round.roundNumber ?? this._round),
            elapsedMs: Math.max(
              0,
              nowMs - Number(this._telemetry.round.startedAtMs ?? this._telemetry.roundStartedAtMs ?? 0),
            ),
            left: {
              attacksStarted: this._telemetry.round.left.attacksStarted,
              hitsLanded: this._telemetry.round.left.hitsLanded,
              hitsBlocked: this._telemetry.round.left.hitsBlocked,
              hitsDodged: this._telemetry.round.left.hitsDodged,
              damageDealt: this._telemetry.round.left.damageDealt,
              chipDamageDealt: this._telemetry.round.left.chipDamageDealt,
              blocks: this._telemetry.round.left.blocks,
              dodges: this._telemetry.round.left.dodges,
              dashes: this._telemetry.round.left.dashes,
              dodgesStarted: this._telemetry.round.left.dodgesStarted,
            },
            right: {
              attacksStarted: this._telemetry.round.right.attacksStarted,
              hitsLanded: this._telemetry.round.right.hitsLanded,
              hitsBlocked: this._telemetry.round.right.hitsBlocked,
              hitsDodged: this._telemetry.round.right.hitsDodged,
              damageDealt: this._telemetry.round.right.damageDealt,
              chipDamageDealt: this._telemetry.round.right.chipDamageDealt,
              blocks: this._telemetry.round.right.blocks,
              dodges: this._telemetry.round.right.dodges,
              dashes: this._telemetry.round.right.dashes,
              dodgesStarted: this._telemetry.round.right.dodgesStarted,
            },
          }
        : null,
      benchmark: this._benchmark
        ? {
            // `active` means we are currently collecting new rounds.
            active: Boolean(this._benchmark.enabled),
            stopOnComplete: Boolean(this._benchmark.stopOnComplete),
            targetRounds: Number(this._benchmark.targetRounds ?? 0),
            completedRounds: Number(this._benchmark.completedRounds ?? 0),
            // `done` means we reached the target at least once (even if active is now false).
            done:
              Number(this._benchmark.targetRounds ?? 0) > 0 &&
              Number(this._benchmark.completedRounds ?? 0) >= Number(this._benchmark.targetRounds ?? 0),
            report: this._benchmark.report,
          }
        : null,
      btLoaded: Boolean(this._initialBtJsonText),
      stage: this._stageMeta,
    })
  }

  _checkPlayerAssets() {
    // Build a compact diagnostic object for the React debug panel.
    // This helps confirm that:
    // - Vite found the expected sprite frame files
    // - Phaser loaded them into the Texture Manager
    // - Phaser animations were created with the expected keys
    const frameStats = getCharacterFrameStats()

    const missingTextures = []
    const missingAnims = []
    const emptyActions = []

    for (const [characterId, actions] of Object.entries(frameStats ?? {})) {
      for (const [action, count] of Object.entries(actions ?? {})) {
        const frameCount = Number(count ?? 0)
        if (!frameCount) {
          emptyActions.push(`${characterId}:${action}`)
          continue
        }

        // Check the first and last frame keys (cheap, high signal).
        const firstKey = getFrameKey({ characterId, action, frameNumber: 1 })
        const lastKey = getFrameKey({ characterId, action, frameNumber: frameCount })

        if (!this.textures.exists(firstKey)) missingTextures.push(firstKey)
        if (!this.textures.exists(lastKey)) missingTextures.push(lastKey)

        // Check the animation exists.
        const animKey = getAnimKey({ characterId, action })
        if (!this.anims.exists(animKey)) missingAnims.push(animKey)
      }
    }

    const ok =
      !emptyActions.length && !missingTextures.length && !missingAnims.length

    return {
      ok,
      frameStats,
      // Keep lists short so the debug snapshot stays readable.
      emptyActions: emptyActions.slice(0, 20),
      missingTextures: missingTextures.slice(0, 20),
      missingAnims: missingAnims.slice(0, 20),
    }
  }

  _ensurePixelTexture() {
    // Create the texture only once across scene restarts.
    if (this.textures.exists('pixel')) return

    const graphics = this.make.graphics({ x: 0, y: 0, add: false })
    graphics.fillStyle(0xffffff, 1)
    graphics.fillRect(0, 0, 1, 1)
    graphics.generateTexture('pixel', 1, 1)
    graphics.destroy()
  }

  _createBackground() {
    // Create background layers once.
    // If they already exist (e.g., stage regeneration), do nothing.
    if (this._background) return

    const stageWidth = Number(this.game?.config?.width ?? this._stage.width)
    const stageHeight = Number(this.game?.config?.height ?? this._stage.height)

    // Create a container so we can manage depth/visibility in one place.
    this._background = this.add.container(0, 0).setDepth(-100)

    // Each layer is stretched to the viewport size.
    // (Later we can switch to parallax or camera-relative scaling.)
    const layers = [
      BACKGROUND_KEYS.LAYER_1,
      BACKGROUND_KEYS.LAYER_2,
      BACKGROUND_KEYS.LAYER_3,
      BACKGROUND_KEYS.LAYER_4,
    ]

    for (const key of layers) {
      const img = this.add.image(0, 0, key).setOrigin(0, 0).setScrollFactor(0)
      img.setDisplaySize(stageWidth, stageHeight)
      this._background.add(img)
    }
  }

  _rebuildStage({ nowMs, resetMatch }) {
    if (this._log.enabled) {
      this._log.groupCollapsed('stage:rebuild', {
        nowMs,
        resetMatch,
        stageConfig: this._stageConfig,
      })
      this._log.groupEnd()
    }

    // Destroy previous tilemap/layer safely.
    if (this._tileColliders?.length) {
      for (const c of this._tileColliders) c?.destroy?.()
    }
    this._tileColliders = []

    // Destroy previous stage decorations (sprites).
    if (this._stageDecorations?.length) {
      for (const sprite of this._stageDecorations) sprite?.destroy?.()
    }
    this._stageDecorations = []

    // Destroy tile layers first (they reference textures and internal tile data).
    if (this._tileForegroundLayer) this._tileForegroundLayer.destroy()
    if (this._tileBackgroundLayer) this._tileBackgroundLayer.destroy()
    if (this._tileLayer) this._tileLayer.destroy()

    // Destroy all tilemaps (we create multiple maps for multi-layer rendering).
    if (this._tilemaps?.length) {
      for (const map of this._tilemaps) map?.destroy?.()
    }

    this._tilemaps = []
    this._tileLayer = null
    this._tileBackgroundLayer = null
    this._tileForegroundLayer = null
    this._platformSurfaces = []
    this._oneWayTileIndices = []

    // Approximate reachability based on physics and Fighter tuning.
    // These constants should stay aligned with Fighter's movement numbers.
    const gravityY = Number(this.physics.world.gravity.y ?? 0)
    const assumedJumpVelocity = 640
    const assumedMoveSpeed = 340

    // Max jump height: v^2 / (2g).
    const maxJumpHeight =
      gravityY > 0 ? (assumedJumpVelocity * assumedJumpVelocity) / (2 * gravityY) : 140

    // Horizontal drift: approximate time in air (~2 * time to apex) * move speed.
    const timeToApex = gravityY > 0 ? assumedJumpVelocity / gravityY : 0.45
    const maxJumpDistance = assumedMoveSpeed * timeToApex * 2 * 0.85

    // ---- Stage generation + validation loop ----
    // We may need to re-roll (change seed) if the generated stage is not playable.
    // Example invalid cases:
    // - spawn has no platform below
    // - left/right spawns are disconnected in the platform graph
    const maxAttempts = 8
    const autoSeedBase = Date.now()

    let acceptedStageDefinition = null
    let acceptedBuilt = null
    let acceptedPlatformGraph = null
    let acceptedValidation = null
    let rerolls = 0
    let platformCount = 0

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      // If the user provided a seed, we keep it on attempt 0.
      // If validation fails, we derive a deterministic variant seed for retry.
      const baseSeed = this._stageConfig?.seed
      const seedForAttempt =
        attempt === 0
          ? baseSeed
          : baseSeed == null || baseSeed === ''
            ? autoSeedBase + attempt
            : typeof baseSeed === 'number'
              ? baseSeed + attempt
              : `${String(baseSeed)}#${attempt}`

      // Generate the stage definition (procedural or preset).
      const stageDefinition = createStageDefinition({
        ...this._stageConfig,
        seed: seedForAttempt,
      })

      // Build the Phaser Tilemap + collision + platform-surface rectangles.
      const built = buildTileStage(this, { stageDefinition })

      // Build a platform graph for AI + validation.
      const platformNodes = buildPlatformNodes(built.platformObjects)
      const platformGraph = buildPlatformGraph(platformNodes, {
        maxJumpHeight,
        maxJumpDistance,
      })

      // Validate playability.
      const validation = validateBrawlStage({
        platformNodes,
        platformGraph,
        spawns: stageDefinition.spawns,
      })

      if (this._log.enabled && this._log.verbose) {
        this._log.info('stage:attempt', {
          attempt,
          seedForAttempt,
          style: stageDefinition?.meta?.style,
          ok: validation.ok,
          platformCount: platformNodes.length,
          errors: validation?.errors?.slice?.(0, 4) ?? [],
        })
      }

      // Accept the first valid stage.
      // If we run out of attempts, accept the last attempt even if invalid
      // (but we still expose validation info via debug snapshot).
      const isLastAttempt = attempt === maxAttempts - 1
      if (validation.ok || isLastAttempt) {
        acceptedStageDefinition = stageDefinition
        acceptedBuilt = built
        acceptedPlatformGraph = platformGraph
        acceptedValidation = validation
        rerolls = attempt
        platformCount = platformNodes.length
        break
      }

      // Stage is invalid and we still have attempts left: destroy it and try again.
      for (const layer of Object.values(built.layers ?? {})) layer?.destroy?.()
      for (const map of built.maps ?? []) map?.destroy?.()
    }

    // Commit the accepted stage to the scene state.
    // (We should always have an accepted stage due to the "last attempt" fallback.)
    this._tilemaps = acceptedBuilt?.maps ?? []
    this._tileBackgroundLayer = acceptedBuilt?.layers?.background ?? null
    this._tileLayer = acceptedBuilt?.layers?.terrain ?? null
    this._tileForegroundLayer = acceptedBuilt?.layers?.foreground ?? null
    this._platformSurfaces = acceptedBuilt?.platformObjects ?? []
    this._oneWayTileIndices = acceptedBuilt?.collision?.oneWay ?? []
    this._oneWayTileIndexSet = new Set(this._oneWayTileIndices)

    // Expose stage meta to the debug UI (include reroll/validation info for learnability).
    this._stageMeta = {
      ...(acceptedStageDefinition?.meta ?? null),
      rerolls,
      valid: Boolean(acceptedValidation?.ok),
      // Keep only a short list of errors so the UI stays readable.
      errors: acceptedValidation?.errors?.slice?.(0, 4) ?? [],
      platformCount,
      spawnPlatformIds: acceptedValidation?.spawnPlatformIds ?? null,
    }

    // Update spawn points for fighters.
    this._spawns = acceptedStageDefinition?.spawns ?? null

    if (this._log.enabled) {
      this._log.info('stage:accepted', {
        style: this._stageMeta?.style,
        seed: this._stageMeta?.seed,
        rerolls: this._stageMeta?.rerolls,
        valid: this._stageMeta?.valid,
        errors: this._stageMeta?.errors,
        bounds: acceptedBuilt?.bounds ?? null,
        hasTileLayer: Boolean(this._tileLayer),
        oneWayCount: this._oneWayTileIndices.length,
        spawns: this._spawns,
      })
    }

    // Create stage decoration sprites (non-colliding).
    // These are purely visual and help differentiate maps without changing gameplay.
    const decorations = acceptedStageDefinition?.decorations ?? []
    if (Array.isArray(decorations) && decorations.length) {
      for (const deco of decorations) {
        if (!deco?.key) continue

        const sprite = this.add.image(deco.x ?? 0, deco.y ?? 0, deco.key)

        // Apply origin if provided (default to center).
        if (Array.isArray(deco.origin) && deco.origin.length >= 2) {
          sprite.setOrigin(Number(deco.origin[0]), Number(deco.origin[1]))
        }

        // Apply scale if provided.
        if (Number.isFinite(deco.scale)) sprite.setScale(deco.scale)

        // Depth controls layering relative to tiles/fighters.
        if (Number.isFinite(deco.depth)) sprite.setDepth(deco.depth)

        this._stageDecorations.push(sprite)
      }
    }

    // Update stage dimensions used by AI heuristics.
    const bounds = acceptedBuilt?.bounds ?? null
    if (bounds) {
      // World bounds are defined in world coordinates (taking layer offsets into account).
      // This matters when the tilemap is larger than the camera viewport.
      const right = Number(bounds.offsetX ?? 0) + Number(bounds.widthPx ?? 0)
      const bottom = Number(bounds.offsetY ?? 0) + Number(bounds.heightPx ?? 0)

      this._stage.width = right
      this._stage.height = bottom
      this._stage.centerX = Number(bounds.offsetX ?? 0) + Number(bounds.widthPx ?? 0) / 2

      // Apply camera + physics bounds so we can scroll on large stages.
      this._applyWorldAndCameraBounds(bounds)
    } else {
      // Fallback for safety: keep stage size equal to the game viewport.
      const stageWidth = Number(this.game?.config?.width ?? 960)
      const stageHeight = Number(this.game?.config?.height ?? 540)

      this._stage.width = stageWidth
      this._stage.height = stageHeight
      this._stage.centerX = stageWidth / 2
    }

    // Store the accepted graph for AI runtime.
    // NOTE: This graph is an approximation and will evolve over time.
    this._stage.platformGraph = acceptedPlatformGraph

    // If fighters already exist, reconnect stage collisions and reset positions.
    // This path is used when React requests stage regeneration.
    if (this._leftFighter && this._rightFighter) {
      this._rebuildStageColliders()

      // Optionally reset score/round too (useful when changing maps).
      // `resetMatch()` also resets fighter positions, so we avoid double-reset.
      if (resetMatch) this.resetMatch()
      else this._resetFighters({ nowMs })
    }
  }

  _rebuildStageColliders() {
    // Recreate Arcade Physics colliders between fighters and the tile layer.
    // We use a processCallback to implement one-way platform behavior.
    if (!this._tileLayer) return
    if (!this._leftFighter || !this._rightFighter) return

    if (this._tileColliders?.length) {
      for (const c of this._tileColliders) c?.destroy?.()
    }
    this._tileColliders = []

    // Pass `this` as callbackContext so `_processTileCollision` can read scene fields.
    this._tileColliders.push(
      this.physics.add.collider(this._leftFighter, this._tileLayer, null, this._processTileCollision, this),
    )
    this._tileColliders.push(
      this.physics.add.collider(this._rightFighter, this._tileLayer, null, this._processTileCollision, this),
    )
  }

  _processTileCollision(sprite, tile) {
    // This is Arcade Physics' processCallback signature for sprite-vs-tile collisions.
    // Return true to allow collision, false to ignore.
    if (!tile) return true

    // Only special-case one-way tiles (e.g., cloud platform).
    if (!this._oneWayTileIndexSet?.has?.(tile.index)) return true

    // If the sprite is currently dropping through, ignore one-way collisions entirely.
    // This is what makes "Down + Jump" actually fall through instead of landing again.
    const nowMs = this.time?.now ?? 0
    if (typeof sprite?.isIgnoringOneWay === 'function' && sprite.isIgnoringOneWay(nowMs)) {
      return false
    }

    // One-way rule:
    // - Only collide when the sprite is moving downward
    // - And when the sprite is above the tile top (prevents sticking from the side)
    const body = sprite?.body
    if (!body) return true

    // Moving up: do not collide (allows jumping through).
    // NOTE: We allow velocity.y === 0 so standing still does not fall through.
    if (body.velocity.y < 0) return false

    // Tile y is in tile coordinates; tile.height is tile size in pixels.
    // We add the layer's world y offset to get world coordinates.
    const tileHeight = Number(tile.height ?? tile.baseHeight ?? 0)
    const tileTopY = (this._tileLayer?.y ?? 0) + Number(tile.y ?? 0) * tileHeight

    // Small tolerance to account for float jitter.
    const tolerancePx = 6
    return body.bottom <= tileTopY + tolerancePx
  }

  _maybeDropThroughOneWay({ fighter, nowMs }) {
    // Convert "down + jump" intent into a temporary one-way collision override.
    if (!fighter?.body) return
    if (!this._tileLayer) return

    const intent = typeof fighter.getIntentRef === 'function' ? fighter.getIntentRef() : null
    if (!intent) return

    // Drop-through is triggered only by the combination.
    if (!intent.fastFall || !intent.jumpPressed) return

    // Must be on ground; otherwise this is just "fast fall + jump" in the air.
    const onGround = Boolean(fighter.body.blocked.down || fighter.body.touching.down)
    if (!onGround) return

    // Only drop if we are actually standing on a one-way tile.
    const tileBelow = this._getTileBelowSprite(fighter)
    if (!tileBelow) return
    if (!this._oneWayTileIndexSet?.has?.(tileBelow.index)) return

    // Enable the drop-through window and nudge downward so we separate from the tile immediately.
    if (typeof fighter.enableDropThrough === 'function') {
      fighter.enableDropThrough({ nowMs, durationMs: 240 })
    }

    fighter.body.setVelocityY(Math.max(fighter.body.velocity.y, 220))

    // Consume the jump press so Fighter doesn't buffer a jump on the same frame.
    // IMPORTANT: this is safe because:
    // - for human input, recording happens before Fighter consumes intents
    // - for AI intent, this prevents the same "press" from turning into a jump
    intent.jumpPressed = false
  }

  _getTileBelowSprite(sprite) {
    // Find the tile directly below the sprite's feet.
    // We use this to detect whether the sprite is standing on a one-way platform.
    if (!this._tileLayer || !sprite?.body) return null

    const worldX = sprite.x
    const worldY = sprite.body.bottom + 2

    // getTileAtWorldXY returns null if out-of-bounds or empty (depending on flags).
    if (typeof this._tileLayer.getTileAtWorldXY === 'function') {
      return this._tileLayer.getTileAtWorldXY(worldX, worldY, false)
    }

    return null
  }

  _setupCameraFollow() {
    // Initialize camera follow exactly once.
    if (this._cameraFocus) return

    const cam = this.cameras.main

    // Ensure we start from a sane zoom value.
    // (If the user hot-reloads or the browser lags badly, zoom can become unstable.)
    cam.setZoom(1)

    // Rounding camera scroll to whole pixels reduces visual shimmer.
    // This is especially noticeable when the canvas is scaled down by FIT.
    cam.setRoundPixels(true)

    // A 1x1 zone is enough; the camera only cares about its position.
    this._cameraFocus = this.add.zone(this._stage.centerX, this._stage.height / 2, 1, 1)

    // Follow the focus point with minimal filtering so fighters never drift off-screen.
    // We prefer deterministic "always visible" behavior over cinematic smoothing for MVP debugging.
    cam.startFollow(this._cameraFocus, true, 1, 1)

    // Disable deadzone so the camera always centers where we tell it to.
    cam.setDeadzone(0, 0)
  }

  _ensureDebugOverlay() {
    // Create the debug graphics object once and reuse it every frame.
    // We keep it null when debug is disabled to avoid any overhead.
    if (this._debugGraphics) return
    this._debugGraphics = this.add.graphics().setDepth(99)
  }

  _renderDebugOverlay({ nowMs }) {
    // Only render debug overlay when debug is enabled.
    if (!this._log.enabled) return
    if (!this._debugGraphics) return

    const g = this._debugGraphics
    g.clear()

    // Draw the current camera world view rectangle.
    const cam = this.cameras?.main
    const view = cam?.worldView
    if (view) {
      g.lineStyle(2, 0xffffff, 0.25)
      g.strokeRect(view.x, view.y, view.width, view.height)
    }

    // Draw fighter hurtboxes (always) and hitboxes (only when active).
    const drawFighter = (fighter, color) => {
      if (!fighter) return

      const hurt = fighter.getHurtboxRect?.()
      if (hurt) {
        g.lineStyle(2, color, 0.65)
        g.strokeRect(hurt.x, hurt.y, hurt.width, hurt.height)
      }

      const hit = fighter.getAttackHitboxRect?.()
      if (hit) {
        g.lineStyle(2, 0xffd43b, 0.9)
        g.strokeRect(hit.x, hit.y, hit.width, hit.height)
      }

      // Draw a small cross at the fighter's origin for sanity.
      g.lineStyle(2, color, 0.75)
      g.beginPath()
      g.moveTo(fighter.x - 6, fighter.y)
      g.lineTo(fighter.x + 6, fighter.y)
      g.moveTo(fighter.x, fighter.y - 6)
      g.lineTo(fighter.x, fighter.y + 6)
      g.closePath()
      g.strokePath()
    }

    drawFighter(this._leftFighter, 0x58a6ff)
    drawFighter(this._rightFighter, 0xff7b72)

    // Draw platform surfaces (sampled) so we can confirm collision extraction looks sane.
    // We intentionally sample to keep draw calls reasonable.
    const platforms = this._platformSurfaces
    if (Array.isArray(platforms) && platforms.length) {
      const sampleEvery = Math.max(1, Math.floor(platforms.length / 40))
      for (let i = 0; i < platforms.length; i += sampleEvery) {
        const p = platforms[i]
        if (!p) continue
        const lineColor = p.oneWay ? 0x7ee787 : 0x8b949e
        g.lineStyle(1, lineColor, 0.35)
        g.strokeRect(p.x - p.width / 2, p.y - p.height / 2, p.width, p.height)
      }
    }

    // Optional: show a small label when the camera rescue has triggered.
    const rescueCount = Number(this._cameraRescue?.rescueCount ?? 0)
    if (rescueCount > 0 && nowMs) {
      g.lineStyle(0)
      g.fillStyle(0x000000, 0.25)
      g.fillRoundedRect((view?.x ?? 0) + 10, (view?.y ?? 0) + 40, 230, 28, 8)
      g.fillStyle(0xffffff, 0.9)
      g.fillText?.(`camera rescue x${rescueCount}`, (view?.x ?? 0) + 18, (view?.y ?? 0) + 58)
    }
  }

  _maybeRescueCamera({ nowMs }) {
    // If fighters are missing, nothing to do.
    const left = this._leftFighter
    const right = this._rightFighter
    const cam = this.cameras?.main
    if (!left || !right || !cam) return

    const view = cam.worldView
    const leftInView = Phaser.Geom.Rectangle.Contains(view, left.x, left.y)
    const rightInView = Phaser.Geom.Rectangle.Contains(view, right.x, right.y)

    const rescue = this._cameraRescue
    if (!rescue) return

    const anyOut = !leftInView || !rightInView

    // Track how long we've been out of view.
    if (anyOut) {
      if (rescue.outOfViewSinceMs == null) rescue.outOfViewSinceMs = nowMs
    } else {
      rescue.outOfViewSinceMs = null
    }

    // Only rescue if we've been out of view for a bit (avoids fighting normal camera motion).
    const outForMs =
      rescue.outOfViewSinceMs == null ? 0 : Math.max(0, nowMs - rescue.outOfViewSinceMs)
    const timeSinceLastRescue = Math.max(0, nowMs - (rescue.lastRescueAtMs ?? 0))

    if (!anyOut) return
    if (outForMs < 420) return
    if (timeSinceLastRescue < 900) return

    // Compute midpoint and snap camera focus there.
    const midX = (left.x + right.x) / 2
    const midY = (left.y + right.y) / 2 - 70
    if (!Number.isFinite(midX) || !Number.isFinite(midY)) return

    // Ensure follow target exists (it can be lost during hot reload edge cases).
    if (!this._cameraFocus) this._setupCameraFollow()

    this._cameraFocus?.setPosition?.(Math.round(midX), Math.round(midY))
    cam.centerOn(midX, midY)

    rescue.lastRescueAtMs = nowMs
    rescue.rescueCount += 1

    if (this._log.enabled) {
      this._log.warn('camera:rescue', {
        rescueCount: rescue.rescueCount,
        outForMs: Math.round(outForMs),
        view: {
          x: Math.round(view.x),
          y: Math.round(view.y),
          w: Math.round(view.width),
          h: Math.round(view.height),
        },
        left: { x: Math.round(left.x), y: Math.round(left.y) },
        right: { x: Math.round(right.x), y: Math.round(right.y) },
      })
    }
  }

  _updateCameraFocus({ delta }) {
    // Keep the camera centered between fighters.
    if (!this._cameraFocus) return
    if (!this._leftFighter || !this._rightFighter) return

    const left = this._leftFighter
    const right = this._rightFighter

    const midX = (left.x + right.x) / 2
    const midY = (left.y + right.y) / 2
    if (!Number.isFinite(midX) || !Number.isFinite(midY)) return

    // Bias the camera slightly upward so you can see more "jump space".
    const biasY = -70

    // Smooth the focus position to avoid micro-jitter from Arcade Physics separation.
    // We keep smoothing fairly light so fast-paced action stays readable.
    const deltaMs = Number(delta ?? 0)
    const dtSec = Number.isFinite(deltaMs) ? Math.max(0, deltaMs) / 1000 : 0
    const clampedDt = Math.min(dtSec, 0.25)

    // Exponential smoothing factor (0..1) that is stable for any dt.
    const posSmoothing = 1 - Math.exp(-14 * clampedDt)

    const desiredX = midX
    const desiredY = midY + biasY

    // If focus is somehow invalid, snap immediately.
    const currentX = Number.isFinite(this._cameraFocus.x) ? this._cameraFocus.x : desiredX
    const currentY = Number.isFinite(this._cameraFocus.y) ? this._cameraFocus.y : desiredY

    const nextX = Phaser.Math.Linear(currentX, desiredX, posSmoothing)
    const nextY = Phaser.Math.Linear(currentY, desiredY, posSmoothing)

    // Apply a tiny hysteresis threshold:
    // - Arcade Physics separation can cause midpoints to oscillate by < 1px.
    // - Rounding those oscillations (especially under FIT scaling) looks like camera shake.
    // The hysteresis makes the camera "commit" to a direction only when the movement is meaningful.
    function applyHysteresis(current, next, thresholdPx) {
      if (!Number.isFinite(current) || !Number.isFinite(next)) return next
      return Math.abs(next - current) < thresholdPx ? current : next
    }

    // Clamp camera focus to the world bounds so it never drifts outside the valid scroll region.
    // This reduces edge jitter when the camera wants to follow slightly beyond the bounds.
    const cam = this.cameras.main
    const worldBounds = this.physics?.world?.bounds

    // Convert camera half-size to world units (zoom-aware).
    const zoom = Number(cam.zoom ?? 1) || 1
    const halfW = (Number(cam.width ?? 0) || 0) / (2 * zoom)
    const halfH = (Number(cam.height ?? 0) || 0) / (2 * zoom)

    // If bounds are missing or invalid, just use the smoothed value.
    let clampedX = nextX
    let clampedY = nextY

    if (worldBounds && Number.isFinite(worldBounds.x) && Number.isFinite(worldBounds.y)) {
      const minX = worldBounds.x + halfW
      const maxX = worldBounds.right - halfW
      const minY = worldBounds.y + halfH
      const maxY = worldBounds.bottom - halfH

      // If the stage is smaller than the viewport, center within bounds.
      clampedX = maxX >= minX ? Phaser.Math.Clamp(nextX, minX, maxX) : (worldBounds.x + worldBounds.right) / 2
      clampedY = maxY >= minY ? Phaser.Math.Clamp(nextY, minY, maxY) : (worldBounds.y + worldBounds.bottom) / 2
    }

    const finalX = applyHysteresis(currentX, clampedX, 0.75)
    // Vertical motion is more sensitive (1px jumps are very noticeable), so we use a slightly
    // larger threshold to suppress "ground contact" micro jitter.
    const finalY = applyHysteresis(currentY, clampedY, 1.25)

    // IMPORTANT:
    // Phaser Camera (when `roundPixels` is enabled) will `Math.floor` the computed scroll values.
    // If the follow target is *close* to an integer boundary (e.g. 360.0001 vs 359.9999),
    // the `floor` can flip the scroll by 1px every frame, which looks like constant shaking.
    //
    // The simplest stable fix is to snap the follow target to integer world pixels.
    // Because our camera size is integer (1280x720) and zoom is fixed at 1,
    // integer follow target => integer scroll => no floor-induced oscillation.
    this._cameraFocus.setPosition(Math.round(finalX), Math.round(finalY))

    // Keep camera zoom fixed at 1 for stability.
    // Dynamic zoom is a common source of "shaking" because scroll changes as zoom changes.
    if (cam.zoom !== 1) cam.setZoom(1)
  }

  _applyWorldAndCameraBounds(bounds) {
    // Configure world/camera bounds based on the tilemap size.
    // This allows larger stages with camera scrolling.
    const x = Number(bounds.offsetX ?? 0)
    const y = Number(bounds.offsetY ?? 0)
    const w = Number(bounds.widthPx ?? 0)
    const h = Number(bounds.heightPx ?? 0)

    // Camera bounds clamp what the player can see.
    this.cameras.main.setBounds(x, y, w, h)

    // Physics bounds clamp what can collide with world bounds.
    // For now we keep the bottom CLOSED so fighters can never fall forever.
    // (We can switch to "open bottom + ring-out KO" later when recovery moves exist.)
    this.physics.world.setBounds(x, y, w, h, true, true, true, true)
  }
}

function createEmptySideRoundStats() {
  // Per-side counters for a single round.
  // Keep these as simple integers so the report can be JSON-exported easily.
  return {
    // Offense
    attacksStarted: 0,
    hitsLanded: 0,
    hitsBlocked: 0,
    hitsDodged: 0,
    damageDealt: 0,
    chipDamageDealt: 0,

    // Defense / mobility
    blocks: 0,
    dodges: 0,
    dashes: 0,
    dodgesStarted: 0,
  }
}

function createEmptyRoundStats() {
  // A round row that we can finalize and export.
  // This is kept small so storing hundreds of rounds is still cheap.
  return {
    roundNumber: 0,
    startedAtMs: 0,
    endedAtMs: 0,
    durationMs: 0,
    winner: null,
    leftHpEnd: null,
    rightHpEnd: null,
    stage: { style: null, seed: null },
    left: createEmptySideRoundStats(),
    right: createEmptySideRoundStats(),
  }
}

function exportRoundStats(round) {
  // Return a deep-ish copy with only plain JSON values.
  // This prevents later mutation when the scene resets internal objects.
  return {
    roundNumber: Number(round?.roundNumber ?? 0),
    startedAtMs: Number(round?.startedAtMs ?? 0),
    endedAtMs: Number(round?.endedAtMs ?? 0),
    durationMs: Number(round?.durationMs ?? 0),
    winner: round?.winner ?? null,
    leftHpEnd: round?.leftHpEnd ?? null,
    rightHpEnd: round?.rightHpEnd ?? null,
    stage: {
      style: round?.stage?.style ?? null,
      seed: round?.stage?.seed ?? null,
    },
    left: { ...(round?.left ?? createEmptySideRoundStats()) },
    right: { ...(round?.right ?? createEmptySideRoundStats()) },
  }
}

function computeBenchmarkReport(rounds) {
  // Compute a compact aggregate report for the UI.
  //
  // We keep the report stable and deterministic:
  // - No random sampling
  // - All numeric values are finite or null
  const list = Array.isArray(rounds) ? rounds : []
  const total = list.length
  if (!total) {
    return {
      totalRounds: 0,
      wins: { left: 0, right: 0, draw: 0 },
      avgKoTimeMs: null,
      avgDamageDealt: { left: null, right: null },
      avgAttacksStarted: { left: null, right: null },
      avgHitsLanded: { left: null, right: null },
      avgBlocks: { left: null, right: null },
      avgDodges: { left: null, right: null },
    }
  }

  let leftWins = 0
  let rightWins = 0
  let draws = 0

  let sumDuration = 0
  let sumLeftDamage = 0
  let sumRightDamage = 0
  let sumLeftAttacks = 0
  let sumRightAttacks = 0
  let sumLeftHits = 0
  let sumRightHits = 0
  let sumLeftBlocks = 0
  let sumRightBlocks = 0
  let sumLeftDodges = 0
  let sumRightDodges = 0

  for (const r of list) {
    const winner = r?.winner
    if (winner === 'left') leftWins += 1
    else if (winner === 'right') rightWins += 1
    else draws += 1

    sumDuration += Number(r?.durationMs ?? 0)
    sumLeftDamage += Number(r?.left?.damageDealt ?? 0)
    sumRightDamage += Number(r?.right?.damageDealt ?? 0)
    sumLeftAttacks += Number(r?.left?.attacksStarted ?? 0)
    sumRightAttacks += Number(r?.right?.attacksStarted ?? 0)
    sumLeftHits += Number(r?.left?.hitsLanded ?? 0)
    sumRightHits += Number(r?.right?.hitsLanded ?? 0)
    sumLeftBlocks += Number(r?.left?.blocks ?? 0)
    sumRightBlocks += Number(r?.right?.blocks ?? 0)
    sumLeftDodges += Number(r?.left?.dodges ?? 0)
    sumRightDodges += Number(r?.right?.dodges ?? 0)
  }

  return {
    totalRounds: total,
    wins: { left: leftWins, right: rightWins, draw: draws },
    avgKoTimeMs: sumDuration / total,
    avgDamageDealt: { left: sumLeftDamage / total, right: sumRightDamage / total },
    avgAttacksStarted: { left: sumLeftAttacks / total, right: sumRightAttacks / total },
    avgHitsLanded: { left: sumLeftHits / total, right: sumRightHits / total },
    avgBlocks: { left: sumLeftBlocks / total, right: sumRightBlocks / total },
    avgDodges: { left: sumLeftDodges / total, right: sumRightDodges / total },
  }
}

function hashStringFNV1a32(text) {
  // Tiny deterministic hash for debugging/regression testing.
  //
  // Why not crypto?
  // - We want a zero-dependency helper that works in the browser sandbox.
  // - 32-bit FNV-1a is good enough to "fingerprint" a BT JSON blob for comparisons.
  const str = String(text ?? '')
  let hash = 2166136261

  for (let i = 0; i < str.length; i += 1) {
    hash ^= str.charCodeAt(i)
    // `Math.imul` keeps multiplication in 32-bit integer space.
    hash = Math.imul(hash, 16777619)
  }

  // Convert to unsigned and format as fixed 8-char hex.
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function normalizeControlMode(value) {
  if (value === CONTROL_MODE.HUMAN) return CONTROL_MODE.HUMAN
  if (value === CONTROL_MODE.REPLAY) return CONTROL_MODE.REPLAY
  return CONTROL_MODE.AI
}

function normalizeSide(value) {
  return value === 'right' ? 'right' : 'left'
}
