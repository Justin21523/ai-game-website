# 實作導讀（MVP：Phaser 3 + HP 制 + BT 雙 AI）

本文件說明「目前已落地的實作」如何運作，並用片段式程式碼帶你連結到對應檔案。文件為繁體中文；程式碼內註解使用英文（English），方便你逐行追。

## 0) 你現在可以做什麼？
1) 啟動開發：
```bash
npm run dev
```
2) 瀏覽：
- `/`：預設入口（導向 `/battle`，直接看到對戰）
- `/battle`：預設 AI vs AI（同一棵 BT、HP 制），可在頁面切換任一邊為「人類（鍵盤）」控制
- `/lab/bt`：用 JSON 編輯/儲存 BT（存到 localStorage）

人類按鍵（目前內建兩套）：
- P1：A/D 移動，W/Space 跳，S 快速下落，J 輕攻擊，K 重攻擊
- P2：←/→ 移動，↑/Enter 跳，↓ 快速下落，1 輕攻擊，2 重攻擊

## 1) 專案切分（概覽）
### React（頁面/UI）
- `src/main.jsx`：掛載 React + `BrowserRouter`
- `src/App.jsx`：定義路由（`/`, `/battle`, `/lab/bt`）
- `src/pages/BattlePage.jsx`：對戰頁（掛載 Phaser + 顯示 debug JSON）
- `src/pages/BehaviorTreeLabPage.jsx`：BT 實驗室（JSON 編輯器）
- `src/components/GameHost.jsx`：Phaser 的 React 容器（建立/銷毀 Phaser.Game）

### Phaser（遊戲迴圈/物理）
- `src/game/bootstrap/createPhaserGame.js`：Phaser.Game 設定（解析度、物理、縮放）
- `src/game/scenes/BattleScene.js`：平台、角色、AI tick、命中判定、回合重置
- `src/game/entities/Fighter.js`：角色（HP、移動、跳躍、出招狀態機、hitbox/hurtbox）
- `src/game/combat/moves.js`：招式資料（簡化 frame data）
- `src/game/input/KeyboardHumanController.js`：鍵盤 → intent（人類控制）

### AI（Behavior Tree）
- `src/game/ai/bt/runtime.js`：BT 核心（Selector/Sequence/Decorator/Leaf）
- `src/game/ai/platformBrawlBt.js`：本遊戲 leaf nodes（條件/動作）
- `src/game/ai/BotAgent.js`：blackboard 更新、tick BT、輸出 trace/reasons
- `src/game/ai/defaultBt.js`：預設 BT JSON
- `src/game/ai/btStorage.js`：localStorage key

## 2) React 如何掛載 Phaser（最重要的整合點）
`src/components/GameHost.jsx` 的核心是把 Phaser 生命週期放進 `useEffect`：
```jsx
useEffect(() => {
  const game = createPhaserGame({ parent: containerRef.current, btJsonText, onDebugSnapshot })
  return () => game.destroy(true)
}, [onDebugSnapshot])
```
重點：
- React re-render 不應該「重建遊戲」；因此只在 mount/unmount 做 create/destroy。
- Phaser → React 的資料回傳採「節流後的 snapshot」（避免每幀 setState）。
- 控制模式（AI/Human）切換不重建遊戲：`GameHost` 會呼叫 `BattleScene.setControlMode(...)` 讓場景即時切換控制來源。

## 3) HP 制與攻擊判定怎麼做？
### 3.1 出招狀態機（startup/active/recovery）
`src/game/entities/Fighter.js` 會把攻擊拆成三段，並在 active 階段才產生 hitbox。

招式資料在 `src/game/combat/moves.js`，例如：
```js
export const MOVES = {
  light: { startupMs: 90, activeMs: 90, recoveryMs: 170, damage: 10, ... }
}
```

### 3.2 命中判定（BattleScene）
`src/game/scenes/BattleScene.js` 每幀會做 hitbox vs hurtbox 的 overlap 檢查：
```js
const hitbox = attacker.getAttackHitboxRect()
const hurtbox = defender.getHurtboxRect()
if (Phaser.Geom.Rectangle.Overlaps(hitbox, hurtbox)) defender.takeHit(...)
```
命中後：
- 扣 HP
- 套用擊退（knockback）
- 套用硬直（hitstun）
- HP 歸零會進入 KO（暫停 1.5 秒 + 顯示勝負）後才重置回合，避免瞬間跳回看不到結果

## 4) 為什麼 AI 要輸出 intent？
你會在 `Fighter` 看到這個概念：
- AI/玩家輸入只做「意圖」：`moveX`, `jumpPressed`, `attackPressed`
- `Fighter.updateFighter(...)` 會把意圖轉成物理速度與出招狀態

好處：
- AI 不會直接亂改 velocity（可控、可 debug）
- 你可以用同一套角色控制器，替換不同 AI 或人類輸入

目前的人類輸入也是走同一套管線：
- `KeyboardHumanController.readIntent()` 讀鍵盤 → 產生 intent
- `BattleScene` 依控制模式選用「AI tick 產生的 intent」或「人類鍵盤 intent」

## 5.5) 如何「重新開始」一場比賽？
在 `/battle` 頁面點選「重新開始（重置比賽）」會呼叫 `BattleScene.resetMatch()`：
- 重置 round 與 score（比分）
- 兩邊 HP 回滿並回到出生點
- 立刻繼續跑（不需要重整頁面）

## 5.6) KO（回合結束）流程長什麼樣？
`src/game/scenes/BattleScene.js` 會在任一方 HP 歸零時：
1) 計算勝負並更新 score  
2) 顯示 KO banner（`KO` / `DOUBLE KO` + `左方獲勝/右方獲勝/平手`）  
3) 冻結動作約 1.5 秒  
4) 進入下一回合（round +1，重置兩邊 HP/位置）  

這樣你就能清楚看到每回合的 KO 與勝負結果。

## 5.7) 人類輸入錄製 / 回放（Replay）怎麼用？
在 `/battle` 的「輸入錄製 / 回放（左方 P1）」區塊：
- **開始錄製（左方）**：會先把左方切成「人類（鍵盤）」並開始錄製 intent
- **停止錄製**：回放資料會存進 localStorage（方便重整後繼續用）
- **套用回放到左方/右方**：可做 `AI vs Replay` 或 `Replay vs Replay` 回歸測試
- **循環回放**：開啟後每回合重置時會把 replay 從頭開始播放（降低人工測試成本）

回放的核心檔案：
- `src/game/input/ReplayRecorder.js`：錄製 intent + dtMs
- `src/game/input/ReplayController.js`：按時間回放 intent（可循環）

## 5.8) BT Lab 的 schema 驗證是什麼？
`/lab/bt` 不只會檢查 JSON 能不能 parse，還會用 zod 驗證 BT 節點是否符合規格：
- 節點 type 是否支援
- Composite/Decorator 的 children 數量是否正確
- `CanAttack` / `IsInRange` 的 `params.kind` 是否為 `light/heavy`

錯誤會以「路徑 + 訊息」顯示（例如 `children[1].params.kind: ...`），避免把壞樹存進 localStorage。

## 5.9) 平台導航（platform graph）做了什麼？
為了讓 AI 懂「跳上平台追擊/下平台追擊」，場景會建立簡易平台圖：
- `src/game/stage/platformGraph.js`：把平台當作 node、建立可達邊（近似跳躍可達）
- `src/game/ai/platformBrawlBt.js`：`MoveToTargetX` 會優先使用平台圖導航（找下一個平台中心、必要時跳躍）

這是 MVP 的近似版本，但已足夠讓 AI 做出更像平台格鬥的追擊路線。

## 5.10) one-way 平台下穿（Down + Jump）怎麼運作？
你在 `/battle` 看到的雲平台屬於 one-way：可從下方跳上去，但會從上方落地站住。

另外，本專案也實作了「下穿」：
- 人類：按住下（P1:S / P2:↓）+ 按跳（P1:W/Space / P2:↑/Enter）
- AI：同樣輸出 `intent.fastFall + intent.jumpPressed`，不需要額外分支

關鍵片段（概念）：
```js
// BattleScene: down + jump + onGround + standingOnOneWayTile => enableDropThrough()
this._maybeDropThroughOneWay({ fighter: this._leftFighter, nowMs })
```
對應檔案：
- `src/game/scenes/BattleScene.js`：`_maybeDropThroughOneWay()`、`_processTileCollision()`
- `src/game/entities/Fighter.js`：`enableDropThrough()`、`isIgnoringOneWay()`

## 5.11) 程序地圖：驗證 + 自動重抽（reroll）
程序生成偶爾會產出「出生點下方沒平台」或「左右平台島不連通」等壞地圖。
因此場景會：
1) 生成 stage（含平台頂面 rectangles）
2) 建 platform graph
3) 用 validator 檢查可玩性
4) 不合格就換 seed 重抽（最多 N 次）

對應檔案：
- `src/game/stage/stageValidator.js`：`validateBrawlStage()`
- `src/game/scenes/BattleScene.js`：`_rebuildStage()`（generation loop + seed 派生）

你可在 `/battle` 的 debug JSON `stage` 看到 `valid/errors/rerolls/seed`，方便重現問題。

## 5.12) KO 後自動換地圖 + 大地圖 camera 跟隨
為了讓你「進畫面就看 AI 一直打、每回合又有多樣性」，本專案提供兩個能力：

1) KO 後自動換地圖（可開關、可設定每 N 回合換一次）
- `/battle` 勾選「KO 後自動換地圖」→ 按「套用換圖設定」
- KO 後 `BattleScene._updateKoPhase()` 會推進 seed 並重建地圖（不清分數）

2) 大地圖與 camera 跟隨
- `/battle` 可選「大地圖（60×24）」或自訂 tiles 尺寸
- 場景會跟隨兩名角色中點（dummy zone），並依距離動態 zoom

對應檔案：
- `src/pages/BattlePage.jsx`：UI（toggle / everyNRounds / widthTiles / heightTiles）
- `src/game/scenes/BattleScene.js`：`setStageRotationConfig()`、`_setupCameraFollow()`、`_updateCameraFocus()`

## 5.13) 角色 sprites/動畫：視覺與碰撞分離
目前角色已由「純方塊」改成使用 `/assets/sprites/player/` 的 Dog/Cat 動畫序列：
- 物理/碰撞仍由 `Fighter` 的 Arcade body（矩形）負責（穩定、好調）
- 畫面顯示用獨立的 `_visual` sprite（播動畫、可自由換素材）

對應檔案：
- `src/game/assets/playerCharacters.js`：用 `import.meta.glob` 收集 frames → `preload()` 載入 → `create()` 建 animations
- `src/game/entities/Fighter.js`：`_updateVisual()` 依狀態選動畫；KO 時可用 `setForcedVisualAction('dead')` 強制播放死亡姿勢

更完整的關卡細節（多層 tile + decorations + 下穿規則）請見：
- `docs/TILEMAP_STAGE.zh-TW.md`

## 5) Behavior Tree（BT）從 JSON 到實際跑起來的流程
### 5.1 JSON（可由 `/lab/bt` 儲存）
`src/game/ai/defaultBt.js` 提供預設樹；`/lab/bt` 可覆寫並存到 localStorage。

### 5.2 runtime（通用）
`src/game/ai/bt/runtime.js` 定義：
- Status：`SUCCESS` / `FAILURE` / `RUNNING`
- Composite：`Selector` / `Sequence`
- Leaf：用 factory 建出條件/動作節點

### 5.3 leaf nodes（本遊戲語彙）
`src/game/ai/platformBrawlBt.js` 決定這個遊戲 BT 可以用哪些節點，例如：
- `CanAttack(kind)`
- `IsInRange(kind)`
- `MoveToTargetX`
- `LightAttack` / `HeavyAttack`

### 5.4 BotAgent（每次 tick 都留下可解釋資料）
`src/game/ai/BotAgent.js` 每次 `tick()` 都會：
- 更新 blackboard（距離、是否著地、是否硬直…）
- 跑 BT → 得到 intent
- 記錄 `trace` 與 `reasons`（給 debug 面板/之後的「AI 回答為什麼」功能）

## 6) 下一步建議（依你的需求排序）
1) 把 BT Lab 從 JSON 進化成圖形化編輯器（節點拖拉、參數面板、schema 驗證）
2) 加入「詢問 AI」面板：直接把 `trace + reasons + blackboard` 轉成繁中回答
3) 更完整的平台導航/回場（平台圖、簡易路徑規劃）
4) 加入「一鍵重開/重置回合」與錄影/回放（降低回歸測試成本）
