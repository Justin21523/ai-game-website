# AI（短期強化）與抖動排除指南

本文件說明目前已完成的「不改戰鬥機制」AI 強化（更像平台格鬥的追擊/控距/懲罰），以及常見的畫面抖動來源與排除方式。  
建議一邊開啟 `/battle` 的「顯示原始 Debug JSON」，一邊對照本文件理解行為與數值。

## 1. 如何確認角色動畫素材有載入

本專案的角色不是使用單一 sprite sheet，而是把每一張 frame 當作獨立圖片載入（由 Vite 的 `import.meta.glob` 提供 URL）。

- 載入流程：`src/game/assets/playerCharacters.js`（glob → `preloadPlayerCharacters` → `ensurePlayerAnimations`）
- 對戰場景會在 `create()` 後做素材檢查，並把結果放進 debug snapshot：
  - `debugSnapshot.assets.player.ok === true` 代表 frame/animation key 都存在
  - `missingTextures / missingAnims / emptyActions` 可協助定位是哪個 key 缺失

你也會在右側 Debug 面板看到「角色素材載入：OK / 有缺失」提示（`src/pages/BattlePage.jsx`）。

## 2. 抖動（jitter）常見來源與修正

### 2.1 UI / Layout 導致的 canvas resize 抖動
當右側 Debug JSON 不斷更新、頁面高度跨過 viewport 閾值時，瀏覽器可能會「出現/消失 scrollbar」，導致可用寬度微變化 → Phaser ScaleManager 重新 FIT → canvas 反覆 resize。

已採取的措施：
- 讓 Debug 面板固定最大高度並改成內部捲動（避免整頁高度抖動）：`src/App.css`
- 強制 `body` 永遠保留垂直 scrollbar（避免寬度來回變動）：`src/index.css`

### 2.2 Camera sub-pixel 抖動
Arcade Physics 在 tilemap 碰撞分離時，角色位置可能有微小浮點變化；若相機以浮點 scroll render，就會出現「畫面輕微抖」。

已採取的措施：
- 固定相機 `zoom=1`，避免 zoom 變動造成 scroll 連帶抖動：`src/game/scenes/BattleScene.js`
- 相機 focus 使用 dt 穩定的 exponential smoothing，再取整數座標：`src/game/scenes/BattleScene.js`
- 啟用 `render.roundPixels`：`src/game/bootstrap/createPhaserGame.js`

## 3. AI：平台格鬥「短期強化」做了什麼

AI 仍以 BT（Behavior Tree）為主，但新增了「可持續的導航記憶」與「更像格鬥的中立行為」。

### 3.1 導航快取 + 抑制抖動（hysteresis）
過去每次 tick 都可能重算 path，導致左右來回。

現在會把導航狀態存入 blackboard（`ctx.blackboard.ai.nav`），包含：
- `path / nextPlatformId`：沿用一段時間，不每 tick 變更
- `lockedUntilMs`：短暫鎖定方向（約 280–320ms）
- `lastSelfPlatformId / lastTargetPlatformId`：平台 id 偵測抖動時的 fallback

位置：`src/game/ai/platformBrawlBt.js`

### 3.2 往下追擊（非 one-way 平台）
當「下一個平台在更低處」時：
- 若目前平台是 one-way：用 `Down + Jump` 觸發下穿（BattleScene 的 one-way 規則）
- 若目前平台是 solid：建立 drop plan（選邊 → 走到邊 → 離地後 fastFall）

位置：`src/game/ai/platformBrawlBt.js`

### 3.3 控距（spacing）+ 走位（tempo）
新增 BT action：
- `KeepDistance({min, max})`：距離太近退、太遠進、在區間內回傳 SUCCESS
- `Strafe()`：短 burst 的左右微調（更像 footsies）

位置：`src/game/ai/platformBrawlBt.js`

### 3.4 懲罰（whiff punish）與命中後加壓（hit-confirm）
新增 BT condition/action：
- `IsTargetRecovering` + `Punish`：對手收招中 → 優先重擊或追近
- `IsTargetInHitstun`：對手硬直中 → `Approach` 並嘗試追加輕攻擊（預設 BT 已使用）

預設 BT：`src/game/ai/defaultBt.js`

### 3.5 200ms 目標位置預測
blackboard 會提供：
- `blackboard.target.predictedX / predictedY`
讓追擊與控距更平滑、較不容易在同一點抖動。

位置：`src/game/ai/BotAgent.js`

## 4. 如何驗證（建議檢查清單）

1) 開 `/battle`，確認右側顯示「角色素材載入：OK」  
2) 展開 Debug JSON，確認：
- `scale.parentCanvasCount === 1`（避免多個 canvas 疊加）
- `assets.player.ok === true`
3) 觀察 AI：
- 對手在下方平台時，AI 會走到邊緣主動下追（或 one-way 下穿）
- 距離接近時會有控距與走位，不會一直貼臉抖動

