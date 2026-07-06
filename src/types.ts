export type ComplianceSource = "mol" | "pcc" | "moea";

export type ComplianceRecord = {
  source: ComplianceSource;
  unitName: string;
  unitNameNormalized: string;
  organizationId: string;
  announceAt: string;
  publishedAt: string;
  effectiveFrom: string;
  effectiveTo: string;
  penaltyAmount: string;
  lawRef: string;
  lawCategory: string;
  note: string;
};

export type ComplianceDataset = {
  updatedAt: string;
  nextRefreshAt: string;
  recordCount: {
    mol: number;
    pcc: number;
    moea: number;
  };
  records: ComplianceRecord[];
  warnings: string[];
};

export type ComplianceConfig = {
  importFolderPath: string;
};

export type ComplianceMatchType = "exact" | "fuzzy";

export type ComplianceMatchItem = ComplianceRecord & {
  matchType: ComplianceMatchType;
  matchScore: number;
};

export type ComplianceMatchResult = {
  molMatches: ComplianceMatchItem[];
  pccMatches: ComplianceMatchItem[];
  moeaMatches: ComplianceMatchItem[];
  matched: boolean;
};

export type RefreshProgress = {
  percent: number;
  stage: string;
};
