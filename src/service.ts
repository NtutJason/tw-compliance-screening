import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execFile } from "child_process";
import { promisify } from "util";
import { DEFAULT_REFRESH_DAYS } from "./constants.js";
import {
  appendMoeaFetchWarnings,
  buildDatasetFromImportFolder,
  readConfigFromFile,
  readDatasetFromFile,
  writeConfigToFile,
  writeDatasetToFile,
} from "./dataset.js";
import { matchComplianceRecords } from "./match.js";
import {
  isImportFolderInsideBase,
  resolveImportFolderPath,
  resolveImportFolderPathSafe,
  toPortableImportFolderPath,
} from "./paths.js";
import type { ComplianceConfig, ComplianceDataset, RefreshProgress } from "./types.js";

const execFileAsync = promisify(execFile);

export type ComplianceScreeningOptions = {
  /** 快取與設定檔目錄（絕對或相對路徑） */
  dataDir: string;
  /**
   * 專案根目錄，用於解析設定檔內的相對匯入路徑。
   * 預設為 dataDir 的上一層；部署時建議明確傳入 process.cwd() 或應用根目錄。
   */
  baseDir?: string;
  /** 預設匯入資料夾（相對 baseDir 或絕對路徑） */
  importFolderPath?: string;
  /** 相對 baseDir 的預設匯入子目錄名稱 */
  defaultImportRelative?: string;
  refreshDays?: number;
  fetchScriptPath?: string;
};

export function createComplianceScreening(options: ComplianceScreeningOptions) {
  const dataDir = path.resolve(options.dataDir);
  const baseDir = path.resolve(options.baseDir ?? path.dirname(dataDir));
  const defaultImportRelative = options.defaultImportRelative ?? "imports";
  const defaultImportFolder = resolveImportFolderPath(
    options.importFolderPath,
    baseDir,
    defaultImportRelative
  );
  const cacheFile = path.join(dataDir, "compliance-screening-cache.json");
  const configFile = path.join(dataDir, "compliance-screening-config.json");
  const refreshDays = options.refreshDays ?? DEFAULT_REFRESH_DAYS;
  const packageRoot = path.dirname(fileURLToPath(import.meta.url));
  const defaultFetchScript = path.join(packageRoot, "..", "scripts", "fetch-compliance-files.mjs");
  const fetchScriptPath = path.resolve(options.fetchScriptPath ?? defaultFetchScript);
  const fetchScriptRelative = path.relative(baseDir, fetchScriptPath);
  if (
    fetchScriptRelative.startsWith("..") ||
    path.isAbsolute(fetchScriptRelative) ||
    !fetchScriptPath.endsWith(`${path.sep}fetch-compliance-files.mjs`)
  ) {
    throw new Error("fetchScriptPath 必須位於 baseDir 內的 scripts/fetch-compliance-files.mjs");
  }

  const resolveImportFolder = async () => {
    const envPath = process.env.COMPLIANCE_IMPORT_FOLDER?.trim();
    if (envPath) {
      return path.resolve(envPath);
    }
    const config = await readConfigFromFile(configFile);
    if (config.importFolderPath) {
      return resolveImportFolderPathSafe(
        config.importFolderPath,
        baseDir,
        defaultImportRelative
      );
    }
    return defaultImportFolder;
  };

  const resolveImportFolderForWrite = async (input?: string) => {
    const envPath = process.env.COMPLIANCE_IMPORT_FOLDER?.trim();
    if (envPath) {
      return path.resolve(envPath);
    }
    if (input?.trim()) {
      const rawResolved = resolveImportFolderPath(
        input.trim(),
        baseDir,
        defaultImportRelative
      );
      if (!isImportFolderInsideBase(rawResolved, baseDir)) {
        throw new Error("匯入資料夾必須位於專案根目錄內");
      }
    }
    const resolved = resolveImportFolderPathSafe(
      input?.trim() ?? (await readConfigFromFile(configFile)).importFolderPath,
      baseDir,
      defaultImportRelative
    );
    if (!isImportFolderInsideBase(resolved, baseDir)) {
      throw new Error("匯入資料夾必須位於專案根目錄內");
    }
    return resolved;
  };

  const persistImportFolderConfig = async (absoluteImportFolder: string) => {
    await writeConfigToFile(configFile, {
      importFolderPath: toPortableImportFolderPath(absoluteImportFolder, baseDir),
    });
  };

  return {
    paths: { dataDir, baseDir, cacheFile, configFile, defaultImportFolder },

    async readConfig(): Promise<ComplianceConfig> {
      const importFolderPath = await resolveImportFolder();
      return { importFolderPath };
    },

    async saveConfig(config: ComplianceConfig) {
      const absolute = await resolveImportFolderForWrite(config.importFolderPath);
      await persistImportFolderConfig(absolute);
    },

    async readDataset(): Promise<ComplianceDataset> {
      return readDatasetFromFile(cacheFile);
    },

    async fetchImports(importFolderPath?: string) {
      const folderPath = importFolderPath
        ? await resolveImportFolderForWrite(importFolderPath)
        : await resolveImportFolder();
      await fs.mkdir(folderPath, { recursive: true });
      const warnings: string[] = [];
      let output = "";
      try {
        const result = await execFileAsync("node", [fetchScriptPath], {
          cwd: baseDir,
          env: {
            ...process.env,
            COMPLIANCE_IMPORT_FOLDER: folderPath,
          },
          maxBuffer: 20 * 1024 * 1024,
        });
        output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
      } catch (error) {
        const err = error as Error & { stderr?: string; stdout?: string };
        output = `${err.stdout ?? ""}\n${err.stderr ?? ""}\n${err.message}`;
        warnings.push(`自動抓取失敗：${err.stderr || err.stdout || err.message}`);
      }
      await appendMoeaFetchWarnings(folderPath, output, warnings);
      return { warnings, output };
    },

    async refresh(
      config?: Partial<ComplianceConfig>,
      onProgress?: (progress: RefreshProgress) => void
    ): Promise<ComplianceDataset> {
      const importFolderPath = await resolveImportFolderForWrite(
        config?.importFolderPath?.trim() ?? (await readConfigFromFile(configFile)).importFolderPath
      );
      await persistImportFolderConfig(importFolderPath);
      const warnings: string[] = [];

      onProgress?.({ percent: 5, stage: "準備更新環境" });
      try {
        await fs.mkdir(importFolderPath, { recursive: true });
        onProgress?.({ percent: 20, stage: "抓取 MOL / PCC / 臺陸資名錄 最新資料" });
        const fetchResult = await this.fetchImports(importFolderPath);
        warnings.push(...fetchResult.warnings);
      } catch (error) {
        warnings.push(`無法建立資料夾：${(error as Error).message}`);
      }

      const dataset = await buildDatasetFromImportFolder({
        importFolderPath,
        warnings,
        onProgress,
      });

      const now = new Date();
      const finalDataset: ComplianceDataset = {
        ...dataset,
        updatedAt: now.toISOString(),
        nextRefreshAt: new Date(
          now.getTime() + refreshDays * 24 * 60 * 60 * 1000
        ).toISOString(),
      };

      onProgress?.({ percent: 95, stage: "寫入快取資料" });
      await writeDatasetToFile(cacheFile, finalDataset);
      onProgress?.({ percent: 100, stage: "更新完成" });
      return finalDataset;
    },

    async ensureFreshDataset(): Promise<ComplianceDataset> {
      const current = await this.readDataset();
      const shouldRefresh = Date.now() >= new Date(current.nextRefreshAt).getTime();
      if (!shouldRefresh) {
        return current;
      }
      return this.refresh();
    },

    query(dataset: ComplianceDataset, organizationName: string) {
      return matchComplianceRecords(dataset, { organizationName });
    },

    matchComplianceRecords,
  };
}
