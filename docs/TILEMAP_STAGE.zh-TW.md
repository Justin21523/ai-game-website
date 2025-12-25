# Tilemap 關卡系統（Tileset + 生成）

本專案的對戰場景原本使用「幾何矩形平台」做碰撞。為了更貼近 2D 平台格鬥遊戲、並能快速做出多樣化關卡，我們改為使用 Phaser 3 的 **Tilemap**，並把 `/assets/` 內的 tileset 素材真正用起來。

## 你會用到的檔案

- `src/game/stage/tilesetAtlas.js`
  - 載入 `/assets/freetileset/png/Tiles/1.png ~ 18.png`
  - **把 18 張獨立圖片打包成一張「Canvas tileset atlas」**（預設每格 32×32）
  - 從 `assets/tileset.json` 推導哪些 tile 是 `solid` / `oneWay`
- `src/game/stage/tileStageGenerator.js`
  - 關卡「樣式 + seed」→ 產生 2D tile grid（`-1` 表示空格）
  - 內建多種樣式：classic / sky / boxes / random + 兩張 preset（Level1、Level1-2）
- `src/game/stage/tileStageBuilder.js`
  - 把 2D tile grid 變成 Phaser Tilemap layer
  - 設定碰撞 tiles
  - 從 tile grid 推導 AI 用的「平台頂面 rectangles」（給 platform graph）
- `src/game/scenes/BattleScene.js`
  - `preload()` 載入 tileset/background
  - `create()` 建立 Tilemap stage、再建立 fighters/AI
  - `setStageConfig()` 允許 UI 送指令「重新生成地圖」
- `src/pages/BattlePage.jsx`
  - UI 提供「關卡樣式/seed」與「套用並重新開始」

## 核心概念（必懂）

### 1) tileNumber vs tileIndex

- `assets/tileset.json` 以 **tileNumber = 1..18** 描述每個 tile（含 solid/oneWay）
- Phaser Tilemap 使用 **tileIndex = 0..17**（0-based）
- 轉換：`tileIndex = tileNumber - 1`

### 2) 為什麼需要 tileset atlas（把 18 張圖合成 1 張）

Phaser 的 Tilemap 最好使用「單一 tileset 圖」，因此我們在 runtime 用 canvas 把 tileset 合成：

```js
// src/game/stage/tilesetAtlas.js
const atlas = scene.textures.createCanvas('tileset-atlas', w, h)
const ctx = atlas.getContext()
ctx.imageSmoothingEnabled = false
ctx.drawImage(srcImage, 0, 0, srcImage.width, srcImage.height, dx, dy, tileSizePx, tileSizePx)
atlas.refresh()
```

這樣我們就能用 `tileSizePx = 32` 做出 30×17 的格子（約對應 960×540 的視窗）。

### 3) one-way 平台（雲平台）怎麼做

Tilemap layer 先把 one-way tile 也標記為可碰撞，然後在 Arcade collider 的 `processCallback` 裡「有條件允許碰撞」：

- 向上移動（跳起）→ 不碰撞（可穿過）
- 向下落下 + 身體底部在 tile top 上方 → 才碰撞（可站上去）

### 4) one-way 平台「下穿」（Down + Jump）

常見平台格鬥規則：站在 one-way 平台上時，**按住下 + 按跳** 會「下穿」，而不是跳起。

本專案把「下穿」做成 **intent 規則**，因此人類/AI/Replay 都共用同一套輸入：

- `intent.fastFall === true`（按住下）
- `intent.jumpPressed === true`（按跳一次）

實作重點：
- `src/game/scenes/BattleScene.js`
  - `_maybeDropThroughOneWay()`：偵測「下 + 跳 + onGround + 腳下是 one-way tile」→ 觸發下穿
  - `_processTileCollision()`：若 `fighter.isIgnoringOneWay(nowMs)` → 直接忽略 one-way 碰撞
- `src/game/entities/Fighter.js`
  - `enableDropThrough()`：開啟短暫忽略窗（避免立刻又黏回平台）

### 5) 多層 Tile（background / terrain / foreground）+ 裝飾物件

為了讓地圖更像真正的關卡，本專案把 tile 分成三層：
- `background`：背景裝飾 tile（不碰撞、較低 depth）
- `terrain`：地形 tile（唯一有碰撞）
- `foreground`：前景裝飾 tile（不碰撞、可遮擋部分角色）

關鍵檔案：
- `src/game/stage/tileStageGenerator.js`
  - `layers: { terrain, background, foreground }`
  - `decorations: [...]`：放 Tree/Stone/Crate 等 sprite（不影響碰撞）
- `src/game/stage/tileStageBuilder.js`
  - 以「三張 Tilemap」建立三層（terrain 才 `setCollision(...)`）
- `src/game/scenes/BattleScene.js`
  - `_rebuildStage()`：重建 tilemaps + 重新建立 decorations sprites

### 6) 生成驗證 + 自動 reroll（避免壞地圖）

程序生成可能會出現「打不到人」的壞地圖（出生點下方沒平台、左右平台島不連通等）。
因此 `BattleScene` 在生成時會做最多 `maxAttempts` 次嘗試，失敗就改 seed 重抽：

- `src/game/stage/stageValidator.js`：`validateBrawlStage()`（平台數、出生點落點、platform graph 互通）
- `src/game/scenes/BattleScene.js`：`_rebuildStage()`（validation 失敗 → 變更 seed → 重新生成）

你可以在 `/battle` 右側 debug JSON 的 `stage` 看到：
- `valid` / `errors`：驗證結果
- `rerolls`：本次生成重抽次數
- `seed`：實際使用 seed（可複製重現）

### 7) 大地圖 + Camera 跟隨（可觀戰）

`/battle` 提供地圖尺寸（tiles）控制：例如 30×17（小）或 60×24（大）。
當地圖大於視窗時，場景會：
- 設定 `camera bounds` 與 `physics world bounds`
- 以兩名角色的「中點」作為跟隨目標（dummy Zone）
- 依距離做簡易動態 zoom（拉遠/拉近）

關鍵檔案：
- `src/pages/BattlePage.jsx`：地圖尺寸 UI → `setStageConfig({ widthTiles, heightTiles })`
- `src/game/scenes/BattleScene.js`：`_setupCameraFollow()` / `_updateCameraFocus()` / `_applyWorldAndCameraBounds()`

### 8) KO 後自動換地圖（觀戰模式）

當你想看 AI 長時間對戰且每回合都有新地圖，可以在 `/battle` 開啟：
- 「KO 後自動換地圖」
- 「每 N 回合換一次」

對應：
- `src/pages/BattlePage.jsx`：toggle + 套用按鈕
- `src/game/scenes/BattleScene.js`：`setStageRotationConfig()` + `_updateKoPhase()`（依 round 推進 seed）

## 如何新增一種關卡樣式（procedural）

1. 在 `src/game/stage/tileStageGenerator.js` 的 `STAGE_STYLE` 新增常數與 label。
2. 在 `buildProcedural()` 裡分派到你的新函式（例如 `placeMyStyle()`）。
3. 盡量保持「左右對稱」與「高度差不要太極端」，AI 會更穩定。

## 如何新增一張手工地圖（preset）

1. 用 Tiled 匯出 JSON 到 `assets/levels/`（建議沿用 30×20 之類大小）。
2. 在 `src/game/stage/tileStageGenerator.js` 用 import 引入 JSON。
3. 在 `buildFromPreset()` 走同一條轉換路徑（`gid -> tileIndex`），並視需要裁切到 17 行高度。

## 建議的下一步

- 把「地圖 seed + 換圖設定」保存到 localStorage（更像觀戰/回歸測試工具）。
- 把 platform graph 從近似版進化：加入「落點估計/跳躍弧線」或簡化 A*。
- 加入「關卡危險區」規則（例如場外 KO、地刺等），並同步到 validator 與 AI。
