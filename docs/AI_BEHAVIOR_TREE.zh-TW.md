# AI / Behavior Tree 規格（可編輯 + 可解釋）

本專案的 AI 以 Behavior Tree（BT）為主要決策框架：**BT 負責「想做什麼」**，角色控制器（Character Controller）負責 **「怎麼把輸入與物理做出來」**。兩者分離後，AI 更容易除錯、擴充與教學化。

## 1) BT 核心規格（執行模型）
- **Node 狀態**：`SUCCESS` / `FAILURE` / `RUNNING`
- **Tick 頻率（建議）**：每秒 10–20 次（AI 決策），每幀 60 FPS（物理與動畫）
- **輸出形式**：BT 不直接改物理，而是寫入 `intent`（意圖）：
  - `moveX`（-1..1）
  - `jumpPressed`（edge-trigger）
  - `attackPressed`（light/heavy）
  - `fastFall`（boolean）

## 2) Blackboard（黑板）資料結構（最小必要）
### 2.1 自身狀態（Self）
- `self.hp`（Stocks 可作為後續擴充選項）
- `self.onGround` / `self.canDoubleJump`
- `self.attackCooldowns.*`
- `self.isInHitstun`

### 2.2 目標狀態（Target）
- `target.distanceX` / `target.distanceY`
- `target.isFacingMe`（可用簡化判定）
- `target.isInAttackRecovery`

### 2.3 場地與風險（Stage）
- `stage.nearLeftEdge` / `stage.nearRightEdge`
- `stage.offstage`（是否離開可站立區）
- `stage.recoveryTarget`（回到舞台的目標點）

### 2.4 可解釋用資料（Explainability）
- `ai.lastDecisionPath`：本次 tick 經過哪些節點（含成功/失敗）
- `ai.lastReason`：簡短理由（結構化欄位，例如 `{type:"ATTACK", why:["IN_RANGE","COOLDOWN_OK"]}`）

## 3) 節點庫（建議第一版就做的）
### 3.1 Composite
- `Selector`：遇到第一個成功/執行中的子節點就停止
- `Sequence`：子節點必須依序成功，遇到失敗就停止

### 3.2 Decorator
- `Cooldown(ms)`：限制子節點觸發頻率（用於重攻擊/閃避/跳躍決策）
- `Timeout(ms)`：避免某行為卡死（例如追擊走不到）
- `Inverter`：反轉成功/失敗（選用）

### 3.3 Conditions（例）
- `IsInRange(kind)`：是否在輕/重攻擊範圍
- `CanAttack(kind)`：冷卻/硬直允許
- `IsTargetAboveMe()`：制空判斷
- `IsNearEdge()`：避免自殺
- `IsOffstage()`：進入回場流程

### 3.4 Actions（例）
- `FaceTarget()`：決定面向（或交給 motor）
- `MoveToTargetX()`：朝目標水平移動（只寫 `intent.moveX`）
- `Jump()` / `DoubleJump()` / `FastFall()`
- `LightAttack()` / `HeavyAttack()`
- `RecoverToStage()`：回場（跳躍/水平移動的組合）

## 4) 行為樹（MVP 參考設計）
高層 Root：優先處理「活下來」再處理「打人」：

1. **Recovery（回場）**
   - `If IsOffstage -> RecoverToStage`
2. **Safety（邊界安全）**
   - `If IsNearEdge && targetPressureHigh -> StepBack / JumpAway`
3. **Combat（交戰）**
   - `If CanHitNow -> Attack`
   - `Else -> Approach / Reposition`

> MVP 重點：先做「可靠回場 + 基本追擊 + 不自殺」就很好玩。

## 5) 可解釋 AI：Trace 與回覆模板
### 5.1 Trace 記錄（建議格式）
每次 BT tick 記錄：
- `timestamp`
- `path`: `["Root","Combat","Approach","MoveToTargetX"]`
- `conditions`: `{ IsInRange:false, IsOffstage:false, ... }`
- `intent`: `{ moveX:1, jumpPressed:false, attackPressed:null }`

### 5.2 對話回覆（繁中模板）
以「理由代碼」拼裝回答（不用 LLM 也能清楚）：
- 「我選擇接近你，因為目前不在攻擊距離內。」
- 「我先回場，因為我在場外而且雙跳還沒用掉。」
- 「我改用重攻擊，因為你剛出招收招中，風險較低。」

## 6) BT 編輯器（你選擇要做）
### 6.1 目標
- 在 `/lab/bt` 以圖形化方式編輯 BT（節點、連線、參數）
- 存成 JSON（localStorage / 下載檔案），並可在對戰中載入

### 6.2 最小 JSON 格式（範例）
```json
{
  "type": "Selector",
  "children": [
    { "type": "Sequence", "children": [{ "type": "IsOffstage" }, { "type": "RecoverToStage" }] },
    { "type": "Sequence", "children": [{ "type": "IsInRange", "params": { "kind": "light" } }, { "type": "LightAttack" }] },
    { "type": "MoveToTargetX" }
  ]
}
```

### 6.3 驗證規則（編輯器必做）
- Root 必須是單一節點
- `children` 數量符合節點類型
- `params` 型別正確（可用 schema 驗證）
- 防止循環連線（BT 必須是樹）
