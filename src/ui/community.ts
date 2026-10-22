import {
  type AchievementWallEntry
} from "../../shared/achievements.ts";
import { buildLocalAchievementWall, buildLocalBestRuns, type LocalBestRun } from "./local-stats";

interface LiveLeaderboardEntry {
  rank: number;
  displayName: string;
  bestScore: number;
  wins: number;
  runs: number;
  winRate: number;
  bestCompleted: number;
  lastPlayedAt: string | null;
  isYou: boolean;
}

interface LeaderboardResponse {
  ok: boolean;
  entries: LiveLeaderboardEntry[];
}

interface SessionAchievementsResponse {
  ok: boolean;
  displayName: string;
  totalPoints: number;
  unlockedCount: number;
  achievements: AchievementWallEntry[];
  runs: Array<{ runId: string; endedAt: string; unlocked: number; points: number }>;
}

interface CommunityOptions {
  apiBaseUrl: string;
  sessionId: string;
  onOpen?: (kind: "leaderboard" | "achievements") => void;
}

export class CommunityPanel {
  private overlay: HTMLElement | null = null;
  private readonly apiBaseUrl: string;
  private readonly sessionId: string;
  private readonly onOpen?: (kind: "leaderboard" | "achievements") => void;

  constructor(options: CommunityOptions) {
    this.apiBaseUrl = options.apiBaseUrl.replace(/\/+$/, "");
    this.sessionId = options.sessionId;
    this.onOpen = options.onOpen;
  }

  get enabled(): boolean {
    return Boolean(this.apiBaseUrl);
  }

  openLeaderboard(): void {
    this.onOpen?.("leaderboard");
    this.mount("leaderboard");
  }

  openAchievements(): void {
    this.onOpen?.("achievements");
    this.mount("achievements");
  }

  close(): void {
    if (!this.overlay) return;
    this.overlay.remove();
    this.overlay = null;
    document.removeEventListener("keydown", this.handleKeydown);
  }

  private readonly handleKeydown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") this.close();
  };

  private mount(kind: "leaderboard" | "achievements"): void {
    this.close();
    const overlay = document.createElement("div");
    overlay.className = "live-overlay";
    overlay.innerHTML = `
      <div class="live-dialog" role="dialog" aria-modal="true" aria-labelledby="live-title">
        <header class="live-head">
          <div>
            <span class="live-kicker">${kind === "leaderboard" ? "LIVE RANKING" : "ACHIEVEMENT WALL"}</span>
            <h2 id="live-title">${kind === "leaderboard" ? "排行榜" : "成就墙"}</h2>
            <p>${kind === "leaderboard" ? "按最佳得分聚合的匿名工程师排行。" : "成就由结算数据与行为事件推导，离线也可查看本机记录。"}</p>
          </div>
          <button class="live-close" type="button" aria-label="关闭">×</button>
        </header>
        <div class="live-body"><div class="live-loading"><i></i><span>正在读取数据</span></div></div>
        <footer class="live-foot"><span data-live-source>${this.apiBaseUrl ? "在线数据" : "本机数据"}</span><button class="live-close-text" type="button">关闭</button></footer>
      </div>`;
    document.body.append(overlay);
    this.overlay = overlay;
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay || (event.target as HTMLElement).closest(".live-close, .live-close-text")) this.close();
    });
    document.addEventListener("keydown", this.handleKeydown);
    if (kind === "leaderboard") void this.loadLeaderboard();
    else void this.loadAchievements();
  }

  private body(): HTMLElement | null {
    return this.overlay?.querySelector<HTMLElement>(".live-body") ?? null;
  }

  private source(text: string): void {
    const element = this.overlay?.querySelector<HTMLElement>("[data-live-source]");
    if (element) element.textContent = text;
  }

  private async loadLeaderboard(): Promise<void> {
    let entries: LiveLeaderboardEntry[] | null = null;
    let online = false;
    if (this.apiBaseUrl) {
      try {
        const response = await this.request<LeaderboardResponse>(`/api/leaderboard?limit=10&sessionId=${encodeURIComponent(this.sessionId)}`);
        entries = response.entries;
        online = true;
      } catch {
        entries = null;
      }
    }
    const local = buildLocalBestRuns(10).map(toLiveEntry);
    const display = entries && entries.length > 0 ? entries : local;
    this.renderLeaderboard(display, Boolean(entries && entries.length > 0 && online));
    this.source(entries && entries.length > 0 && online ? "在线数据 · 前十名" : "离线模式 · 本机记录");
  }

  private async loadAchievements(): Promise<void> {
    if (this.apiBaseUrl) {
      try {
        const response = await this.request<SessionAchievementsResponse>(
          `/api/achievements?sessionId=${encodeURIComponent(this.sessionId)}`
        );
        if (response.unlockedCount > 0 || buildLocalAchievementWall().unlockedCount === 0) {
          this.renderAchievements(response.achievements, response.unlockedCount, response.totalPoints, true);
          this.source("在线数据 · 服务端判定");
          return;
        }
      } catch {
        // Fall through to local records.
      }
    }
    const local = buildLocalAchievementWall();
    this.renderAchievements(local.achievements, local.unlockedCount, local.totalPoints, false);
    this.source(local.runs > 0 ? "本机记录 · 离线判定" : "暂无成就记录");
  }

  private renderLeaderboard(entries: LiveLeaderboardEntry[], online: boolean): void {
    const body = this.body();
    if (!body) return;
    if (entries.length === 0) {
      body.innerHTML = `
        <div class="live-empty">
          <strong>还没有排行数据</strong>
          <p>${this.apiBaseUrl ? "联网提交一局结算后即可进入排行榜。" : "配置 VITE_API_BASE_URL 后可以连接在线排行榜；当前会记录本机最佳成绩。"}</p>
        </div>`;
      return;
    }
    body.innerHTML = `
      <div class="live-table-wrap">
        <table class="live-table">
          <thead><tr><th class="num">#</th><th>玩家</th><th class="num">最佳分</th><th class="num">胜场</th><th class="num">对局</th><th class="num">最佳验收</th></tr></thead>
          <tbody>${entries.map((entry) => `
            <tr class="${entry.isYou ? "is-you" : ""}">
              <td class="num ${entry.rank <= 3 ? "is-podium" : ""}">${entry.rank}</td>
              <td><span class="live-player">${escapeHtml(entry.displayName)}${entry.isYou ? `<b>你</b>` : ""}</span></td>
              <td class="num strong">${formatNumber(entry.bestScore)}</td>
              <td class="num">${formatNumber(entry.wins)}</td>
              <td class="num">${formatNumber(entry.runs)}</td>
              <td class="num">${formatNumber(entry.bestCompleted)}</td>
            </tr>`).join("")}</tbody>
        </table>
      </div>
      ${online ? "" : `<p class="live-note">当前显示的是本机历史成绩。${this.apiBaseUrl ? "连接排行榜服务失败，可能服务端尚未启动。" : "设置 VITE_API_BASE_URL 后可参与在线排行。"}</p>`}`;
  }

  private renderAchievements(achievements: AchievementWallEntry[], unlockedCount: number, totalPoints: number, online: boolean): void {
    const body = this.body();
    if (!body) return;
    const sorted = [...achievements].sort((a, b) => Number(b.unlocked) - Number(a.unlocked) || b.progress - a.progress);
    body.innerHTML = `
      <div class="live-achievement-summary">
        <span><strong>${formatNumber(unlockedCount)}</strong><small>/ ${formatNumber(achievements.length)} 已解锁</small></span>
        <span><strong>${formatNumber(totalPoints)}</strong><small>成就点数</small></span>
        <span class="live-mode">${online ? "服务端判定" : "本机判定"}</span>
      </div>
      <div class="live-achievement-grid">
        ${sorted.map((achievement) => `
          <article class="live-achievement tier-${achievement.tier} ${achievement.unlocked ? "" : "is-locked"}">
            <span class="live-achievement-icon">${escapeHtml(achievement.icon)}</span>
            <span class="live-achievement-copy">
              <strong>${escapeHtml(achievement.name)}${achievement.unlocked ? " ✓" : ""}</strong>
              <small>${escapeHtml(achievement.detail)}</small>
              <i><b style="width:${Math.round(achievement.progress * 100)}%"></b></i>
            </span>
            <span class="live-achievement-points">+${achievement.points}</span>
          </article>`).join("")}
      </div>
      ${online ? "" : `<p class="live-note">本机成就来自浏览器保存的事件与结算记录；清除站点数据后会重置。</p>`}`;
  }

  private async request<T>(path: string): Promise<T> {
    const controller = new AbortController();
    const timer = globalThis.setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(`${this.apiBaseUrl}${path}`, {
        signal: controller.signal,
        headers: { accept: "application/json" }
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json() as T;
    } finally {
      globalThis.clearTimeout(timer);
    }
  }
}

function toLiveEntry(run: LocalBestRun): LiveLeaderboardEntry {
  return {
    rank: run.rank,
    displayName: run.displayName,
    bestScore: run.score,
    wins: run.result === "win" ? 1 : 0,
    runs: 1,
    winRate: run.result === "win" ? 1 : 0,
    bestCompleted: run.completedRequests,
    lastPlayedAt: run.endedAt,
    isYou: true
  };
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("zh-CN").format(Math.round(value));
}

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[character] ?? character));
}
