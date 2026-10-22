const TOKEN_KEY = "1024-admin-token";
const PAGE_SIZE = 20;

const state = {
  token: sessionStorage.getItem(TOKEN_KEY) || "",
  meta: null,
  view: "overview",
  seq: 0,
  sessionsOffset: 0,
  sessionsSearch: "",
  sessionsTotal: 0,
  leaderboardSort: "score",
  sessionId: null
};

const main = document.getElementById("main");
const viewRoot = document.getElementById("view-root");
const authGate = document.getElementById("auth-gate");
const authForm = document.getElementById("auth-form");
const authError = document.getElementById("auth-error");
const tokenInput = document.getElementById("token-input");
const toast = document.getElementById("toast");
let toastTimer = 0;

class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[character]));
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatInt(value) {
  return new Intl.NumberFormat("zh-CN").format(Math.round(number(value)));
}

function formatPct(value, digits = 0) {
  return `${(number(value) * 100).toFixed(digits)}%`;
}

function formatScore(value) {
  return formatInt(value);
}

function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false
  }).format(date);
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit" }).format(date);
}

function formatGameTime(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
  const total = Math.max(0, Math.round(Number(value)));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function formatDuration(value) {
  if (!Number.isFinite(Number(value)) || Number(value) <= 0) return "—";
  const seconds = Math.round(Number(value));
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

function shortId(value) {
  const text = String(value ?? "");
  return text.length > 10 ? `${text.slice(0, 8)}…` : text || "—";
}

function initials(name) {
  const text = String(name ?? "").replace(/^匿名工程师·/, "");
  return text.slice(0, 2).toUpperCase() || "??";
}

function tierBadge(tier) {
  const names = { bronze: "青铜", silver: "白银", gold: "黄金", legend: "传奇" };
  return `<span class="badge tier-${escapeHtml(tier)}"><i class="tier-dot"></i>${names[tier] ?? escapeHtml(tier)}</span>`;
}

async function api(path) {
  const headers = {};
  if (state.token) headers.authorization = `Bearer ${state.token}`;
  let response;
  try {
    response = await fetch(path, { headers, cache: "no-store" });
  } catch {
    throw new ApiError("无法连接分析服务，请确认 npm run dev:server 正在运行。", 0);
  }
  if (response.status === 401) {
    showAuth("令牌已失效，请重新输入。");
    throw new ApiError("unauthorized", 401);
  }
  if (!response.ok) {
    let message = `请求失败（HTTP ${response.status}）`;
    try {
      const payload = await response.json();
      if (payload?.error?.message) message = payload.error.message;
    } catch {
      // Keep the status-based message.
    }
    throw new ApiError(message, response.status);
  }
  return response.json();
}

function showSkeleton() {
  viewRoot.innerHTML = `
    <div class="skeleton-stack" aria-hidden="true">
      <div class="skeleton skeleton-title"></div>
      <div class="skeleton skeleton-card"></div>
      <div class="skeleton skeleton-card"></div>
    </div>`;
}

function showError(error) {
  if (error instanceof ApiError && error.status === 401) return;
  viewRoot.innerHTML = `
    <div class="page-head">
      <div class="page-head-copy">
        <span class="eyebrow">CONNECTION ERROR</span>
        <h1>数据加载失败</h1>
        <p>${escapeHtml(error?.message ?? "未知错误")}</p>
      </div>
      <div class="page-head-actions"><button class="ghost-button" type="button" data-retry>重试</button></div>
    </div>
    <div class="empty">
      <strong>无法读取分析数据</strong>
      <p>确认服务端已启动，并且浏览器访问的地址与 API 地址一致。本地默认地址是 <code>http://127.0.0.1:8787/admin</code>。</p>
    </div>`;
}

function pageHead(kicker, title, description, actions = "") {
  return `
    <div class="page-head">
      <div class="page-head-copy">
        <span class="eyebrow">${escapeHtml(kicker)}</span>
        <h1>${escapeHtml(title)}</h1>
        <p>${description}</p>
      </div>
      ${actions ? `<div class="page-head-actions">${actions}</div>` : ""}
    </div>`;
}

function kpi(label, value, sub = "", tone = "") {
  return `
    <article class="kpi ${tone ? `is-${tone}` : ""}">
      <span class="kpi-label">${escapeHtml(label)}</span>
      <strong class="kpi-value">${value}</strong>
      ${sub ? `<span class="kpi-sub">${sub}</span>` : ""}
    </article>`;
}

function panel(title, description, body, tag = "") {
  return `
    <section class="panel">
      <div class="panel-head">
        <div><h3>${escapeHtml(title)}</h3>${description ? `<p>${description}</p>` : ""}</div>
        ${tag ? `<span class="panel-tag">${escapeHtml(tag)}</span>` : ""}
      </div>
      ${body}
    </section>`;
}

function emptyState(title, body) {
  return `<div class="empty"><strong>${escapeHtml(title)}</strong><p>${body}</p></div>`;
}

function setHash(value) {
  const next = `#${value}`;
  if (location.hash !== next) history.replaceState(null, "", next);
}

function updateNav() {
  const active = state.view === "session" ? "sessions" : state.view;
  for (const button of document.querySelectorAll("[data-view]")) {
    button.classList.toggle("is-active", button.dataset.view === active);
  }
}

function showAuth(message = "") {
  authGate.hidden = false;
  authError.textContent = message;
  tokenInput.value = state.token;
  window.setTimeout(() => tokenInput.focus(), 30);
}

function hideAuth() {
  authGate.hidden = true;
  authError.textContent = "";
}

function showToast(message) {
  toast.textContent = message;
  toast.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { toast.hidden = true; }, 4200);
}

function setConnection(status, label) {
  const pill = document.getElementById("connection-status");
  pill.classList.toggle("is-live", status === "live");
  pill.classList.toggle("is-offline", status === "offline");
  pill.querySelector("span").textContent = label;
}

async function boot() {
  bindGlobal();
  window.addEventListener("hashchange", () => {
    if (!state.meta) return;
    const hash = location.hash.replace(/^#/, "");
    if (hash.startsWith("session/")) {
      void openSession(decodeURIComponent(hash.slice("session/".length)), { keepHash: true });
      return;
    }
    const allowed = ["overview", "sessions", "decisions", "leaderboard", "achievements"];
    if (allowed.includes(hash)) void loadView(hash);
  });
  try {
    state.meta = await api("/api/admin/meta");
    document.getElementById("build-label").textContent = `v${state.meta.gameVersion ?? "0.1.0"}`;
    if (state.meta.gameUrl) {
      const gameLink = document.getElementById("game-link");
      gameLink.href = state.meta.gameUrl;
      gameLink.hidden = false;
    }
    const mode = document.getElementById("mode-pill");
    if (!state.meta.authRequired) {
      mode.hidden = false;
      document.getElementById("token-button").hidden = true;
    } else {
      mode.hidden = true;
      document.getElementById("token-button").hidden = false;
    }
    if (state.meta.authRequired && !state.token) {
      showAuth();
      setConnection("offline", "等待令牌");
      return;
    }
    hideAuth();
    setConnection("live", "数据在线");
    const hash = location.hash.replace(/^#/, "");
    if (hash.startsWith("session/")) {
      await openSession(decodeURIComponent(hash.slice("session/".length)), { keepHash: true });
    } else {
      const allowed = ["overview", "sessions", "decisions", "leaderboard", "achievements"];
      await loadView(allowed.includes(hash) ? hash : "overview");
    }
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return;
    setConnection("offline", "连接失败");
    showError(error);
  }
}

function bindGlobal() {
  document.getElementById("nav-list").addEventListener("click", (event) => {
    const button = event.target.closest("[data-view]");
    if (!button) return;
    state.view = button.dataset.view;
    loadView(button.dataset.view);
  });
  document.getElementById("refresh-button").addEventListener("click", () => {
    if (state.view === "session" && state.sessionId) openSession(state.sessionId);
    else loadView(state.view);
  });
  document.getElementById("token-button").addEventListener("click", () => showAuth());
  document.getElementById("auth-cancel").addEventListener("click", () => {
    state.token = "";
    sessionStorage.removeItem(TOKEN_KEY);
    tokenInput.value = "";
    authError.textContent = "已清空本地令牌。";
    tokenInput.focus();
  });
  authForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const token = tokenInput.value.trim();
    if (!token) return;
    state.token = token;
    sessionStorage.setItem(TOKEN_KEY, token);
    try {
      await api("/api/admin/overview");
      hideAuth();
      setConnection("live", "数据在线");
      await loadView(state.view === "session" ? "overview" : state.view);
    } catch (error) {
      state.token = "";
      sessionStorage.removeItem(TOKEN_KEY);
      showAuth(error instanceof ApiError && error.status === 401 ? "令牌无效，请重新输入。" : error.message);
    }
  });
  main.addEventListener("click", (event) => {
    const retry = event.target.closest("[data-retry]");
    if (retry) {
      if (state.view === "session" && state.sessionId) openSession(state.sessionId);
      else loadView(state.view);
      return;
    }
    const sessionRow = event.target.closest("[data-session-id]");
    if (sessionRow) {
      const sessionId = sessionRow.dataset.sessionId;
      if (sessionId) openSession(sessionId);
      return;
    }
    const back = event.target.closest("[data-back-sessions]");
    if (back) {
      loadView("sessions");
      return;
    }
    const sortButton = event.target.closest("[data-sort]");
    if (sortButton) {
      state.leaderboardSort = sortButton.dataset.sort;
      loadLeaderboard();
      return;
    }
    const pageButton = event.target.closest("[data-page-offset]");
    if (pageButton) {
      state.sessionsOffset = Math.max(0, Number(pageButton.dataset.pageOffset) || 0);
      loadSessions();
    }
  });
  main.addEventListener("submit", (event) => {
    const form = event.target.closest("[data-search-form]");
    if (!form) return;
    event.preventDefault();
    const input = form.querySelector("input[name=search]");
    state.sessionsSearch = input?.value.trim() ?? "";
    state.sessionsOffset = 0;
    loadSessions();
  });
}

async function loadView(view) {
  state.view = view;
  updateNav();
  setHash(view);
  if (view === "overview") return loadOverview();
  if (view === "sessions") return loadSessions();
  if (view === "decisions") return loadDecisions();
  if (view === "leaderboard") return loadLeaderboard();
  if (view === "achievements") return loadAchievements();
  return loadOverview();
}

async function loadOverview() {
  const seq = ++state.seq;
  showSkeleton();
  try {
    const [overviewResponse, sessionsResponse] = await Promise.all([
      api("/api/admin/overview"),
      api("/api/admin/sessions?limit=6&offset=0")
    ]);
    if (seq !== state.seq) return;
    renderOverview(overviewResponse.overview, sessionsResponse);
    setConnection("live", "数据在线");
  } catch (error) {
    if (seq === state.seq) showError(error);
  }
}

function renderOverview(overview, sessionsResponse) {
  const runs = number(overview.runs);
  const wins = number(overview.wins);
  const daily = overview.daily ?? [];
  const maxDaily = Math.max(1, ...daily.map((day) => number(day.runs)));
  const style = overview.decisionStyle ?? { quality: 0, speed: 0, qualityShare: 0 };
  const totalChoices = number(style.quality) + number(style.speed);
  const qualityShare = totalChoices > 0 ? number(style.quality) / totalChoices : 0;

  const kpis = `
    <div class="kpi-grid">
      ${kpi("活跃玩家", formatInt(overview.sessions), "匿名 session 数", "cyan")}
      ${kpi("完成对局", formatInt(runs), `${formatInt(wins)} 胜 · ${formatInt(overview.losses)} 负`)}
      ${kpi("上线成功率", formatPct(overview.winRate, 1), `${formatInt(overview.wins)} / ${formatInt(runs)}`, "gold")}
      ${kpi("平均得分", formatInt(overview.avgScore), `最高分见排行榜`, "violet")}
      ${kpi("平均验收需求", number(overview.avgCompletedRequests).toFixed(1), "每局验收数量")}
      ${kpi("平均健康度", `${number(overview.avgProjectHealth).toFixed(0)}<small>%</small>`, `平均技术债 ${number(overview.avgTechDebt).toFixed(0)}`)}
      ${kpi("行为事件", formatInt(overview.events), `中途离开 ${formatInt(overview.abandonedRuns)} 次`)}
      ${kpi("成就解锁", formatInt(overview.achievement?.unlockedRuns), `${formatInt(overview.achievement?.playersWithAny)} 名玩家获得过成就`, "gold")}
    </div>`;

  const donut = `
    <div class="donut-wrap">
      <div class="donut" style="--win-share:${Math.max(0, Math.min(100, number(overview.winRate) * 100))}%" data-center="${formatPct(overview.winRate, 0)}"></div>
      <div class="legend">
        ${(overview.resultDistribution ?? []).map((entry) => `
          <div class="legend-row">
            <i class="legend-dot" style="background:${entry.result === "win" ? "var(--green)" : "var(--red)"}"></i>
            <span>${escapeHtml(entry.label)}</span>
            <b>${formatInt(entry.count)}</b>
            <small>${formatPct(entry.share, 0)}</small>
          </div>`).join("")}
        <div class="legend-row" style="margin-top:4px;border-top:1px solid var(--border-soft);padding-top:9px">
          <i class="legend-dot" style="background:var(--gold)"></i><span>平均用时</span><b>${formatDuration(overview.avgDurationSeconds)}</b><small></small>
        </div>
      </div>
    </div>`;

  const dailyChart = daily.length === 0 ? emptyState("暂无近 7 日活动", "等待玩家提交对局后这里会出现趋势。") : `
    <div class="bar-chart" role="img" aria-label="近 7 日对局与事件趋势">
      ${daily.map((day) => {
        const height = Math.max(3, (number(day.runs) / maxDaily) * 100);
        const winShare = number(day.runs) > 0 ? (number(day.wins) / number(day.runs)) * 100 : 0;
        return `
          <div class="bar-col">
            <div class="bar-stack">
              <span class="bar-value">${number(day.runs) > 0 ? formatInt(day.runs) : ""}</span>
              <i class="bar-fill" style="height:${height}%;background:linear-gradient(to top,var(--gold) 0 ${winShare}%,var(--cyan) ${winShare}% 100%)"></i>
            </div>
            <span class="bar-label">${formatDate(day.date)}<br>${formatInt(day.events)}e</span>
          </div>`;
      }).join("")}
    </div>`;

  const decisionStyle = `
    <div class="split-bar" aria-label="决策风格比例">
      <i style="width:${qualityShare * 100}%;background:var(--cyan)"></i>
      <i style="width:${(1 - qualityShare) * 100}%;background:var(--gold)"></i>
    </div>
    <div class="split-legend">
      <span><i class="legend-dot" style="display:inline-block;background:var(--cyan);margin-right:5px"></i>稳健 ${formatInt(style.quality)} 次</span>
      <span><i class="legend-dot" style="display:inline-block;background:var(--gold);margin-right:5px"></i>激进 ${formatInt(style.speed)} 次</span>
      <span>稳健占比 <b class="mono">${formatPct(qualityShare, 0)}</b></span>
    </div>
    <div class="note-block"><b>口径：</b>稳健决策 = 冻结范围 / 坚持验证 / 修复告警 / 先审后用；激进决策 = 接下需求 / 快速交付 / 快速绕过 / 批量生成。</div>`;

  const eras = `
    <div class="hbar-list">
      ${(overview.eraDistribution ?? []).map((era) => `
        <div class="hbar">
          <span class="hbar-label">${escapeHtml(era.name)}</span>
          <span class="hbar-track"><i class="hbar-fill ${era.era === 2 ? "is-gold" : era.era === 1 ? "is-violet" : ""}" style="width:${number(era.share) * 100}%"></i></span>
          <span class="hbar-value">${formatInt(era.count)} · ${formatPct(era.share, 0)}</span>
        </div>`).join("")}
    </div>`;

  const topAchievements = (overview.topAchievements ?? []).length === 0
    ? emptyState("暂无成就数据", "玩家提交对局后，服务端会从 run 与事件中推导成就。")
    : `<ul class="list-plain">
        ${overview.topAchievements.map((achievement, index) => `
          <li class="list-row">
            <span class="rank">${String(index + 1).padStart(2, "0")}</span>
            <span class="achievement-icon tier-${escapeHtml(achievement.tier)}" style="width:26px;height:26px;font-size:11px">${escapeHtml(achievement.icon)}</span>
            <span class="grow"><strong>${escapeHtml(achievement.name)}</strong><small>${formatInt(achievement.unlockedRuns)} 局解锁 · ${formatPct(achievement.rate, 0)}</small></span>
            <b>+${formatInt(achievement.points)}</b>
          </li>`).join("")}
      </ul>`;

  const recentSessions = (sessionsResponse?.sessions ?? []).length === 0
    ? emptyState("暂无玩家", "先运行演示数据脚本，或让游戏端连接 API 游玩一局。")
    : `<ul class="list-plain">
        ${sessionsResponse.sessions.map((session) => `
          <li class="list-row" data-session-id="${escapeHtml(session.sessionId)}" style="cursor:pointer">
            <span class="avatar">${escapeHtml(initials(session.displayName))}</span>
            <span class="grow"><strong>${escapeHtml(session.displayName)}</strong><small>${formatInt(session.runs)} 局 · 最佳 ${formatScore(session.bestScore)} · ${formatDateTime(session.lastActiveAt)}</small></span>
            <b>${formatPct(session.winRate, 0)}</b>
          </li>`).join("")}
      </ul>`;

  viewRoot.innerHTML = `
    ${pageHead("OVERVIEW", "数据总览", "单局决策、玩家行为与成就解锁的整体态势。数据来自游戏端批量埋点与结算上报，服务端只保存匿名会话 ID。",
      `<button class="ghost-button" type="button" data-session-id="${escapeHtml(sessionsResponse?.sessions?.[0]?.sessionId ?? "")}">查看最近玩家</button>`)}
    ${kpis}
    <div class="section-title"><h2>结果与活跃</h2><span>RESULT / ACTIVITY</span></div>
    <div class="grid-2">
      ${panel("上线结果", "提交结算的对局胜负分布", donut, "RUNS")}
      ${panel("近 7 日趋势", "柱高 = 对局数；柱内金色部分 = 胜利占比；e = 事件数", dailyChart, "7 DAYS")}
    </div>
    <div class="section-title"><h2>决策与进程</h2><span>DECISION / ERA</span></div>
    <div class="grid-2">
      ${panel("决策风格", "所有需求变更选择的风险偏好", decisionStyle, "CHOICES")}
      ${panel("时代分布", "每局最终到达的技术时代", eras, "ERAS")}
    </div>
    <div class="section-title"><h2>成就与最近玩家</h2><span>ACHIEVEMENT / PLAYERS</span></div>
    <div class="grid-2">
      ${panel("热门成就", "按解锁对局数排序", topAchievements, "TOP 6")}
      ${panel("最近活跃", "按最近一次事件或结算时间排序", recentSessions, "RECENT")}
    </div>
    <div class="note-block"><b>当前数据库时间：</b>${escapeHtml(formatDateTime(overview.generatedAt))}　<b>最近活动：</b>${escapeHtml(formatDateTime(overview.latestActivityAt))}　<b>平均对局时长：</b>${formatDuration(overview.avgDurationSeconds)}</div>`;
}

async function loadSessions() {
  const seq = ++state.seq;
  showSkeleton();
  try {
    const params = new URLSearchParams({
      limit: String(PAGE_SIZE),
      offset: String(state.sessionsOffset)
    });
    if (state.sessionsSearch) params.set("search", state.sessionsSearch);
    const response = await api(`/api/admin/sessions?${params.toString()}`);
    if (seq !== state.seq) return;
    state.sessionsTotal = number(response.total);
    renderSessions(response);
    setConnection("live", "数据在线");
  } catch (error) {
    if (seq === state.seq) showError(error);
  }
}

function renderSessions(response) {
  const sessions = response.sessions ?? [];
  const total = number(response.total);
  const start = total === 0 ? 0 : state.sessionsOffset + 1;
  const end = Math.min(state.sessionsOffset + PAGE_SIZE, total);
  const rows = sessions.length === 0
    ? `<tr><td colspan="9"><div class="empty" style="min-height:160px;border:0"><strong>没有匹配的玩家</strong><p>调整搜索词，或让游戏端先提交一局。</p></div></td></tr>`
    : sessions.map((session) => `
      <tr class="is-clickable" data-session-id="${escapeHtml(session.sessionId)}">
        <td>
          <div class="player-cell">
            <span class="avatar">${escapeHtml(initials(session.displayName))}</span>
            <span><strong>${escapeHtml(session.displayName)}</strong><small>${escapeHtml(shortId(session.sessionId))}</small></span>
          </div>
        </td>
        <td class="num">${formatInt(session.runs)}</td>
        <td class="num">${formatPct(session.winRate, 0)}</td>
        <td class="num strong">${formatScore(session.bestScore)}</td>
        <td class="num">${formatInt(session.bestCompleted)}</td>
        <td class="num">${formatInt(session.achievementCount)} <span class="muted">/ ${formatInt(session.achievementPoints)}p</span></td>
        <td class="num">${formatInt(session.eventCount)}</td>
        <td class="num">${formatInt(session.decisions)}</td>
        <td class="nowrap">${formatDateTime(session.lastActiveAt)}</td>
      </tr>`).join("");

  viewRoot.innerHTML = `
    ${pageHead("PLAYERS", "用户档案", "以匿名会话为单位查看单个玩家的对局、决策轨迹与成就。点击任意一行进入完整档案。",
      `<button class="ghost-button" type="button" data-back-sessions>刷新列表</button>`)}
    <form class="toolbar" data-search-form>
      <label class="search-box">
        <span class="sr-only">搜索玩家</span>
        <input name="search" type="search" placeholder="搜索昵称或 sessionId，回车确认" value="${escapeHtml(state.sessionsSearch)}" />
      </label>
      <button class="primary-button" type="submit">搜索</button>
      <span class="panel-tag">共 ${formatInt(total)} 名玩家</span>
    </form>
    <div class="table-wrap">
      <table>
        <thead><tr>
          <th>玩家</th><th class="num">对局</th><th class="num">胜率</th><th class="num">最佳分</th>
          <th class="num">最佳验收</th><th class="num">成就</th><th class="num">事件</th><th class="num">决策</th><th>最近活跃</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div class="pagination">
      <span>显示 ${formatInt(start)}–${formatInt(end)} / ${formatInt(total)}，每页 ${PAGE_SIZE} 条</span>
      <span class="pagination-actions">
        <button class="ghost-button" type="button" data-page-offset="${Math.max(0, state.sessionsOffset - PAGE_SIZE)}" ${state.sessionsOffset === 0 ? "disabled" : ""}>上一页</button>
        <button class="ghost-button" type="button" data-page-offset="${state.sessionsOffset + PAGE_SIZE}" ${end >= total ? "disabled" : ""}>下一页</button>
      </span>
    </div>`;
}

async function openSession(sessionId, options = {}) {
  state.view = "session";
  state.sessionId = sessionId;
  updateNav();
  if (!options.keepHash) setHash(`session/${encodeURIComponent(sessionId)}`);
  const seq = ++state.seq;
  showSkeleton();
  try {
    const response = await api(`/api/admin/sessions/${encodeURIComponent(sessionId)}`);
    if (seq !== state.seq) return;
    renderSession(response);
    setConnection("live", "数据在线");
  } catch (error) {
    if (seq === state.seq) showError(error);
  }
}

function renderSession(detail) {
  const session = detail.session;
  const runs = detail.runs ?? [];
  const wall = detail.achievements ?? [];
  const unlocked = wall.filter((achievement) => achievement.unlocked);
  const locked = wall.filter((achievement) => !achievement.unlocked);
  const decisions = detail.decisionLog ?? [];
  const timeline = detail.timeline ?? [];
  const unfinished = detail.unfinishedRunIds ?? [];

  const runCards = runs.length === 0
    ? emptyState("还没有结算对局", "该会话只有行为事件，没有提交 run。可能是中途离开或结算上报失败。")
    : runs.map((run) => {
        const runTimeline = timeline.filter((entry) => entry.runId === run.runId);
        const unlockedRun = (run.achievements ?? []).filter((achievement) => achievement.unlocked);
        return `
          <details class="run-card">
            <summary>
              <span class="run-result">
                <strong style="color:${run.result === "win" ? "var(--green)" : "var(--red)"}">${run.result === "win" ? "WIN" : "LOSS"}</strong>
                <small>${escapeHtml(shortId(run.runId))}</small>
              </span>
              <span class="run-summary">
                <span>得分 <b>${formatScore(run.score)}</b></span>
                <span>验收 <b>${formatInt(run.completedRequests)}</b></span>
                <span>漏单 <b>${formatInt(run.missedRequests)}</b></span>
                <span>健康 <b>${Math.round(number(run.finalProjectHealth))}%</b></span>
                <span>债务 <b>${Math.round(number(run.finalTechDebt))}</b></span>
                <span>${escapeHtml(formatDateTime(run.endedAt))}</span>
              </span>
              <span class="run-badges">
                ${unlockedRun.slice(0, 3).map((achievement) => `<span class="badge tier-${escapeHtml(achievement.tier)}" title="${escapeHtml(achievement.name)}">${escapeHtml(achievement.icon)} ${escapeHtml(achievement.name)}</span>`).join("")}
                ${unlockedRun.length > 3 ? `<span class="badge is-muted">+${unlockedRun.length - 3}</span>` : ""}
              </span>
            </summary>
            <div class="run-body">
              <div class="run-metrics">
                <span class="metric-mini"><span>招募</span><b>${formatInt(run.recruitCount)} 人</b></span>
                <span class="metric-mini"><span>时代</span><b>${["手搓", "工程化", "Agent"][number(run.finalEra)] ?? run.finalEra}</b></span>
                <span class="metric-mini"><span>用时</span><b>${formatDuration((Date.parse(run.endedAt) - Date.parse(run.startedAt)) / 1000)}</b></span>
                <span class="metric-mini"><span>成就</span><b>${formatInt(run.unlockedAchievements)} 个 / ${formatInt(run.points)}p</b></span>
                <span class="metric-mini"><span>事件</span><b>${formatInt((run.events ?? []).length)}</b></span>
                <span class="metric-mini"><span>局内结算</span><b>${escapeHtml(run.gameVersion)}</b></span>
              </div>
              ${runTimeline.length === 0
                ? `<p class="muted" style="margin:0;font-size:10px">这一局还没有关联行为事件。</p>`
                : `<div class="event-stream">${runTimeline.map(eventRow).join("")}</div>`}
            </div>
          </details>`;
      }).join("");

  const decisionRows = decisions.length === 0
    ? `<p class="muted" style="font-size:10px;margin:0">暂无招募、升级、调度或需求变更记录。</p>`
    : `<div class="decision-log">${decisions.map((entry) => `
        <div class="decision-row">
          <span class="event-time">${formatGameTime(entry.at)}</span>
          <span class="decision-kind is-${escapeHtml(entry.kind)}">${escapeHtml(entry.kind)}</span>
          <span><span class="decision-title">${escapeHtml(entry.title)}</span><span class="decision-detail">${escapeHtml(entry.detail)} · ${escapeHtml(formatDateTime(entry.timestamp))}</span></span>
        </div>`).join("")}</div>`;

  const achievementCards = wall.length === 0
    ? emptyState("暂无成就", "成就由结算 run 与行为事件推导。")
    : (unlocked.length === 0 ? "" : unlocked.map((achievement) => achievementCard(achievement, false)).join("")) +
      (locked.length === 0 ? "" : locked.map((achievement) => achievementCard(achievement, true)).join(""));

  viewRoot.innerHTML = `
    ${pageHead("PLAYER PROFILE", "玩家档案", "单用户视角：对局结果、需求变更选择、招聘/调度节奏、成就墙与完整事件流。",
      `<button class="ghost-button" type="button" data-back-sessions>← 返回用户列表</button>
       <button class="ghost-button" type="button" data-session-id="${escapeHtml(session.sessionId)}">刷新档案</button>`)}
    <div class="session-head">
      <div class="session-identity">
        <span class="session-avatar">${escapeHtml(initials(session.displayName))}</span>
        <div>
          <h1>${escapeHtml(session.displayName)}</h1>
          <code>${escapeHtml(session.sessionId)}</code>
        </div>
      </div>
      <div class="session-actions">
        ${detail.rank ? `<span class="badge is-gold">排行榜 #${formatInt(detail.rank.rank)} / ${formatInt(detail.rank.total)}</span>` : `<span class="badge is-muted">未上榜</span>`}
        <span class="badge ${session.winRate >= 0.5 ? "is-win" : "is-loss"}">胜率 ${formatPct(session.winRate, 0)}</span>
        <span class="badge is-cyan">成就 ${formatInt(session.achievementCount)} · ${formatInt(session.achievementPoints)}p</span>
        <span class="badge is-muted">最近 ${escapeHtml(formatDateTime(session.lastActiveAt))}</span>
      </div>
    </div>
    <div class="kpi-grid is-six">
      ${kpi("对局", formatInt(session.runs), `${formatInt(session.wins)} 胜 / ${formatInt(session.losses)} 负`)}
      ${kpi("最佳得分", formatInt(session.bestScore), "服务端计算", "gold")}
      ${kpi("最佳验收", formatInt(session.bestCompleted), `累计 ${formatInt(session.totalCompleted)}`)}
      ${kpi("平均健康", `${Math.round(number(session.avgHealth))}<small>%</small>`, `平均债务 ${Math.round(number(session.avgDebt))}`)}
      ${kpi("行为事件", formatInt(session.eventCount), `${formatInt(session.decisions)} 次需求决策`)}
      ${kpi("未结算对局", formatInt(unfinished.length), unfinished.length ? "有事件但无 run" : "全部完成结算", unfinished.length ? "red" : "")}
    </div>
    ${unfinished.length > 0 ? `<div class="note-block"><b>未结算 run：</b>${unfinished.map((id) => `<code>${escapeHtml(id)}</code>`).join(" ")}。这些对局只有事件，没有结算分数，可能由中途退出或上报失败造成。</div>` : ""}
    <div class="section-title"><h2>对局明细</h2><span>RUNS / ${formatInt(runs.length)}</span></div>
    <div class="run-list">${runCards}</div>
    <div class="grid-2" style="margin-top:14px">
      ${panel("决策轨迹", "按时间顺序排列的招募、时代升级、优先调度、冲刺与需求变更选择", decisionRows, "DECISION LOG")}
      ${panel("对局节奏", "该玩家的运营与风险概况", `
        <div class="hbar-list">
          ${barRow("需求变更", decisions.filter((entry) => entry.kind === "choice").length, Math.max(1, decisions.length), "var(--gold)")}
          ${barRow("极限冲刺", decisions.filter((entry) => entry.kind === "rush").length, Math.max(1, decisions.length), "var(--red)")}
          ${barRow("优先调度", decisions.filter((entry) => entry.kind === "priority").length, Math.max(1, decisions.length), "var(--violet)")}
          ${barRow("招募", decisions.filter((entry) => entry.kind === "recruit").length, Math.max(1, decisions.length), "var(--cyan)")}
          ${barRow("时代升级", decisions.filter((entry) => entry.kind === "era").length, Math.max(1, decisions.length), "var(--blue)")}
        </div>
        <div class="note-block">成就点数只统计已解锁项；同一成就跨多局只计一次。</div>`, "RHYTHM")}
    </div>
    <div class="section-title"><h2>成就墙</h2><span>UNLOCKED ${formatInt(unlocked.length)} / ${formatInt(wall.length)}</span></div>
    <div class="achievement-grid">${achievementCards}</div>
    <div class="section-title"><h2>会话事件</h2><span>EVENTS / ${formatInt(timeline.length)}</span></div>
    ${panel("完整事件流", "包含进入、开局、决策、结果与系统事件，按时间升序", timeline.length === 0 ? `<p class="muted" style="font-size:10px;margin:0">暂无事件。</p>` : `<div class="event-stream" style="max-height:420px">${timeline.map(eventRow).join("")}</div>`, "RAW TIMELINE")}`;
}

function eventRow(entry) {
  return `
    <div class="event-row">
      <span class="event-time">${formatGameTime(entry.at)}</span>
      <i class="event-dot is-${escapeHtml(entry.category)}"></i>
      <span class="event-label">${escapeHtml(entry.label)}<small>${escapeHtml(entry.type)}${entry.runId ? ` · ${escapeHtml(shortId(entry.runId))}` : ""} · ${escapeHtml(formatDateTime(entry.timestamp))}</small></span>
    </div>`;
}

function barRow(label, value, max, color) {
  return `
    <div class="hbar">
      <span class="hbar-label">${escapeHtml(label)}</span>
      <span class="hbar-track"><i class="hbar-fill" style="width:${Math.min(100, (number(value) / Math.max(1, max)) * 100)}%;background:${color}"></i></span>
      <span class="hbar-value">${formatInt(value)}</span>
    </div>`;
}

function achievementCard(achievement, locked) {
  const progress = Math.max(0, Math.min(1, number(achievement.progress)));
  return `
    <article class="achievement-card tier-${escapeHtml(achievement.tier)} ${locked ? "is-locked" : ""}">
      <div class="achievement-top">
        <span class="achievement-icon">${escapeHtml(achievement.icon)}</span>
        <span class="achievement-points">+${formatInt(achievement.points)}</span>
      </div>
      <h4>${escapeHtml(achievement.name)} ${locked ? "" : "✓"}</h4>
      <p>${escapeHtml(achievement.description)}</p>
      <div class="achievement-progress"><i style="width:${progress * 100}%"></i></div>
      <div class="achievement-meta"><span>${escapeHtml(achievement.detail ?? (locked ? "未解锁" : "已解锁"))}</span><span>${escapeHtml(formatDateTime(achievement.unlockedAt))}</span></div>
    </article>`;
}

async function loadDecisions() {
  const seq = ++state.seq;
  showSkeleton();
  try {
    const response = await api("/api/admin/decisions");
    if (seq !== state.seq) return;
    renderDecisions(response.decisions);
    setConnection("live", "数据在线");
  } catch (error) {
    if (seq === state.seq) showError(error);
  }
}

function renderDecisions(data) {
  const choices = data.choices ?? [];
  const totalChoices = choices.reduce((sum, event) => sum + number(event.total), 0);
  const qualityShare = number(data.choiceTone?.qualityShare);
  const roleMax = Math.max(1, ...(data.roles ?? []).map((role) => number(role.count)));
  const requestRows = (data.requestOutcomes ?? []).map((request) => `
    <tr>
      <td class="strong mono">${escapeHtml(request.code)}</td>
      <td class="num">${formatInt(request.completed)}</td>
      <td class="num" style="color:var(--red)">${formatInt(request.missed)}</td>
      <td class="num">${formatPct(request.completionRate, 0)}</td>
    </tr>`).join("");
  const debtRows = (data.debtReasons ?? []).map((reason) => `
    <tr>
      <td>${escapeHtml(reason.reason)}</td>
      <td class="num">${formatInt(reason.count)}</td>
      <td class="num" style="color:${number(reason.totalDelta) >= 0 ? "var(--red)" : "var(--green)"}">${number(reason.totalDelta) > 0 ? "+" : ""}${formatInt(reason.totalDelta)}</td>
      <td class="num">${number(reason.avgDelta).toFixed(1)}</td>
    </tr>`).join("");

  const choiceCards = choices.map((event) => {
    return `
      <article class="choice-card">
        <div class="choice-card-head">
          <div><h4>${escapeHtml(event.title)}</h4><small>${escapeHtml(event.eventId)} · ${escapeHtml(event.category)}</small></div>
          <span class="badge is-cyan">${formatInt(event.total)} 次</span>
        </div>
        ${event.choices.map((choice) => `
          <div class="choice-row">
            <span>${escapeHtml(choice.label)}</span>
            <span class="hbar-track"><i class="hbar-fill ${choice.tone === "quality" ? "" : "is-gold"}" style="width:${number(choice.share) * 100}%"></i></span>
            <b>${formatInt(choice.count)} · ${formatPct(choice.share, 0)}</b>
          </div>`).join("")}
      </article>`;
  }).join("");

  viewRoot.innerHTML = `
    ${pageHead("DECISIONS", "决策分析", "聚合所有玩家在需求变更、招聘、调度与冲刺上的选择，判断整体策略偏好与风险。",
      `<button class="ghost-button" type="button" data-view-link="overview">返回总览</button>`)}
    <div class="kpi-grid is-six">
      ${kpi("需求决策", formatInt(data.decisions), `${formatInt(data.sessions)} 名玩家参与`, "gold")}
      ${kpi("稳健占比", formatPct(qualityShare, 0), `激进 ${formatPct(1 - qualityShare, 0)}`)}
      ${kpi("极限冲刺", formatInt(data.rush?.total), `${formatInt(data.rush?.runsWithRush)} 局使用 · 场均 ${number(data.rush?.avgPerRun).toFixed(1)}`)}
      ${kpi("优先调度", formatInt(data.priorities?.total), `${formatInt(data.priorities?.runsWithPriority)} 局使用 · 场均 ${number(data.priorities?.avgPerRun).toFixed(1)}`)}
      ${kpi("线上故障", formatInt(data.incidents), "技术债触发的效率惩罚")}
      ${kpi("中途离开", formatInt(data.abandoned), "有事件但未提交结算", data.abandoned > 0 ? "red" : "")}
    </div>
    <div class="section-title"><h2>需求变更选择</h2><span>CHOICE DISTRIBUTION · ${formatInt(totalChoices)}</span></div>
    <div class="grid-2">${choiceCards || emptyState("暂无决策数据", "玩家遇到需求变更并做出选择后，这里会出现分布。")}</div>
    <div class="section-title"><h2>团队与运营</h2><span>TEAM / OPERATIONS</span></div>
    <div class="grid-2">
      ${panel("招聘偏好", "按招募次数统计的五类工程师", `
        <div class="hbar-list">
          ${(data.roles ?? []).map((role) => `
            <div class="hbar">
              <span class="hbar-label">${escapeHtml(role.name)}</span>
              <span class="hbar-track"><i class="hbar-fill" style="width:${(number(role.count) / roleMax) * 100}%;background:${escapeHtml(roleColor(role.id))}"></i></span>
              <span class="hbar-value">${formatInt(role.count)} · ${formatPct(role.share, 0)}</span>
            </div>`).join("")}
        </div>`, "HIRES")}
      ${panel("时代升级", "升级到各技术时代的次数", `
        <div class="hbar-list">
          ${(data.eraUpgrades ?? []).map((era) => `
            <div class="hbar">
              <span class="hbar-label">${escapeHtml(era.name)}</span>
              <span class="hbar-track"><i class="hbar-fill is-violet" style="width:${Math.min(100, number(era.count) * 8)}%"></i></span>
              <span class="hbar-value">${formatInt(era.count)} 次</span>
            </div>`).join("")}
        </div>
        <div class="note-block">时代升级消耗经验，提升团队 productivity；完整单局通常只升级 1–2 次。</div>`, "ERAS")}
    </div>
    <div class="section-title"><h2>需求结果与风险</h2><span>OUTCOME / DEBT</span></div>
    <div class="grid-2">
      ${panel("需求验收 / 漏单", "按需求编号统计结果，完成率 = 验收 / (验收 + 漏单)", `
        <div class="table-wrap is-scroll"><table>
          <thead><tr><th>需求</th><th class="num">验收</th><th class="num">漏单</th><th class="num">完成率</th></tr></thead>
          <tbody>${requestRows || `<tr><td colspan="4" class="muted">暂无需求结果</td></tr>`}</tbody>
        </table></div>`, "REQUESTS")}
      ${panel("技术债变化原因", "按原因聚合的债务增量，正值为增加", `
        <div class="table-wrap is-scroll"><table>
          <thead><tr><th>原因</th><th class="num">次数</th><th class="num">总变化</th><th class="num">均值</th></tr></thead>
          <tbody>${debtRows || `<tr><td colspan="4" class="muted">暂无技术债变化</td></tr>`}</tbody>
        </table></div>`, "DEBT")}
    </div>
    <div class="section-title"><h2>界面交互</h2><span>UI ACTIONS</span></div>
    ${panel("界面操作计数", "暂停、倍速、静音等非策略交互；用于判断玩家是否理解操作", (data.uiActions ?? []).length === 0
      ? `<p class="muted" style="font-size:10px;margin:0">暂无界面交互事件。新版本客户端会记录 pause / speed / mute 等操作。</p>`
      : `<div class="hbar-list">${data.uiActions.map((action) => `
          <div class="hbar"><span class="hbar-label">${escapeHtml(action.action)}</span>
          <span class="hbar-track"><i class="hbar-fill" style="width:${Math.min(100, number(action.count) * 4)}%"></i></span>
          <span class="hbar-value">${formatInt(action.count)}</span></div>`).join("")}</div>`, "INTERACTION")}`;
}

function tierName(tier) {
  return { bronze: "青铜", silver: "白银", gold: "黄金", legend: "传奇" }[tier] ?? tier;
}

function roleColor(id) {
  return { intern: "var(--gold)", frontend: "var(--cyan)", backend: "var(--blue)", qa: "var(--violet)", agent: "var(--red)" }[id] ?? "var(--muted)";
}

async function loadLeaderboard() {
  const seq = ++state.seq;
  showSkeleton();
  try {
    const response = await api(`/api/admin/leaderboard?limit=20&sort=${encodeURIComponent(state.leaderboardSort)}`);
    if (seq !== state.seq) return;
    renderLeaderboard(response);
    setConnection("live", "数据在线");
  } catch (error) {
    if (seq === state.seq) showError(error);
  }
}

function renderLeaderboard(response) {
  const entries = response.entries ?? [];
  const rows = entries.length === 0
    ? `<tr><td colspan="8"><div class="empty" style="min-height:160px;border:0"><strong>排行榜还没有数据</strong><p>玩家提交结算后即可进入排行。</p></div></td></tr>`
    : entries.map((entry) => `
      <tr class="is-clickable" data-session-id="${escapeHtml(entry.sessionId)}">
        <td class="num strong" style="color:${entry.rank <= 3 ? "var(--gold)" : "var(--muted)"}">#${formatInt(entry.rank)}</td>
        <td>
          <div class="player-cell">
            <span class="avatar">${escapeHtml(initials(entry.displayName))}</span>
            <span><strong>${escapeHtml(entry.displayName)}${entry.isYou ? " · 你" : ""}</strong><small>${escapeHtml(shortId(entry.sessionId))}</small></span>
          </div>
        </td>
        <td class="num strong">${formatScore(entry.bestScore)}</td>
        <td class="num">${formatInt(entry.wins)}</td>
        <td class="num">${formatInt(entry.runs)}</td>
        <td class="num">${formatPct(entry.winRate, 0)}</td>
        <td class="num">${formatInt(entry.bestCompleted)}</td>
        <td class="nowrap">${formatDateTime(entry.lastPlayedAt)}</td>
      </tr>`).join("");

  viewRoot.innerHTML = `
    ${pageHead("LEADERBOARD", "排行榜", "按匿名会话聚合最佳成绩。排行榜只展示昵称与派生标识，不公开完整 sessionId。",
      `<div class="tabs">
        <button type="button" data-sort="score" class="${state.leaderboardSort === "score" ? "is-active" : ""}">最佳得分</button>
        <button type="button" data-sort="wins" class="${state.leaderboardSort === "wins" ? "is-active" : ""}">胜场</button>
        <button type="button" data-sort="completed" class="${state.leaderboardSort === "completed" ? "is-active" : ""}">验收需求</button>
      </div>`)}
    <div class="note-block"><b>排名规则：</b>同一玩家多局取最佳值；得分相同时依次比较胜场、最近游玩时间。当前排序：<b>${state.leaderboardSort === "score" ? "最佳得分" : state.leaderboardSort === "wins" ? "胜场" : "验收需求"}</b>。</div>
    <div class="table-wrap" style="margin-top:14px">
      <table>
        <thead><tr><th class="num">名次</th><th>玩家</th><th class="num">最佳分</th><th class="num">胜场</th><th class="num">对局</th><th class="num">胜率</th><th class="num">最佳验收</th><th>最近游玩</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

async function loadAchievements() {
  const seq = ++state.seq;
  showSkeleton();
  try {
    const response = await api("/api/admin/achievements");
    if (seq !== state.seq) return;
    renderAchievements(response);
    setConnection("live", "数据在线");
  } catch (error) {
    if (seq === state.seq) showError(error);
  }
}

function renderAchievements(data) {
  const stats = data.stats ?? [];
  const totals = data.totals ?? {};
  const recent = data.recentUnlocks ?? [];
  const cards = stats.map((achievement) => `
    <article class="achievement-card tier-${escapeHtml(achievement.tier)}">
      <div class="achievement-top">
        <span class="achievement-icon">${escapeHtml(achievement.icon)}</span>
        <span class="achievement-points">+${formatInt(achievement.points)} · ${tierName(achievement.tier)}</span>
      </div>
      <h4>${escapeHtml(achievement.name)}</h4>
      <p>${escapeHtml(achievement.description)}</p>
      <div class="achievement-progress"><i style="width:${number(achievement.rate) * 100}%"></i></div>
      <div class="achievement-meta">
        <span>${formatInt(achievement.unlockedRuns)} 局解锁 · ${formatInt(achievement.players)} 人</span>
        <span>${formatPct(achievement.rate, 0)}</span>
      </div>
    </article>`).join("");

  const recentList = recent.length === 0
    ? `<p class="muted" style="font-size:10px;margin:0">暂无解锁记录。</p>`
    : `<ul class="list-plain">${recent.map((entry) => `
        <li class="list-row" data-session-id="${escapeHtml(entry.sessionId)}" style="cursor:pointer">
          <span class="achievement-icon tier-${escapeHtml(entry.tier)}" style="width:26px;height:26px;font-size:11px">${escapeHtml(entry.icon)}</span>
          <span class="grow"><strong>${escapeHtml(entry.displayName)} 解锁「${escapeHtml(entry.achievementName)}」</strong><small>${escapeHtml(formatDateTime(entry.unlockedAt))} · ${escapeHtml(shortId(entry.runId))}</small></span>
          <b>+${formatInt(entry.points ?? 0)}</b>
        </li>`).join("")}</ul>`;

  viewRoot.innerHTML = `
    ${pageHead("ACHIEVEMENTS", "成就系统", "20 项成就在服务端从结算 run 与行为事件确定性推导，无需额外上报或回填。",
      `<button class="ghost-button" type="button" data-view-link="sessions">查看玩家成就墙</button>`)}
    <div class="kpi-grid">
      ${kpi("成就总数", formatInt((data.definitions ?? []).length), "覆盖交付 / 团队 / 决策 / 风险 / 速度", "gold")}
      ${kpi("解锁对局", formatInt(totals.unlockedRuns), `共 ${formatInt(totals.runs)} 局`)}
      ${kpi("获得成就玩家", formatInt(totals.playersWithAny), "至少解锁 1 项")}
      ${kpi("发放点数", formatInt(totals.pointsAwarded), "每局每项只计一次")}
    </div>
    <div class="section-title"><h2>解锁率</h2><span>UNLOCK RATE</span></div>
    <div class="achievement-grid">${cards || emptyState("暂无成就定义", "成就定义来自 shared/achievements.ts。")}</div>
    <div class="section-title"><h2>最近解锁</h2><span>RECENT UNLOCKS</span></div>
    ${panel("最近 12 条解锁记录", "点击记录进入对应玩家档案", recentList, "LIVE FEED")}`;
}

// The delegation above references data-view-link; handle it centrally.
main.addEventListener("click", (event) => {
  const link = event.target.closest("[data-view-link]");
  if (link) loadView(link.dataset.viewLink);
});

boot();
