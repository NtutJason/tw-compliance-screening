#!/usr/bin/env node
/**
 * tw-compliance-screening — 單檔 CLI
 * 勞動法令違規 / 工程會拒絕往來廠商 / 臺陸資名錄 比對工具
 *
 * 用法：
 *   node tw-compliance-screening.mjs fetch [--out 資料夾]
 *   node tw-compliance-screening.mjs build-cache [--imports 資料夾] [--cache 快取.json]
 *   node tw-compliance-screening.mjs query "公司名稱" [--cache 快取.json] [--json]
 *   node tw-compliance-screening.mjs help
 */

import { execFile } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { promisify } from "util";
import { matchComplianceRecords } from "./dist/match.js";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── 常數 ─────────────────────────────────────────────────────────────
const MOL_SOURCES = [
  { name: "違反勞動基準法", url: "https://apiservice.mol.gov.tw/OdService/download/A17000000J-030225-svj", encoding: "utf-8", lawCategory: "勞動基準法" },
  { name: "違反就業服務法", url: "https://apiservice.mol.gov.tw/OdService/download/A17000000J-030228-p2G", encoding: "utf-8", lawCategory: "就業服務法" },
  { name: "違反性別平等工作法", url: "https://apiservice.mol.gov.tw/OdService/download/A17000000J-030226-sop", encoding: "utf-8", lawCategory: "性別平等工作法" },
  { name: "違反中高齡者及高齡者就業促進法", url: "https://apiservice.mol.gov.tw/OdService/download/A17000000J-030472-56W", encoding: "big5", lawCategory: "中高齡者及高齡者就業促進法" },
  { name: "違反勞工退休金條例", url: "https://apiservice.mol.gov.tw/OdService/download/A17000000J-030227-POn", encoding: "utf-8", lawCategory: "勞工退休金條例" },
  { name: "違反勞工職業災害保險及保護法", url: "https://apiservice.mol.gov.tw/OdService/download/A17000000J-030471-WCv", encoding: "utf-8", lawCategory: "勞工職業災害保險及保護法" },
  { name: "違反工會法", url: "https://apiservice.mol.gov.tw/OdService/download/A17000000J-030542-tEK", encoding: "utf-8", lawCategory: "工會法" },
  { name: "違反職業安全衛生法", url: "https://apiservice.mol.gov.tw/OdService/download/A17000000J-030466-h0a", encoding: "utf-8", lawCategory: "職業安全衛生法" },
];
const PCC_JSON_URL = process.env.PCC_SOURCE_JSON_URL?.trim() || "https://web.pcc.gov.tw/vms/rvlm/rvlmPublicSearch/queryRVFile/json";
const MOEA_XLSX_URL = process.env.MOEA_INVESTMENT_LIST_XLSX_URL?.trim() || "https://www.moea.gov.tw/Mns/dir/content/wHandMenuFile.ashx?menu_id=42805&file_id=35237";
const MOEA_QUERY_URL = "https://www.moea.gov.tw/Mns/dir/Investment/InvestmentList.aspx?menu_id=42804";
const MOEA_CSV_FALLBACK = process.env.MOEA_INVESTMENT_LIST_CSV_URL?.trim() || "https://quality.data.gov.tw/dq_download_csv.php?nid=18431&md5_url=5274761001e7af5bc6caeb5647734d9f";
const MOEA_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

// ── 工具函式 ─────────────────────────────────────────────────────────
const csvEscape = (v) => {
  const t = String(v ?? "");
  return t.includes(",") || t.includes('"') || t.includes("\n") ? `"${t.replaceAll('"', '""')}"` : t;
};

const parseCsvLine = (line) => {
  const result = [];
  let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQ = inQ && line[i + 1] === '"' ? (cur += '"', i++, false) : !inQ; continue; }
    if (ch === "," && !inQ) { result.push(cur); cur = ""; continue; }
    cur += ch;
  }
  result.push(cur);
  return result.map((s) => s.trim());
};

const normalizeUnitName = (v) =>
  String(v ?? "")
    .replace(/[（(].*?[)）]/g, "")
    .replace(/\s+/g, "")
    .replace(/臺/g, "台")
    .replace(/股份有限公司|有限公司|有限責任公司|公司|商號|企業社/g, "")
    .trim()
    .toLowerCase();

const pickIndex = (headers, aliases) =>
  headers.findIndex((h) => aliases.some((a) => h.includes(a)));

const findMoeaHeader = (rows) => {
  for (let i = 0; i < Math.min(rows.length, 12); i++) {
    const j = rows[i].join(",");
    if (j.includes("國內被投資事業名稱") || j.includes("被投資事業名稱") || (j.includes("統一編號") && j.includes("投資型態"))) return i;
  }
  return 0;
};

const buildRecords = (source, rows) => {
  if (rows.length <= 1) return [];
  const hi = source === "moea" ? findMoeaHeader(rows) : 0;
  const data = rows.slice(hi);
  if (data.length <= 1) return [];
  const headers = data[0];
  const nameIdx = pickIndex(headers, source === "moea" ? ["國內被投資事業名稱", "被投資事業名稱"] : ["國內被投資事業名稱", "被投資事業名稱", "事業單位", "廠商名稱", "名稱", "公司"]);
  if (source === "moea" && nameIdx < 0) return [];
  const cell = (row, idx) => (idx >= 0 ? String(row[idx] ?? "").trim() : "");
  return data.slice(1).map((row) => {
    const unitName = cell(row, nameIdx);
    return {
      source,
      unitName,
      unitNameNormalized: normalizeUnitName(unitName),
      lawCategory: cell(row, pickIndex(headers, ["法令類別", "法令"])) || (source === "moea" ? "臺陸資名錄" : ""),
      lawRef: cell(row, pickIndex(headers, ["違法法規", "法規", "法條", "投資型態"])),
      publishedAt: cell(row, pickIndex(headers, ["處分日期", "核准月年", "核准年月", "公告日期"])),
      penaltyAmount: cell(row, pickIndex(headers, ["投資金額", "罰鍰", "處分金額"])),
      note: cell(row, pickIndex(headers, ["備註", "違反法規內容", "說明"])),
    };
  });
};

const matchRecords = (records, orgName) =>
  matchComplianceRecords(
    {
      records,
      updatedAt: "",
      nextRefreshAt: "",
      recordCount: { mol: 0, pcc: 0, moea: 0 },
      warnings: [],
    },
    { organizationName: orgName }
  );

const parseArgs = (argv) => {
  const args = [...argv];
  const command = args.shift() ?? "help";
  const flags = {};
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      const key = args[i].slice(2);
      const val = args[i + 1] && !args[i + 1].startsWith("--") ? args[++i] : "true";
      flags[key] = val;
    } else {
      positional.push(args[i]);
    }
  }
  return { command, flags, positional };
};

const fileExists = async (p) => { try { await fs.access(p); return true; } catch { return false; } };

// ── XLSX 解析（可選 exceljs）────────────────────────────────────────
async function loadRowsFromFile(filePath) {
  const bytes = await fs.readFile(filePath);
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".csv" || ext === ".txt") {
    const lines = bytes.toString("utf8").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    return lines.map(parseCsvLine);
  }
  try {
    const { default: ExcelJS } = await import("exceljs");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    const sheet = wb.worksheets[0];
    if (!sheet) return [];
    const rows = [];
    sheet.eachRow((row) => {
      const vals = (row.values ?? []).slice(1).map((v) => (v == null ? "" : String(v).trim()));
      if (vals.some(Boolean)) rows.push(vals);
    });
    return rows;
  } catch {
    throw new Error(`無法解析 ${filePath}。請安裝 exceljs（npm i exceljs）或改提供 CSV。`);
  }
}

// ── fetch 子命令 ─────────────────────────────────────────────────────
async function cmdFetch(importFolder) {
  await fs.mkdir(importFolder, { recursive: true });
  const bundledScript = path.join(__dirname, "scripts", "fetch-compliance-files.mjs");
  if (await fileExists(bundledScript)) {
    await execFileAsync("node", [bundledScript], {
      env: { ...process.env, COMPLIANCE_IMPORT_FOLDER: importFolder },
      maxBuffer: 30 * 1024 * 1024,
    });
    return;
  }
  console.log("=== 內建抓取（無 bundled script）===");
  // MOL
  let header = "";
  const molRows = [];
  for (const src of MOL_SOURCES) {
    const res = await fetch(src.url);
    if (!res.ok) throw new Error(`${src.name} 下載失敗`);
    const text = new TextDecoder(src.encoding).decode(await res.arrayBuffer());
    const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (!header) header = lines[0];
    for (const row of lines.slice(1)) molRows.push(`${row},${csvEscape(src.lawCategory)}`);
    console.log(`[勞動部] ${src.name}：${lines.length - 1} 筆`);
  }
  await fs.writeFile(path.join(importFolder, "mol-latest.csv"), `${header},法令類別\n${molRows.join("\n")}\n`, "utf8");
  // PCC
  const pccRes = await fetch(PCC_JSON_URL, { headers: { Accept: "application/json" } });
  const payload = await pccRes.json();
  const list = payload?.Rvlmd_List?.Rvlmd ?? [];
  const pccHeader = ["主管機關","公告日期","處分日期","處分字號","事業單位名稱或負責人","違法法規法條","違反法規內容","拒絕往來生效日","拒絕往來截止日","備註說明","法令類別"];
  const pccRows = list.map((item) => [
    item.Announce_Agency_Name ?? "", item.Announce_Date ?? "", item.Origional_Announce_Date ?? "",
    item.Judgment_Doc_No ?? "", item.Corporation_Name ?? "", item.GPA101_Caluse ?? "",
    item.Crime_Info || item.Suitable_Law || "", item.Effective_Date ?? "", item.Expire_Date ?? "",
    item.Remark ?? "", "政府採購法第101條（拒絕往來廠商）",
  ].map(csvEscape).join(","));
  await fs.writeFile(path.join(importFolder, "pcc-latest.csv"), `${pccHeader.join(",")}\n${pccRows.join("\n")}\n`, "utf8");
  console.log(`[工程會] ${list.length} 筆`);
  // MOEA
  try {
    const res = await fetch(MOEA_XLSX_URL, { headers: { Referer: MOEA_QUERY_URL, "User-Agent": MOEA_USER_AGENT } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf[0] !== 0x50) throw new Error("非 XLSX");
    await fs.writeFile(path.join(importFolder, "moea-latest.xlsx"), buf);
    console.log("[臺陸資] XLSX 下載完成");
  } catch (e) {
    console.warn(`[臺陸資] 自動下載失敗：${e.message}`);
    console.warn(`請至 ${MOEA_QUERY_URL} 手動下載，存為 moea-latest.xlsx`);
  }
  console.log("抓取完成。");
}

// ── build-cache 子命令 ───────────────────────────────────────────────
async function cmdBuildCache(importFolder, cacheFile) {
  const warnings = [];
  let mol = [], pcc = [], moea = [];
  const molPath = path.join(importFolder, "mol-latest.csv");
  if (await fileExists(molPath)) {
    mol = buildRecords("mol", await loadRowsFromFile(molPath));
    console.log(`[勞動部] 解析 ${mol.length} 筆`);
  } else warnings.push("找不到 mol-latest.csv");
  const pccPath = path.join(importFolder, "pcc-latest.csv");
  if (await fileExists(pccPath)) {
    pcc = buildRecords("pcc", await loadRowsFromFile(pccPath));
    console.log(`[工程會] 解析 ${pcc.length} 筆`);
  } else warnings.push("找不到 pcc-latest.csv");
  const moeaXlsx = path.join(importFolder, "moea-latest.xlsx");
  const moeaCsv = path.join(importFolder, "moea-latest.csv");
  const moeaPath = (await fileExists(moeaXlsx)) ? moeaXlsx : (await fileExists(moeaCsv)) ? moeaCsv : null;
  if (moeaPath) {
    moea = buildRecords("moea", await loadRowsFromFile(moeaPath));
    console.log(`[臺陸資] 解析 ${moea.length} 筆`);
  } else {
    warnings.push(`找不到臺陸資名錄。請至 ${MOEA_QUERY_URL} 下載 xlsx`);
  }
  const now = new Date().toISOString();
  const dataset = {
    updatedAt: now,
    nextRefreshAt: new Date(Date.now() + 30 * 86400000).toISOString(),
    recordCount: { mol: mol.length, pcc: pcc.length, moea: moea.length },
    records: [...mol, ...pcc, ...moea].filter((r) => r.unitName),
    warnings,
  };
  await fs.mkdir(path.dirname(cacheFile), { recursive: true });
  await fs.writeFile(cacheFile, JSON.stringify(dataset, null, 2), "utf8");
  console.log(`快取已寫入：${cacheFile}（共 ${dataset.records.length} 筆）`);
  if (warnings.length) warnings.forEach((w) => console.warn(`⚠ ${w}`));
}

// ── query 子命令 ─────────────────────────────────────────────────────
async function cmdQuery(orgName, cacheFile, asJson) {
  const raw = await fs.readFile(cacheFile, "utf8");
  const dataset = JSON.parse(raw);
  const result = matchRecords(dataset.records ?? [], orgName);
  const output = {
    query: { organizationName: orgName },
    updatedAt: dataset.updatedAt,
    recordCount: dataset.recordCount,
    warnings: dataset.warnings ?? [],
    ...result,
  };
  if (asJson) {
    console.log(JSON.stringify(output, null, 2));
    return;
  }
  console.log(`查詢：${orgName}`);
  console.log(`資料更新：${dataset.updatedAt}`);
  console.log(`比對結果：${result.matched ? "有命中" : "無命中"}`);
  for (const [label, key] of [["勞動法令", "molMatches"], ["工程會拒絕往來", "pccMatches"], ["臺陸資名錄", "moeaMatches"]]) {
    const items = result[key];
    console.log(`\n── ${label}（${items.length}）──`);
    if (!items.length) { console.log("  （無）"); continue; }
    for (const r of items) {
      const matchLabel =
        r.matchType === "fuzzy"
          ? ` [相似命中${r.matchScore != null ? ` ${Math.round(r.matchScore * 100)}%` : ""}]`
          : r.matchType === "exact"
            ? " [精準命中]"
            : "";
      console.log(`  • ${r.unitName}${matchLabel}`);
      if (r.lawCategory) console.log(`    法令：${r.lawCategory}`);
      if (r.publishedAt) console.log(`    日期：${r.publishedAt}`);
      if (r.penaltyAmount) console.log(`    金額：${r.penaltyAmount}`);
    }
  }
}

// ── help ─────────────────────────────────────────────────────────────
function printHelp() {
  console.log(`
tw-compliance-screening — 違反勞動相關法令、公共工程委員會拒絕往來廠商與來臺陸資投資名錄比對工具

子命令：
  fetch       從政府網站下載最新名單
  build-cache 將匯入檔解析為 JSON 快取
  query       以公司名稱比對快取
  help        顯示說明

範例：
  node tw-compliance-screening.mjs fetch --out ./imports
  node tw-compliance-screening.mjs build-cache --imports ./imports --cache ./cache.json
  node tw-compliance-screening.mjs query "亞威科技有限公司" --cache ./cache.json
  node tw-compliance-screening.mjs query "亞威科技有限公司" --cache ./cache.json --json

環境變數：
  COMPLIANCE_IMPORT_FOLDER  預設匯入資料夾
  PCC_SOURCE_JSON_URL       工程會 JSON 來源
  MOEA_INVESTMENT_LIST_XLSX_URL  臺陸資 XLSX 直連

比對欄位：
  勞動部／工程會：事業單位名稱
  臺陸資：國內被投資事業名稱
`);
}

// ── main ─────────────────────────────────────────────────────────────
const { command, flags, positional } = parseArgs(process.argv.slice(2));
const defaultImports = flags.out || flags.imports || process.env.COMPLIANCE_IMPORT_FOLDER || path.join(process.cwd(), "compliance-imports");
const defaultCache = flags.cache || path.join(process.cwd(), "compliance-screening-cache.json");

try {
  switch (command) {
    case "fetch":
      await cmdFetch(path.resolve(defaultImports));
      break;
    case "build-cache":
      await cmdBuildCache(path.resolve(defaultImports), path.resolve(defaultCache));
      break;
    case "query": {
      const name = positional[0];
      if (!name) { console.error("請提供公司名稱"); process.exit(1); }
      await cmdQuery(name, path.resolve(defaultCache), flags.json === "true");
      break;
    }
    case "help":
    case "--help":
    case "-h":
      printHelp();
      break;
    default:
      console.error(`未知子命令：${command}`);
      printHelp();
      process.exit(1);
  }
} catch (error) {
  console.error("錯誤：", error.message || error);
  process.exit(1);
}
