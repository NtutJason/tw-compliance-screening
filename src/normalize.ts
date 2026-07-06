/** 解碼政府開放資料常見的 HTML 字元參照（僅處理合法 Unicode 碼位） */
export const decodeHtmlCharacterReferences = (value: string) =>
  value
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
      const codePoint = Number.parseInt(hex, 16);
      return codePoint > 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : `&#x${hex};`;
    })
    .replace(/&#(\d+);/g, (_, decimal) => {
      const codePoint = Number(decimal);
      return codePoint > 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : `&#${decimal};`;
    })
    .replace(/&(?:amp|lt|gt|quot|apos);/g, (entity) => {
      const map: Record<string, string> = {
        "&amp;": "&",
        "&lt;": "<",
        "&gt;": ">",
        "&quot;": '"',
        "&apos;": "'",
      };
      return map[entity] ?? entity;
    });

/** 匯入欄位常見全形／特殊空白與括號，先統一再 trim */
export const cleanImportText = (value: string | undefined | null) =>
  decodeHtmlCharacterReferences(
    String(value ?? "")
      .replace(/\uFEFF/g, "")
      .replace(/\u3000/g, " ")
      .replace(/[\u00A0\u2000-\u200B\u202F\u205F]/g, " ")
      .replace(/（/g, "(")
      .replace(/）/g, ")")
      .replace(/【/g, "(")
      .replace(/】/g, ")")
      .replace(/［/g, "(")
      .replace(/］/g, ")")
      .trim()
  );

export const normalizeOrganizationId = (value: string | undefined) =>
  cleanImportText(value)
    .replace(/\D/g, "")
    .slice(0, 8);

export const normalizeUnitName = (value: string) =>
  cleanImportText(value)
    .replace(/[（(].*?[)）]/g, "")
    .replace(/\s+/g, "")
    .replace(/臺/g, "台")
    .replace(/股份有限公司|有限公司|有限責任公司|公司|商號|企業社/g, "")
    .toLowerCase();

/** 模糊比對時，較短字串至少需達此長度，避免過度命中 */
export const FUZZY_NAME_MIN_LENGTH = 4;

/**
 * 正規化後名稱的模糊相似度（0～1）。
 * 採雙向包含：任一方包含另一方即視為相似，分數為較短／較長字串長度比。
 */
export const scoreFuzzyNameMatch = (
  queryNormalized: string,
  candidateNormalized: string
): number => {
  if (!queryNormalized || !candidateNormalized) {
    return 0;
  }
  if (queryNormalized === candidateNormalized) {
    return 1;
  }
  const shorter =
    queryNormalized.length <= candidateNormalized.length
      ? queryNormalized
      : candidateNormalized;
  const longer = shorter === queryNormalized ? candidateNormalized : queryNormalized;
  if (shorter.length < FUZZY_NAME_MIN_LENGTH) {
    return 0;
  }
  if (!longer.includes(shorter)) {
    return 0;
  }
  return shorter.length / longer.length;
};

export const parseDateText = (value: string | undefined) =>
  cleanImportText(value);

export const inferLawCategoryFromLawRef = (lawRef: string | undefined) => {
  const value = String(lawRef ?? "").trim();
  if (!value) {
    return "";
  }
  const byDelim = value.split(/[;；]/)[0].trim();
  const match = byDelim.match(/^(.+?法|.+?條例|.+?規則)/);
  return (match?.[1] ?? byDelim).trim();
};
