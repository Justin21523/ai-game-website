// This page is a lightweight landing page for the project.
// It provides navigation to the battle scene and the BT lab.
import { Link } from 'react-router-dom'

export default function HomePage() {
  return (
    <div className="page">
      <header className="pageHeader">
        <h1 className="title">ReactAI 平台格鬥（原型）</h1>
        <p className="subtitle">
          目標：用 Behavior Tree（BT）打造可解釋 AI，並逐步擴充成快節奏 2D
          平台格鬥。
        </p>
      </header>

      <section className="card">
        <h2 className="cardTitle">開始</h2>
        <div className="buttonRow">
          <Link className="button" to="/battle">
            進入對戰（AI vs AI）
          </Link>
          <Link className="button buttonSecondary" to="/lab/bt">
            Behavior Tree 實驗室
          </Link>
        </div>
        <p className="hint">
          提示：目前預設是兩個 AI 對戰，用來降低人工測試成本；之後再加入玩家手動控制切換。
        </p>
      </section>
    </div>
  )
}

