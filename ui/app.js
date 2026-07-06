const $ = (id) => document.getElementById(id);

const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const safeHttpUrl = (value) => {
  try {
    const parsed = new URL(value);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.href;
    }
  } catch {
    // ignore
  }
  return null;
};

const toDateOnly = (value) => (value?.trim() ? value.trim().split(" ")[0] : "-");

const toRocDate = (value) => {
  const token = toDateOnly(value);
  if (!/^\d{8}$/.test(token)) return token;
  const year = Number(token.slice(0, 4));
  if (Number.isNaN(year) || year <= 1911) return token;
  const rocYear = year - 1911;
  return `${rocYear}年${token.slice(4, 6)}月${token.slice(6, 8)}日`;
};

const formatAmount = (value) => {
  const raw = (value ?? "").trim();
  if (!raw || raw === "-") return "-";
  const digitsOnly = raw.replace(/,/g, "");
  if (!/^\d+$/.test(digitsOnly)) return raw;
  return `新台幣${Number(digitsOnly).toLocaleString("en-US")} 元`;
};

const matchTypeLabel = (item) => {
  if (item.matchType === "fuzzy") {
    const pct =
      item.matchScore != null ? Math.round(item.matchScore * 100) : null;
    return pct != null ? `比對方式：相似命中（${pct}%）` : "比對方式：相似命中";
  }
  if (item.matchType === "exact") {
    return "比對方式：精準命中";
  }
  return null;
};

const withMatchType = (lines, item) => {
  const label = matchTypeLabel(item);
  return label ? [label, ...lines] : lines;
};

const setMessage = (text) => {
  const el = $("message");
  if (!text) {
    el.classList.add("hidden");
    el.textContent = "";
    return;
  }
  el.textContent = text;
  el.classList.remove("hidden");
};

const setWarnings = (warnings) => {
  const el = $("warnings");
  if (!warnings?.length) {
    el.classList.add("hidden");
    el.innerHTML = "";
    return;
  }
  el.classList.remove("hidden");
  el.innerHTML = warnings
    .map((warning) =>
      String(warning)
        .split(/(https?:\/\/[^\s]+)/g)
        .map((part) => {
          if (!/^https?:\/\//.test(part)) {
            return escapeHtml(part);
          }
          const href = safeHttpUrl(part);
          return href
            ? `<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer">${escapeHtml(part)}</a>`
            : escapeHtml(part);
        })
        .join("")
    )
    .map((html) => `<p>${html}</p>`)
    .join("");
};

const renderCards = (containerId, items, renderItem) => {
  const container = $(containerId);
  if (!items.length) {
    container.innerHTML = '<p class="result-empty">查無相關紀錄</p>';
    return;
  }
  container.innerHTML = items
    .map(
      (item, idx) =>
        `<div class="result-card">${renderItem(item, idx)
          .map((line) => `<p>${escapeHtml(line)}</p>`)
          .join("")}</div>`
    )
    .join("");
};

const renderMol = (items) => {
  $("molTitle").textContent = `勞動部違反勞動法令比對結果（${items.length}）`;
  renderCards("molResults", items, (item) =>
    withMatchType(
      [
        `單位：${item.unitName || "-"}`,
        `處分日期：${toRocDate(item.publishedAt || "")}`,
        `法令類別：${item.lawCategory || "-"}`,
        `法條：${item.lawRef || "-"}`,
        `罰鍰金額：${formatAmount(item.penaltyAmount || "-")}`,
      ],
      item
    )
  );
};

const renderPcc = (items) => {
  $("pccTitle").textContent = `工程會拒絕往來廠商比對結果（${items.length}）`;
  renderCards("pccResults", items, (item) =>
    withMatchType(
      [
        `廠商：${item.unitName || "-"}`,
        `公告日期：${toDateOnly(item.announceAt || item.publishedAt)}`,
        `拒絕往來生效日：${item.effectiveFrom || "-"}`,
        `拒絕往來截止日：${item.effectiveTo || "-"}`,
        `法令類別：${item.lawCategory || "-"}`,
        `備註：${item.note || "-"}`,
      ],
      item
    )
  );
};

const renderMoea = (items) => {
  $("moeaTitle").textContent = `臺陸資名錄比對結果（${items.length}）`;
  renderCards("moeaResults", items, (item) =>
    withMatchType(
      [
        `事業：${item.unitName || "-"}`,
        `統一編號：${item.organizationId || "-"}`,
        `核准月年：${item.announceAt || item.publishedAt || "-"}`,
        `投資型態：${item.lawRef || "-"}`,
        `投資金額：${formatAmount(item.penaltyAmount || "-")}`,
        `備註：${item.note || "-"}`,
      ],
      item
    )
  );
};

const loadMeta = async () => {
  const response = await fetch("/api/compliance-screening?mode=meta");
  if (!response.ok) throw new Error("載入設定失敗");
  const data = await response.json();
  $("importFolderPath").value = data.config?.importFolderPath ?? "";
  $("metaInfo").textContent = `上次更新：${
    data.updatedAt ? new Date(data.updatedAt).toLocaleString("zh-TW") : "-"
  }，下次自動更新：${
    data.nextRefreshAt ? new Date(data.nextRefreshAt).toLocaleString("zh-TW") : "-"
  }`;
  setWarnings(data.warnings ?? []);
};

const runQuery = async () => {
  const organizationName = $("organizationName").value.trim();
  if (!organizationName) {
    setMessage("請輸入單位名稱。");
    return;
  }

  const btn = $("queryBtn");
  btn.disabled = true;
  btn.textContent = "查詢中...";
  setMessage("");

  try {
    const query = new URLSearchParams({ organizationName });
    const response = await fetch(`/api/compliance-screening?${query}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "查詢失敗");

    renderMol(data.molMatches ?? []);
    renderPcc(data.pccMatches ?? []);
    renderMoea(data.moeaMatches ?? []);
    setWarnings(data.warnings ?? []);
    const allMatches = [
      ...(data.molMatches ?? []),
      ...(data.pccMatches ?? []),
      ...(data.moeaMatches ?? []),
    ];
    const hasFuzzy = allMatches.some((item) => item.matchType === "fuzzy");
    setMessage(
      data.matched
        ? hasFuzzy
          ? "已完成比對（含相似命中，請人工確認）。"
          : "已完成比對。"
        : "查無比對結果（可能無違規/無列管，或資料尚未匯入）。"
    );
  } catch (error) {
    setMessage(error.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "開始比對";
  }
};

const refreshData = async () => {
  const btn = $("refreshBtn");
  const progressBox = $("progressBox");
  btn.disabled = true;
  btn.textContent = "更新中...";
  setMessage("");
  progressBox.classList.remove("hidden");

  try {
    const response = await fetch("/api/compliance-screening", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "refresh",
        importFolderPath: $("importFolderPath").value.trim(),
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "更新失敗");

    const taskId = data.taskId;
    let done = false;
    while (!done) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const taskResponse = await fetch(
        `/api/compliance-screening?mode=task&taskId=${encodeURIComponent(taskId)}`
      );
      const taskData = await taskResponse.json();
      if (!taskResponse.ok) throw new Error(taskData.error || "讀取更新進度失敗");

      $("progressStage").textContent = taskData.stage || "更新中...";
      const percent = Math.max(5, taskData.percent ?? 0);
      $("progressFill").style.width = `${percent}%`;
      $("progressPercent").textContent = `${percent}%`;

      if (taskData.status === "done") {
        done = true;
        setMessage("資料更新完成。");
        await loadMeta();
      } else if (taskData.status === "error") {
        done = true;
        throw new Error(taskData.error || "更新失敗");
      }
    }
  } catch (error) {
    setMessage(error.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "立即更新資料";
    setTimeout(() => progressBox.classList.add("hidden"), 1500);
  }
};

$("queryBtn").addEventListener("click", () => void runQuery());
$("refreshBtn").addEventListener("click", () => void refreshData());
$("organizationName").addEventListener("keydown", (event) => {
  if (event.key === "Enter") void runQuery();
});

loadMeta().catch((error) => setMessage(error.message));
