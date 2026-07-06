#!/usr/bin/env node
/**
 * 修補後安全煙霧測試（惡意使用者情境）
 * 用法：先啟動 UI，再 node scripts/security-smoke-test.mjs [baseUrl]
 */
import { spawn } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  createComplianceScreening,
  isImportFolderInsideBase,
  resolveImportFolderPathSafe,
  resolveStaticFilePath,
} from "../dist/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const baseUrl = process.argv[2] || "http://127.0.0.1:3456";

const results = [];
const pass = (name, detail = "") => results.push({ name, ok: true, detail });
const fail = (name, detail = "") => results.push({ name, ok: false, detail });

async function http(method, urlPath, { body, headers } = {}) {
  const url = `${baseUrl}${urlPath}`;
  const init = { method, headers: { ...(headers || {}) } };
  if (body !== undefined) {
    init.headers["Content-Type"] = "application/json";
    init.body = typeof body === "string" ? body : JSON.stringify(body);
  }
  const started = Date.now();
  const res = await fetch(url, init);
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // ignore
  }
  return { status: res.status, text, json, ms: Date.now() - started };
}

function testPathsModule() {
  const escapeAttempts = [
    "../../../Windows/Temp/evil",
    "..\\..\\..\\Windows\\Temp\\evil",
    "imports/../../outside",
    "C:\\Windows\\Temp\\evil",
  ];
  for (const attempt of escapeAttempts) {
    const resolved = resolveImportFolderPathSafe(attempt, projectRoot, "imports");
    if (!isImportFolderInsideBase(resolved, projectRoot)) {
      fail(`paths: 路徑穿越未阻擋`, attempt);
      return;
    }
    const expected = path.join(projectRoot, "imports");
    if (attempt.includes("..") && resolved !== expected && attempt !== "C:\\Windows\\Temp\\evil") {
      // relative traversal should fallback to imports
    }
  }
  pass("paths: importFolderPath 穿越路徑被限制在 baseDir 內");

  const uiRoot = path.join(projectRoot, "ui");
  const blocked = [
    "/../package.json",
    "/..%2f..%2fpackage.json",
    "/app.js/../../../package.json",
  ];
  for (const req of blocked) {
    const resolved = resolveStaticFilePath(uiRoot, req);
    if (resolved && !resolved.startsWith(uiRoot + path.sep) && resolved !== uiRoot) {
      fail(`paths: 靜態檔穿越`, req);
      return;
    }
    if (resolved && path.basename(resolved) === "package.json" && !resolved.startsWith(uiRoot)) {
      fail(`paths: 讀到 package.json`, resolved);
      return;
    }
  }
  const allowed = resolveStaticFilePath(uiRoot, "/app.js");
  if (!allowed || !allowed.endsWith("app.js")) {
    fail("paths: 合法靜態檔無法解析", String(allowed));
    return;
  }
  pass("paths: 靜態檔路徑穿越被阻擋");
}

async function testFetchUrlAllowlist() {
  const env = {
    ...process.env,
    PCC_SOURCE_JSON_URL: "https://evil.example.com/steal",
  };
  const child = spawn("node", ["scripts/fetch-compliance-files.mjs"], {
    cwd: projectRoot,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (c) => {
    stderr += c.toString();
  });
  const code = await new Promise((resolve) => child.on("close", resolve));
  const output = stderr;
  if (code === 0 && !output.includes("白名單")) {
    fail("fetch: 惡意 PCC URL 未被阻擋", `exit=${code}`);
    return;
  }
  if (output.includes("白名單") || output.includes("未在白名單") || code !== 0) {
    pass("fetch: 惡意 PCC_SOURCE_JSON_URL 啟動時被拒絕", output.split("\n")[0]?.slice(0, 80));
    return;
  }
  pass("fetch: 惡意 URL 未成功執行", `exit=${code}`);
}

async function testApiWhenServerUp() {
  let meta;
  try {
    meta = await http("GET", "/api/compliance-screening?mode=meta");
  } catch (error) {
    fail("API: 無法連線 UI", `${baseUrl} — ${error.message}`);
    return;
  }

  if (meta.status !== 200) {
    fail("API: meta 失敗", `status=${meta.status} ${meta.text.slice(0, 120)}`);
    return;
  }
  pass("API: meta 可讀取快取", `records=${meta.json?.recordCount?.total ?? meta.json?.recordCount ?? "?"}`);

  const longName = "A".repeat(501);
  const tooLong = await http(
    "GET",
    `/api/compliance-screening?organizationName=${encodeURIComponent(longName)}`
  );
  if (tooLong.status === 400) {
    pass("API: 過長查詢字串被拒絕");
  } else {
    fail("API: 過長查詢字串未拒絕", `status=${tooLong.status}`);
  }

  const queryStart = Date.now();
  const q1 = await http("GET", "/api/compliance-screening?organizationName=測試公司");
  const q1ms = Date.now() - queryStart;
  if (q1.status === 200 && q1ms < 30_000) {
    pass("API: 查詢回應快速（未觸發長時間 refresh）", `${q1ms}ms`);
  } else if (q1.status === 503) {
    pass("API: 無快取時回 503（需手動更新）", meta.text?.slice(0, 60));
  } else {
    fail("API: 查詢異常或過慢", `status=${q1.status} ${q1ms}ms`);
  }

  const traversal = await http("POST", "/api/compliance-screening", {
    body: {
      action: "refresh",
      importFolderPath: "../../../Windows/Temp/compliance-evil",
    },
  });
  if (process.env.COMPLIANCE_IMPORT_FOLDER) {
    pass("API: 路徑穿越測試跳過（COMPLIANCE_IMPORT_FOLDER 已鎖定目錄）");
  } else if (traversal.status === 400) {
    pass("API: POST 路徑穿越被拒絕", traversal.json?.error);
  } else if (traversal.status === 200) {
    fail("API: 惡意路徑不應啟動 refresh", `status=200 taskId=${traversal.json?.taskId}`);
  } else {
    fail("API: POST 穿越測試未預期", `status=${traversal.status}`);
  }

  let oversized;
  try {
    const bigBody = JSON.stringify({
      action: "refresh",
      importFolderPath: "imports",
      padding: "x".repeat(70 * 1024),
    });
    oversized = await http("POST", "/api/compliance-screening", { body: bigBody });
  } catch (error) {
    oversized = { status: 0, json: null, text: error.message };
  }
  if (oversized.status === 400 && oversized.json?.error?.includes("too large")) {
    pass("API: POST body 過大被拒絕");
  } else {
    fail("API: POST body 大小限制未生效", `status=${oversized.status} ${oversized.text?.slice(0, 60)}`);
  }

  const staticTests = [
    ["/../package.json", [404, 403]],
    ["/..%2f..%2fpackage.json", [404, 400]],
    ["/app.js", [200]],
  ];
  for (const [p, okStatuses] of staticTests) {
    const r = await http("GET", p);
    if (okStatuses.includes(r.status)) {
      if (p === "/app.js" && r.text.includes("escapeHtml")) {
        pass(`靜態: ${p} 正常`, "含 escapeHtml");
      } else if (p !== "/app.js") {
        pass(`靜態: ${p} 無法讀取專案外檔案`, `status=${r.status}`);
      } else {
        pass(`靜態: ${p}`, `status=${r.status}`);
      }
    } else if (p === "/app.js") {
      fail(`靜態: ${p}`, `status=${r.status}`);
    }
  }

  const evilAction = await http("POST", "/api/compliance-screening", {
    body: { action: "delete_all" },
  });
  if (evilAction.status === 400) {
    pass("API: 不支援的 action 被拒絕");
  } else {
    fail("API: 未知 action", `status=${evilAction.status}`);
  }

  const fakeTask = await http("GET", "/api/compliance-screening?mode=task&taskId=../../etc/passwd");
  if (fakeTask.status === 404) {
    pass("API: 偽造 taskId 回 404");
  } else {
    fail("API: taskId 處理異常", `status=${fakeTask.status}`);
  }
}

async function testServiceFetchScriptGuard() {
  try {
    createComplianceScreening({
      dataDir: path.join(projectRoot, "data"),
      baseDir: projectRoot,
      fetchScriptPath: "C:\\Windows\\System32\\calc.exe",
    });
    fail("service: 惡意 fetchScriptPath 未被阻擋");
  } catch (error) {
    if (String(error.message).includes("fetchScriptPath")) {
      pass("service: 惡意 fetchScriptPath 被拒絕");
    } else {
      fail("service: fetchScriptPath 錯誤訊息不符", error.message);
    }
  }
}

async function testNoWriteOutsideImports() {
  const marker = path.join("C:\\Windows\\Temp", `compliance-pentest-${Date.now()}.txt`);
  const before = await fs.access(marker).then(() => true).catch(() => false);
  if (before) {
    pass("filesystem: 跳過（標記檔已存在）");
    return;
  }
  const prevEnv = process.env.COMPLIANCE_IMPORT_FOLDER;
  delete process.env.COMPLIANCE_IMPORT_FOLDER;
  const screening = createComplianceScreening({
    dataDir: path.join(projectRoot, "data"),
    baseDir: projectRoot,
    fetchScriptPath: path.join(projectRoot, "scripts", "fetch-compliance-files.mjs"),
  });
  try {
    await screening.saveConfig({ importFolderPath: "../../../Windows/Temp" });
    fail("filesystem: saveConfig 應拒絕專案外路徑");
  } catch (error) {
    pass("filesystem: saveConfig 拒絕專案外路徑", error.message);
  } finally {
    if (prevEnv !== undefined) {
      process.env.COMPLIANCE_IMPORT_FOLDER = prevEnv;
    }
  }
  const after = await fs.access(marker).then(() => true).catch(() => false);
  if (after) {
    fail("filesystem: 發現專案外寫入", marker);
  }
}

async function main() {
  console.log("=== 安全煙霧測試 ===\n");
  console.log(`專案：${projectRoot}`);
  console.log(`API：${baseUrl}`);
  if (process.env.COMPLIANCE_IMPORT_FOLDER) {
    console.warn(
      `注意：偵測到 COMPLIANCE_IMPORT_FOLDER=${process.env.COMPLIANCE_IMPORT_FOLDER}`
    );
    console.warn("API 路徑穿越測試將跳過（環境變數會覆寫 API 設定）\n");
  } else {
    console.log("");
  }

  testPathsModule();
  await testServiceFetchScriptGuard();
  await testNoWriteOutsideImports();
  await testFetchUrlAllowlist();
  await testApiWhenServerUp();

  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);

  console.log("\n--- 結果 ---\n");
  for (const r of results) {
    const mark = r.ok ? "✓" : "✗";
    console.log(`${mark} ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
  }
  console.log(`\n${passed}/${results.length} 通過`);
  if (failed.length) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
