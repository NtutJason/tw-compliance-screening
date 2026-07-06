# 違反勞動相關法令、來臺陸資及工程會拒絕往來廠商比對工具

臺灣政府「違反勞動相關法令、屬公共工程委員會公告拒絕往來廠商或屬經濟部公告來臺陸資投資名錄之單位」比對開源工具，支援：

- **勞動部（MOL）**：8 類違反勞動法令名單
- **工程會（PCC）**：政府採購法第 101 條拒絕往來廠商
- **經濟部（MOEA）**：來臺陸資名錄（比對「**國內被投資事業名稱**」）

## 三種使用方式

| 形式 | 適合對象 | 指令 |
|------|----------|------|
| **獨立 UI** | 本機查詢、不整合既有系統 | `npm run ui` |
| **CLI** | 排程、批次、腳本 | `node tw-compliance-screening.mjs ...` |
| **函式庫** | 嵌入自己的網站／後台 | 見 [INTEGRATION.md](./INTEGRATION.md) |

## 快速開始

```bash
git clone https://github.com/NtutJason/tw-compliance-screening.git
cd tw-compliance-screening
npm install
npm run build
npm run ui
```

瀏覽器開啟：**http://127.0.0.1:3456**（預設僅本機；區網共用見下方「安全性」）

1. 第一次請按「**立即更新資料**」（或手動放入 `imports/` 名單檔）
2. 輸入單位名稱 →「**開始比對**」
3. 查看三欄結果

## CLI 範例

```bash
node tw-compliance-screening.mjs fetch --out ./imports
node tw-compliance-screening.mjs build-cache --imports ./imports --cache ./data/compliance-screening-cache.json
node tw-compliance-screening.mjs query "亞威科技有限公司" --cache ./data/compliance-screening-cache.json
```

## 接到自己的系統

請閱讀 **[INTEGRATION.md](./INTEGRATION.md)**，內含：

- Next.js / Express 整合範例
- API 契約說明
- 資料夾與路徑設定（**跨平台／伺服器部署**）
- 排程更新建議
- 整合端安全責任（見 [SECURITY.md](./SECURITY.md)）

## 安全性

本工具預設為**本機輔助程式**，已實作多項防護，詳見 **[SECURITY.md](./SECURITY.md)**。摘要如下：

| 類別 | 加強項目 |
|------|----------|
| **下載** | 政府 HTTPS 網域白名單、120 秒逾時、`execFile` 執行抓取腳本（不經 shell） |
| **路徑** | API 設定的 `importFolderPath` 限制在專案根目錄內；惡意路徑回 **400** |
| **API** | 查詢僅讀快取（不自動下載）；POST body 上限 64 KB；查詢字串 ≤ 500 字 |
| **靜態檔** | 目錄穿越檢查 |
| **前端** | 比對結果 HTML escape；連結僅允許 `http` / `https` |
| **UI** | 預設監聽 `127.0.0.1`（非全網路介面） |

**刻意保留的介接彈性**（由整合方自行決定）：

- 無內建登入／速率限制（可於反向代理或主系統加認證、節流）
- `refresh` 可由排程、CLI 或自建 API 觸發
- `COMPLIANCE_IMPORT_FOLDER` 可由部署者鎖定匯入目錄

驗證修補是否生效：

```bash
npm run ui          # 終端機 1
npm run security-test   # 終端機 2（預期 15/15 通過）
```

## 資料夾約定

```
專案根目錄/
├── imports/                 # 政府名單匯入檔（建議用相對路徑設定）
│   ├── mol-latest.csv
│   ├── pcc-latest.csv
│   └── moea-latest.xlsx
└── data/
    ├── compliance-screening-cache.json
    └── compliance-screening-config.json   # 內存相對路徑，例如 "imports"
```

## 匯入路徑設定（重要）

設定檔**建議存相對路徑**（如 `imports`），會依 `baseDir`（通常為專案根目錄）解析，避免 Windows 絕對路徑在 Linux 伺服器失效。

優先順序：

1. 環境變數 `COMPLIANCE_IMPORT_FOLDER`（部署推薦）
2. `data/compliance-screening-config.json`（可從 `config.example.json` 複製）
3. 程式選項 `importFolderPath`

## 環境變數

| 變數 | 說明 |
|------|------|
| `COMPLIANCE_IMPORT_FOLDER` | 匯入資料夾（絕對路徑，部署首選；設定後 API 無法改寫路徑） |
| `UI_PORT` | 獨立 UI 埠號（預設 3456） |
| `UI_HOST` | 監聽位址（預設 `127.0.0.1`；內網共用設 `0.0.0.0`） |
| `PCC_SOURCE_JSON_URL` | 工程會 JSON API（須通過 HTTPS 政府網域白名單） |
| `MOEA_INVESTMENT_LIST_XLSX_URL` | 臺陸資 XLSX 直連（同上） |
| `MOEA_INVESTMENT_LIST_CSV_URL` | 臺陸資 CSV 備援（同上） |

## 臺陸資下載失敗時

1. 開啟 [來臺陸資名錄查詢頁](https://www.moea.gov.tw/Mns/dir/Investment/InvestmentList.aspx?menu_id=42804)
2. 下載 xlsx，存為 `{匯入資料夾}/moea-latest.xlsx`
3. 按「立即更新資料」或執行 `build-cache`

## 目錄結構

```
├── ui/                           獨立 UI（server + 靜態頁）
├── src/                          TypeScript 函式庫
├── dist/                         編譯產物
├── scripts/
│   ├── fetch-compliance-files.mjs
│   └── security-smoke-test.mjs   # 安全煙霧測試
├── tw-compliance-screening.mjs   單檔 CLI
├── INTEGRATION.md                整合指南
├── SECURITY.md                   安全性說明與加強項目
├── config.example.json           匯入路徑設定範例
└── README.md
```

## 結論與未來展望

**tw-compliance-screening** 專為臺灣政府「違反勞動相關法令、屬公共工程委員會公告拒絕往來廠商或屬經濟部公告來臺陸資投資名錄之單位」比對而設計，核心價值在於提供**高自由度、高安全性**的本地輔助方案，並以獨立 UI、CLI 與函式庫三種形式，讓企業與開發者依自身情境靈活介接。

我們期望透過開源協作，降低「違反勞動相關法令、屬公共工程委員會公告拒絕往來廠商或屬經濟部公告來臺陸資投資名錄之單位」比對作業的自動化門檻——減少人工逐筆查閱的時間成本，也降低因資訊落差而產生的非故意性違規風險。本專案依 **MIT 條款**開源；名單資料皆串接自政府公開資料集。惟政府資料之更新頻率、欄位格式可能隨時調整，**比對結果僅供輔助參考**；企業於採購、投標或供應鏈決策時，仍應以各主管機關之官方公告為最終依據。

本專案將持續追蹤臺灣「違反勞動相關法令、屬公共工程委員會公告拒絕往來廠商或屬經濟部公告來臺陸資投資名錄之單位」相關資料結構的變動，並完善路徑防護、下載白名單與安全性煙霧測試等基礎建設。誠摯歡迎開發者、法務與採購實務工作者透過 [Issue](https://github.com/NtutJason/tw-compliance-screening/issues) 或 Pull Request 參與貢獻——無論是補強測試案例、回報政府 API 異動，或擴充更多相關來源（如環境保護、公平交易等名單），都將幫助這套工具更貼近臺灣實務需求。一起把比對作業做得更可靠、更好用。

## 授權

MIT License
