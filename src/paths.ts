import path from "path";

/** 將設定檔內路徑（可為相對）解析為絕對路徑 */
export function resolveImportFolderPath(
  input: string | undefined,
  baseDir: string,
  fallbackRelative = "imports"
): string {
  const resolvedBase = path.resolve(baseDir);
  const fallback = path.join(resolvedBase, fallbackRelative);
  if (!input?.trim()) {
    return fallback;
  }
  const normalized = input.trim().replace(/\//g, path.sep);
  const resolved = path.isAbsolute(normalized)
    ? path.normalize(normalized)
    : path.resolve(resolvedBase, normalized);
  return resolved;
}

/** 匯入資料夾是否位於 baseDir 內（防止路徑穿越寫入任意目錄） */
export function isImportFolderInsideBase(importFolderPath: string, baseDir: string): boolean {
  const resolvedBase = path.resolve(baseDir);
  const resolvedPath = path.resolve(importFolderPath);
  const relative = path.relative(resolvedBase, resolvedPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/** 解析並驗證匯入路徑必須在 baseDir 內；否則回傳 fallback */
export function resolveImportFolderPathSafe(
  input: string | undefined,
  baseDir: string,
  fallbackRelative = "imports"
): string {
  const resolved = resolveImportFolderPath(input, baseDir, fallbackRelative);
  if (!isImportFolderInsideBase(resolved, baseDir)) {
    return resolveImportFolderPath(undefined, baseDir, fallbackRelative);
  }
  return resolved;
}

/** 若路徑在 baseDir 底下，存成相對路徑（POSIX `/`）以利跨機器部署 */
export function toPortableImportFolderPath(absolutePath: string, baseDir: string): string {
  const resolvedBase = path.resolve(baseDir);
  const resolvedPath = path.resolve(absolutePath);
  const relative = path.relative(resolvedBase, resolvedPath);
  if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) {
    return relative.split(path.sep).join("/");
  }
  return resolvedPath;
}

export function joinImportFile(importFolderPath: string, fileName: string): string {
  const safeName = path.basename(fileName);
  return path.join(importFolderPath, safeName);
}

/** 靜態檔案路徑解析，防止目錄穿越 */
export function resolveStaticFilePath(rootDir: string, requestPath: string): string | null {
  const decoded = decodeURIComponent(requestPath.replace(/^\/+/, ""));
  if (!decoded || decoded.includes("\0")) {
    return null;
  }
  const root = path.resolve(rootDir);
  const candidate = path.resolve(root, decoded);
  if (candidate !== root && !candidate.startsWith(root + path.sep)) {
    return null;
  }
  return candidate;
}
