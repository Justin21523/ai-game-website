// This page hosts the Phaser battle scene.
// For this milestone we focus on AI-vs-AI so you can iterate quickly without manual input.
import { useCallback, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import GameHost from '../components/GameHost.jsx'
import { BT_STORAGE_KEY } from '../game/ai/btStorage.js'
import { REPLAY_STORAGE_KEY } from '../game/input/replayStorage.js'
import { BENCHMARK_RUNS_STORAGE_KEY } from '../game/benchmark/benchmarkStorage.js'
import { explainAiAgentSnapshot } from '../game/ai/explain/explainDecision.zh-TW.js'
import { AI_PROFILE_OPTIONS } from '../game/ai/aiProfiles.js'
import { STAGE_STYLE, STAGE_STYLE_LABEL } from '../game/stage/tileStageGenerator.js'

// Read the BT JSON saved by the BT lab page.
// Safely read a string value from localStorage.
function readStoredBtJson() {
  try {
    return localStorage.getItem(BT_STORAGE_KEY)
  } catch {
    return null
  }
}

// Safely read replay data from localStorage.
function readStoredReplay() {
  try {
    const text = localStorage.getItem(REPLAY_STORAGE_KEY)
    if (!text) return null
    return JSON.parse(text)
  } catch {
    return null
  }
}

// Safely write replay data to localStorage.
function writeStoredReplay(data) {
  try {
    localStorage.setItem(REPLAY_STORAGE_KEY, JSON.stringify(data))
    return true
  } catch {
    return false
  }
}

// Safely remove replay data from localStorage.
function clearStoredReplay() {
  try {
    localStorage.removeItem(REPLAY_STORAGE_KEY)
    return true
  } catch {
    return false
  }
}

function readStoredBenchmarkRuns() {
  // Benchmark exports can be saved locally so you can compare AI changes over time.
  try {
    const text = localStorage.getItem(BENCHMARK_RUNS_STORAGE_KEY)
    if (!text) return []
    const parsed = JSON.parse(text)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeStoredBenchmarkRuns(list) {
  try {
    localStorage.setItem(BENCHMARK_RUNS_STORAGE_KEY, JSON.stringify(list))
    return true
  } catch {
    return false
  }
}

function getBenchmarkKindLabel(data) {
  if (data?.kind === 'benchmarkBatch' || Array.isArray(data?.runs)) return 'Batch'
  return 'Single'
}

function getBenchmarkSummary(data) {
  // Normalize the exported payload into a stable, small summary object for UI display.
  const report = data?.report ?? null
  const aiProfiles = data?.aiProfiles ?? {}
  const btHash = data?.bt?.hash ?? null
  const kind = getBenchmarkKindLabel(data)

  // Stage label:
  // - single: use stage meta when available
  // - batch: use stageConfigTemplate if available (seed varies per run)
  const stageStyle = data?.stage?.style ?? data?.stageConfigTemplate?.style ?? data?.stageConfig?.style ?? null

  return {
    kind,
    btHash,
    leftProfile: aiProfiles.left ?? null,
    rightProfile: aiProfiles.right ?? null,
    stageStyle,
    totalRounds: report?.totalRounds ?? null,
    wins: report?.wins ?? null,
    avgKoTimeMs: report?.avgKoTimeMs ?? null,
    avgDamageDealt: report?.avgDamageDealt ?? null,
    avgAttacksStarted: report?.avgAttacksStarted ?? null,
    avgHitsLanded: report?.avgHitsLanded ?? null,
    avgBlocks: report?.avgBlocks ?? null,
    avgDodges: report?.avgDodges ?? null,
  }
}

function stripBenchmarkRounds(data) {
  // Create a smaller payload by removing the per-round rows.
  // Useful for saving to localStorage without hitting storage limits.
  if (!data || typeof data !== 'object') return data

  if (Array.isArray(data?.runs)) {
    return {
      ...data,
      runs: data.runs.map((run) => ({
        ...run,
        rounds: [],
      })),
    }
  }

  return { ...data, rounds: [] }
}

function formatEpochMs(epochMs) {
  const ms = Number(epochMs ?? 0)
  if (!Number.isFinite(ms) || ms <= 0) return '—'
  try {
    return new Date(ms).toLocaleString('zh-TW')
  } catch {
    return String(epochMs)
  }
}

function formatSeconds(ms) {
  const n = Number(ms)
  if (!Number.isFinite(n)) return '—'
  return `${Math.round((n / 1000) * 10) / 10}s`
}

function formatNumber(n) {
  const v = Number(n)
  if (!Number.isFinite(v)) return '—'
  return String(Math.round(v * 100) / 100)
}

function formatDelta(base, next, { invertBetter = false } = {}) {
  // Invert "better" if a smaller value is better (e.g., KO time).
  const a = Number(base)
  const b = Number(next)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return '—'
  const raw = b - a
  const sign = raw > 0 ? '+' : ''
  const display = `${sign}${formatNumber(raw)}`
  if (!invertBetter) return display
  // For "smaller is better", a negative delta is "good".
  return raw < 0 ? `${display}（更快）` : raw > 0 ? `${display}（更慢）` : display
}

function escapeCsvCell(value) {
  // Minimal CSV escaping:
  // - Wrap in quotes if the cell contains commas/newlines/quotes.
  // - Escape quotes by doubling them.
  const text = value == null ? '' : String(value)
  if (!/[,"\n\r]/.test(text)) return text
  return `"${text.replace(/"/g, '""')}"`
}

function buildBenchmarkCsv(benchmarkData) {
  // Convert exported benchmark JSON into a flat CSV table.
  //
  // Supported payload shapes:
  // - Single run: `{ rounds: [...] }`
  // - Batch run:  `{ kind: 'benchmarkBatch', runs: [ { rounds: [...] }, ... ] }`
  //
  // Design:
  // - 1 row per round (easiest to analyze in spreadsheets)
  // - Repeat run-level metadata on every row for easy pivot tables
  const isBatch = Array.isArray(benchmarkData?.runs)

  const header = [
    'btHash',
    'leftProfile',
    'rightProfile',
    'runIndex',
    'runSeed',
    'roundNumber',
    'winner',
    'durationMs',
    'stageStyle',
    'stageSeed',
    'leftHpEnd',
    'rightHpEnd',
    'leftAttacksStarted',
    'leftHitsLanded',
    'leftHitsBlocked',
    'leftHitsDodged',
    'leftDamageDealt',
    'leftChipDamageDealt',
    'leftBlocks',
    'leftDodges',
    'leftDashes',
    'leftDodgesStarted',
    'rightAttacksStarted',
    'rightHitsLanded',
    'rightHitsBlocked',
    'rightHitsDodged',
    'rightDamageDealt',
    'rightChipDamageDealt',
    'rightBlocks',
    'rightDodges',
    'rightDashes',
    'rightDodgesStarted',
  ]

  const lines = [header.map(escapeCsvCell).join(',')]

  const runs = isBatch ? benchmarkData.runs : [benchmarkData]

  for (let runIndex = 0; runIndex < runs.length; runIndex += 1) {
    const run = runs[runIndex]
    if (!run) continue

    const rounds = Array.isArray(run?.rounds) ? run.rounds : []
    const btHash = run?.bt?.hash ?? benchmarkData?.bt?.hash ?? ''
    const leftProfile = run?.aiProfiles?.left ?? benchmarkData?.aiProfiles?.left ?? ''
    const rightProfile = run?.aiProfiles?.right ?? benchmarkData?.aiProfiles?.right ?? ''

    // Prefer the explicit batch seed, otherwise fall back to stage seed.
    const runSeed = run?.batch?.seed ?? run?.stage?.seed ?? benchmarkData?.stage?.seed ?? ''

    for (const r of rounds) {
    const row = [
      btHash,
      leftProfile,
      rightProfile,
      run?.batch?.seedIndex ?? runIndex,
      runSeed,
      r?.roundNumber ?? '',
      r?.winner ?? '',
      r?.durationMs ?? '',
      r?.stage?.style ?? '',
      r?.stage?.seed ?? '',
      r?.leftHpEnd ?? '',
      r?.rightHpEnd ?? '',
      r?.left?.attacksStarted ?? 0,
      r?.left?.hitsLanded ?? 0,
      r?.left?.hitsBlocked ?? 0,
      r?.left?.hitsDodged ?? 0,
      r?.left?.damageDealt ?? 0,
      r?.left?.chipDamageDealt ?? 0,
      r?.left?.blocks ?? 0,
      r?.left?.dodges ?? 0,
      r?.left?.dashes ?? 0,
      r?.left?.dodgesStarted ?? 0,
      r?.right?.attacksStarted ?? 0,
      r?.right?.hitsLanded ?? 0,
      r?.right?.hitsBlocked ?? 0,
      r?.right?.hitsDodged ?? 0,
      r?.right?.damageDealt ?? 0,
      r?.right?.chipDamageDealt ?? 0,
      r?.right?.blocks ?? 0,
      r?.right?.dodges ?? 0,
      r?.right?.dashes ?? 0,
      r?.right?.dodgesStarted ?? 0,
    ]

    lines.push(row.map(escapeCsvCell).join(','))
  }
  }

  return lines.join('\n')
}

function downloadTextFile({ filename, text, mimeType } = {}) {
  // Small helper for downloading a string as a file.
  // Used for exporting CSV without adding dependencies.
  const safeName = filename ? String(filename) : `export_${Date.now()}.txt`
  const blob = new Blob([String(text ?? '')], { type: mimeType ?? 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)

  const a = document.createElement('a')
  a.href = url
  a.download = safeName
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)

  // Revoke after the click so the browser can read it.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

export default function BattlePage() {
  // Read the saved BT JSON once when the page renders.
  // If none exists, GameHost will pass null and the scene can fall back to defaults.
  const btJsonText = useMemo(() => readStoredBtJson(), [])

  // Default is AI vs AI to reduce manual testing time.
  const [leftControl, setLeftControl] = useState('ai')
  const [rightControl, setRightControl] = useState('ai')

  // AI playstyles are independent of control mode.
  // When a side is not controlled by AI, this setting is simply ignored.
  const [leftAiProfile, setLeftAiProfile] = useState('balanced')
  const [rightAiProfile, setRightAiProfile] = useState('balanced')

  // Replay data recorded from human input (stored locally for convenience).
  const [replayData, setReplayData] = useState(() => readStoredReplay())

  // Looping replay is useful for repeated regression testing.
  const [replayLoop, setReplayLoop] = useState(true)

  // A command object sent to GameHost/Phaser to start/stop recording or apply replay data.
  const [replayCommand, setReplayCommand] = useState(null)

  // Stage generation controls (tilemap style + deterministic seed).
  const [stageStyle, setStageStyle] = useState(STAGE_STYLE.PROCEDURAL_RANDOM)
  const [stageSeed, setStageSeed] = useState('')
  // Keep these aligned with the Phaser internal resolution (1280x720) and 32px tiles:
  // 40x23 tiles with offsetY -16 fits the viewport nicely.
  const [stageWidthTiles, setStageWidthTiles] = useState(40)
  const [stageHeightTiles, setStageHeightTiles] = useState(23)

  // Auto stage rotation (after KO) is useful when watching AI-vs-AI for long periods.
  const [autoRotateStage, setAutoRotateStage] = useState(false)
  const [autoRotateEvery, setAutoRotateEvery] = useState(1)

  // A command object sent to GameHost/Phaser to rebuild the stage.
  const [stageCommand, setStageCommand] = useState(null)

  // ---- Benchmark (evaluation loop) ----
  // Auto-run N rounds and collect stats so you can compare AI changes objectively.
  const [benchmarkRounds, setBenchmarkRounds] = useState(30)
  const [benchmarkStopOnComplete, setBenchmarkStopOnComplete] = useState(true)
  const [benchmarkResetMatch, setBenchmarkResetMatch] = useState(true)
  const [benchmarkCommand, setBenchmarkCommand] = useState(null)
  const [benchmarkData, setBenchmarkData] = useState(null)

  // Save/compare benchmark exports locally for regression testing.
  const [savedBenchmarkRuns, setSavedBenchmarkRuns] = useState(() => readStoredBenchmarkRuns())
  const [benchmarkSaveName, setBenchmarkSaveName] = useState('')
  const [benchmarkSaveSummaryOnly, setBenchmarkSaveSummaryOnly] = useState(true)
  const [baselineRunId, setBaselineRunId] = useState('')
  const [candidateRunId, setCandidateRunId] = useState('')

  // Batch benchmark controls.
  const [batchSeedStart, setBatchSeedStart] = useState('')
  const [batchSeedCount, setBatchSeedCount] = useState(10)
  const [batchRoundsPerSeed, setBatchRoundsPerSeed] = useState(20)
  const [batchPauseBetweenSeedsMs, setBatchPauseBetweenSeedsMs] = useState(450)

  // Increment this number to request a "reset match" from the running Phaser scene.
  // Using a monotonically increasing token is a simple way to trigger an effect.
  const [restartToken, setRestartToken] = useState(0)

  // Memoize the object so GameHost only reacts when values actually change.
  const controlMode = useMemo(
    () => ({ left: leftControl, right: rightControl }),
    [leftControl, rightControl],
  )

  const aiProfiles = useMemo(
    () => ({ left: leftAiProfile, right: rightAiProfile }),
    [leftAiProfile, rightAiProfile],
  )

  // Hold the latest debug snapshot emitted by Phaser (throttled to ~10Hz).
  const [debugSnapshot, setDebugSnapshot] = useState(null)

  // Keep the callback stable so GameHost doesn't re-create Phaser unnecessarily.
  const handleDebugSnapshot = useCallback((snapshot) => {
    setDebugSnapshot(snapshot)
  }, [])

  // Receive recorded replay data from Phaser and persist it for later reuse.
  const handleReplayData = useCallback((data) => {
    if (!data) return

    setReplayData(data)
    writeStoredReplay(data)
  }, [])

  // Receive exported benchmark payload from Phaser (round rows + aggregate report).
  const handleBenchmarkData = useCallback((data) => {
    if (!data) return
    setBenchmarkData(data)
  }, [])

  // UI helpers: send commands to Phaser via GameHost.
  function startRecordingLeft() {
    // Switch left to human automatically so recording makes sense.
    setLeftControl('human')

    setReplayCommand({
      type: 'startRecording',
      payload: { side: 'left', notes: 'P1 recording' },
    })
  }

  function stopRecording() {
    setReplayCommand({ type: 'stopRecording', payload: {} })
  }

  function applyReplayToLeft() {
    if (!replayData) return

    setReplayCommand({
      type: 'setReplayData',
      payload: { side: 'left', replayData, loop: replayLoop },
    })
    setLeftControl('replay')
  }

  function applyReplayToRight() {
    if (!replayData) return

    setReplayCommand({
      type: 'setReplayData',
      payload: { side: 'right', replayData, loop: replayLoop },
    })
    setRightControl('replay')
  }

  function clearReplay() {
    setReplayCommand({
      type: 'clearReplayData',
      payload: { side: 'both' },
    })

    setReplayData(null)
    clearStoredReplay()
  }

  const recordingState = debugSnapshot?.replay?.recording
  const isRecording = Boolean(recordingState?.active)

  // Stage info is emitted by BattleScene so the UI can display the active style/seed.
  const stageInfo = debugSnapshot?.stage

  // Explainability panel: convert trace/reasons into human-friendly Traditional Chinese.
  const leftExplain = explainAiAgentSnapshot(
    debugSnapshot?.controlMode?.left === 'ai' ? debugSnapshot?.ai?.left : null,
  )
  const rightExplain = explainAiAgentSnapshot(
    debugSnapshot?.controlMode?.right === 'ai' ? debugSnapshot?.ai?.right : null,
  )

  // Asset diagnostics emitted by BattleScene (helps confirm sprite frames/animations loaded).
  const playerAssets = debugSnapshot?.assets?.player

  function applyStageConfig() {
    // Send a single command to Phaser so we don't rebuild the Tilemap on every input change.
    setStageCommand({
      type: 'setStageConfig',
      payload: {
        style: stageStyle,
        seed: stageSeed || null,
        widthTiles: stageWidthTiles,
        heightTiles: stageHeightTiles,
        resetMatch: true,
      },
    })
  }

  function applyStageRotationConfig() {
    setStageCommand({
      type: 'setStageRotationConfig',
      payload: {
        enabled: autoRotateStage,
        everyNRounds: autoRotateEvery,
      },
    })
  }

  function randomizeSeed() {
    // Use a time-based seed for convenience (still reproducible if you copy the value).
    setStageSeed(String(Date.now()))
  }

  // Benchmark helpers: start/stop/export.
  function startBenchmark() {
    setBenchmarkData(null)
    setBenchmarkCommand({
      type: 'startBenchmark',
      payload: {
        rounds: benchmarkRounds,
        stopOnComplete: benchmarkStopOnComplete,
        resetMatch: benchmarkResetMatch,
      },
    })
  }

  function stopBenchmark() {
    setBenchmarkCommand({ type: 'stopBenchmark', payload: {} })
  }

  function exportBenchmark() {
    setBenchmarkCommand({ type: 'exportBenchmark', payload: {} })
  }

  function startBenchmarkBatch() {
    // Batch uses current stage style/size as a template and iterates over multiple seeds.
    setBenchmarkData(null)
    setBenchmarkCommand({
      type: 'startBenchmarkBatch',
      payload: {
        seedStart: batchSeedStart || stageSeed || null,
        seedCount: batchSeedCount,
        roundsPerSeed: batchRoundsPerSeed,
        pauseBetweenSeedsMs: batchPauseBetweenSeedsMs,
        stageConfigTemplate: {
          style: stageStyle,
          widthTiles: stageWidthTiles,
          heightTiles: stageHeightTiles,
        },
      },
    })
  }

  function stopBenchmarkBatch() {
    setBenchmarkCommand({ type: 'stopBenchmarkBatch', payload: {} })
  }

  function exportBenchmarkBatch() {
    setBenchmarkCommand({ type: 'exportBenchmarkBatch', payload: {} })
  }

  async function copyBenchmarkJson() {
    // Copy the last exported benchmark payload to clipboard.
    // This is useful for pasting into a gist / spreadsheet / analysis script.
    if (!benchmarkData) return

    try {
      const text = JSON.stringify(benchmarkData, null, 2)
      await navigator.clipboard.writeText(text)
      alert('已複製 Benchmark JSON 到剪貼簿。')
    } catch {
      alert('複製失敗：瀏覽器不允許 clipboard 存取。請改用「顯示 JSON」手動複製。')
    }
  }

  const benchmarkCsv = useMemo(
    () => (benchmarkData ? buildBenchmarkCsv(benchmarkData) : ''),
    [benchmarkData],
  )

  async function copyBenchmarkCsv() {
    // Copy CSV to clipboard so you can paste into Google Sheets / Excel quickly.
    if (!benchmarkCsv) return

    try {
      await navigator.clipboard.writeText(benchmarkCsv)
      alert('已複製 Benchmark CSV 到剪貼簿。')
    } catch {
      alert('複製失敗：瀏覽器不允許 clipboard 存取。請改用「下載 CSV」。')
    }
  }

  function downloadBenchmarkCsv() {
    if (!benchmarkCsv) return

    const leftProfile = benchmarkData?.aiProfiles?.left ?? 'left'
    const rightProfile = benchmarkData?.aiProfiles?.right ?? 'right'
    const btHash = benchmarkData?.bt?.hash ?? 'bt'

    const seedCount = Array.isArray(benchmarkData?.runs) ? benchmarkData.runs.length : null
    const batchTag = seedCount != null ? `_batch_${seedCount}seeds` : ''
    const filename = `benchmark${batchTag}_${leftProfile}_vs_${rightProfile}_${btHash}_${Date.now()}.csv`
    downloadTextFile({ filename, text: benchmarkCsv, mimeType: 'text/csv;charset=utf-8' })
  }

  function saveBenchmarkRun() {
    // Save the last exported benchmark payload into localStorage for regression comparisons.
    if (!benchmarkData) return

    const nowEpochMs = Date.now()
    const id = `run_${nowEpochMs}_${Math.random().toString(16).slice(2, 8)}`

    const summary = getBenchmarkSummary(benchmarkData)
    const defaultName =
      `${summary.kind} | ${summary.leftProfile ?? 'L'} vs ${summary.rightProfile ?? 'R'} | ` +
      `BT ${summary.btHash ?? '—'} | ${summary.totalRounds ?? '—'} rounds`

    const name = benchmarkSaveName.trim() || defaultName
    const payload = benchmarkSaveSummaryOnly ? stripBenchmarkRounds(benchmarkData) : benchmarkData

    // Rough size check (localStorage is typically ~5MB; keep headroom).
    const approxChars = JSON.stringify(payload).length
    if (approxChars > 2_500_000) {
      alert('此匯出結果太大，建議改用「只保存 report（不含 rounds）」或降低 rounds/seeds。')
      return
    }

    const entry = {
      id,
      name,
      savedAtEpochMs: nowEpochMs,
      summary,
      // Store the payload so you can re-load it later (e.g., export CSV again).
      data: payload,
      // Remember whether rounds were stripped, so the UI can communicate limitations.
      summaryOnly: Boolean(benchmarkSaveSummaryOnly),
      approxChars,
    }

    const next = [entry, ...savedBenchmarkRuns].slice(0, 30)
    setSavedBenchmarkRuns(next)
    writeStoredBenchmarkRuns(next)
    setBenchmarkSaveName('')
  }

  function deleteSavedRun(id) {
    const next = savedBenchmarkRuns.filter((r) => r?.id !== id)
    setSavedBenchmarkRuns(next)
    writeStoredBenchmarkRuns(next)
  }

  function clearSavedRuns() {
    setSavedBenchmarkRuns([])
    writeStoredBenchmarkRuns([])
    setBaselineRunId('')
    setCandidateRunId('')
  }

  function loadSavedRunIntoExport(id) {
    const entry = savedBenchmarkRuns.find((r) => r?.id === id)
    if (!entry?.data) return
    setBenchmarkData(entry.data)
  }

  const baselineEntry = savedBenchmarkRuns.find((r) => r?.id === baselineRunId) ?? null
  const candidateEntry = savedBenchmarkRuns.find((r) => r?.id === candidateRunId) ?? null

  const comparisonText = useMemo(() => {
    if (!baselineEntry || !candidateEntry) return ''

    const a = baselineEntry.summary ?? getBenchmarkSummary(baselineEntry.data)
    const b = candidateEntry.summary ?? getBenchmarkSummary(candidateEntry.data)

    const lines = []
    lines.push(`Baseline：${baselineEntry.name}`)
    lines.push(`- 時間：${formatEpochMs(baselineEntry.savedAtEpochMs)}`)
    lines.push(`- 類型：${a.kind}  | BT：${a.btHash ?? '—'}  | Profiles：${a.leftProfile ?? '—'} vs ${a.rightProfile ?? '—'}`)
    lines.push('')
    lines.push(`Candidate：${candidateEntry.name}`)
    lines.push(`- 時間：${formatEpochMs(candidateEntry.savedAtEpochMs)}`)
    lines.push(`- 類型：${b.kind}  | BT：${b.btHash ?? '—'}  | Profiles：${b.leftProfile ?? '—'} vs ${b.rightProfile ?? '—'}`)
    lines.push('')

    lines.push(`總回合：${a.totalRounds ?? '—'} → ${b.totalRounds ?? '—'}（Δ ${formatDelta(a.totalRounds, b.totalRounds)}）`)
    lines.push(
      `平均 KO：${formatSeconds(a.avgKoTimeMs)} → ${formatSeconds(b.avgKoTimeMs)}（Δ ${formatDelta(a.avgKoTimeMs, b.avgKoTimeMs, { invertBetter: true })}）`,
    )

    const aWins = a.wins ?? {}
    const bWins = b.wins ?? {}
    lines.push(
      `勝率（count）：L ${aWins.left ?? '—'} / R ${aWins.right ?? '—'} / D ${aWins.draw ?? '—'}  →  ` +
        `L ${bWins.left ?? '—'} / R ${bWins.right ?? '—'} / D ${bWins.draw ?? '—'}`,
    )

    lines.push(
      `平均傷害：L ${formatNumber(a.avgDamageDealt?.left)} / R ${formatNumber(a.avgDamageDealt?.right)}  →  ` +
        `L ${formatNumber(b.avgDamageDealt?.left)} / R ${formatNumber(b.avgDamageDealt?.right)}`,
    )
    lines.push(
      `平均命中：L ${formatNumber(a.avgHitsLanded?.left)} / R ${formatNumber(a.avgHitsLanded?.right)}  →  ` +
        `L ${formatNumber(b.avgHitsLanded?.left)} / R ${formatNumber(b.avgHitsLanded?.right)}`,
    )
    lines.push(
      `平均出招數：L ${formatNumber(a.avgAttacksStarted?.left)} / R ${formatNumber(a.avgAttacksStarted?.right)}  →  ` +
        `L ${formatNumber(b.avgAttacksStarted?.left)} / R ${formatNumber(b.avgAttacksStarted?.right)}`,
    )
    lines.push(
      `平均格擋：L ${formatNumber(a.avgBlocks?.left)} / R ${formatNumber(a.avgBlocks?.right)}  →  ` +
        `L ${formatNumber(b.avgBlocks?.left)} / R ${formatNumber(b.avgBlocks?.right)}`,
    )
    lines.push(
      `平均閃避：L ${formatNumber(a.avgDodges?.left)} / R ${formatNumber(a.avgDodges?.right)}  →  ` +
        `L ${formatNumber(b.avgDodges?.left)} / R ${formatNumber(b.avgDodges?.right)}`,
    )

    return lines.join('\n')
  }, [baselineEntry, candidateEntry])

  const savedRunsSummaryCsv = useMemo(() => {
    if (!savedBenchmarkRuns.length) return ''

    const header = [
      'id',
      'name',
      'savedAt',
      'kind',
      'btHash',
      'leftProfile',
      'rightProfile',
      'totalRounds',
      'avgKoTimeMs',
      'winsLeft',
      'winsRight',
      'winsDraw',
      'avgDamageLeft',
      'avgDamageRight',
      'summaryOnly',
      'approxChars',
    ]

    const lines = [header.map(escapeCsvCell).join(',')]

    for (const entry of savedBenchmarkRuns) {
      const s = entry?.summary ?? getBenchmarkSummary(entry?.data)
      lines.push(
        [
          entry?.id ?? '',
          entry?.name ?? '',
          formatEpochMs(entry?.savedAtEpochMs),
          s?.kind ?? '',
          s?.btHash ?? '',
          s?.leftProfile ?? '',
          s?.rightProfile ?? '',
          s?.totalRounds ?? '',
          s?.avgKoTimeMs ?? '',
          s?.wins?.left ?? '',
          s?.wins?.right ?? '',
          s?.wins?.draw ?? '',
          s?.avgDamageDealt?.left ?? '',
          s?.avgDamageDealt?.right ?? '',
          entry?.summaryOnly ? '1' : '0',
          entry?.approxChars ?? '',
        ].map(escapeCsvCell).join(','),
      )
    }

    return lines.join('\n')
  }, [savedBenchmarkRuns])

  function downloadSavedRunsSummaryCsv() {
    if (!savedRunsSummaryCsv) return
    downloadTextFile({
      filename: `benchmark_runs_summary_${Date.now()}.csv`,
      text: savedRunsSummaryCsv,
      mimeType: 'text/csv;charset=utf-8',
    })
  }

  async function copySavedRunsSummaryCsv() {
    if (!savedRunsSummaryCsv) return
    try {
      await navigator.clipboard.writeText(savedRunsSummaryCsv)
      alert('已複製 saved runs summary CSV 到剪貼簿。')
    } catch {
      alert('複製失敗：瀏覽器不允許 clipboard 存取。')
    }
  }

  return (
    <div className="page">
      <header className="pageHeader">
        <div className="headerRow">
          <h1 className="title">對戰（可切換人類/AI 控制）</h1>
          <div className="buttonRow">
            <Link className="button buttonSecondary" to="/menu">
              回選單
            </Link>
            <Link className="button buttonSecondary" to="/lab/bt">
              BT 實驗室
            </Link>
          </div>
        </div>
        <p className="subtitle">
          這頁會掛載 Phaser 場景並讓兩個 AI 以同一棵 Behavior Tree 對戰。BT JSON
          來源為 localStorage（由「BT 實驗室」儲存）；未儲存時會使用預設 BT。
        </p>
      </header>

      <section className="card">
        <h2 className="cardTitle">遊戲畫面</h2>
        <div className="controlPanel">
          <div className="controlGroup">
            <label className="label" htmlFor="leftControl">
              左方角色
            </label>
            <select
              id="leftControl"
              className="select"
              value={leftControl}
              onChange={(event) => setLeftControl(event.target.value)}
            >
              <option value="ai">AI（BT）</option>
              <option value="human">人類（鍵盤）</option>
              <option value="replay">回放（Replay）</option>
            </select>
            <p className="hint">
              人類按鍵（P1）：A/D 移動，W/Space 跳，S 快速下落，U Dash，H Guard，L Dodge，J 輕攻擊，K 重攻擊
            </p>

            <label className="label" htmlFor="leftAiProfile" style={{ marginTop: 12 }}>
              AI 風格
            </label>
            <select
              id="leftAiProfile"
              className="select"
              value={leftAiProfile}
              onChange={(event) => setLeftAiProfile(event.target.value)}
            >
              {AI_PROFILE_OPTIONS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.labelZh}
                </option>
              ))}
            </select>
            <p className="hint">
              {AI_PROFILE_OPTIONS.find((p) => p.id === leftAiProfile)?.descriptionZh ?? ''}
            </p>
          </div>

          <div className="controlGroup">
            <label className="label" htmlFor="rightControl">
              右方角色
            </label>
            <select
              id="rightControl"
              className="select"
              value={rightControl}
              onChange={(event) => setRightControl(event.target.value)}
            >
              <option value="ai">AI（BT）</option>
              <option value="human">人類（鍵盤）</option>
              <option value="replay">回放（Replay）</option>
            </select>
            <p className="hint">
              人類按鍵（P2）：←/→ 移動，↑/Enter 跳，↓ 快速下落，5 Dash，3 Guard，4 Dodge，1 輕攻擊，2 重攻擊
            </p>

            <label className="label" htmlFor="rightAiProfile" style={{ marginTop: 12 }}>
              AI 風格
            </label>
            <select
              id="rightAiProfile"
              className="select"
              value={rightAiProfile}
              onChange={(event) => setRightAiProfile(event.target.value)}
            >
              {AI_PROFILE_OPTIONS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.labelZh}
                </option>
              ))}
            </select>
            <p className="hint">
              {AI_PROFILE_OPTIONS.find((p) => p.id === rightAiProfile)?.descriptionZh ?? ''}
            </p>
          </div>
        </div>

        <div className="controlGroup" style={{ marginBottom: 16 }}>
          <h3 className="cardTitle">輸入錄製 / 回放（左方 P1）</h3>
          <div className="buttonRow">
            {!isRecording ? (
              <button className="button" type="button" onClick={startRecordingLeft}>
                開始錄製（左方）
              </button>
            ) : (
              <button className="button" type="button" onClick={stopRecording}>
                停止錄製
              </button>
            )}

            <button
              className="button"
              type="button"
              onClick={applyReplayToLeft}
              disabled={!replayData}
            >
              套用回放到左方
            </button>

            <button
              className="button"
              type="button"
              onClick={applyReplayToRight}
              disabled={!replayData}
            >
              套用回放到右方
            </button>

            <button
              className="button buttonSecondary"
              type="button"
              onClick={clearReplay}
              disabled={!replayData}
            >
              清除回放
            </button>

            <label className="hint" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={replayLoop}
                onChange={(event) => setReplayLoop(event.target.checked)}
              />
              循環回放
            </label>
          </div>

          <p className="hint">
            {replayData
              ? `已載入回放：${replayData.frameCount ?? replayData.frames?.length ?? 0} frames，${Math.round(
                  (replayData.durationMs ?? 0) / 1000,
                )} 秒`
              : '尚未錄製回放。'}
          </p>
          {isRecording ? (
            <p className="statusOk">
              錄製中：{recordingState?.frameCount ?? 0} frames（約{' '}
              {Math.round((recordingState?.durationMs ?? 0) / 1000)} 秒）
            </p>
          ) : null}
        </div>

        <div className="buttonRow toolbarRow">
          <button
            className="button"
            type="button"
            onClick={() => setRestartToken((v) => v + 1)}
          >
            重新開始（重置比賽）
          </button>
        </div>

        <div className="controlPanel" style={{ marginTop: 12 }}>
          <div className="controlGroup">
            <label className="label" htmlFor="stageStyle">
              關卡樣式（Tilemap）
            </label>
            <select
              id="stageStyle"
              className="select"
              value={stageStyle}
              onChange={(event) => setStageStyle(event.target.value)}
            >
              {Object.values(STAGE_STYLE).map((value) => (
                <option key={value} value={value}>
                  {STAGE_STYLE_LABEL[value] ?? value}
                </option>
              ))}
            </select>
            <p className="hint">
              目前關卡：{stageInfo?.styleLabel ?? '（載入中…）'} / seed：
              {stageInfo?.seedLabel ?? stageInfo?.seed ?? '—'}
            </p>
          </div>

          <div className="controlGroup">
            <label className="label" htmlFor="stageSeed">
              Seed（可留空＝自動隨機）
            </label>
            <input
              id="stageSeed"
              className="input"
              value={stageSeed}
              onChange={(event) => setStageSeed(event.target.value)}
              placeholder="例如：12345 或 abc"
            />
            <p className="hint" style={{ marginTop: 10 }}>
              地圖尺寸（tiles）：{stageWidthTiles} × {stageHeightTiles}（每格 32px）
            </p>
            <div className="buttonRow" style={{ marginTop: 10 }}>
              <button
                className="button buttonSecondary"
                type="button"
                onClick={() => {
                  setStageWidthTiles(40)
                  setStageHeightTiles(23)
                }}
              >
                小地圖（40×23）
              </button>
              <button
                className="button buttonSecondary"
                type="button"
                onClick={() => {
                  setStageWidthTiles(80)
                  setStageHeightTiles(30)
                }}
              >
                大地圖（80×30）
              </button>
            </div>
            <div className="buttonRow" style={{ marginTop: 10 }}>
              <label className="hint" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                寬度
                <input
                  className="input"
                  style={{ width: 110 }}
                  type="number"
                  min="20"
                  max="120"
                  value={stageWidthTiles}
                  onChange={(event) => setStageWidthTiles(Number(event.target.value))}
                />
              </label>
              <label className="hint" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                高度
                <input
                  className="input"
                  style={{ width: 110 }}
                  type="number"
                  min="12"
                  max="60"
                  value={stageHeightTiles}
                  onChange={(event) => setStageHeightTiles(Number(event.target.value))}
                />
              </label>
            </div>
            <div className="buttonRow" style={{ marginTop: 10 }}>
              <button className="button buttonSecondary" type="button" onClick={randomizeSeed}>
                產生隨機 seed
              </button>
              <button className="button" type="button" onClick={applyStageConfig}>
                套用並重新開始
              </button>
            </div>

            <div className="buttonRow" style={{ marginTop: 12 }}>
              <label className="hint" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  type="checkbox"
                  checked={autoRotateStage}
                  onChange={(event) => setAutoRotateStage(event.target.checked)}
                />
                KO 後自動換地圖
              </label>

              <label className="hint" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                每
                <input
                  className="input"
                  style={{ width: 90 }}
                  type="number"
                  min="1"
                  max="20"
                  value={autoRotateEvery}
                  onChange={(event) => setAutoRotateEvery(Number(event.target.value))}
                />
                回合換一次
              </label>

              <button className="button buttonSecondary" type="button" onClick={applyStageRotationConfig}>
                套用換圖設定
              </button>
            </div>
          </div>
        </div>

        <div className="controlGroup" style={{ marginBottom: 16 }}>
          <h3 className="cardTitle">評測（Benchmark / 自動跑 N 回合）</h3>
          <p className="hint">
            用來客觀比較 AI 版本：自動跑 N 回合並統計平均 KO 時間、傷害、命中、格擋/閃避等。完成後會停在 FINISH 畫面。
          </p>

          <div className="buttonRow" style={{ marginTop: 10 }}>
            <label className="hint" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              回合數
              <input
                className="input"
                style={{ width: 110 }}
                type="number"
                min="1"
                max="500"
                value={benchmarkRounds}
                onChange={(event) => setBenchmarkRounds(Number(event.target.value))}
              />
            </label>

            <label className="hint" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={benchmarkStopOnComplete}
                onChange={(event) => setBenchmarkStopOnComplete(event.target.checked)}
              />
              完成後停住（推薦）
            </label>

            <label className="hint" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={benchmarkResetMatch}
                onChange={(event) => setBenchmarkResetMatch(event.target.checked)}
              />
              開始前重置比賽
            </label>
          </div>

          <div className="buttonRow" style={{ marginTop: 10 }}>
            <button className="button" type="button" onClick={startBenchmark}>
              開始 Benchmark
            </button>
            <button className="button buttonSecondary" type="button" onClick={stopBenchmark}>
              停止（恢復比賽）
            </button>
            <button className="button buttonSecondary" type="button" onClick={exportBenchmark}>
              匯出 Benchmark JSON
            </button>
            <button
              className="button buttonSecondary"
              type="button"
              onClick={copyBenchmarkJson}
              disabled={!benchmarkData}
            >
              複製 JSON
            </button>
            <button
              className="button buttonSecondary"
              type="button"
              onClick={downloadBenchmarkCsv}
              disabled={!benchmarkCsv}
            >
              下載 CSV
            </button>
            <button
              className="button buttonSecondary"
              type="button"
              onClick={copyBenchmarkCsv}
              disabled={!benchmarkCsv}
            >
              複製 CSV
            </button>
          </div>

          <div className="controlPanel" style={{ marginTop: 14 }}>
            <h4 className="cardTitle" style={{ margin: 0 }}>
              批次（Batch / 多 seed）
            </h4>
            <p className="hint" style={{ marginTop: 8 }}>
              一次跑多個 seed（每個 seed 跑固定回合數），可降低「單一地圖偏差」並方便做 AI 回歸測試。
            </p>

            <div className="buttonRow" style={{ marginTop: 10 }}>
              <label className="hint" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                seed 起點（可留空＝沿用目前 seed）
                <input
                  className="input"
                  style={{ width: 160 }}
                  value={batchSeedStart}
                  onChange={(event) => setBatchSeedStart(event.target.value)}
                  placeholder={stageInfo?.seedLabel ?? String(stageInfo?.seed ?? '')}
                />
              </label>

              <label className="hint" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                seed 數量
                <input
                  className="input"
                  style={{ width: 110 }}
                  type="number"
                  min="1"
                  max="200"
                  value={batchSeedCount}
                  onChange={(event) => setBatchSeedCount(Number(event.target.value))}
                />
              </label>

              <label className="hint" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                每 seed 回合數
                <input
                  className="input"
                  style={{ width: 120 }}
                  type="number"
                  min="1"
                  max="500"
                  value={batchRoundsPerSeed}
                  onChange={(event) => setBatchRoundsPerSeed(Number(event.target.value))}
                />
              </label>

              <label className="hint" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                seed 間隔（ms）
                <input
                  className="input"
                  style={{ width: 120 }}
                  type="number"
                  min="0"
                  max="5000"
                  value={batchPauseBetweenSeedsMs}
                  onChange={(event) => setBatchPauseBetweenSeedsMs(Number(event.target.value))}
                />
              </label>
            </div>

            <div className="buttonRow" style={{ marginTop: 10 }}>
              <button className="button" type="button" onClick={startBenchmarkBatch}>
                開始 Batch
              </button>
              <button className="button buttonSecondary" type="button" onClick={stopBenchmarkBatch}>
                停止 Batch
              </button>
              <button className="button buttonSecondary" type="button" onClick={exportBenchmarkBatch}>
                匯出 Batch JSON
              </button>
            </div>

            {debugSnapshot?.benchmarkBatch ? (
              <p className="hint" style={{ marginTop: 10 }}>
                Batch 狀態：
                {debugSnapshot.benchmarkBatch.active
                  ? debugSnapshot.benchmarkBatch.waitingForNextSeed
                    ? '切換地圖中'
                    : '進行中'
                  : debugSnapshot.benchmarkBatch.done
                    ? '已完成'
                    : '未啟動'}
                {'  '}| 進度 {debugSnapshot.benchmarkBatch.completedSeeds}/{debugSnapshot.benchmarkBatch.totalSeeds}
                {'  '}| 目前 seed index {debugSnapshot.benchmarkBatch.seedIndex}
              </p>
            ) : null}
          </div>

          {debugSnapshot?.benchmark ? (
            <p className="hint" style={{ marginTop: 10 }}>
              狀態：{debugSnapshot.benchmark.active ? '進行中' : debugSnapshot.benchmark.done ? '已完成' : '未啟動'}
              {'  '}| 進度 {debugSnapshot.benchmark.completedRounds}/{debugSnapshot.benchmark.targetRounds}
            </p>
          ) : null}

          {debugSnapshot?.benchmark?.report ? (
            <details style={{ marginTop: 10 }}>
              <summary className="hint">顯示彙總報表（Report）</summary>
              <pre className="codeBlock">
                {JSON.stringify(debugSnapshot.benchmark.report, null, 2)}
              </pre>
            </details>
          ) : null}

          {benchmarkData ? (
            <details style={{ marginTop: 10 }}>
              <summary className="hint">顯示已匯出的 Benchmark JSON（可手動複製）</summary>
              <pre className="codeBlock">{JSON.stringify(benchmarkData, null, 2)}</pre>
            </details>
          ) : (
            <p className="hint" style={{ marginTop: 10 }}>
              尚未匯出 JSON（按「匯出 Benchmark JSON」取得完整 rounds + report）。
            </p>
          )}

          {benchmarkCsv ? (
            <details style={{ marginTop: 10 }}>
              <summary className="hint">顯示已匯出的 Benchmark CSV（可手動複製）</summary>
              <pre className="codeBlock">{benchmarkCsv}</pre>
            </details>
          ) : null}
        </div>

        <div className="controlGroup" style={{ marginBottom: 16 }}>
          <h3 className="cardTitle">回歸（保存 / 比較 Benchmark）</h3>
          <p className="hint">
            把「匯出 JSON」的結果保存到 localStorage，之後可以挑兩個 run 做差異比較（BT / profiles / 平均 KO 等）。
          </p>

          <div className="buttonRow" style={{ marginTop: 10 }}>
            <label className="hint" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              名稱（可留空＝自動生成）
              <input
                className="input"
                style={{ width: 360 }}
                value={benchmarkSaveName}
                onChange={(event) => setBenchmarkSaveName(event.target.value)}
                placeholder="例如：BT v3 + aggressive buff"
              />
            </label>

            <label className="hint" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={benchmarkSaveSummaryOnly}
                onChange={(event) => setBenchmarkSaveSummaryOnly(event.target.checked)}
              />
              只保存 report（不含 rounds，較省空間）
            </label>
          </div>

          <div className="buttonRow" style={{ marginTop: 10 }}>
            <button className="button" type="button" onClick={saveBenchmarkRun} disabled={!benchmarkData}>
              保存目前匯出結果
            </button>
            <button className="button buttonSecondary" type="button" onClick={clearSavedRuns} disabled={!savedBenchmarkRuns.length}>
              清空全部
            </button>
            <button className="button buttonSecondary" type="button" onClick={downloadSavedRunsSummaryCsv} disabled={!savedRunsSummaryCsv}>
              下載 runs summary CSV
            </button>
            <button className="button buttonSecondary" type="button" onClick={copySavedRunsSummaryCsv} disabled={!savedRunsSummaryCsv}>
              複製 runs summary CSV
            </button>
          </div>

          <p className="hint" style={{ marginTop: 10 }}>
            已保存：{savedBenchmarkRuns.length} 筆（localStorage key：{BENCHMARK_RUNS_STORAGE_KEY}）
          </p>

          {savedBenchmarkRuns.length ? (
            <details style={{ marginTop: 10 }}>
              <summary className="hint">顯示 saved runs 清單</summary>
              <div className="controlPanel" style={{ marginTop: 10 }}>
                {savedBenchmarkRuns.map((entry) => {
                  const s = entry?.summary ?? getBenchmarkSummary(entry?.data)
                  return (
                    <div key={entry.id} style={{ padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                      <p className="hint" style={{ margin: 0 }}>
                        {entry.name}
                      </p>
                      <p className="hint" style={{ margin: '6px 0 0 0' }}>
                        {formatEpochMs(entry.savedAtEpochMs)} | {s.kind} | BT {s.btHash ?? '—'} | {s.leftProfile ?? '—'} vs{' '}
                        {s.rightProfile ?? '—'} | rounds {s.totalRounds ?? '—'} | avg KO {formatSeconds(s.avgKoTimeMs)}{' '}
                        {entry.summaryOnly ? '（summary only）' : ''}
                      </p>
                      <div className="buttonRow" style={{ marginTop: 8 }}>
                        <button className="button buttonSecondary" type="button" onClick={() => loadSavedRunIntoExport(entry.id)}>
                          載入
                        </button>
                        <button className="button buttonSecondary" type="button" onClick={() => setBaselineRunId(entry.id)}>
                          設為 Baseline
                        </button>
                        <button className="button buttonSecondary" type="button" onClick={() => setCandidateRunId(entry.id)}>
                          設為 Candidate
                        </button>
                        <button className="button buttonSecondary" type="button" onClick={() => deleteSavedRun(entry.id)}>
                          刪除
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </details>
          ) : null}

          <div className="controlPanel" style={{ marginTop: 12 }}>
            <div className="buttonRow">
              <label className="hint" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                Baseline
                <select className="select" value={baselineRunId} onChange={(e) => setBaselineRunId(e.target.value)}>
                  <option value="">（未選擇）</option>
                  {savedBenchmarkRuns.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="hint" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                Candidate
                <select className="select" value={candidateRunId} onChange={(e) => setCandidateRunId(e.target.value)}>
                  <option value="">（未選擇）</option>
                  {savedBenchmarkRuns.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {comparisonText ? (
              <pre className="codeBlock" style={{ marginTop: 10 }}>
                {comparisonText}
              </pre>
            ) : (
              <p className="hint" style={{ marginTop: 10 }}>
                選擇 Baseline 與 Candidate 後，這裡會顯示差異比較。
              </p>
            )}
          </div>
        </div>

        <div className="gameLayout">
          <div>
            <GameHost
              btJsonText={btJsonText}
              controlMode={controlMode}
              aiProfiles={aiProfiles}
              restartToken={restartToken}
              replayCommand={replayCommand}
              stageCommand={stageCommand}
              benchmarkCommand={benchmarkCommand}
              onReplayData={handleReplayData}
              onBenchmarkData={handleBenchmarkData}
              onDebugSnapshot={handleDebugSnapshot}
            />
            <p className="hint">
              BT JSON（截斷顯示）：{' '}
              {btJsonText ? btJsonText.slice(0, 140) : '（未儲存，使用預設）'}
            </p>
          </div>
          <aside className="debugPanel">
            <h3 className="cardTitle">AI 解釋（人話）</h3>

            {playerAssets ? (
              <p className={playerAssets.ok ? 'statusOk' : 'statusError'}>
                角色素材載入：{playerAssets.ok ? 'OK' : '有缺失（請展開 Debug JSON 查看）'}
              </p>
            ) : (
              <p className="hint">角色素材載入：檢查中…</p>
            )}

            <p className="hint">左方：{leftExplain.headline}</p>
            {leftExplain.details.length ? (
              <pre className="codeBlock">{leftExplain.details.join('\n')}</pre>
            ) : null}

            <p className="hint">右方：{rightExplain.headline}</p>
            {rightExplain.details.length ? (
              <pre className="codeBlock">{rightExplain.details.join('\n')}</pre>
            ) : null}

            <details style={{ marginTop: 12 }}>
              <summary className="hint">顯示原始 Debug JSON</summary>
              <pre className="codeBlock">
                {debugSnapshot
                  ? JSON.stringify(debugSnapshot, null, 2)
                  : '（等待場景回報中…）'}
              </pre>
            </details>
          </aside>
        </div>
      </section>
    </div>
  )
}
