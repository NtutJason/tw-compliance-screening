import {
  cleanImportText,
  normalizeOrganizationId,
  normalizeUnitName,
  scoreFuzzyNameMatch,
} from "./normalize.js";
import type {
  ComplianceDataset,
  ComplianceMatchItem,
  ComplianceMatchResult,
  ComplianceRecord,
  ComplianceSource,
} from "./types.js";

/** 舊快取可能仍含 HTML 實體；比對時以原始 unitName 重新正規化以相容 */
const getRecordNameNormalized = (record: ComplianceRecord) =>
  record.unitName.includes("&#") || record.unitName.includes("&")
    ? normalizeUnitName(record.unitName)
    : record.unitNameNormalized;

const withDecodedRecord = (record: ComplianceRecord): ComplianceRecord => ({
  ...record,
  unitName: cleanImportText(record.unitName),
  unitNameNormalized: normalizeUnitName(record.unitName),
});

const toExactMatch = (record: ComplianceRecord): ComplianceMatchItem => ({
  ...withDecodedRecord(record),
  matchType: "exact",
  matchScore: 1,
});

const toFuzzyMatch = (
  record: ComplianceRecord,
  score: number
): ComplianceMatchItem => ({
  ...withDecodedRecord(record),
  matchType: "fuzzy",
  matchScore: score,
});

const matchSourceRecords = (
  records: ComplianceRecord[],
  queryName: string,
  queryOrgId: string,
  allowOrgIdExact: boolean
): ComplianceMatchItem[] => {
  if (!queryName && !queryOrgId) {
    return [];
  }

  if (queryName) {
    const exactByName = records.filter((record) => {
      const recordName = getRecordNameNormalized(record);
      return Boolean(recordName) && recordName === queryName;
    });
    if (exactByName.length > 0) {
      return exactByName.map(toExactMatch);
    }
  }

  if (allowOrgIdExact && queryOrgId.length === 8) {
    const exactById = records.filter(
      (record) =>
        Boolean(record.organizationId) && record.organizationId === queryOrgId
    );
    if (exactById.length > 0) {
      return exactById.map(toExactMatch);
    }
  }

  if (!queryName) {
    return [];
  }

  return records
    .map((record) => ({
      record,
      score: scoreFuzzyNameMatch(queryName, getRecordNameNormalized(record)),
    }))
    .filter((item) => item.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.record.unitName.localeCompare(b.record.unitName, "zh-Hant")
    )
    .map((item) => toFuzzyMatch(item.record, item.score));
};

export function matchComplianceRecords(
  dataset: ComplianceDataset,
  input: { organizationName: string }
): ComplianceMatchResult {
  const rawInput = input.organizationName ?? "";
  const queryName = normalizeUnitName(rawInput);
  const queryOrgId = normalizeOrganizationId(rawInput);

  const matchForSource = (source: ComplianceSource) =>
    matchSourceRecords(
      dataset.records.filter((record) => record.source === source),
      queryName,
      queryOrgId,
      source === "moea"
    );

  const molMatches = matchForSource("mol");
  const pccMatches = matchForSource("pcc");
  const moeaMatches = matchForSource("moea");

  return {
    molMatches,
    pccMatches,
    moeaMatches,
    matched:
      molMatches.length > 0 ||
      pccMatches.length > 0 ||
      moeaMatches.length > 0,
  };
}
