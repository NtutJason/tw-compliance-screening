export const DEFAULT_REFRESH_DAYS = 30;

export const PCC_SOURCE_JSON_URL =
  process.env.PCC_SOURCE_JSON_URL?.trim() ||
  "https://web.pcc.gov.tw/vms/rvlm/rvlmPublicSearch/queryRVFile/json";

export const MOEA_INVESTMENT_LIST_XLSX_URL =
  process.env.MOEA_INVESTMENT_LIST_XLSX_URL?.trim() ||
  "https://www.moea.gov.tw/Mns/dir/content/wHandMenuFile.ashx?menu_id=42805&file_id=35237";

export const MOEA_INVESTMENT_LIST_CSV_FALLBACK_URL =
  process.env.MOEA_INVESTMENT_LIST_CSV_URL?.trim() ||
  "https://quality.data.gov.tw/dq_download_csv.php?nid=18431&md5_url=5274761001e7af5bc6caeb5647734d9f";

export const MOEA_INVESTMENT_LIST_QUERY_URL =
  "https://www.moea.gov.tw/Mns/dir/Investment/InvestmentList.aspx?menu_id=42804";

export const MOL_SOURCES = [
  {
    name: "違反勞動基準法",
    url: "https://apiservice.mol.gov.tw/OdService/download/A17000000J-030225-svj",
    encoding: "utf-8" as const,
    lawCategory: "勞動基準法",
  },
  {
    name: "違反就業服務法",
    url: "https://apiservice.mol.gov.tw/OdService/download/A17000000J-030228-p2G",
    encoding: "utf-8" as const,
    lawCategory: "就業服務法",
  },
  {
    name: "違反性別平等工作法",
    url: "https://apiservice.mol.gov.tw/OdService/download/A17000000J-030226-sop",
    encoding: "utf-8" as const,
    lawCategory: "性別平等工作法",
  },
  {
    name: "違反中高齡者及高齡者就業促進法",
    url: "https://apiservice.mol.gov.tw/OdService/download/A17000000J-030472-56W",
    encoding: "big5" as const,
    lawCategory: "中高齡者及高齡者就業促進法",
  },
  {
    name: "違反勞工退休金條例",
    url: "https://apiservice.mol.gov.tw/OdService/download/A17000000J-030227-POn",
    encoding: "utf-8" as const,
    lawCategory: "勞工退休金條例",
  },
  {
    name: "違反勞工職業災害保險及保護法",
    url: "https://apiservice.mol.gov.tw/OdService/download/A17000000J-030471-WCv",
    encoding: "utf-8" as const,
    lawCategory: "勞工職業災害保險及保護法",
  },
  {
    name: "違反工會法",
    url: "https://apiservice.mol.gov.tw/OdService/download/A17000000J-030542-tEK",
    encoding: "utf-8" as const,
    lawCategory: "工會法",
  },
  {
    name: "違反職業安全衛生法",
    url: "https://apiservice.mol.gov.tw/OdService/download/A17000000J-030466-h0a",
    encoding: "utf-8" as const,
    lawCategory: "職業安全衛生法",
  },
] as const;
