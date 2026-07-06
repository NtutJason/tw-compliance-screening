import type { ComplianceRecord, ComplianceSource } from "./types.js";
import {
  cleanImportText,
  inferLawCategoryFromLawRef,
  normalizeOrganizationId,
  normalizeUnitName,
  parseDateText,
} from "./normalize.js";
import { pickColumnIndex, validateTabularSchema } from "./schema.js";

export function buildRecordsFromRows(
  source: ComplianceSource,
  rows: string[][]
): ComplianceRecord[] {
  const { dataRows, headers } = validateTabularSchema(source, rows);
  if (dataRows.length <= 1) {
    return [];
  }

  const nameIndex = pickColumnIndex(
    headers,
    source === "moea"
      ? ["國內被投資事業名稱", "被投資事業名稱"]
      : [
          "國內被投資事業名稱",
          "被投資事業名稱",
          "事業單位名稱或負責人",
          "事業單位",
          "廠商名稱",
          "名稱",
          "公司",
        ]
  );
  const idIndex = pickColumnIndex(headers, ["統一編號", "廠商代碼", "統編"]);
  const penaltyDateIndex = pickColumnIndex(headers, ["處分日期"]);
  const announceDateIndex = pickColumnIndex(headers, [
    "核准月年",
    "核准年月",
    "公告日期",
    "刊登日期",
  ]);
  const lawRefIndex = pickColumnIndex(headers, [
    "違法法規",
    "法規",
    "法條",
    "投資型態",
  ]);
  const lawCategoryIndex = pickColumnIndex(headers, ["法令類別", "法令"]);
  const effectiveFromIndex = pickColumnIndex(headers, [
    "拒絕往來生效日",
    "生效日",
    "生效日期",
  ]);
  const effectiveToIndex = pickColumnIndex(headers, [
    "拒絕往來截止日",
    "截止日",
    "截止日期",
    "到期日",
  ]);
  const penaltyIndex = pickColumnIndex(headers, [
    "投資金額",
    "罰鍰",
    "處分金額",
    "滯納金",
    "新台幣",
    "（新台幣）",
  ]);
  const noteIndex = pickColumnIndex(headers, ["備註", "違反法規內容", "說明"]);
  const investorIndex = pickColumnIndex(headers, [
    "陸資投資人名稱",
    "投資人名稱",
  ]);
  const industryIndex = pickColumnIndex(headers, ["行業分類"]);
  const addressIndex = pickColumnIndex(headers, [
    "國內被投資事業地址",
    "國內被投資事業登記地址",
    "登記地址",
    "地址",
  ]);
  const safeCell = (row: string[], index: number) =>
    index >= 0 ? cleanImportText(row[index]) : "";

  return dataRows.slice(1).map((row) => {
    const unitName = safeCell(row, nameIndex);
    const lawRef = safeCell(row, lawRefIndex);
    const lawCategoryRaw = safeCell(row, lawCategoryIndex);
    const investorName = safeCell(row, investorIndex);
    const industry = safeCell(row, industryIndex);
    const address = safeCell(row, addressIndex);
    const noteParts = [
      safeCell(row, noteIndex),
      industry,
      investorName ? `投資人：${investorName}` : "",
      address,
    ].filter(Boolean);
    return {
      source,
      unitName,
      unitNameNormalized: normalizeUnitName(unitName),
      organizationId: normalizeOrganizationId(safeCell(row, idIndex)),
      announceAt: parseDateText(safeCell(row, announceDateIndex)),
      publishedAt: parseDateText(
        source === "moea"
          ? safeCell(row, announceDateIndex)
          : penaltyDateIndex >= 0
            ? safeCell(row, penaltyDateIndex)
            : safeCell(row, announceDateIndex)
      ),
      effectiveFrom: parseDateText(safeCell(row, effectiveFromIndex)),
      effectiveTo: parseDateText(safeCell(row, effectiveToIndex)),
      penaltyAmount: safeCell(row, penaltyIndex),
      lawRef,
      lawCategory:
        source === "moea"
          ? lawCategoryRaw || "臺陸資名錄"
          : lawCategoryRaw || inferLawCategoryFromLawRef(lawRef),
      note: noteParts.join("；"),
    };
  });
}
