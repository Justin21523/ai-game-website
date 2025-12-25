# Production 等級診斷與修復（更新版）

> 目的：把「畫面閃爍/Canvas 變大/看不到角色」與「AI 亂跳/瞬移」用可上 production 的方式穩定下來，並提供可重現與可觀測的 Debug 流程。

## 0) 先確認你看的檔案是「真的在跑的」

本 repo 真正在跑的檔案主要在：
- `src/game/bootstrap/createPhaserGame.js`
- `src/game/scenes/BattleScene.js`
- `src/game/entities/Fighter.js`
- `src/game/ai/platformBrawlBt.js`
- `src/pages/BattlePage.jsx`

專案根目錄的 `ai.js / BattleScene.js / Fighter.js ...` 是「匯出/快照」用途，**不一定是 runtime 來源**（ESLint 已忽略它們）。

## 1) Root Cause（已定位的根因）

### A) Console 沒輸出（你以為沒跑，其實是 Debug 關了）
- `createDebugLogger()` 會讀 `?debug=1` / `localStorage.DEBUG_GAME`；沒開就完全不印。
- 另外 DevTools 有時會過濾 `info/warn`，看起來像「沒 log」。

### B) 反覆 create Phaser.Game（多 canvas / 閃爍 / 行為像重置）
- 只要同一個 parent 被建立多個 `Phaser.Game`，就會出現：
  - canvas 疊加、尺寸一直變、畫面閃
  - 多套 scene/physics 同時跑，AI/輸入/碰撞行為混亂

### C) Stage rebuild 被 spam（tilemap destroy/create → 直接閃）
- `BattleScene.setStageConfig()` 若被重複呼叫，會一直 `_rebuildStage()`，畫面會像不停「換圖/重置」。

### D) AI 在空中反覆塞跳躍 + Fighter jump buffer/coyote 組合（像連跳/抖動）
- BT tick 會產生 intent；若跳躍沒有 cooldown/ground gate，會在短時間內反覆觸發 `setVelocityY()`。
- 搭配 coyote time 與 jump buffer，會看起來像「空中又跳、落地瞬間彈起」。

### E) Camera scrollY 微幅震盪（地面接觸 jitter 被放大）
- Arcade 物理在 tile separation / pushbox 時會有 1–3px 微調；若 camera 每幀跟著 midpoint，會抖。

## 2) 已套用的修正（對應檔案/commit）

### Debug 可觀測（強制重建 + 可開關）
- `src/pages/BattlePage.jsx`：新增 UI 按鈕
  - `啟用 Console Log` / `停用` / `切換 Verbose` / `重新建立遊戲`
  - 會寫入 `localStorage.DEBUG_GAME/DEBUG_GAME_VERBOSE`，並透過 `key` 強制 remount Phaser
- commit：`2325d62`

### 防止同 parent 多個 Phaser.Game（避免多 canvas/閃爍）
- `src/game/bootstrap/createPhaserGame.js`
  - 用 `Symbol.for(...)` 把 game reference 綁在 parent 上
  - 若偵測到舊 game 仍存活：先 `destroy(true)` + 清掉 stray canvas 再建立新 game
- commit：`4cfe2e4`

### StageConfig 防 spam（避免 tilemap 不停重建）
- `src/game/scenes/BattleScene.js`
  - 加入 `cmdKey + timestamp`，350ms 內相同指令直接忽略
  - 若 config key 沒變：不 rebuild，只在需要時 `resetMatch()`
- commit：`011fd35`

### AI 跳躍穩定化（避免空中反覆跳/落地瞬跳）
- `src/game/entities/Fighter.js`
  - 新增 `_hasJumpedSinceGrounded`：coyote time 不再被當成「偽二段跳」
  - 增加 `ground-transition` 與 `jump`（throttle）log
- `src/game/ai/platformBrawlBt.js`
  - 新增集中式 `maybeRequestJump()`（ground gate + cooldown）
- commits：`5c67359`

### Camera 抑制地面抖動
- `src/game/scenes/BattleScene.js`：雙方都落地時提高 Y hysteresis 閾值，減少 scrollY 震盪
- commit：`77f7252`

## 3) 驗證步驟（你要看哪些現象/哪些 log）

1) 打開 `/battle`，右側點：
   - `啟用 Console Log`（必要）
   - 若還是太少：再點 `切換 Verbose`
2) 確認 console 有看到：
   - `[PhaserGame] BOOT / READY`（每次重建只應該出現一次）
   - `[BattleScene#X] create:start`、`stage:accepted`（代表場景與地圖建立成功）
3) 若你要強制重現某次狀態：按 `重新建立遊戲`（不需手動刷新頁面）
4) Debug JSON（右側「顯示原始 Debug JSON」）要確認：
   - `scale.parentCanvasCount` 長期維持 `1`
   - `camera.scrollY` 不再 1px 來回抖動（落地站定時應趨近穩定）
5) AI 跳躍檢查：
   - console 的 `[Fighter:*] jump` 不應在同一次離地中連續刷
   - `[Fighter:*] ground-transition` 不應在平台上「一秒內狂切換」成 land/leave/land/leave

## 4) 若還是「看不到角色 / 抖動」：下一步要抓什麼
- 先確定 DevTools 沒把 `Info` 關掉（很多 log 是 `console.info`）
- 看 `SCALE_RESIZE` 是否一直噴：若一直噴，通常是 CSS/layout feedback loop（父容器尺寸在抖）
- 看 Debug JSON：
  - `assets.player.ok` 是否為 `true`
  - `world.hasTileLayer` 是否為 `true`
  - `physics.bounds` 是否合理（寬高不是 0/NaN）

