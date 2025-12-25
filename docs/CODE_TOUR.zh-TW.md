# 程式碼導讀（CODE_TOUR）

本文件用「階段式」方式帶你理解專案目前的執行路徑：從 `index.html` → React Router → 對戰頁掛載 Phaser → 角色系統與 HP → Behavior Tree（BT）雙 AI 對戰與可解釋輸出。

> 文件為繁體中文；程式碼內的逐行/區塊註解使用英文（English）。

## 階段 1：HTML 入口（`index.html`）
重點片段：
```html
<div id="root"></div>
<script type="module" src="/src/main.jsx"></script>
```
- `#root`：React 掛載點
- `type="module"`：以 ESM 形式載入入口檔案，交由 Vite 打包與熱更新

## 階段 2：React 啟動與路由（`src/main.jsx`、`src/App.jsx`）
`src/main.jsx` 會把 App 包在 `BrowserRouter` 中：
```jsx
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
```

`src/App.jsx` 定義三個主要路由：
- `/`：預設入口（導向 `/battle`）
- `/battle`：對戰（`src/pages/BattlePage.jsx`）
- `/menu`：選單（`src/pages/HomePage.jsx`）
- `/lab/bt`：BT 實驗室（`src/pages/BehaviorTreeLabPage.jsx`）

## 階段 3：React 掛載 Phaser（`src/components/GameHost.jsx`）
核心概念：React 管 UI/路由；Phaser 管遊戲迴圈與物理。`GameHost` 用 `useEffect` 封裝 Phaser 的生命週期：
```jsx
useEffect(() => {
  const game = createPhaserGame({ parent: containerRef.current, btJsonText, onDebugSnapshot })
  return () => game.destroy(true)
}, [onDebugSnapshot])
```
- `createPhaserGame(...)`：建立 `new Phaser.Game(...)`（`src/game/bootstrap/createPhaserGame.js`）
- `onDebugSnapshot`：由 Phaser 回傳「節流後」的 debug 資料給 React（避免每幀觸發 re-render）

## 階段 4：對戰場景（`src/game/scenes/BattleScene.js`）
`BattleScene` 的責任：
- 建立平台（static bodies）
- 建立兩個角色（`Fighter`）
- 每幀更新角色（移動/跳躍/攻擊狀態）
- 固定頻率 tick AI（BT）並產生 intent
- 判定命中（hitbox vs hurtbox）與扣 HP

AI tick 與物理更新分離（可讀性與穩定性更好）：
```js
this._aiAccumulatorMs += delta
if (this._aiAccumulatorMs >= this._aiTickIntervalMs) {
  const leftIntent = this._leftAi.tick({ nowMs })
  this._leftFighter.setIntent(leftIntent)
}
this._leftFighter.updateFighter({ nowMs, opponent: this._rightFighter })
```

## 階段 4.5：控制模式切換（AI / 人類鍵盤）
目前 `/battle` 預設是 **AI vs AI**，但你可以在頁面切換任一邊為「人類（鍵盤）」控制。

技術上是透過：
- `src/components/GameHost.jsx`：在不重建 Phaser 的前提下，把控制模式更新「推送」到場景
- `src/game/scenes/BattleScene.js`：提供 `setControlMode({ left, right })`，並在 `update()` 中依模式選用 **AI tick intent** 或 **鍵盤 intent**
- `src/game/input/KeyboardHumanController.js`：把鍵盤狀態轉成 intent（使用 `JustDown` 做 edge-trigger）

另外，`/battle` 提供「重新開始（重置比賽）」按鈕，背後會呼叫 `BattleScene.resetMatch()` 來重置比分與 HP，方便你反覆觀察 AI 對戰行為。

## 階段 5：角色、HP 與攻擊（`src/game/entities/Fighter.js`）
`Fighter` 的三個關鍵概念：
1) **Intent-driven**：AI 只輸出 `intent`（move/jump/attack），由 Fighter 把意圖轉成速度與出招狀態。  
2) **招式三段式**：`startup → active → recovery`（以毫秒近似 frame data）。  
3) **命中事件**：active 階段產生 hitbox，命中後扣 HP、套用擊退（knockback）與硬直（hitstun）。

招式資料在 `src/game/combat/moves.js`，方便你做平衡與觀察 AI 決策。

## 階段 6：BT runtime 與雙 AI（`src/game/ai/*`）
檔案分工：
- `src/game/ai/bt/runtime.js`：BT 核心（`Selector`/`Sequence`/Decorator/Leaf）
- `src/game/ai/platformBrawlBt.js`：本遊戲 leaf nodes（`CanAttack`, `IsInRange`, `MoveToTargetX`…）
- `src/game/ai/BotAgent.js`：更新 blackboard、tick BT、輸出 trace/reasons
- `src/game/ai/defaultBt.js`：預設 BT JSON

`BotAgent.tick()` 每次會輸出：
- `intent`：給 Fighter 執行
- `trace`：本次 tick 走過哪些 BT 節點（可解釋）
- `reasons`：簡化理由碼（例如 `ATTACK_LIGHT`, `MOVE_TO_TARGET`）

## 階段 7：BT 實驗室（`src/pages/BehaviorTreeLabPage.jsx`）
BT JSON 會存到 localStorage（key 版本化，便於未來遷移）：
```js
export const BT_STORAGE_KEY = 'bt:platform-brawl:v1'
```
流程：
1) 到 `/lab/bt` 編輯 JSON → 儲存  
2) 到 `/battle` 重新載入頁面 → Phaser 場景使用你儲存的 BT

## （選配）啟用 Tailwind v4
專案已安裝 Tailwind v4（含 `@tailwindcss/vite`），但尚未啟用；可在確認遊戲迴圈穩定後再導入，以免同時改動太多面向。
