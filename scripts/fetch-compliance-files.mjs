import { execFile } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

const projectRoot = process.cwd();
const importFolder = process.env.COMPLIANCE_IMPORT_FOLDER?.trim()
  ? path.resolve(process.env.COMPLIANCE_IMPORT_FOLDER.trim())
  : path.join(projectRoot, "imports");
const molSources = [
  {
    name: "違反勞動基準法",
    url: "https://apiservice.mol.gov.tw/OdService/download/A17000000J-030225-svj",
    encoding: "utf-8",
    lawCategory: "勞動基準法",
  },
  {
    name: "違反就業服務法",
    url: "https://apiservice.mol.gov.tw/OdService/download/A17000000J-030228-p2G",
    encoding: "utf-8",
    lawCategory: "就業服務法",
  },
  {
    name: "違反性別平等工作法",
    url: "https://apiservice.mol.gov.tw/OdService/download/A17000000J-030226-sop",
    encoding: "utf-8",
    lawCategory: "性別平等工作法",
  },
  {
    name: "違反中高齡者及高齡者就業促進法",
    url: "https://apiservice.mol.gov.tw/OdService/download/A17000000J-030472-56W",
    encoding: "big5",
    lawCategory: "中高齡者及高齡者就業促進法",
  },
  {
    name: "違反勞工退休金條例",
    url: "https://apiservice.mol.gov.tw/OdService/download/A17000000J-030227-POn",
    encoding: "utf-8",
    lawCategory: "勞工退休金條例",
  },
  {
    name: "違反勞工職業災害保險及保護法",
    url: "https://apiservice.mol.gov.tw/OdService/download/A17000000J-030471-WCv",
    encoding: "utf-8",
    lawCategory: "勞工職業災害保險及保護法",
  },
  {
    name: "違反工會法",
    url: "https://apiservice.mol.gov.tw/OdService/download/A17000000J-030542-tEK",
    encoding: "utf-8",
    lawCategory: "工會法",
  },
  {
    name: "違反職業安全衛生法",
    url: "https://apiservice.mol.gov.tw/OdService/download/A17000000J-030466-h0a",
    encoding: "utf-8",
    lawCategory: "職業安全衛生法",
  },
];
const MOEA_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const ALLOWED_FETCH_HOSTS = new Set([
  "apiservice.mol.gov.tw",
  "web.pcc.gov.tw",
  "www.moea.gov.tw",
  "quality.data.gov.tw",
]);

const FETCH_TIMEOUT_MS = 120_000;
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 3_000;

const log = {
  wait: (message) => console.log(`⏳ ${message}`),
  ok: (message) => console.log(`✅ ${message}`),
  warn: (message) => console.warn(`⚠️  ${message}`),
  fail: (message) => console.error(`❌ ${message}`),
  info: (message) => console.log(`ℹ️  ${message}`),
  retry: (message) => console.log(`🔄 ${message}`),
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const withRetry = async (label, fn, { maxRetries = MAX_RETRIES } = {}) => {
  let lastError;
  const totalAttempts = maxRetries + 1;

  for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
    try {
      if (attempt === 1) {
        log.wait(`${label} 開始下載（最多 ${totalAttempts} 次嘗試）…`);
      } else {
        log.retry(`${label} 第 ${attempt - 1}/${maxRetries} 次重試…`);
      }

      const result = await fn(attempt);
      if (attempt > 1) {
        log.ok(`${label} 重試成功（第 ${attempt} 次嘗試）`);
      }
      return result;
    } catch (error) {
      lastError = error;
      const message = error?.message || String(error);

      if (attempt >= totalAttempts) {
        log.fail(`${label} 已用盡 ${totalAttempts} 次嘗試：${message}`);
        throw error;
      }

      const delayMs = RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
      log.warn(
        `${label} 第 ${attempt} 次嘗試失敗：${message}；${(delayMs / 1000).toFixed(0)} 秒後重試…`
      );
      await sleep(delayMs);
    }
  }

  throw lastError;
};

const assertAllowedHttpsUrl = (urlString, label = "URL") => {
  let parsed;
  try {
    parsed = new URL(urlString);
  } catch {
    throw new Error(`${label} 格式無效`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error(`${label} 僅允許 HTTPS`);
  }
  if (!ALLOWED_FETCH_HOSTS.has(parsed.hostname)) {
    throw new Error(`${label} 網域未在白名單內：${parsed.hostname}`);
  }
  return parsed.href;
};

const fetchWithTimeout = async (url, options = {}) => {
  const safeUrl = assertAllowedHttpsUrl(url);
  return fetch(safeUrl, {
    ...options,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
};

for (const source of molSources) {
  assertAllowedHttpsUrl(source.url, source.name);
}
const pccJsonUrl = assertAllowedHttpsUrl(
  process.env.PCC_SOURCE_JSON_URL?.trim() ||
    "https://web.pcc.gov.tw/vms/rvlm/rvlmPublicSearch/queryRVFile/json",
  "PCC_SOURCE_JSON_URL"
);
const moeaXlsxUrl = assertAllowedHttpsUrl(
  process.env.MOEA_INVESTMENT_LIST_XLSX_URL?.trim() ||
    "https://www.moea.gov.tw/Mns/dir/content/wHandMenuFile.ashx?menu_id=42805&file_id=35237",
  "MOEA_INVESTMENT_LIST_XLSX_URL"
);
export const MOEA_LIST_PAGE_URL =
  "https://www.moea.gov.tw/Mns/dir/Investment/InvestmentList.aspx?menu_id=42804";
const moeaReferer = MOEA_LIST_PAGE_URL;

const printMoeaManualDownloadHint = () => {
  log.warn("[臺陸資名錄] 請至經濟部官網手動下載：");
  console.warn(`  查詢頁面：${MOEA_LIST_PAGE_URL}`);
  console.warn(`  xlsx 檔案：${moeaXlsxUrl}`);
  console.warn(`  存檔路徑：{資料夾}/moea-latest.xlsx`);
};
const moeaCsvFallbackUrl = assertAllowedHttpsUrl(
  process.env.MOEA_INVESTMENT_LIST_CSV_URL?.trim() ||
    "https://quality.data.gov.tw/dq_download_csv.php?nid=18431&md5_url=5274761001e7af5bc6caeb5647734d9f",
  "MOEA_INVESTMENT_LIST_CSV_URL"
);

const nowStamp = () => {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${yyyy}${mm}${dd}-${hh}${mi}${ss}`;
};

const ensureDir = async (dirPath) => {
  await fs.mkdir(dirPath, { recursive: true });
};

const fileExists = async (filePath) => {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
};

const removeFileQuietly = async (filePath) => {
  try {
    await fs.unlink(filePath);
  } catch {
    // 暫存檔可能不存在，忽略即可
  }
};

const warnIfKeepingExisting = async (sourceKey, ext) => {
  const latestPath = path.join(importFolder, `${sourceKey}-latest${ext}`);
  if (await fileExists(latestPath)) {
    log.warn(`[${sourceKey.toUpperCase()}] 下載失敗，保留既有檔案：${latestPath}`);
    return true;
  }
  log.fail(`[${sourceKey.toUpperCase()}] 下載失敗，且無既有檔案可使用`);
  return false;
};

const commitLatestFile = async (sourceKey, content, ext = ".csv") => {
  const latestName = `${sourceKey}-latest${ext}`;
  const archiveName = `${sourceKey}-${nowStamp()}${ext}`;
  const latestPath = path.join(importFolder, latestName);
  const archivePath = path.join(importFolder, archiveName);
  const tempPath = path.join(importFolder, `.${latestName}.${process.pid}.tmp`);

  const isBinary = content instanceof Uint8Array || Buffer.isBuffer(content);
  const payload = isBinary ? Buffer.from(content) : String(content);

  if (!isBinary && payload.length === 0) {
    throw new Error(`${sourceKey} 文字內容為空，拒絕覆蓋現有檔案`);
  }
  if (isBinary && payload.length === 0) {
    throw new Error(`${sourceKey} 二進位內容為空，拒絕覆蓋現有檔案`);
  }

  try {
    if (isBinary) {
      await fs.writeFile(tempPath, payload);
    } else {
      await fs.writeFile(tempPath, payload, "utf8");
    }

    const stat = await fs.stat(tempPath);
    if (stat.size === 0) {
      throw new Error(`${sourceKey} 暫存檔驗證失敗：檔案大小為 0`);
    }

    await fs.copyFile(tempPath, archivePath);
    await fs.rename(tempPath, latestPath);

    return { latestPath, archivePath };
  } catch (error) {
    await removeFileQuietly(tempPath);
    throw error;
  }
};

const saveTextAsLatest = async (sourceKey, content, ext = ".csv") =>
  commitLatestFile(sourceKey, content, ext);

const saveBinaryAsLatest = async (sourceKey, bytes, ext = ".xlsx") =>
  commitLatestFile(sourceKey, bytes, ext);

const pruneOldArchives = async (sourceKey, ext = ".csv", keepCount = 2) => {
  const entries = await fs.readdir(importFolder, { withFileTypes: true });
  const archivePrefix = `${sourceKey}-`;
  const latestName = `${sourceKey}-latest${ext}`;
  const archives = entries
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name !== latestName &&
        entry.name.startsWith(archivePrefix) &&
        entry.name.endsWith(ext) &&
        !entry.name.includes(".tmp")
    )
    .map((entry) => entry.name)
    .sort()
    .reverse();

  const staleFiles = archives.slice(keepCount);
  await Promise.all(
    staleFiles.map((fileName) => fs.unlink(path.join(importFolder, fileName)))
  );
  if (staleFiles.length > 0) {
    log.info(`[${sourceKey.toUpperCase()}] 已清理舊檔：${staleFiles.length} 份`);
  }
};

const normalizeLines = (text) =>
  text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

const fetchMolSourceOnce = async (source) => {
  const response = await fetchWithTimeout(source.url);
  if (!response.ok) {
    throw new Error(`${source.name} HTTP ${response.status}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  const decoder = new TextDecoder(source.encoding);
  const text = decoder.decode(bytes);
  const lines = normalizeLines(text);
  if (lines.length === 0) {
    throw new Error(`${source.name} 內容為空`);
  }
  return lines;
};

const fetchMolSource = async (source) =>
  withRetry(`[勞動部] ${source.name}`, () => fetchMolSourceOnce(source));

const fetchAndMergeMolSources = async () => {
  let header = "";
  const mergedRows = [];

  for (const source of molSources) {
    try {
      const lines = await fetchMolSource(source);
      const currentHeader = lines[0];
      if (!header) {
        header = currentHeader;
      }
      const rows = lines.slice(1);
      for (const row of rows) {
        if (!row) {
          continue;
        }
        mergedRows.push(`${row},${csvEscape(source.lawCategory)}`);
      }
      log.ok(`[勞動部] 已擷取：${source.name}（${rows.length} 筆）`);
    } catch (error) {
      log.warn(`[勞動部] 略過 ${source.name}：${error.message || error}`);
    }
  }

  if (!header) {
    throw new Error("MOL 合併失敗：找不到標題列");
  }
  const mergedHeader = `${header},法令類別`;
  const merged = `${mergedHeader}\n${mergedRows.join("\n")}\n`;
  const saved = await saveTextAsLatest("mol", merged, ".csv");
  log.ok(`[勞動部] 合併完成：${mergedRows.length} 筆 -> ${saved.latestPath}`);
  return true;
};

const csvEscape = (value) => {
  const text = String(value ?? "");
  if (text.includes(",") || text.includes('"') || text.includes("\n")) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
};

const fetchPccPayloadOnce = async () => {
  const response = await fetchWithTimeout(pccJsonUrl, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`PCC JSON HTTP ${response.status}`);
  }
  const payload = await response.json();
  const list = payload?.Rvlmd_List?.Rvlmd;
  if (!Array.isArray(list)) {
    throw new Error("PCC JSON 格式不符（缺少 Rvlmd_List.Rvlmd）");
  }
  return list;
};

const fetchAndBuildPccCsv = async () => {
  const list = await withRetry("[公共工程委員會] PCC JSON", fetchPccPayloadOnce);
  const header = [
    "主管機關",
    "公告日期",
    "處分日期",
    "處分字號",
    "事業單位名稱或負責人",
    "違法法規法條",
    "違反法規內容",
    "拒絕往來生效日",
    "拒絕往來截止日",
    "備註說明",
    "法令類別",
  ];
  const rows = list.map((item) => {
    const note = [
      item.Case_Name ? `案名:${item.Case_Name}` : "",
      item.Case_no ? `案號:${item.Case_no}` : "",
      item.Effective_Date ? `生效:${item.Effective_Date}` : "",
      item.Expire_Date ? `到期:${item.Expire_Date}` : "",
      item.Remark ?? "",
    ]
      .filter(Boolean)
      .join("；");
    return [
      item.Announce_Agency_Name ?? "",
      item.Announce_Date ?? "",
      item.Origional_Announce_Date ?? "",
      item.Judgment_Doc_No ?? "",
      item.Corporation_Name ?? "",
      item.GPA101_Caluse ?? "",
      item.Crime_Info || item.Suitable_Law || "",
      item.Effective_Date ?? "",
      item.Expire_Date ?? "",
      note,
      "政府採購法第101條（拒絕往來廠商）",
    ];
  });
  const csv = [header, ...rows]
    .map((row) => row.map((cell) => csvEscape(cell)).join(","))
    .join("\n");
  const saved = await saveTextAsLatest("pcc", `${csv}\n`, ".csv");
  log.ok(`[公共工程委員會] JSON 轉檔完成：${rows.length} 筆 -> ${saved.latestPath}`);
  return true;
};

const curlDownloadOnce = async (url, { cookieFile = "", referer = "" } = {}) => {
  const safeUrl = assertAllowedHttpsUrl(url);
  const args = [
    "-sL",
    "--max-time",
    "120",
    "-H",
    `User-Agent: ${MOEA_USER_AGENT}`,
    "-H",
    "Accept-Language: zh-TW,zh;q=0.9",
  ];
  if (cookieFile) {
    args.push("-c", cookieFile, "-b", cookieFile);
  }
  if (referer) {
    args.push("-H", `Referer: ${referer}`);
  }
  args.push(safeUrl);
  const { stdout } = await execFileAsync("curl.exe", args, {
    maxBuffer: 30 * 1024 * 1024,
    encoding: "buffer",
    windowsHide: true,
  });
  return Buffer.from(stdout);
};

const curlDownload = async (url, options = {}) => {
  const label = options.label || `[臺陸資名錄] curl ${url}`;
  return withRetry(label, () => curlDownloadOnce(url, options));
};

const assertValidXlsx = (bytes) => {
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new Error("下載內容不是有效的 XLSX 檔案");
  }
};

const fetchMoeaXlsxViaCurl = async () => {
  const cookieFile = path.join(importFolder, "_moea-curl-cookies.txt");
  await curlDownload(moeaReferer, {
    cookieFile,
    label: "[臺陸資名錄] curl 取得 session",
  });
  const bytes = await curlDownload(moeaXlsxUrl, {
    cookieFile,
    referer: moeaReferer,
    label: "[臺陸資名錄] curl 下載 XLSX",
  });
  assertValidXlsx(bytes);
  const saved = await saveBinaryAsLatest("moea", bytes, ".xlsx");
  log.ok(`[臺陸資名錄] 經濟部官網 XLSX 下載完成 -> ${saved.latestPath}`);
  return { format: "xlsx" };
};

const fetchMoeaXlsxOnce = async () => {
  const response = await fetchWithTimeout(moeaXlsxUrl, {
    headers: {
      Accept:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel;q=0.9,*/*;q=0.8",
      "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
      Referer: moeaReferer,
      Origin: "https://www.moea.gov.tw",
      "User-Agent": MOEA_USER_AGENT,
    },
  });
  if (!response.ok) {
    throw new Error(`XLSX HTTP ${response.status}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  assertValidXlsx(bytes);
  return bytes;
};

const fetchMoeaXlsx = async () => {
  const bytes = await withRetry("[臺陸資名錄] fetch 下載 XLSX", fetchMoeaXlsxOnce);
  const saved = await saveBinaryAsLatest("moea", bytes, ".xlsx");
  log.ok(`[臺陸資名錄] XLSX 下載完成 -> ${saved.latestPath}`);
  return { format: "xlsx" };
};

const fetchMoeaCsvFallbackOnce = async () => {
  const response = await fetchWithTimeout(moeaCsvFallbackUrl, {
    headers: {
      Accept: "text/csv,text/plain,application/csv,*/*;q=0.8",
      "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    },
  });
  if (!response.ok) {
    throw new Error(`CSV 備援 HTTP ${response.status}`);
  }
  let text = Buffer.from(await response.arrayBuffer()).toString("utf8");
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }
  if (!text.includes("國內被投資事業名稱")) {
    throw new Error('CSV 缺少比對欄位「國內被投資事業名稱」');
  }
  return text.endsWith("\n") ? text : `${text}\n`;
};

const fetchMoeaCsvFallback = async () => {
  const normalized = await withRetry(
    "[臺陸資名錄] CSV 備援下載",
    fetchMoeaCsvFallbackOnce
  );
  const saved = await saveTextAsLatest("moea", normalized, ".csv");
  const lineCount = normalized.split(/\r?\n/).filter((line) => line.trim()).length - 1;
  log.ok(`[臺陸資名錄] CSV 備援下載完成：${lineCount} 筆 -> ${saved.latestPath}`);
  return { format: "csv" };
};

const fetchMoeaImport = async () => {
  try {
    return await fetchMoeaXlsxViaCurl();
  } catch (error) {
    log.warn(`[臺陸資名錄] curl 下載 XLSX 失敗：${error.message || error}`);
  }
  try {
    return await fetchMoeaXlsx();
  } catch (error) {
    log.warn(`[臺陸資名錄] fetch 下載 XLSX 失敗：${error.message || error}`);
  }
  try {
    const result = await fetchMoeaCsvFallback();
    log.warn("[臺陸資名錄] 已改用政府資料開放平臺 CSV 備援（可能較官網舊）");
    printMoeaManualDownloadHint();
    return result;
  } catch (fallbackError) {
    printMoeaManualDownloadHint();
    throw fallbackError;
  }
};

const printSummary = (results) => {
  console.log("");
  log.info("=== 下載結果摘要 ===");
  const labels = {
    mol: "勞動部違法名單",
    pcc: "公共工程委員會拒絕往來",
    moea: "臺陸資投資名錄",
  };
  for (const [key, label] of Object.entries(labels)) {
    if (results[key]) {
      log.ok(`${label}：更新成功`);
    } else {
      log.warn(`${label}：未更新（已保留既有資料或無可用檔案）`);
    }
  }
};

const main = async () => {
  await ensureDir(importFolder);

  const results = { mol: false, pcc: false, moea: false };

  console.log("=== 違反勞動相關法令、公共工程委員會拒絕往來廠商與來臺陸資投資名錄資料抓取器 ===");
  log.info(`資料夾：${importFolder}`);

  try {
    await fetchAndMergeMolSources();
    results.mol = true;
  } catch (error) {
    log.fail(`[勞動部] 自動下載失敗：${error.message || error}`);
    await warnIfKeepingExisting("mol", ".csv");
  }

  try {
    await fetchAndBuildPccCsv();
    results.pcc = true;
  } catch (error) {
    log.fail(`[公共工程委員會] 自動下載失敗：${error.message || error}`);
    await warnIfKeepingExisting("pcc", ".csv");
  }

  try {
    const moeaResult = await fetchMoeaImport();
    results.moea = true;
    if (moeaResult?.format === "xlsx") {
      await pruneOldArchives("moea", ".csv");
    } else if (moeaResult?.format === "csv") {
      await pruneOldArchives("moea", ".xlsx");
    }
  } catch (error) {
    log.fail(`[臺陸資名錄] 自動下載失敗：${error.message || error}`);
    const keptXlsx = await warnIfKeepingExisting("moea", ".xlsx");
    const keptCsv = await warnIfKeepingExisting("moea", ".csv");
    if (!keptXlsx && !keptCsv) {
      printMoeaManualDownloadHint();
    }
  }

  if (results.mol) {
    await pruneOldArchives("mol");
  }
  if (results.pcc) {
    await pruneOldArchives("pcc");
  }
  if (results.moea) {
    await pruneOldArchives("moea", ".xlsx");
    await pruneOldArchives("moea", ".csv");
  }

  printSummary(results);

  const anySuccess = Object.values(results).some(Boolean);
  if (anySuccess) {
    log.ok("抓取流程結束。");
  } else {
    log.fail("所有資料源下載均失敗，已保留既有檔案（若有）。");
    process.exitCode = 1;
  }
};

main().catch((error) => {
  log.fail(`抓取失敗：${error.message || error}`);
  process.exit(1);
});
