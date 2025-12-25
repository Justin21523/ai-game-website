# 開發流程指南（DEV_WORKFLOW）

## 環境需求
- Node（Vite 6）：`^18.0.0 || ^20.0.0 || >=22.0.0`
- 套件管理：建議使用 npm（本專案使用 `package-lock.json`）

## 安裝與啟動
在專案根目錄：
```bash
npm ci
npm run dev
```

## 建置與預覽
```bash
npm run build
npm run preview
```
- `build`：產生 `dist/`（靜態檔案，可部署到任意靜態主機）。
- `preview`：用本機伺服器模擬部署後的行為（適合檢查路由、資產路徑）。

## 程式碼品質（Lint）
```bash
npm run lint
npm run lint -- --fix
```
- 規則來源：`eslint.config.js`（ESLint v9 flat config）

## 常見問題排除
- 依賴不一致/奇怪錯誤：刪除 `node_modules/` 後重新安裝
  ```bash
  rm -rf node_modules
  npm ci
  ```
- 連接埠衝突：改用其他 port（例：`npm run dev -- --port 5174`）

## 註解與文件語言規範
- 文件與說明：繁體中文
- 程式碼逐行註解：英文（English）

