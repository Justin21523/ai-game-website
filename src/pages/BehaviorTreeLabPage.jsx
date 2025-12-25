// This page is the initial "BT editor" milestone.
// For MVP it is JSON-based (textarea + validation), which is simple and teaches data-driven design.
// Later we can replace/augment this with a graphical editor (e.g., node graph UI).
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { BT_STORAGE_KEY } from '../game/ai/btStorage.js'
import { DEFAULT_BT_JSON } from '../game/ai/defaultBt.js'
import {
  KNOWN_BT_NODE_TYPES,
  validateBtJsonText,
} from '../game/ai/bt/validateBtJson.js'

// Safely load a string value from localStorage.
function readStoredBtJson() {
  try {
    return localStorage.getItem(BT_STORAGE_KEY)
  } catch {
    return null
  }
}

// Safely write a string value to localStorage.
function writeStoredBtJson(text) {
  try {
    localStorage.setItem(BT_STORAGE_KEY, text)
    return true
  } catch {
    return false
  }
}

export default function BehaviorTreeLabPage() {
  // Prepare the default JSON text once (stable across renders).
  const defaultText = useMemo(() => JSON.stringify(DEFAULT_BT_JSON, null, 2), [])

  // Initialize from localStorage if available; otherwise fall back to DEFAULT_BT.
  const [text, setText] = useState(() => readStoredBtJson() ?? defaultText)

  // UI feedback message after "validate/save".
  const [status, setStatus] = useState(null)

  // Validate JSON + schema so we can show friendly errors before saving.
  function validateJson() {
    const result = validateBtJsonText(text)

    if (result.ok) {
      setStatus({
        kind: 'ok',
        message: 'BT JSON 驗證成功（可載入到對戰頁使用）。',
        issues: [],
      })
      return
    }

    setStatus({
      kind: 'error',
      message: 'BT JSON 驗證失敗（請修正下方錯誤）。',
      issues: result.issues,
    })
  }

  // Save the JSON to localStorage so /battle can load it.
  function saveJson() {
    // Validate before saving so we do not persist broken trees.
    const result = validateBtJsonText(text)
    if (!result.ok) {
      setStatus({
        kind: 'error',
        message: '無法儲存：BT JSON 驗證失敗。',
        issues: result.issues,
      })
      return
    }

    const ok = writeStoredBtJson(text)
    setStatus(
      ok
        ? { kind: 'ok', message: '已儲存到 localStorage；回到對戰頁即可套用。' }
        : { kind: 'error', message: '儲存失敗：瀏覽器拒絕寫入 localStorage。' },
    )
  }

  // Reset the editor to the default BT.
  function resetToDefault() {
    setText(defaultText)
    setStatus({ kind: 'ok', message: '已重設為預設 BT。' })
  }

  return (
    <div className="page">
      <header className="pageHeader">
        <div className="headerRow">
          <h1 className="title">Behavior Tree 實驗室（JSON）</h1>
          <Link className="button buttonSecondary" to="/menu">
            回選單
          </Link>
        </div>
        <p className="subtitle">
          這裡先用 JSON 編輯 BT（後續再做圖形化編輯器）。對戰頁會從 localStorage
          讀取並套用你儲存的樹。
        </p>
      </header>

      <section className="card">
        <h2 className="cardTitle">BT JSON</h2>
        <textarea
          className="textArea"
          value={text}
          onChange={(event) => setText(event.target.value)}
          spellCheck={false}
          rows={18}
        />

        <p className="hint">
          支援節點：{KNOWN_BT_NODE_TYPES.join(', ')}
        </p>

        <div className="buttonRow">
          <button className="button" type="button" onClick={validateJson}>
            驗證 JSON
          </button>
          <button className="button" type="button" onClick={saveJson}>
            儲存
          </button>
          <button
            className="button buttonSecondary"
            type="button"
            onClick={resetToDefault}
          >
            重設為預設
          </button>
          <Link className="button buttonSecondary" to="/battle">
            前往對戰
          </Link>
        </div>

        {status ? (
          <div>
            <p className={status.kind === 'ok' ? 'statusOk' : 'statusError'}>
              {status.message}
            </p>
            {status.kind === 'error' && status.issues?.length ? (
              <pre className="codeBlock">
                {status.issues.map((line) => `- ${line}`).join('\n')}
              </pre>
            ) : null}
          </div>
        ) : null}

        <p className="hint">
          下一步（M6）會做 schema 驗證、防循環連線、以及圖形化節點編輯 UI。
        </p>
      </section>
    </div>
  )
}
