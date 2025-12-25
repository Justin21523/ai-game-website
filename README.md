# ReactAI Game Website（React + Vite）

此專案是「React + Vite」前端，並在 `/battle` 掛載 Phaser 3 來製作「橫向 2D 平台格鬥」原型。目前已具備：
- **HP 制**的快節奏 1v1 對戰（暫以幾何方塊呈現）
- **雙 AI（AI vs AI）**：兩邊都用同一套 Behavior Tree（BT）原理產生 intent，降低人工測試成本
- **BT 實驗室（JSON）**：可編輯/儲存 BT，並套用到對戰頁
- **可解釋資料（debug）**：BT trace / reasons / blackboard 摘要可輸出給 UI 顯示

## 快速開始
環境需求（Vite 6）：Node `^18.0.0 || ^20.0.0 || >=22.0.0`

在專案根目錄執行：
```bash
npm ci
npm run dev
```

常用指令：
- `npm run dev`：啟動開發伺服器（HMR）。
- `npm run build`：建置正式版到 `dist/`。
- `npm run preview`：在本機預覽 `dist/`。
- `npm run lint`：執行 ESLint（可加 `-- --fix`）。

## 路由（你會用到的頁面）
- `/`：預設入口（會導向 `/battle`，一進站就能看到 AI 對戰）
- `/battle`：對戰（Phaser 場景；預設 AI vs AI，可切換任一邊為人類鍵盤控制；可一鍵重新開始）
- `/menu`：選單/首頁（可選）
- `/lab/bt`：Behavior Tree 實驗室（JSON）

## 專案結構
- `index.html`：入口 HTML（提供 `#root` 並載入 `src/main.jsx`）。
- `src/main.jsx`：建立 React Root，並掛上 `BrowserRouter`。
- `src/App.jsx`：路由入口（`/`, `/battle`, `/lab/bt`）。
- `public/`：靜態檔案（例如 `vite.svg`）。
- `vite.config.js`：Vite 設定。
- `eslint.config.js`：ESLint v9（flat config）。
- `src/game/`：Phaser 遊戲邏輯（scene/entity/combat/ai）。

## 套件現況（路由與樣式）
- 已安裝 `react-router-dom`：用於頁面路由（`/battle`, `/lab/bt` 等）。
- 已安裝 `phaser`：用於 2D 遊戲場景、物理與更新迴圈。
- 已安裝 Tailwind v4（含 `@tailwindcss/vite`）：目前尚未在設定與 CSS 中啟用；啟用方式與範例請見文件。

## 文件（繁體中文）
- `docs/DEV_WORKFLOW.zh-TW.md`：開發/建置流程與常見問題排除。
- `docs/CODE_TOUR.zh-TW.md`：程式碼導讀（React → Phaser → BT 雙 AI）。
- `docs/IMPLEMENTATION_GUIDE.zh-TW.md`：目前 MVP 的落地實作導讀（含片段解說）。
- `docs/GAME_DESIGN.zh-TW.md`：遊戲核心規格（平台格鬥 1v1 vs AI）。
- `docs/AI_BEHAVIOR_TREE.zh-TW.md`：BT/黑板/可解釋 AI 與 BT 編輯器規格。
- `docs/ROADMAP.zh-TW.md`：里程碑與學習路線圖（每步可驗收）。
- `docs/TECH_ARCHITECTURE.zh-TW.md`：技術架構（套件選型、目錄規劃、React×遊戲引擎整合）。
