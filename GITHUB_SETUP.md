# 建立 GitHub 儲存庫

本專案為**獨立開源工具**。請在本機終端機（需已安裝 [Git](https://git-scm.com/) 與 [GitHub CLI](https://cli.github.com/)）執行。

## 一、要上傳什麼？

### 應提交（程式與文件）

| 路徑 | 說明 |
|------|------|
| `src/` | TypeScript 原始碼 |
| `ui/` | 獨立 UI（HTML / JS / CSS / server） |
| `scripts/` | 抓取腳本、安全煙霧測試 |
| `tw-compliance-screening.mjs` | CLI 入口 |
| `package.json`、`package-lock.json` | 依賴鎖定 |
| `tsconfig.json` | TypeScript 設定 |
| `config.example.json` | 設定範例 |
| `README.md`、`INTEGRATION.md`、`SECURITY.md` | 文件 |
| `GITHUB_SETUP.md`、`.gitignore` | 本指南與忽略規則 |
| `LICENSE` | MIT 授權（建議新增，見下方） |

### 不要提交（已在 `.gitignore`）

| 路徑 | 原因 |
|------|------|
| `node_modules/` | 依賴套件，`npm install` 可還原 |
| `dist/` | 編譯產物，`npm run build` 可還原 |
| `data/` | 快取與本機設定（含 60 萬筆快取，體積大） |
| `imports/` | 政府名單 CSV/XLSX（可重新下載） |
| `.env` | 環境變數、可能含路徑或金鑰 |
| `.cursor/`、`agent-transcripts/` | **Cursor 對話與 IDE 設定** |

> **關於 Cursor 對話紀錄**  
> 對話通常存放在使用者目錄（例如 `C:\Users\你的帳號\.cursor\projects\`），**不在本專案資料夾內**，只要在本專案目錄執行 `git init`，就不會被上傳。  
> 請勿將 `.cursor` 資料夾複製進專案；`.gitignore` 已預防誤提交。

### 推送前自檢

```powershell
cd "你的專案路徑"

# 預覽將被提交的檔案（不應出現 data、imports、node_modules、.cursor）
git status

# 若已安裝 git，也可用：
git add -n .
```

## 二、首次推送步驟

```bash
cd tw-compliance-screening

git init
git add .
git status   # 再次確認清單
git commit -m "Initial commit: 勞動法令、臺陸資、工程會拒絕往來廠商比對工具"

# 建立公開 repo 並推送
gh repo create tw-compliance-screening --public --source=. --remote=origin --push --description "違反勞動相關法令、公共工程委員會拒絕往來廠商與來臺陸資投資名錄比對工具"
```

若尚未登入 GitHub CLI：

```bash
gh auth login
```

若不用 `gh`，可在 GitHub 網站手動建立空白 repo `tw-compliance-screening`，再：

```bash
git remote add origin https://github.com/NtutJason/tw-compliance-screening.git
git branch -M main
git push -u origin main
```

## 三、推送後確認

- 儲存庫網址：`https://github.com/NtutJason/tw-compliance-screening`
- `package.json` 的 `repository.url` 已指向上述網址
- 根目錄已含 `LICENSE`（MIT）

## 四、他人 clone 後

```bash
npm install
npm run build
npm run ui
# 第一次使用請按「立即更新資料」下載政府名單
```

設定範例：複製 `config.example.json` 為 `data/compliance-screening-config.json`（`data/` 目錄需自行建立）。
