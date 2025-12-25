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

        <div className="gameLayout">
          <div>
            <GameHost
              btJsonText={btJsonText}
              controlMode={controlMode}
              aiProfiles={aiProfiles}
              restartToken={restartToken}
              replayCommand={replayCommand}
              stageCommand={stageCommand}
              onReplayData={handleReplayData}
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
