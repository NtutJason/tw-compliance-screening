# 安全性說明

本文件說明「違反勞動相關法令、屬公共工程委員會公告拒絕往來廠商或屬經濟部公告來臺陸資投資名錄之單位比對工具」的威脅模型、**已實作加強項目**、驗證方式，以及整合部署建議。

## 威脅模型

此工具設計為**本機或受信任內網**使用的輔助程式，主要風險來自：

1. **獨立 UI**（`npm run ui`）對外提供 HTTP API，預設無登入。
2. **抓取腳本**會對政府公開 API 發起 HTTPS 請求，並將檔案寫入匯入資料夾。
3. **嵌入整合**時，呼叫端需自行保護 API 端點、認證與資源節流。

## 已實作加強項目（總覽）

| # | 項目 | 說明 | 相關程式 |
|---|------|------|----------|
| 1 | **匯入路徑沙箱** | API／`saveConfig` 設定的 `importFolderPath` 必須在 `baseDir` 內；`../`、絕對路徑逃出專案根目錄時回 **400** | `src/paths.ts`、`src/service.ts` |
| 2 | **抓取腳本固定** | 僅允許執行 `baseDir/scripts/fetch-compliance-files.mjs`，透過 `execFile("node", [...])`，不經 shell | `src/service.ts` |
| 3 | **下載 URL 白名單** | 僅允許 HTTPS + 政府網域，防 SSRF | `scripts/fetch-compliance-files.mjs` |
| 4 | **下載逾時** | 單次請求 120 秒（`fetch` + `curl --max-time`） | 同上 |
| 5 | **查詢與下載分離** | UI 的 `GET` 查詢只讀快取，**不**在查詢時自動 `refresh` | `ui/server.mjs` |
| 6 | **POST body 上限** | 64 KB，過大回 400 | `ui/server.mjs` |
| 7 | **查詢字串長度** | `organizationName` ≤ 500 字 | `ui/server.mjs` |
| 8 | **靜態檔防穿越** | 正規化路徑並檢查前綴 | `src/paths.ts`、`ui/server.mjs` |
| 9 | **預設本機監聽** | `UI_HOST` 預設 `127.0.0.1` | `ui/server.mjs` |
| 10 | **前端 XSS 防護** | 比對結果 HTML escape；警告連結僅 `http` / `https` | `ui/app.js` |
| 11 | **匯入檔名安全** | `joinImportFile` 使用 `path.basename` | `src/paths.ts` |

### 下載 URL 白名單網域

- `apiservice.mol.gov.tw`（勞動部）
- `web.pcc.gov.tw`（工程會）
- `www.moea.gov.tw`（經濟部）
- `quality.data.gov.tw`（政府資料開放平臺備援）

環境變數 `PCC_SOURCE_JSON_URL`、`MOEA_INVESTMENT_LIST_XLSX_URL`、`MOEA_INVESTMENT_LIST_CSV_URL` 若覆寫預設值，仍須通過上述白名單。

## 資料下載流程（fetch）

| 步驟 | 行為 | 防護 |
|------|------|------|
| 觸發 | UI「立即更新」、CLI `fetch` / `refresh`、嵌入方呼叫 `screening.refresh()` | 僅 `execFile` 執行固定腳本 |
| 腳本路徑 | `scripts/fetch-compliance-files.mjs` | 必須位於 `baseDir` 內 |
| 寫入目錄 | 設定檔或 API 的 `importFolderPath` | 限制在專案根目錄內 |
| 寫入目錄（管理員） | `COMPLIANCE_IMPORT_FOLDER` 環境變數 | 可指定專案外路徑，由部署者負責權限 |
| 下載 | MOL / PCC / MOEA | HTTPS 白名單 + 120 秒逾時 |
| curl | MOEA XLSX 備援 | URL 同樣經白名單驗證 |

## API 呼叫流程（獨立 UI）

| 端點 | 風險 | 防護 |
|------|------|------|
| `GET ?mode=query` | 查詢觸發下載或大量運算 | 僅 `readDataset()`；字串 ≤ 500 |
| `GET ?mode=meta` | 同上 | 僅讀快取與設定 |
| `POST action=refresh` | 路徑穿越、資源耗盡 | 路徑沙箱；見下方「刻意保留彈性」 |
| POST body | DoS | 上限 64 KB |
| 靜態檔 | 目錄穿越 | `resolveStaticFilePath` |
| 監聽位址 | 區網未授權存取 | 預設 `127.0.0.1` |

### 獨立 UI API 契約

```
GET  /api/compliance-screening?mode=meta
GET  /api/compliance-screening?organizationName=...
GET  /api/compliance-screening?mode=task&taskId=...
POST /api/compliance-screening  { "action": "refresh", "importFolderPath?": "imports" }
```

## 前端（XSS）

比對結果與警告訊息來自政府公開資料，可能含特殊字元。`ui/app.js` 以 `escapeHtml` 處理文字；自動連結僅接受 `http:` / `https:` 協定。

## 刻意保留的介接彈性

以下**刻意不在核心實作**，以便嵌入各類主系統時由整合方決定策略：

| 項目 | 說明 | 整合方建議 |
|------|------|------------|
| **認證／授權** | UI 與函式庫皆無內建登入 | 反向代理、Next.js middleware、Express session |
| **refresh 速率限制** | 可反覆觸發下載與建快取 | 應用層節流、排程取代手動更新、單一進行中任務鎖 |
| **自動過期更新** | 函式庫提供 `ensureFreshDataset()`，行為由呼叫端決定 | 查詢用 `readDataset()`；更新用排程 + `refresh()` |
| **COMPLIANCE_IMPORT_FOLDER** | 環境變數可覆寫 API 路徑設定 | 生產環境鎖定匯入目錄時建議使用 |

## 已知限制（請勿誤用）

- **無認證**：勿將獨立 UI 直接暴露於公網。
- **refresh 資源消耗**：惡意或誤用可反覆觸發政府 API 下載與快取重建。
- **COMPLIANCE_IMPORT_FOLDER**：管理員指定專案外路徑時，需自行管控目錄權限。
- **XLSX/ZIP 解析**：未設檔案大小上限；惡意替換 `imports/` 內檔案可能消耗記憶體。
- **快取檔完整性**：`data/compliance-screening-cache.json` 若可被任意寫入，比對結果可能遭篡改。

## 安全驗證（煙霧測試）

專案內建 `scripts/security-smoke-test.mjs`，涵蓋惡意使用者常見手法：

| 測試情境 | 預期結果 |
|----------|----------|
| `importFolderPath` 路徑穿越（`../../../Windows/Temp`） | 400 或函式庫 throw |
| 靜態檔 `GET /../package.json` | 404 |
| 惡意 `PCC_SOURCE_JSON_URL`（非白名單網域） | 抓取腳本啟動失敗 |
| 替換 `fetchScriptPath` 為其他程式 | `createComplianceScreening` 拋錯 |
| POST body > 64 KB | 400 `request body too large` |
| 查詢 `organizationName` 501 字 | 400 |
| 查詢回應時間 | 僅讀快取，毫秒級 |
| 未知 `action` | 400 |
| 偽造 `taskId` | 404 |
| `app.js` 含 `escapeHtml` | 靜態檔可讀且含防護 |

```bash
# 終端機 1：啟動 UI（測路徑穿越時請勿設定 COMPLIANCE_IMPORT_FOLDER）
npm run ui

# 終端機 2
npm run security-test
# 預期：15/15 通過
```

若已設定 `COMPLIANCE_IMPORT_FOLDER`，路徑穿越相關 API 測試會自動跳過（環境變數鎖定目錄屬預期行為）。

## 部署建議

```bash
# 本機使用（預設，推薦）
npm run ui
# → http://127.0.0.1:3456

# 內網共用（需自行評估風險，建議加反向代理認證）
$env:UI_HOST="0.0.0.0"; npm run ui

# 鎖定匯入目錄（伺服器管理員）
$env:COMPLIANCE_IMPORT_FOLDER="D:\compliance-imports"
```

### 嵌入其他網站時

1. 在反向代理或應用層加上**認證**，勿將 `/api/compliance-screening` 直接開放至網際網路。
2. 查詢端點使用 `readDataset()` + `query()`，避免每次查詢觸發 `ensureFreshDataset()` 下載。
3. `refresh` 建議限縮給管理員或排程；必要時於主系統加速率限制。
4. 匯入目錄與 `data/` 目錄設定適當檔案系統權限。
5. 前端渲染比對結果時，若自建 UI，請同樣對使用者可見文字做 escape。

詳見 [INTEGRATION.md](./INTEGRATION.md) 整合範例與安全章節。

## 回報

若發現安全問題，請透過 GitHub Issues 或專案維護者聯絡方式回報。
