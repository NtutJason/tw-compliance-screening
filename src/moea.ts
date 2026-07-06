import path from "path";
import {
  MOEA_INVESTMENT_LIST_QUERY_URL,
  MOEA_INVESTMENT_LIST_XLSX_URL,
} from "./constants.js";
import { joinImportFile } from "./paths.js";

export const buildMoeaManualDownloadWarning = (importFolderPath: string) =>
  [
    "臺陸資名錄自動下載失敗，請改由經濟部官網手動下載：",
    `1. 開啟「來臺陸資名錄」查詢頁：${MOEA_INVESTMENT_LIST_QUERY_URL}`,
    `2. 在頁面上方「檔案下載」點選 xlsx（或直接使用：${MOEA_INVESTMENT_LIST_XLSX_URL}）`,
    `3. 將檔案存為：${joinImportFile(importFolderPath, "moea-latest.xlsx")}`,
    "4. 回到本系統按「立即更新資料」或重新執行 build-cache",
  ].join("\n");
