import type { ComplianceSource } from "./types.js";
import { cleanImportText } from "./normalize.js";

const SOURCE_LABELS: Record<ComplianceSource, string> = {
  mol: "勞動部",
  pcc: "公共工程委員會",
  moea: "經濟部",
};

const GITHUB_ISSUE_HINT = "請檢查欄位或至 GitHub 提交 Issue。";

export class SchemaValidationError extends Error {
  readonly source: ComplianceSource;

  constructor(source: ComplianceSource, detail?: string) {
    const label = SOURCE_LABELS[source];
    const suffix = detail ? `（${detail}）` : "";
    super(
      `[Validation Error] ${label}表格結構已變更${suffix}，${GITHUB_ISSUE_HINT}`
    );
    this.name = "SchemaValidationError";
    this.source = source;
  }
}

export const normalizeHeaderForMatch = (header: string) =>
  cleanImportText(header).replace(/\s+/g, "");

const headerIncludesAny = (headers: string[], keywords: string[]) =>
  headers.some((header) =>
    keywords.some((keyword) =>
      normalizeHeaderForMatch(header).includes(keyword)
    )
  );

export const pickColumnIndex = (headers: string[], aliases: string[]) =>
  headers.findIndex((header) =>
    aliases.some((alias) => normalizeHeaderForMatch(header).includes(alias))
  );

const findMoeaHeaderRowIndex = (rows: string[][]) => {
  for (let index = 0; index < Math.min(rows.length, 12); index += 1) {
    const headers = rows[index].map((cell) => cleanImportText(cell));
    const hasName = headerIncludesAny(headers, [
      "國內被投資事業名稱",
      "被投資事業名稱",
    ]);
    const hasId = headerIncludesAny(headers, ["統一編號", "統編"]);
    const hasInvestmentType = headerIncludesAny(headers, ["投資型態"]);
    if (hasName || (hasId && hasInvestmentType) || hasId) {
      return index;
    }
  }
  return -1;
};

type SchemaRule = {
  /** 每組至少需命中一個關鍵字 */
  requiredGroups: string[][];
  /** 用於錯誤訊息 */
  missingHint: string;
};

const SCHEMA_RULES: Record<ComplianceSource, SchemaRule> = {
  mol: {
    requiredGroups: [
      ["事業單位名稱或負責人", "事業單位", "廠商名稱"],
      ["法令類別", "法令"],
    ],
    missingHint: "缺少「事業單位名稱或負責人」或「法令類別」等欄位",
  },
  pcc: {
    requiredGroups: [
      ["事業單位名稱或負責人", "事業單位", "廠商名稱", "Corporation_Name"],
      ["法令類別", "拒絕往來", "違反法規"],
    ],
    missingHint: "缺少「事業單位名稱或負責人」或「法令類別／拒絕往來」等欄位",
  },
  moea: {
    requiredGroups: [
      ["國內被投資事業名稱", "被投資事業名稱", "統一編號", "統編"],
    ],
    missingHint: "缺少「國內被投資事業名稱」或「統一編號」等欄位",
  },
};

export type ValidatedTabularSchema = {
  headerRowIndex: number;
  headers: string[];
  dataRows: string[][];
};

const validateHeaderGroups = (
  source: ComplianceSource,
  headers: string[]
): void => {
  const rule = SCHEMA_RULES[source];
  const missingGroups = rule.requiredGroups.filter(
    (group) => !headerIncludesAny(headers, group)
  );
  if (missingGroups.length > 0) {
    throw new SchemaValidationError(source, rule.missingHint);
  }

  if (source === "moea") {
    const nameIndex = pickColumnIndex(headers, [
      "國內被投資事業名稱",
      "被投資事業名稱",
    ]);
    const idIndex = pickColumnIndex(headers, ["統一編號", "統編"]);
    if (nameIndex < 0 && idIndex < 0) {
      throw new SchemaValidationError(source, rule.missingHint);
    }
  } else {
    const nameIndex = pickColumnIndex(headers, rule.requiredGroups[0]);
    if (nameIndex < 0) {
      throw new SchemaValidationError(source, rule.missingHint);
    }
  }
};

/**
 * 在解析資料列之前驗證表頭結構；不符時拋出 SchemaValidationError。
 */
export function validateTabularSchema(
  source: ComplianceSource,
  rows: string[][]
): ValidatedTabularSchema {
  if (rows.length === 0) {
    return { headerRowIndex: 0, headers: [], dataRows: [] };
  }

  const headerRowIndex =
    source === "moea" ? findMoeaHeaderRowIndex(rows) : 0;

  if (headerRowIndex < 0) {
    throw new SchemaValidationError(
      source,
      SCHEMA_RULES[source].missingHint
    );
  }

  const dataRows = rows.slice(headerRowIndex);
  if (dataRows.length <= 1) {
    return {
      headerRowIndex,
      headers: dataRows[0]?.map((cell) => cleanImportText(cell)) ?? [],
      dataRows,
    };
  }

  const headers = dataRows[0].map((cell) => cleanImportText(cell));
  validateHeaderGroups(source, headers);

  return { headerRowIndex, headers, dataRows };
};
