# 整合指南（INTEGRATION.md）

本文件說明其他開發者從 GitHub 取得本工具後，如何接到自己的系統。

---

## 1. 安裝

### 方式 A：Git clone

```bash
git clone https://github.com/NtutJason/tw-compliance-screening.git
cd tw-compliance-screening
npm install
npm run build
```

### 方式 B：作為 npm 依賴（GitHub）

```json
{
  "dependencies": {
    "tw-compliance-screening": "github:NtutJason/tw-compliance-screening"
  }
}
```

安裝後需確認 `dist/` 已編譯；若無，在套件目錄執行 `npm run build`。

---

## 2. 核心 API

```typescript
import path from "path";
import { createComplianceScreening } from "tw-compliance-screening";

const screening = createComplianceScreening({
  // 快取與設定檔目錄
  dataDir: path.join(process.cwd(), "data"),
  // 專案根目錄：用來解析設定檔內的相對匯入路徑（部署時務必明確指定）
  baseDir: process.cwd(),
  // 預設匯入資料夾（相對 baseDir）
  importFolderPath: "imports",
  defaultImportRelative: "imports",
  // 抓取腳本（整合時請傳入正確路徑）
  fetchScriptPath: path.join(
    process.cwd(),
    "node_modules/tw-compliance-screening/scripts/fetch-compliance-files.mjs"
  ),
});
```

### 常用方法

| 方法 | 說明 |
|------|------|
| `screening.refresh(config?, onProgress?)` | 下載政府名單 + 解析 + 寫快取 |
| `screening.ensureFreshDataset()` | 若超過 30 天則自動 refresh |
| `screening.readDataset()` | 讀取快取 |
| `screening.query(dataset, companyName)` | 比對，回傳三類結果 |
| `screening.readConfig()` / `saveConfig()` | 讀寫匯入路徑設定 |

### 查詢回傳格式

```typescript
{
  molMatches: ComplianceRecord[];   // 勞動法令
  pccMatches: ComplianceRecord[];   // 工程會拒絕往來
  moeaMatches: ComplianceRecord[];  // 臺陸資
  matched: boolean;
}
```

---

## 3. 匯入資料夾路徑（跨平台／伺服器）

### 問題說明

若設定檔寫死 Windows 絕對路徑（例如 `C:\Users\...\imports`），換到 Linux 伺服器或另一位開發者電腦會**找不到資料夾**。

### 本工具的做法

- 設定檔 `data/compliance-screening-config.json` **優先儲存相對路徑**（如 `"imports"`）
- 執行時依 `baseDir` 解析為絕對路徑
- 路徑分隔符號使用 `path.join`，提示訊息亦同

### 路徑優先順序

1. **`COMPLIANCE_IMPORT_FOLDER` 環境變數**（生產環境推薦）
2. `data/compliance-screening-config.json` 內的 `importFolderPath`
3. `createComplianceScreening({ importFolderPath })` 選項

### 建議設定

**本機開發**

```json
{ "importFolderPath": "imports" }
```

**Linux 伺服器（Docker / systemd）**

```bash
export COMPLIANCE_IMPORT_FOLDER=/var/lib/myapp/compliance-imports
```

或在程式中：

```typescript
createComplianceScreening({
  dataDir: "/var/lib/myapp/data",
  baseDir: "/var/lib/myapp",
  importFolderPath: process.env.COMPLIANCE_IMPORT_FOLDER ?? "imports",
});
```

### 必要檔案

| 檔案 | 說明 |
|------|------|
| `mol-latest.csv` | 勞動部 8 類法令合併檔 |
| `pcc-latest.csv` | 工程會拒絕往來廠商 |
| `moea-latest.xlsx` 或 `.csv` | 臺陸資名錄 |

---

## 4. Next.js 整合範例

`app/api/compliance-screening/route.ts`：

```typescript
import path from "path";
import { createComplianceScreening } from "tw-compliance-screening";

const screening = createComplianceScreening({
  dataDir: path.join(process.cwd(), "data"),
  baseDir: process.cwd(),
  importFolderPath: "imports",
  fetchScriptPath: path.join(
    process.cwd(),
    "node_modules/tw-compliance-screening/scripts/fetch-compliance-files.mjs"
  ),
});

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get("mode");

  if (mode === "meta") {
    const dataset = await screening.readDataset();
    const config = await screening.readConfig();
    return Response.json({
      updatedAt: dataset.updatedAt,
      nextRefreshAt: dataset.nextRefreshAt,
      recordCount: dataset.recordCount,
      warnings: dataset.warnings,
      config,
    });
  }

  const name = searchParams.get("organizationName")?.trim() ?? "";
  if (!name) {
    return Response.json({ error: "organizationName required" }, { status: 400 });
  }

  const dataset = await screening.ensureFreshDataset();
  return Response.json(screening.query(dataset, name));
}

export async function POST(req: Request) {
  const body = await req.json();
  if (body.action !== "refresh") {
    return Response.json({ error: "unsupported action" }, { status: 400 });
  }
  await screening.refresh({ importFolderPath: body.importFolderPath });
  return Response.json({ message: "更新完成" });
}
```

前端 fetch 範例：

```typescript
const res = await fetch(
  `/api/compliance-screening?organizationName=${encodeURIComponent(companyName)}`
);
const data = await res.json();
// data.molMatches / pccMatches / moeaMatches
```

UI 可參考本 repo 的 `ui/index.html`、`ui/app.js` 三欄版型。

---

## 5. Express 整合範例

```typescript
import express from "express";
import path from "path";
import { createComplianceScreening } from "tw-compliance-screening";

const app = express();
app.use(express.json());

const screening = createComplianceScreening({
  dataDir: path.join(process.cwd(), "data"),
  baseDir: process.cwd(),
});

app.get("/api/compliance", async (req, res) => {
  const name = String(req.query.organizationName ?? "").trim();
  if (!name) {
    return res.status(400).json({ error: "organizationName required" });
  }
  const dataset = await screening.ensureFreshDataset();
  res.json(screening.query(dataset, name));
});

app.post("/api/compliance/refresh", async (req, res) => {
  await screening.refresh({ importFolderPath: req.body.importFolderPath });
  res.json({ message: "ok" });
});

app.listen(3000);
```

---

## 6. 獨立 UI 當子服務

若暫不嵌入程式碼，可單獨跑 UI：

```bash
npm run ui
# http://localhost:3456
```

以反向代理（Nginx）掛在子路徑，例如 `/compliance` → `http://127.0.0.1:3456`。

---

## 7. 排程更新

建議每月執行一次：

```bash
# cron 範例（每月 1 日 03:00）
0 3 1 * * cd /var/lib/myapp/tw-compliance-screening && \
  COMPLIANCE_IMPORT_FOLDER=/var/lib/myapp/imports \
  node scripts/fetch-compliance-files.mjs && \
  node -e "import('./dist/index.js').then(m=>m.createComplianceScreening({dataDir:'./data',baseDir:process.cwd()}).then(s=>s.refresh()))"
```

或在應用內呼叫 `screening.refresh()`。

---

## 8. 比對規則

- **精準優先**：以公司名稱正規化後做完全相等比對
- **未命中再模糊**：若該來源無精準命中，改以正規化後名稱的雙向包含比對（較短字串至少 4 字）
- 正規化會去除括號內容、空白、公司類型後綴，臺/台統一
- 匯入與比對時會解碼政府資料常見的 HTML 字元參照（如 `&#18962;` → `䨒`）；無效碼位保留原樣
- 每筆命中結果含 `matchType`（`exact` / `fuzzy`）與 `matchScore`（0～1）
- **臺陸資**另支援：輸入 8 碼統一編號時，於名稱精準未命中後嘗試統編精準比對
- **臺陸資**比對欄位為「**國內被投資事業名稱**」，不是陸資投資人名稱
- 勞動部、工程會名單原始資料**無統一編號欄位**，仍以名稱為主

---

## 9. 常見問題

### Q：伺服器上自動下載失敗？

政府 API 可能不穩。請手動下載 `moea-latest.xlsx` 放入匯入資料夾，再執行 `refresh()` 或 UI「立即更新資料」。只要三個匯入檔存在，仍會正常解析。

### Q：設定檔路徑在別台機器失效？

改為相對路徑 `imports`，或設定 `COMPLIANCE_IMPORT_FOLDER` 環境變數。

### Q：需要哪些依賴？

- Node.js 18+
- `exceljs`、`jszip`（解析 xlsx）
- Windows 上臺陸資自動下載可選用 `curl.exe`

### Q：快取檔很大？

`compliance-screening-cache.json` 含全量紀錄（勞動部約 60 萬筆）。可定期更新，勿納入 git（已在 `.gitignore`）。

---

## 11. 整合端安全責任

核心函式庫已實作路徑沙箱、下載白名單等防護，完整清單見 **[SECURITY.md](./SECURITY.md)**。嵌入時請注意：

### 建議做法

| 情境 | 建議 |
|------|------|
| 使用者查詢 | `readDataset()` + `query()`，避免每次查詢呼叫 `ensureFreshDataset()` |
| 資料更新 | 排程或管理員介面呼叫 `refresh()` |
| 匯入路徑 | 生產環境用 `COMPLIANCE_IMPORT_FOLDER` 鎖定；或確保 `saveConfig` 傳入相對路徑如 `imports` |
| 對外 API | 加認證、查詢字串長度檢查、必要時 refresh 節流 |
| 前端顯示 | 比對結果做 HTML escape（可參考 `ui/app.js`） |

### 路徑驗證行為

- 透過 API／`saveConfig` 傳入逃出 `baseDir` 的路徑（含 `../`、專案外絕對路徑）→ **拋錯**，訊息：`匯入資料夾必須位於專案根目錄內`
- 設定 `COMPLIANCE_IMPORT_FOLDER` 環境變數 → **覆寫**設定檔與 API 路徑（由部署者管控，適合鎖定目錄）

### 刻意留給整合方的彈性

本套件**不內建**登入、refresh 速率限制。若主系統已有使用者權限或 API Gateway，請在該層實作，無需修改本工具核心。

驗證修補：`npm run security-test`（需先 `npm run ui`）。

---

## 12. 授權

MIT License — 可自由整合至商業或政府專案，請保留版權聲明。
