# Repository Guidelines

## 專案結構與模組組織
- `src/`：React 應用（路由/頁面/UI），並以 `src/game/` 掛載 Phaser 3 遊戲。
  - `src/pages/`：頁面（`/battle`, `/menu`, `/lab/bt`）。
  - `src/components/`：可重用元件（例如 `GameHost` 用來建立/銷毀 Phaser 實例）。
  - `src/game/`：遊戲核心（`scenes/`, `entities/`, `combat/`, `ai/`, `input/`, `stage/`）。
- `assets/`：遊戲素材與關卡資料（目前原型以幾何圖形為主，可逐步導入素材）。
- `docs/`：繁體中文文件（導讀、架構、AI/BT、實作指南）。
- `public/`：靜態資源（建置時原樣輸出）。
- `dist/`：`npm run build` 產物（請勿手動修改）。

## 建置、測試與開發指令
在專案根目錄執行：
- `npm ci`：依 `package-lock.json` 安裝固定版本（CI/重現性建議）。
- `npm run dev`：啟動本機開發伺服器（HMR）。
- `npm run build`：輸出正式版到 `dist/`。
- `npm run preview`：本機預覽 `dist/`。
- `npm run lint`：執行 ESLint（自動修正：`npm run lint -- --fix`）。

Node 需求（Vite 6）：`^18.0.0 || ^20.0.0 || >=22.0.0`。

## 程式風格與命名慣例
- 縮排 2 spaces；使用 ESM（`import`/`export`）。
- 延續既有風格：單引號、無分號。
- 元件命名 `PascalCase`；hooks 命名 `useCamelCase`。
- 遊戲模組以領域分資料夾（`scenes/`, `entities/`, `ai/` 等），避免讓 React UI 直接操作 Phaser 物件，改透過 `GameHost`/scene API 溝通。
- 程式碼註解以英文為主（English，覆蓋率高）；文件/介面文字使用繁體中文。

## 測試指南
- 目前未配置自動化測試；優先以 `npm run lint` + 手動驗收 `/battle` 與 `/lab/bt`。
- 若要補測試：建議 `vitest` + React Testing Library；檔名 `*.test.jsx`（可放在檔案旁或 `src/__tests__/`）。

## Commit 與 Pull Request 指南
- 目前工作區未包含 `.git`（無法從歷史推斷慣例）；建議採用 Conventional Commits（例：`feat: add level select`）。
- PR 請包含：變更摘要與動機、測試方式（指令/步驟）、UI/遊戲行為變更截圖或錄影、關聯 issue（若有）。

## Agent（Codex）專用注意事項
- 若使用者點名某個 skill（或需求符合 skill 描述），請先開啟對應 `SKILL.md` 並依流程執行；避免一次載入過多內容，優先重用既有 scripts/templates。
