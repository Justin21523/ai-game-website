// This page hosts the Phaser battle scene.
// For this milestone we focus on AI-vs-AI so you can iterate quickly without manual input.
import { useCallback, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import GameHost from '../components/GameHost.jsx'
import { BT_STORAGE_KEY } from '../game/ai/btStorage.js'
import { REPLAY_STORAGE_KEY } from '../game/input/replayStorage.js'
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
