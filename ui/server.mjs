#!/usr/bin/env node
import { createServer } from "http";
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  createComplianceScreening,
  resolveImportFolderPathSafe,
  resolveStaticFilePath,
} from "../dist/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const uiRoot = __dirname;
const port = Number(process.env.UI_PORT || 3456);
const host = process.env.UI_HOST?.trim() || "127.0.0.1";
const MAX_BODY_BYTES = 64 * 1024;

const screening = createComplianceScreening({
  dataDir: path.join(projectRoot, "data"),
  baseDir: projectRoot,
  importFolderPath: "imports",
  defaultImportRelative: "imports",
  fetchScriptPath: path.join(projectRoot, "scripts", "fetch-compliance-files.mjs"),
});

const refreshTasks = new Map();

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".ico": "image/x-icon",
};

const json = (res, status, body) => {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
};

const readBody = (req) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let tooLarge = false;
    req.on("data", (chunk) => {
      if (tooLarge) return;
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        tooLarge = true;
        reject(new Error("request body too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!tooLarge) {
        resolve(Buffer.concat(chunks).toString("utf8"));
      }
    });
    req.on("error", reject);
  });

async function handleApi(req, res, url) {
  if (req.method === "GET") {
    const mode = url.searchParams.get("mode")?.trim() ?? "query";
    const taskId = url.searchParams.get("taskId")?.trim() ?? "";

    if (mode === "task") {
      const task = refreshTasks.get(taskId);
      if (!task) {
        return json(res, 404, { error: "task not found" });
      }
      return json(res, 200, task);
    }

    let dataset;
    try {
      dataset = await screening.readDataset();
    } catch {
      return json(res, 503, { error: "快取尚未建立，請先執行更新資料" });
    }

    if (mode === "meta") {
      const config = await screening.readConfig();
      return json(res, 200, {
        updatedAt: dataset.updatedAt,
        nextRefreshAt: dataset.nextRefreshAt,
        recordCount: dataset.recordCount,
        warnings: dataset.warnings,
        config,
      });
    }

    const organizationName = url.searchParams.get("organizationName")?.trim() ?? "";
    if (!organizationName) {
      return json(res, 400, { error: "organizationName required" });
    }
    if (organizationName.length > 500) {
      return json(res, 400, { error: "organizationName too long" });
    }

    const result = screening.query(dataset, organizationName);
    return json(res, 200, {
      query: { organizationName },
      updatedAt: dataset.updatedAt,
      nextRefreshAt: dataset.nextRefreshAt,
      warnings: dataset.warnings,
      recordCount: dataset.recordCount,
      ...result,
    });
  }

  if (req.method === "POST") {
    let body = {};
    try {
      body = JSON.parse(await readBody(req));
    } catch (error) {
      const message = error.message === "request body too large" ? error.message : "invalid json";
      return json(res, 400, { error: message });
    }

    if (body.action !== "refresh") {
      return json(res, 400, { error: "unsupported action" });
    }

    const currentConfig = await screening.readConfig();
    const nextConfig = {
      importFolderPath:
        body.importFolderPath?.trim() || currentConfig.importFolderPath,
    };
    try {
      await screening.saveConfig(nextConfig);
    } catch (error) {
      return json(res, 400, { error: error.message || "invalid import folder" });
    }

    const taskId = crypto.randomUUID();
    refreshTasks.set(taskId, {
      taskId,
      status: "running",
      percent: 0,
      stage: "建立更新任務",
    });

    void (async () => {
      try {
        await screening.refresh(nextConfig, (progress) => {
          const current = refreshTasks.get(taskId);
          if (!current) return;
          refreshTasks.set(taskId, {
            ...current,
            percent: progress.percent,
            stage: progress.stage,
          });
        });
        refreshTasks.set(taskId, {
          taskId,
          status: "done",
          percent: 100,
          stage: "更新完成",
        });
      } catch (error) {
        refreshTasks.set(taskId, {
          taskId,
          status: "error",
          percent: 100,
          stage: "更新失敗",
          error: error.message,
        });
      }
    })();

    return json(res, 200, {
      taskId,
      message: "更新任務已啟動",
      config: nextConfig,
    });
  }

  return json(res, 405, { error: "method not allowed" });
}

async function serveStatic(res, filePath) {
  try {
    const content = await fs.readFile(filePath);
    const ext = path.extname(filePath);
    res.writeHead(200, { "Content-Type": mimeTypes[ext] || "application/octet-stream" });
    res.end(content);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not Found");
  }
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    if (url.pathname === "/api/compliance-screening") {
      return handleApi(req, res, url);
    }

    if (url.pathname === "/" || url.pathname === "/index.html") {
      return serveStatic(res, path.join(uiRoot, "index.html"));
    }

    const staticFile = resolveStaticFilePath(uiRoot, url.pathname);
    if (staticFile && (await fs.stat(staticFile).catch(() => null))?.isFile()) {
      return serveStatic(res, staticFile);
    }

    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not Found");
  } catch (error) {
    json(res, 500, { error: error.message || "internal error" });
  }
});

await fs.mkdir(path.join(projectRoot, "data"), { recursive: true });
await fs.mkdir(path.join(projectRoot, "imports"), { recursive: true });

const config = await screening.readConfig();
const resolvedImports = resolveImportFolderPathSafe(
  config.importFolderPath,
  projectRoot,
  "imports"
);
const importPathValid = await fs.access(resolvedImports).then(() => true).catch(() => false);
if (!importPathValid) {
  await screening.saveConfig({ importFolderPath: "imports" });
}

// 若使用者曾用 CLI 產生根目錄 cache.json，首次啟動 UI 時沿用
const rootCache = path.join(projectRoot, "cache.json");
const dataCache = path.join(projectRoot, "data", "compliance-screening-cache.json");
const dataCacheExists = await fs.access(dataCache).then(() => true).catch(() => false);
const rootCacheExists = await fs.access(rootCache).then(() => true).catch(() => false);
if (!dataCacheExists && rootCacheExists) {
  await fs.copyFile(rootCache, dataCache);
}

let currentPort = port;
const startServer = (listenPort) => {
  currentPort = listenPort;
  server.listen(listenPort, host, () => {
    const url = `http://${host === "0.0.0.0" ? "localhost" : host}:${listenPort}`;
    console.log("");
    console.log("=== 違反勞動相關法令、公共工程委員會拒絕往來廠商與來臺陸資投資名錄比對工具（獨立 UI）===");
    console.log(`請在瀏覽器開啟：${url}`);
    if (host === "0.0.0.0") {
      console.log("（已監聽所有網路介面，僅建議於受信任內網使用）");
    }
    console.log("按 Ctrl+C 結束");
    console.log("");
  });
};

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    const nextPort = currentPort + 1;
    if (nextPort <= port + 10) {
      console.warn(`埠號 ${currentPort} 已被占用，改試 ${nextPort}…`);
      startServer(nextPort);
      return;
    }
    console.error("");
    console.error(`埠號 ${port} 已被占用。請擇一處理：`);
    console.error(`  1. 直接開啟既有服務：http://localhost:${port}`);
    console.error("  2. 關閉舊程序後重試：");
    console.error('     Get-NetTCPConnection -LocalPort 3456 | %% { Stop-Process -Id $_.OwningProcess -Force }');
    console.error("  3. 改用其他埠：$env:UI_PORT=3457; npm run ui");
    console.error("");
    process.exit(1);
  }
  throw error;
});

startServer(port);
