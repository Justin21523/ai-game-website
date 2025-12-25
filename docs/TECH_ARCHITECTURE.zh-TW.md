# 技術架構設計（React + Vite + 2D 平台格鬥）

本文件聚焦在「怎麼做」：套件選型、目錄規劃、遊戲迴圈、資料流與除錯工具。文件用繁體中文；程式碼逐行註解一律使用英文（English）。

## 1) 套件選型（建議）
**2D 引擎（建議）**：Phaser 3  
理由：成熟的場景管理、輸入、資產載入、簡易物理（Arcade Physics）與 debug overlay，適合快速迭代平台遊戲。

**React UI（既有）**：React + Vite  
用途：首頁/選單、HUD、AI 對話、BT 編輯器、除錯面板、設定（按鍵/難度）。

**狀態與事件（建議）**
- `zustand`（可選）：React 狀態（設定、對戰結果、UI 開關）
- `mitt`（可選）：輕量事件匯流排（Phaser ↔ React 溝通）

**BT 編輯器（你指定要做）**
- `@xyflow/react`（可選）：做節點編輯器（拖拉、連線、屬性面板）
- `zod`（可選）：驗證 BT JSON schema（避免載入壞樹）

> 以上「可選」套件會在 M0/M6 分階段導入；先把可玩性做出來再加工具。

## 2) 目錄結構（建議落點）
建議新增遊戲專屬資料夾，避免與 React UI 混雜：
- `src/game/`
  - `src/game/bootstrap/`：建立 Phaser.Game、解析設定
  - `src/game/scenes/`：`PreloadScene`, `BattleScene` 等
  - `src/game/entities/`：`Player`, `Bot`, `Projectile`…
  - `src/game/physics/`：碰撞層、判定工具
  - `src/game/combat/`：招式資料、hitbox 系統
  - `src/game/ai/`
    - `src/game/ai/bt/`：BT runtime（Node、Decorator、Composite）
    - `src/game/ai/blackboard/`：黑板 schema 與更新
    - `src/game/ai/debug/`：trace 記錄與可視化資料
  - `src/game/data/`：`attacks.json`, `stages.json`, `bt-default.json`
- `src/ui/`：React 頁面與元件（HUD、對話、BT Editor）

## 3) React × 遊戲引擎整合方式（建議模式）
- React route `/battle` 渲染 `<GameHost />`
- `<GameHost />` 在 `useEffect` 中建立 Phaser 實例，並在 unmount 時 `destroy(true)`
- 透過事件匯流排傳遞：
  - Phaser → React：KO、命中、回合結束、AI 決策摘要
  - React → Phaser：暫停、重開、載入 BT JSON、切換 debug overlay

這樣的好處：UI 與遊戲迴圈互不干擾，但仍可互相控制。

## 4) 遊戲迴圈與更新頻率
建議切成兩條更新：
- **物理/動畫**：每幀（約 60 FPS）
- **AI 決策**：固定頻率 tick（約 10–20 Hz）

AI tick 只產生 `intent`（意圖），角色控制器再把 intent 轉成實際速度/跳躍/出招，避免 AI “直接改速度” 造成不可控與難除錯。

## 5) 戰鬥與判定（工程落地）
建議採「資料驅動 + 幀序」：
- 招式資料（frame data）放在 `src/game/data/attacks.json`
- 每個角色有：
  - `motor`（移動/跳躍）
  - `combat`（出招狀態機：startup/active/recovery）
  - `hurtbox`（受擊框）與 `hitbox`（攻擊框）

命中時：
- 套用 hitstop（短暫 freeze）
- 套用 hitstun（硬直）與 knockback（擊退）
- 發送事件（給 UI 與 AI trace）

## 6) Debug/教學化工具（MVP 就留接口）
最低限度建議：
- 顯示角色狀態：`onGround`, `velocity`, `inHitstun`, `currentMove`
- 顯示判定框：hitbox/hurtbox
- 顯示 AI：最後一次 BT 路徑（path）與理由（reason codes）

## 7) BT 編輯器與載入流程（概念）
1. `/lab/bt` 編輯 BT → 輸出 JSON
2. JSON 經 schema 驗證（防止循環、缺參數）
3. `/battle` 載入 JSON → runtime parse 成 Node tree
4. 對戰中可切換「預設 BT / 自訂 BT」，並能即時觀察 trace 變化

