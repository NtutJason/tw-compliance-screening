import { promises as fs } from "fs";

const ds = JSON.parse(
  await fs.readFile("./data/compliance-screening-cache.json", "utf8")
);
const textFields = [
  "unitName",
  "lawRef",
  "lawCategory",
  "note",
  "penaltyAmount",
  "announceAt",
  "publishedAt",
  "effectiveFrom",
  "effectiveTo",
];

const patterns = [
  ["html_decimal", /&#\d+;/g],
  ["html_hex", /&#x[0-9a-fA-F]+;/g],
  ["html_named", /&(?:amp|lt|gt|quot|apos);/g],
  ["replacement_char", /\uFFFD/g],
  ["private_use", /[\uE000-\uF8FF]/g],
  ["question_marks", /\?{2,}/g],
  ["lone_surrogate", /[\uD800-\uDFFF]/g],
];

const stats = Object.fromEntries(
  patterns.map(([key]) => [key, { records: 0, samples: [] }])
);

for (const record of ds.records) {
  const blob = textFields.map((field) => record[field] || "").join("\n");
  for (const [key, pattern] of patterns) {
    pattern.lastIndex = 0;
    if (!pattern.test(blob)) {
      continue;
    }
    stats[key].records += 1;
    if (stats[key].samples.length >= 8) {
      continue;
    }
    for (const field of textFields) {
      const value = record[field] || "";
      pattern.lastIndex = 0;
      if (pattern.test(value)) {
        stats[key].samples.push({
          field,
          source: record.source,
          value: value.slice(0, 120),
        });
        break;
      }
    }
  }
}

console.log("=== 亂碼型態統計（全庫）===");
for (const [key, value] of Object.entries(stats)) {
  console.log(`${key}: ${value.records}`);
  for (const sample of value.samples.slice(0, 3)) {
    console.log(`  ${sample.source}.${sample.field}: ${JSON.stringify(sample.value)}`);
  }
}

const invalidEntities = new Set();
for (const record of ds.records) {
  for (const match of (record.unitName || "").matchAll(/&#(\d+);/g)) {
    if (Number(match[1]) > 0x10ffff) {
      invalidEntities.add(record.unitName);
    }
  }
}
console.log("\n無效 html_decimal:", invalidEntities.size);
for (const name of [...invalidEntities].slice(0, 5)) {
  console.log(`  ${name}`);
}

const molOnly = {};
for (const [key, pattern] of patterns) {
  let count = 0;
  for (const record of ds.records) {
    if (record.source !== "mol") {
      continue;
    }
    const blob = textFields.map((field) => record[field] || "").join("");
    pattern.lastIndex = 0;
    if (pattern.test(blob)) {
      count += 1;
    }
  }
  molOnly[key] = count;
}
console.log("\n=== MOL 子集 ===");
console.log(molOnly);
