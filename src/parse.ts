import path from "path";
import { parseCsvLine } from "./csv.js";

type XlsxWorkbook = {
  xlsx: { load: (arrayBuffer: ArrayBuffer) => Promise<void> };
  worksheets: Array<{
    eachRow: (
      callback: (row: { values: Array<string | number | Date | undefined> }) => void
    ) => void;
  }>;
};

type XlsxModule = {
  Workbook: new () => XlsxWorkbook;
};

type ZipLoader = {
  loadAsync: (bytes: Buffer) => Promise<{
    files: Record<string, { async: (type: "nodebuffer" | "string") => Promise<Buffer | string> }>;
  }>;
};

async function loadXlsxBytes(bytes: Buffer, ExcelJS: XlsxModule) {
  const workbook = new ExcelJS.Workbook();
  const arrayBuffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer;
  await workbook.xlsx.load(arrayBuffer);
  const firstSheet = workbook.worksheets[0];
  if (!firstSheet) {
    return [];
  }
  const rows: string[][] = [];
  firstSheet.eachRow((row) => {
    const values = row.values;
    const normalized = values
      .slice(1)
      .map((item) => (item === undefined || item === null ? "" : String(item).trim()));
    if (normalized.some(Boolean)) {
      rows.push(normalized);
    }
  });
  return rows;
}

export async function parseTabularRowsFromBytes(
  bytes: Buffer,
  sourceLabel: string
): Promise<string[][]> {
  const extension = path.extname(sourceLabel).toLowerCase();
  const contentType = extension === ".csv" ? "text/csv" : "";
  const headText = bytes.subarray(0, 200).toString("utf8").trim().toLowerCase();
  const looksHtml = headText.startsWith("<!doctype html") || headText.startsWith("<html");
  if (looksHtml) {
    throw new Error(`檔案內容看起來是 HTML：${sourceLabel}`);
  }
  const looksCsv = contentType.includes("csv") || extension === ".csv";
  if (looksCsv) {
    const lines = bytes
      .toString("utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    return lines.map(parseCsvLine);
  }
  const isZipLike = bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;

  let ExcelJS: XlsxModule | null = null;
  let JSZip: ZipLoader | null = null;
  try {
    const excelModule = await import("exceljs");
    ExcelJS = excelModule.default as unknown as XlsxModule;
  } catch {
  }
  try {
    const zipModule = await import("jszip");
    JSZip = zipModule.default as unknown as ZipLoader;
  } catch {
  }

  if (!ExcelJS) {
    throw new Error(
      `不支援的檔案格式（${sourceLabel}）。請安裝 exceljs，或改提供 CSV 檔案。`
    );
  }

  try {
    return await loadXlsxBytes(bytes, ExcelJS);
  } catch (error) {
    if (!isZipLike || !JSZip) {
      throw new Error(
        `不支援的檔案格式（${sourceLabel}）。請提供 CSV 或 XLSX 檔案。`
      );
    }

    try {
      const zip = await JSZip.loadAsync(bytes);
      const fileNames = Object.keys(zip.files);
      const xlsxName = fileNames.find((name) => name.toLowerCase().endsWith(".xlsx"));
      if (xlsxName) {
        const extracted = await zip.files[xlsxName].async("nodebuffer");
        return await loadXlsxBytes(Buffer.from(extracted as Buffer), ExcelJS);
      }
      const csvName = fileNames.find((name) => name.toLowerCase().endsWith(".csv"));
      if (csvName) {
        const extracted = await zip.files[csvName].async("string");
        const lines = String(extracted)
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean);
        return lines.map(parseCsvLine);
      }
      throw new Error(`ZIP 內找不到 .xlsx 或 .csv（共 ${fileNames.length} 個檔案）`);
    } catch (zipError) {
      throw new Error(
        `無法解析檔案（${sourceLabel}）：${
          (zipError as Error).message || (error as Error).message
        }`
      );
    }
  }
}

export async function parseTabularRowsFromText(
  text: string,
  sourceLabel: string
): Promise<string[][]> {
  return parseTabularRowsFromBytes(Buffer.from(text, "utf8"), sourceLabel);
}
