import { promises as fs } from "fs";
import path from "path";
import { DEFAULT_REFRESH_DAYS } from "./constants.js";
import { buildMoeaManualDownloadWarning } from "./moea.js";
import { parseTabularRowsFromBytes } from "./parse.js";
import { buildRecordsFromRows } from "./records.js";
import type { ComplianceConfig, ComplianceDataset, ComplianceRecord } from "./types.js";

export const emptyDataset = (): ComplianceDataset => {
  const now = new Date();
  return {
    updatedAt: now.toISOString(),
    nextRefreshAt: new Date(
      now.getTime() + DEFAULT_REFRESH_DAYS * 24 * 60 * 60 * 1000
    ).toISOString(),
    recordCount: { mol: 0, pcc: 0, moea: 0 },
    records: [],
    warnings: [],
  };
};

const fileExists = async (filePath: string) => {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
};

async function loadTabularRowsFromFile(filePath: string) {
  const bytes = await fs.readFile(filePath);
  return parseTabularRowsFromBytes(bytes, path.basename(filePath));
}

async function resolveMoeaImportFile(importFolderPath: string) {
  const xlsxPath = path.join(importFolderPath, "moea-latest.xlsx");
  const csvPath = path.join(importFolderPath, "moea-latest.csv");
  if (await fileExists(xlsxPath)) {
    return xlsxPath;
  }
  if (await fileExists(csvPath)) {
    return csvPath;
  }
  return null;
}

async function loadMoeaRecordsFromImportFolder(importFolderPath: string) {
  const filePath = await resolveMoeaImportFile(importFolderPath);
  if (!filePath) {
    return { records: [] as ComplianceRecord[], filePath: null };
  }
  const rows = await loadTabularRowsFromFile(filePath);
  return {
    records: buildRecordsFromRows("moea", rows),
    filePath,
  };
}

export type BuildDatasetOptions = {
  importFolderPath: string;
  warnings?: string[];
  onProgress?: (progress: { percent: number; stage: string }) => void;
};

export async function buildDatasetFromImportFolder(
  options: BuildDatasetOptions
): Promise<ComplianceDataset> {
  const warnings = options.warnings ?? [];
  let mol: ComplianceRecord[] = [];
  let pcc: ComplianceRecord[] = [];
  let moea: ComplianceRecord[] = [];
  const importFolderPath = path.resolve(options.importFolderPath);
  options.onProgress?.({ percent: 5, stage: "準備解析匯入檔" });

  const molFile = path.join(importFolderPath, "mol-latest.csv");
  if (await fileExists(molFile)) {
    try {
      const rows = await loadTabularRowsFromFile(molFile);
      mol = buildRecordsFromRows("mol", rows);
      options.onProgress?.({ percent: 55, stage: "已完成 勞動部 資料解析" });
    } catch (error) {
      warnings.push(`勞動部資料更新失敗：${(error as Error).message}`);
    }
  }

  const pccFile = path.join(importFolderPath, "pcc-latest.csv");
  if (await fileExists(pccFile)) {
    try {
      const rows = await loadTabularRowsFromFile(pccFile);
      pcc = buildRecordsFromRows("pcc", rows);
      options.onProgress?.({ percent: 75, stage: "已完成 公共工程委員會 資料解析" });
    } catch (error) {
      warnings.push(`工程會資料更新失敗：${(error as Error).message}`);
    }
  }

  try {
    const loaded = await loadMoeaRecordsFromImportFolder(importFolderPath);
    moea = loaded.records;
    if (loaded.filePath) {
      options.onProgress?.({ percent: 90, stage: "已完成 臺陸資名錄 資料解析" });
    } else {
      const hint = buildMoeaManualDownloadWarning(importFolderPath);
      if (!warnings.includes(hint)) {
        warnings.push(hint);
      }
    }
  } catch (error) {
    warnings.push(`臺陸資名錄資料更新失敗：${(error as Error).message}`);
  }

  const now = new Date();
  const dataset: ComplianceDataset = {
    updatedAt: now.toISOString(),
    nextRefreshAt: new Date(
      now.getTime() + DEFAULT_REFRESH_DAYS * 24 * 60 * 60 * 1000
    ).toISOString(),
    recordCount: {
      mol: mol.length,
      pcc: pcc.length,
      moea: moea.length,
    },
    records: [...mol, ...pcc, ...moea].filter((item) => item.unitName || item.organizationId),
    warnings,
  };
  options.onProgress?.({ percent: 100, stage: "解析完成" });
  return dataset;
}

export async function readDatasetFromFile(cacheFile: string): Promise<ComplianceDataset> {
  try {
    const raw = await fs.readFile(cacheFile, "utf8");
    const parsed = JSON.parse(raw) as ComplianceDataset;
    return {
      ...parsed,
      recordCount: {
        mol: parsed.recordCount?.mol ?? 0,
        pcc: parsed.recordCount?.pcc ?? 0,
        moea: parsed.recordCount?.moea ?? 0,
      },
      warnings: parsed.warnings ?? [],
      records: parsed.records ?? [],
    };
  } catch {
    return emptyDataset();
  }
}

export async function writeDatasetToFile(cacheFile: string, dataset: ComplianceDataset) {
  await fs.mkdir(path.dirname(cacheFile), { recursive: true });
  await fs.writeFile(cacheFile, JSON.stringify(dataset, null, 2), "utf8");
}

export async function readConfigFromFile(configFile: string): Promise<ComplianceConfig> {
  try {
    const raw = await fs.readFile(configFile, "utf8");
    const parsed = JSON.parse(raw) as Partial<ComplianceConfig>;
    return {
      importFolderPath: parsed.importFolderPath?.trim() ?? "",
    };
  } catch {
    return { importFolderPath: "" };
  }
}

export async function writeConfigToFile(configFile: string, config: ComplianceConfig) {
  await fs.mkdir(path.dirname(configFile), { recursive: true });
  await fs.writeFile(configFile, JSON.stringify(config, null, 2), "utf8");
}

export type FetchOutputAnalysis = {
  moeaXlsxOk: boolean;
  moeaUsedCsvFallback: boolean;
  moeaFetchFailed: boolean;
};

export function analyzeFetchOutput(output: string): FetchOutputAnalysis {
  return {
    moeaXlsxOk:
      output.includes("經濟部官網 XLSX 下載完成") || output.includes("[臺陸資名錄] XLSX 下載完成"),
    moeaUsedCsvFallback: output.includes("已改用政府資料開放平臺 CSV 備援"),
    moeaFetchFailed:
      output.includes("[臺陸資名錄] 自動下載失敗") ||
      output.includes("curl 下載 XLSX 失敗") ||
      output.includes("fetch 下載 XLSX 失敗"),
  };
}

export async function appendMoeaFetchWarnings(
  importFolderPath: string,
  output: string,
  warnings: string[]
) {
  const analysis = analyzeFetchOutput(output);
  const hasMoeaXlsx = await fileExists(path.join(importFolderPath, "moea-latest.xlsx"));

  if (!hasMoeaXlsx || analysis.moeaFetchFailed || analysis.moeaUsedCsvFallback) {
    const hint = buildMoeaManualDownloadWarning(importFolderPath);
    if (!warnings.includes(hint)) {
      warnings.push(hint);
    }
    if (analysis.moeaUsedCsvFallback && !analysis.moeaXlsxOk) {
      warnings.push("目前臺陸資名錄暫以舊版開放資料 CSV 備援載入，比對結果可能與官網最新名錄不一致。");
    }
  }
}
