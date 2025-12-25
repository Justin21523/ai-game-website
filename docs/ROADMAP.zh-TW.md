# 開發里程碑（Roadmap）與學習重點

本 roadmap 以「可玩 → 可教學 → 可擴充」為順序，每一步都能跑起來、能驗收，並對應一個你要吸收的核心觀念。

## M0：專案骨架與畫面切分
**交付物**
- React 路由：`/`（首頁）、`/battle`（對戰）、`/lab/bt`（BT 實驗室）
- Phaser（或選定引擎）可以在 `/battle` 正常掛載/銷毀

**你會學到**
- React 與遊戲引擎生命週期整合、canvas 掛載、事件橋接

## M1：平台移動（手感）
**交付物**
- 玩家：左右移動、跳躍（含 coyote time + jump buffer）、重力與地面碰撞
- Debug overlay：顯示速度/是否著地/輸入狀態

**你會學到**
- 平台物理、手感參數化、固定更新（fixed timestep）的理由

## M2：戰鬥基礎（判定 + 擊退）
**交付物**
- 輕/重攻擊各 1 招（含 startup/active/recovery）
- Hitbox/Hurtbox、Hitstop、Hitstun、Knockback
- 掉出邊界 → KO → 重生

**你會學到**
- Frame data、判定框、打擊感（hitstop）的工程落地

## M3：AI v0（對照組：FSM）
**交付物**
- 用簡單 FSM 做出「接近 → 攻擊 → 後撤」的 Bot
- UI 顯示 Bot 當前狀態（Approach/Attack/Retreat）

**你會學到**
- FSM 的優缺點、為何複雜行為難以維護

## M4：AI v1（Behavior Tree 最小可用）
**交付物**
- BT runtime（Selector/Sequence/Condition/Action）
- Blackboard 與 intent 輸出（AI 不直接操控物理）
- Bot 能安全回場、不自殺，並能在範圍內攻擊

**你會學到**
- BT tick、黑板設計、決策與執行分離

## M5：可解釋 AI（Trace + 對話）
**交付物**
- 每次 tick 紀錄決策路徑（trace）
- 對戰 UI：可詢問 AI「為何這麼做」，AI 回覆繁中理由

**你會學到**
- 可觀測性（observability）、除錯思維、把 AI 變成學習工具

## M6：BT 編輯器（可存可載）
**交付物**
- `/lab/bt`：圖形化編輯 BT（節點/連線/參數）
- JSON 匯出/匯入（localStorage + download/upload）
- 對戰中載入自訂 BT

**你會學到**
- 資料驅動、編輯器思維、schema 驗證、版本管理（BT 版號）

## M7：擴充（選配）
方向建議：
- 多招式與簡易連段（combo）
- 平台導航（platform graph）與更聰明的追擊/回場
- 替換幾何圖形為 sprite/動畫、加入音效

