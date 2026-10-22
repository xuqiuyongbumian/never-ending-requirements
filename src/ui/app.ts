import type Phaser from "phaser";
import {
  activateShipIt,
  BASE_FRONT_EDGE,
  chooseChange,
  createBattle,
  DEBT_INTEREST_PER_DEBT_PER_SECOND,
  ENGINEER_DEFS,
  ERAS,
  getEngineerCost,
  getEngineerDefinition,
  getNextEra,
  hireEngineer,
  isAgentBanned,
  MAX_POPULATION,
  MAX_PROJECT_HEALTH,
  MAX_TRAINING_QUEUE,
  SHIP_IT_COOLDOWN,
  SHIP_IT_DEBT_COST,
  SHIP_IT_DURATION,
  SHIP_IT_WORK_BONUS,
  ROUND_DURATION,
  tutorialText,
  upgradeEra,
  type BattleState,
  type EngineerId
} from "../core/game";
import { GAME_ASSETS } from "../presentation/game-assets";
import { AudioEngine } from "../audio/audio-engine";
import { withAudioPatch } from "../audio/audio-settings";
import { audioPanelMarkup, bindAudioPanel, syncAudioPanel } from "./audio-panel";
import { CommunityPanel } from "./community";
import { buildLocalAchievementWall, evaluateCurrentRun, localPersonalBest } from "./local-stats";
import { summarizeRun, TelemetryReporter } from "./telemetry";
import { getDeliveryProgress } from "./run-progress";
import { getOpeningBattlePlanHint, getUpcomingBattlePlanHint } from "./battle-plan-hints";
import { calculateRunScore } from "../../shared/scoring.ts";

type CreateGame = (updateHud: (state: BattleState) => void) => Promise<Phaser.Game>;

const NICKNAME_KEY = "1024-ai-game-nickname";

export class GameApp {
  private state: BattleState | null = null;
  private game: Phaser.Game | null = null;
  private visibilityPaused = false;
  private telemetryCursor = 0;
  private stageEra = -1;
  private readonly telemetry = new TelemetryReporter();
  private readonly community: CommunityPanel;
  private readonly audio = new AudioEngine();

  constructor(private readonly root: HTMLElement, private readonly createGame: CreateGame) {
    this.community = new CommunityPanel({
      apiBaseUrl: this.telemetry.apiBaseUrl,
      sessionId: this.telemetry.sessionId,
      onOpen: (kind) => this.telemetry.trackInteraction(kind === "leaderboard" ? "open_leaderboard" : "open_achievements")
    });
    this.telemetry.setNickname(readNickname());
    // CSS 变量里的 url() 是相对"使用它的样式表"解析的，而样式表位于 /assets/ 下，
    // 直接塞 "./assets/..." 会被解析成 /assets/assets/... 导致 404。
    // 这里统一转成绝对 URL，使其与样式表位置无关。
    const menuBackground = new URL(GAME_ASSETS.backgrounds[0].src, document.baseURI).href;
    document.documentElement.style.setProperty("--studio-background", `url("${menuBackground}")`);
    document.addEventListener("keydown", (event) => this.handleKeydown(event));
    document.addEventListener("visibilitychange", () => this.handleVisibilityChange());
    document.addEventListener("fullscreenchange", () => {
      const active = Boolean(document.fullscreenElement);
      for (const button of this.root.querySelectorAll<HTMLButtonElement>("#fullscreen-game, #fullscreen-menu")) {
        button.setAttribute("aria-label", active ? "退出全屏" : "进入全屏");
        button.title = active ? "退出全屏（Esc）" : "进入全屏";
      }
    });
    this.telemetry.enter();
    this.showMenu();
  }

  private showMenu(): void {
    this.community.close();
    document.querySelector<HTMLElement>("#stage")?.classList.remove("is-battle-mode");
    if (this.state?.phase === "running") this.abandonCurrentRun(this.state);
    if (this.state) this.game?.scene.stop("battle");
    this.game?.registry.remove("battleState");
    this.state = null;
    this.visibilityPaused = false;
    // The score keeps running across menu switches; only its layers calm down.
    this.audio.setMusicMood({ rush: false, incident: false, urgent: false });
    this.audio.setDuck(1);
    const personalBest = localPersonalBest();
    const achievementWall = buildLocalAchievementWall();
    const unlockedAchievements = achievementWall.achievements
      .filter((achievement) => achievement.unlocked)
      .sort((a, b) => b.points - a.points);
    const showcased = unlockedAchievements.length > 0
      ? unlockedAchievements.slice(0, 8)
      : achievementWall.achievements.slice().sort((a, b) => b.progress - a.progress).slice(0, 3);
    const achievementCards = showcased.map((achievement) => `
              <article class="menu-achievement tier-${achievement.tier} ${achievement.unlocked ? "is-unlocked" : "is-locked"}">
                <span class="menu-achievement-icon">${escapeText(achievement.icon)}</span>
                <div class="menu-achievement-copy">
                  <strong>${escapeText(achievement.name)}${achievement.unlocked ? " ✓" : ""}</strong>
                  <p>${escapeText(achievement.unlocked ? achievement.description : achievement.hint)}</p>
                  <span class="menu-achievement-progress"><i style="width:${Math.round(Math.max(0, Math.min(1, achievement.progress)) * 100)}%"></i></span>
                </div>
                <span class="menu-achievement-points">+${achievement.points}</span>
              </article>`).join("");
    this.root.innerHTML = `
      <section class="menu-screen">
        <div class="menu-grid" aria-hidden="true"></div>
        <button class="menu-home-fullscreen" id="fullscreen-menu" aria-label="进入全屏" title="进入全屏">⛶</button>
        <div class="menu-content">
          <section class="menu-hero" aria-labelledby="menu-title">
            <div class="eyebrow"><span class="live-dot"></span>1024 AI 游戏创作赛 · 5 分钟限时关卡</div>
            <h1 id="menu-title">需求永不眠</h1>
            <p class="menu-subtitle">组建研发团队，处理不断涌来的需求，在最后期限前让项目上线。</p>
            <div class="menu-roster" aria-label="五种研发岗位">
              <div class="menu-roster-portraits" aria-hidden="true">
                ${ENGINEER_DEFS.map((engineer) => `<img src="${GAME_ASSETS.characters[engineer.id].src}" alt="" title="${engineer.name}" />`).join("")}
              </div>
              <span><strong>五种岗位 · 三个时代</strong><small>组队处理需求，赶在倒计时归零前上线</small></span>
            </div>
            <article class="mission-card">
              <div class="mission-topline"><span>极限上线挑战</span><span class="mission-tag">版本 10.24</span></div>
              <h2>需求永不眠：1024 极限上线</h2>
              <p>需求会从右侧逼近，处理时也不会停下。专长角色处理更快，同岗位重复招聘成本会上升。点击任务卡调度，按 R 冲刺 12 秒（效率 +40%，技术债 +25）。</p>
              <div class="mission-objective"><span class="objective-mark">✓</span>招人 · 进化 · 处理变更 · 准时上线</div>
              <button class="primary-button" id="start-battle"><span>开始新项目</span><span class="button-arrow">↗</span></button>
            </article>
          </section>
          <aside class="menu-side" aria-label="成就与其他信息">
            <section class="menu-achievements" aria-label="成就陈列">
              <header class="menu-achievements-head">
                <div class="menu-achievements-title">
                  <span class="menu-achievements-kicker">ACHIEVEMENTS</span>
                  <strong>成就陈列</strong>
                </div>
                <div class="menu-achievements-stats">
                  <span><b>${achievementWall.unlockedCount}</b><small>/${achievementWall.achievements.length} 已解锁</small></span>
                  <span><b>${achievementWall.totalPoints}</b><small>成就点数</small></span>
                  <button class="menu-ghost-button" id="open-achievements-wall" type="button">完整成就墙 ↗</button>
                </div>
              </header>
              <div class="menu-achievement-grid">${achievementCards}</div>
              ${achievementWall.runs === 0 ? `<p class="menu-achievements-empty">还没有结算记录，完成第一局即可点亮成就。</p>` : ""}
            </section>
            <div class="era-preview">
              <div><span class="era-step">01</span><strong>手搓时代</strong><small>实习生 · 前端</small></div>
              <span class="era-arrow">→</span>
              <div><span class="era-step">02</span><strong>工程化时代</strong><small>后端 · 测试</small></div>
              <span class="era-arrow">→</span>
              <div><span class="era-step">03</span><strong>Agent 时代</strong><small>AI Agent · 技术债</small></div>
            </div>
            <div class="menu-community">
              <label class="nickname-field" for="nickname-input">
                <span>排行榜昵称<small>仅随结算上报，可留空</small></span>
                <input id="nickname-input" type="text" maxlength="24" autocomplete="nickname" placeholder="匿名工程师" value="${escapeAttribute(readNickname())}" />
              </label>
              <div class="menu-community-actions">
                <button class="menu-ghost-button" id="open-leaderboard" type="button">排行榜 ↗</button>
                <button class="menu-ghost-button" id="open-achievements" type="button">成就墙 ↗</button>
                <span class="menu-best">本机最佳 <b>${personalBest ? personalBest.score : "—"}</b></span>
              </div>
            </div>
            <div class="menu-footnote"><span>PHASER 4</span><span>·</span><span>单机策略 · 浏览器即开即玩</span></div>
          </aside>
        </div>
      </section>`;
    this.root.querySelector<HTMLButtonElement>("#start-battle")?.addEventListener("click", () => this.startBattle());
    this.root.querySelector<HTMLButtonElement>("#fullscreen-menu")?.addEventListener("click", () => void this.toggleFullscreen());
    const nicknameInput = this.root.querySelector<HTMLInputElement>("#nickname-input");
    nicknameInput?.addEventListener("input", () => {
      saveNickname(nicknameInput.value);
      this.telemetry.setNickname(nicknameInput.value);
    });
    this.root.querySelector("#open-achievements-wall")?.addEventListener("click", () => this.community.openAchievements());
    this.root.querySelector("#open-leaderboard")?.addEventListener("click", () => this.community.openLeaderboard());
    this.root.querySelector("#open-achievements")?.addEventListener("click", () => this.community.openAchievements());
  }

  private abandonCurrentRun(state: BattleState): void {
    const summary = summarizeRun(state.telemetry);
    this.telemetry.abandonRun({
      elapsed: Math.round(state.elapsed * 10) / 10,
      completedRequests: summary.completedRequests,
      recruitCount: summary.recruitedEngineers,
      missedRequests: summary.missedRequests,
      finalEra: state.techEra,
      finalTechDebt: Math.round(state.techDebt),
      finalProjectHealth: Math.round(state.projectHealth)
    });
  }

  private async startBattle(replay = false): Promise<void> {
    // Browsers only allow audio to start inside a gesture, so unlock first.
    await this.audio.unlock();
    this.community.close();
    this.telemetry.setNickname(readNickname());
    this.telemetry.beginRun();
    if (replay) this.telemetry.track("replay", {});
    const state = createBattle(Date.now() >>> 0);
    this.state = state;
    this.telemetryCursor = 0;
    if (!this.game) {
      this.root.innerHTML = `<section class="loading-screen"><span class="loading-mark">1024</span><strong>正在准备项目现场</strong><small>首次启动正在载入游戏引擎…</small></section>`;
      try {
        this.game = await this.createGame((nextState) => this.updateHud(nextState));
      } catch {
        this.state = null;
        this.telemetry.track("load_error", { stage: "phaser_init" });
        this.showMenu();
        const button = this.root.querySelector<HTMLButtonElement>("#start-battle");
        if (button) button.textContent = "载入失败，点击重试";
        return;
      }
    }
    this.game.registry.set("battleState", state);
    this.game.registry.set("audio", this.audio);
    this.game.scene.start("battle", { state });
    this.audio.startMusic(state.techEra);
    this.renderBattleHud();
    this.updateHud(state);
  }

  private renderBattleHud(): void {
    document.querySelector<HTMLElement>("#stage")?.classList.add("is-battle-mode");
    this.root.innerHTML = `
      <section class="battle-ui" aria-label="需求永不眠项目现场">
        <div class="orientation-guide" role="status"><div><span>1024 · GO-LIVE</span><strong>请横屏游玩</strong><small>旋转设备以查看完整战场和操作面板。</small></div></div>
        <header class="battle-header">
          <div class="header-identity">
            <button class="back-button" id="back-to-menu" aria-label="返回首页">← <span>项目列表</span></button>
            <div class="battle-title"><span class="title-kicker">1024 AI 创作赛</span><strong>需求永不眠</strong><small data-era-heading>手搓时代</small></div>
          </div>
          <div class="header-goal">
            <div class="deadline-clock"><span>距离上线</span><strong data-time>05:00</strong></div>
            <div class="goal-progress"><span data-goal-label>常规验收</span><strong data-goal-value>0 / 11</strong><i class="goal-track"><i data-goal-bar></i></i><small data-boss-status></small></div>
          </div>
          <div class="header-actions">
            <div class="metric-pill budget-pill"><img class="metric-icon" src="${GAME_ASSETS.icons.budget.src}" alt="" aria-hidden="true"><strong data-budget>145</strong><small>预算</small></div>
            <div class="metric-pill exp-pill"><img class="metric-icon" src="${GAME_ASSETS.icons.experience.src}" alt="" aria-hidden="true"><strong data-exp>0</strong><small>经验</small></div>
            <div class="project-status left-status">
              <div class="status-copy"><span><img class="status-icon" src="${GAME_ASSETS.icons.stability.src}" alt="" aria-hidden="true">健康</span><strong data-health-label>100%</strong></div>
              <span class="status-track"><i data-health-bar></i></span>
            </div>
            <div class="project-status right-status">
              <div class="status-copy"><span><img class="status-icon" src="${GAME_ASSETS.icons.techDebt.src}" alt="" aria-hidden="true">技术债</span><strong data-debt-label>0</strong></div>
              <span class="status-track debt-track"><i data-debt-bar></i></span>
              <small class="debt-interest" data-debt-hint role="status" aria-live="polite" hidden></small>
              <small class="debt-warning" data-debt-warning role="status" aria-live="polite" hidden>线上事故风险升高</small>
              <small class="ai-ban-banner" data-ai-ban role="status" aria-live="polite" hidden></small>
            </div>
            ${audioPanelMarkup(this.audio.settings)}
            <button class="icon-button" id="fullscreen-game" aria-label="进入全屏" title="进入全屏">⛶</button>
            <button class="icon-button" id="pause-game" aria-label="暂停">Ⅱ</button>
          </div>
        </header>

        <div class="tutorial-callout" role="status" aria-live="polite"><strong data-plan-hint></strong><span data-tutorial></span></div>
        <div class="battle-notice" data-notice role="status" aria-live="polite"></div>

        <section class="unit-deck" aria-label="招聘工程师">
          <div class="deck-heading">
            <span><i class="heading-dot"></i>研发团队</span>
            <div class="deck-status">
              <span class="deck-team-count">团队 <b data-team>1 / ${MAX_POPULATION}</b></span>
              <span class="deck-separator">·</span>
              <span data-queue>招聘队列：空</span>
              <span class="deck-separator">·</span>
              <span class="open-requests-status" data-open-requests>待办 0</span>
              <button id="speed-game" class="speed-button">速度 1×</button>
            </div>
          </div>
          <div class="unit-cards">${ENGINEER_DEFS.map((engineer, index) => `
            <button class="unit-card role-${engineer.id}" data-role="${engineer.id}" aria-label="招聘${engineer.name}，消耗${engineer.cost}预算" title="${engineer.summary}">
              <span class="unit-card-top"><span class="unit-key">0${index + 1}</span><img class="unit-portrait" src="${GAME_ASSETS.characters[engineer.id].src}" alt="" aria-hidden="true"></span>
              <strong>${engineer.name}</strong>
              <span class="unit-card-bottom"><small class="role-state" data-role-state>${engineer.era ? `${ERAS[engineer.era].name}解锁` : `交付 ${engineer.workRate}/秒`}</small><b><span aria-hidden="true">◈</span> <span data-role-cost>${engineer.cost}</span></b></span>
            </button>`).join("")}
          </div>
          <div class="deck-footer">
            <span class="hint-copy">点需求卡优先调度 · R 冲刺 · 1–5 招聘</span>
            <div class="deck-actions">
              <button id="ship-it" class="ship-it-button" aria-label="极限冲刺：持续 12 秒，效率提升 40%，技术债增加 25，冷却 45 秒" title="持续 12 秒，效率 +40%，技术债 +25，冷却 45 秒">
                <span data-ship-it-label>极限冲刺</span><small data-ship-it-state>+40% · 技术债 +25</small>
              </button>
              <button id="upgrade-era" class="era-button" aria-label="升级技术时代"><span data-era-button>升级时代</span><small data-era-cost>需要 80 经验</small></button>
            </div>
          </div>
        </section>

        <section class="change-panel" data-change-panel aria-modal="true" role="dialog" hidden>
          <div class="change-stamp"><img class="event-icon" src="${GAME_ASSETS.icons.event.src}" alt="" aria-hidden="true">需求变更</div>
          <span class="change-kicker">产品 / 运营 / 线上事件</span>
          <h2 data-change-title></h2>
          <p data-change-body></p>
          <div class="change-choices" data-change-choices></div>
          <small>选择后项目继续计时；选择会影响预算、效率和技术债。</small>
        </section>

        <section class="result-panel" data-result aria-live="assertive" hidden>
          <div class="result-stamp" data-result-stamp>上线成功</div>
          <span class="result-kicker">1024 极限上线 · 项目复盘</span>
          <h2 data-result-title>项目上线成功</h2>
          <p data-result-copy></p>
          <div class="result-score"><span>本局得分</span><strong data-run-score>0</strong><small data-run-achievement-summary>未解锁成就</small></div>
          <div class="result-achievements" data-result-achievements></div>
          <div class="result-stats">
            <span>最终健康<strong data-final-health></strong></span><span>技术债<strong data-final-debt></strong></span><span>完成时代<strong data-final-era></strong></span>
            <span>常规验收<strong data-run-requests></strong></span><span>额外需求<strong data-run-extras></strong></span><span>Boss<strong data-run-boss></strong></span><span>最终上线<strong data-run-go-live></strong></span><span>招募工程师<strong data-run-hires></strong></span><span>应对变更<strong data-run-events></strong></span>
          </div>
          <div class="result-actions">
            <button class="primary-button" id="replay-battle">再开一个项目 <span>↻</span></button>
            <div class="result-secondary-actions">
              <button class="secondary-button" id="result-leaderboard">查看排行榜</button>
              <button class="secondary-button" id="result-achievements-open">成就墙</button>
              <button class="tertiary-button" id="export-analytics">导出本局行为数据</button>
            </div>
            <button class="tertiary-button" id="result-home">返回首页</button>
          </div>
        </section>
      </section>`;

    for (const button of this.root.querySelectorAll<HTMLButtonElement>("[data-role]")) {
      button.addEventListener("click", () => this.hire(button.dataset.role as EngineerId));
    }
    this.root.querySelector("#upgrade-era")?.addEventListener("click", () => this.advanceEra());
    this.root.querySelector("#pause-game")?.addEventListener("click", () => this.togglePause());
    this.root.querySelector("#fullscreen-game")?.addEventListener("click", () => void this.toggleFullscreen());
    this.root.querySelector("#speed-game")?.addEventListener("click", () => this.toggleSpeed());
    this.root.querySelector("#ship-it")?.addEventListener("click", () => this.useShipIt());
    this.root.querySelector("#back-to-menu")?.addEventListener("click", () => this.showMenu());
    this.root.querySelector("#replay-battle")?.addEventListener("click", () => this.startBattle(true));
    this.root.querySelector("#export-analytics")?.addEventListener("click", () => {
      this.telemetry.trackInteraction("export_run");
      this.telemetry.exportCurrentRun();
    });
    this.root.querySelector("#result-leaderboard")?.addEventListener("click", () => this.community.openLeaderboard());
    this.root.querySelector("#result-achievements-open")?.addEventListener("click", () => this.community.openAchievements());
    this.root.querySelector("#result-home")?.addEventListener("click", () => this.showMenu());
    bindAudioPanel(this.root, () => this.audio.settings, {
      onChange: (patch) => {
        this.audio.setSettings(withAudioPatch(this.audio.settings, patch));
        syncAudioPanel(this.root, this.audio.settings);
        if (typeof patch.muted === "boolean") {
          this.telemetry.trackInteraction("audio_setting", { muted: patch.muted });
        }
      },
      onPreview: () => this.audio.playCue("ui_tick")
    });
  }

  private hire(role: EngineerId): void {
    if (!this.state) return;
    const hired = hireEngineer(this.state, role);
    if (!hired) this.audio.playCue("denied", { gain: 0.55 });
    if (hired && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const card = this.root.querySelector<HTMLButtonElement>(`[data-role="${role}"]`);
      card?.animate(
        [
          { transform: "scale(1)", boxShadow: "0 0 0 rgb(255 189 115 / 0%)" },
          { transform: "scale(1.045)", boxShadow: "0 0 22px rgb(255 189 115 / 44%)", offset: 0.55 },
          { transform: "scale(1)", boxShadow: "0 0 0 rgb(255 189 115 / 0%)" }
        ],
        { duration: 340, easing: "cubic-bezier(.2,.8,.25,1)" }
      );
    }
    this.updateHud(this.state);
  }

  private advanceEra(): void {
    if (!this.state) return;
    if (!upgradeEra(this.state)) this.audio.playCue("denied", { gain: 0.55 });
    this.updateHud(this.state);
  }

  private useShipIt(): void {
    if (!this.state) return;
    if (!activateShipIt(this.state)) this.audio.playCue("denied", { gain: 0.55 });
    this.updateHud(this.state);
  }

  private togglePause(): void {
    if (!this.state || this.state.phase !== "running") return;
    this.state.paused = !this.state.paused;
    this.telemetry.trackInteraction("pause", { paused: this.state.paused });
    this.syncPauseButton();
    this.audio.update(this.state);
  }

  private handleVisibilityChange(): void {
    if (document.hidden) {
      // Suspend before touching state so the score never plays to a hidden tab.
      this.audio.suspend();
    } else {
      this.audio.resume();
    }
    if (!this.state || this.state.phase !== "running") return;
    if (document.hidden && !this.state.paused) {
      this.visibilityPaused = true;
      this.state.paused = true;
    } else if (!document.hidden && this.visibilityPaused) {
      this.visibilityPaused = false;
      this.state.paused = false;
    }
    this.syncPauseButton();
  }

  private syncPauseButton(): void {
    if (!this.state) return;
    const button = this.root.querySelector<HTMLButtonElement>("#pause-game");
    if (button) {
      button.textContent = this.state.paused ? "▶" : "Ⅱ";
      button.setAttribute("aria-label", this.state.paused ? "继续" : "暂停");
    }
    this.root.classList.toggle("is-paused", this.state.paused);
  }

  private toggleSpeed(): void {
    if (!this.state || this.state.phase !== "running") return;
    this.state.speed = this.state.speed === 1 ? 2 : 1;
    this.telemetry.trackInteraction("speed", { speed: this.state.speed });
    const button = this.root.querySelector<HTMLButtonElement>("#speed-game");
    if (button) button.textContent = `速度　${this.state.speed}×`;
  }

  private async toggleFullscreen(): Promise<void> {
    const target = this.root.closest<HTMLElement>("#app");
    const button = this.root.querySelector<HTMLButtonElement>("#fullscreen-game, #fullscreen-menu");
    if (!target) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (target.requestFullscreen) await target.requestFullscreen();
      else if (button) {
        button.setAttribute("aria-label", "浏览器不支持全屏");
        button.title = "浏览器不支持全屏，请使用浏览器的全屏功能";
      }
    } catch {
      if (button) {
        button.setAttribute("aria-label", "无法进入全屏");
        button.title = "无法进入全屏，请检查浏览器权限";
      }
    }
  }

  private handleKeydown(event: KeyboardEvent): void {
    if (event.repeat) return;
    if (event.key.toLowerCase() === "m") {
      this.toggleMute();
      return;
    }
    if (!this.state || this.state.phase !== "running") return;
    if (event.code === "Space") {
      event.preventDefault();
      this.togglePause();
      return;
    }
    if (event.key.toLowerCase() === "e") {
      this.advanceEra();
      return;
    }
    if (event.key.toLowerCase() === "r") {
      event.preventDefault();
      this.useShipIt();
      return;
    }
    const role = ENGINEER_DEFS[Number(event.key) - 1];
    if (role) this.hire(role.id);
  }

  private toggleMute(): void {
    this.audio.setSettings(withAudioPatch(this.audio.settings, { muted: !this.audio.settings.muted }));
    syncAudioPanel(this.root, this.audio.settings);
    this.telemetry.trackInteraction("mute", { muted: this.audio.settings.muted });
    if (!this.audio.settings.muted) this.audio.playCue("ui_tick");
  }

  private updateHud(state: BattleState): void {
    if (!this.root.querySelector(".battle-ui")) return;
    if (this.stageEra !== state.techEra) {
      const background = GAME_ASSETS.backgrounds[state.techEra] ?? GAME_ASSETS.backgrounds[0];
      document.querySelector<HTMLElement>("#stage")?.style.setProperty(
        "--battle-background",
        `url("${new URL(background.src, document.baseURI).href}")`
      );
      this.stageEra = state.techEra;
    }
    this.audio.update(state);
    this.consumeTelemetry(state);
    const timeLeft = Math.max(0, Math.ceil(ROUND_DURATION - state.elapsed));
    this.setText("[data-time]", `${String(Math.floor(timeLeft / 60)).padStart(2, "0")}:${String(timeLeft % 60).padStart(2, "0")}`);
    this.root.classList.toggle("is-deadline", timeLeft <= 30);
    this.setResourceText("[data-budget]", Math.floor(state.budget).toString());
    this.setResourceText("[data-exp]", Math.floor(state.experience).toString());
    this.setResourceText("[data-health-label]", `${Math.ceil(state.projectHealth)}%`);
    this.setResourceText("[data-debt-label]", Math.floor(state.techDebt).toString());
    const interestPerMinute = Math.round(state.techDebt * DEBT_INTEREST_PER_DEBT_PER_SECOND * 60);
    const debtHint = this.root.querySelector<HTMLElement>("[data-debt-hint]");
    if (debtHint) {
      debtHint.textContent = interestPerMinute > 0 ? `利息 -${interestPerMinute}/分` : "";
      debtHint.hidden = interestPerMinute <= 0;
    }
    const banBanner = this.root.querySelector<HTMLElement>("[data-ai-ban]");
    if (banBanner) {
      if (isAgentBanned(state)) {
        banBanner.hidden = false;
        banBanner.textContent = `AI 已被风控封禁 ${Math.max(0, state.aiBanUntil - state.elapsed).toFixed(1)}s`;
      } else {
        banBanner.hidden = true;
      }
    }
    this.setText("[data-team]", `${state.engineers.length + state.queue.length} / ${MAX_POPULATION}`);
    const priorityRequest = state.requests.find((request) => request.id === state.prioritizedRequestId);
    const urgentRequest = [...state.requests].sort((a, b) => {
      const aWorking = state.engineers.some((engineer) => engineer.targetRequestId === a.id && engineer.action === "working");
      const bWorking = state.engineers.some((engineer) => engineer.targetRequestId === b.id && engineer.action === "working");
      const aEta = Math.max(0, a.x - BASE_FRONT_EDGE) / (a.speed * (aWorking ? 0.55 : 1));
      const bEta = Math.max(0, b.x - BASE_FRONT_EDGE) / (b.speed * (bWorking ? 0.55 : 1));
      return aEta - bEta;
    })[0];
    const urgentEta = urgentRequest
      ? Math.max(0, urgentRequest.x - BASE_FRONT_EDGE) / (urgentRequest.speed * (state.engineers.some((engineer) => engineer.targetRequestId === urgentRequest.id && engineer.action === "working") ? 0.55 : 1))
      : Number.POSITIVE_INFINITY;
    const requestStatus = this.root.querySelector<HTMLElement>("[data-open-requests]");
    if (requestStatus) {
      requestStatus.textContent = priorityRequest
        ? `优先 ${priorityRequest.code} · ${Math.ceil(priorityRequest.remainingWork)} 工时`
        : urgentRequest && urgentEta <= 24
          ? `⚠ ${urgentRequest.code} · ${Math.ceil(urgentEta)} 秒`
          : `待办 ${state.requests.length}`;
      requestStatus.classList.toggle("has-priority", Boolean(priorityRequest));
      requestStatus.classList.toggle("has-urgent", !priorityRequest && urgentEta <= 24);
      requestStatus.title = priorityRequest
        ? `${priorityRequest.title} 已被优先调度`
        : urgentRequest && urgentEta <= 24
          ? `${urgentRequest.title} 预计 ${Math.ceil(urgentEta)} 秒后抵达研发中心；点击战场任务卡重新调度`
          : `${state.requests.length} 项待办需求`;
    }
    this.setText("[data-era-heading]", ERAS[state.techEra].name);
    const tutorial = tutorialText(state);
    this.setText("[data-tutorial]", tutorial);
    const finalRequest = state.requests.find((request) => request.isFinal);
    const delivery = getDeliveryProgress(state.telemetry, state.plan);
    const goLiveFailed = delivery.goLiveMissed && !delivery.goLiveCompleted;
    const goalProgress = finalRequest
      ? 1 - finalRequest.remainingWork / finalRequest.totalWork
      : delivery.goLiveCompleted ? 1 : goLiveFailed ? 0 : delivery.normalTotal > 0 ? Math.min(delivery.normalCompleted / delivery.normalTotal, 1) : 0;
    this.root.querySelector(".goal-progress")?.classList.toggle("is-failed", goLiveFailed);
    this.setText("[data-goal-label]", goLiveFailed ? "上线结果" : (finalRequest || delivery.goLiveCompleted) ? "最终上线" : "常规验收");
    this.setText("[data-goal-value]", finalRequest
      ? `GO-LIVE ${Math.round((1 - finalRequest.remainingWork / finalRequest.totalWork) * 100)}%`
      : delivery.goLiveCompleted ? "GO-LIVE ✓" : goLiveFailed ? "GO-LIVE 超时" : `${delivery.normalCompleted} / ${delivery.normalTotal}`);
    const bossActive = state.requests.some((request) => request.isBoss);
    this.setText("[data-boss-status]", delivery.bossCompleted ? "Boss 已完成" : delivery.bossMissed ? "Boss 已漏单"
      : bossActive ? "Boss 攻坚中" : state.bossSpawned ? "Boss 未拦截" : "Boss 未登场");
    const planHint = state.elapsed <= 12 ? getOpeningBattlePlanHint(state.plan) : getUpcomingBattlePlanHint(state);
    this.setText("[data-plan-hint]", planHint);
    const tutorialCallout = this.root.querySelector<HTMLElement>(".tutorial-callout");
    if (tutorialCallout) tutorialCallout.hidden = !tutorial && !planHint;
    this.updateBar("[data-goal-bar]", goalProgress);
    this.updateBar("[data-health-bar]", state.projectHealth / MAX_PROJECT_HEALTH);
    this.updateBar("[data-debt-bar]", state.techDebt / 200);
    this.root.querySelector(".battle-ui")?.setAttribute("data-era", String(state.techEra));
    const debtStatus = this.root.querySelector<HTMLElement>(".right-status");
    debtStatus?.classList.toggle("debt-critical", state.techDebt >= 100);
    const debtWarning = this.root.querySelector<HTMLElement>("[data-debt-warning]");
    if (debtWarning) debtWarning.hidden = state.techDebt < 100;

    const order = state.queue[0];
    this.setText("[data-queue]", order
      ? `招聘中：${getEngineerDefinition(order.role).name} ${Math.max(0, order.remaining).toFixed(1)} 秒 · 队列 ${state.queue.length}/${MAX_TRAINING_QUEUE}`
      : `招聘队列：空 · ${state.queue.length}/${MAX_TRAINING_QUEUE}`);

    for (const button of this.root.querySelectorAll<HTMLButtonElement>("[data-role]")) {
      const engineer = getEngineerDefinition(button.dataset.role as EngineerId);
      const hireCost = getEngineerCost(state, engineer.id);
      const locked = engineer.era > state.techEra;
      const full = state.engineers.length + state.queue.length >= MAX_POPULATION || state.queue.length >= MAX_TRAINING_QUEUE;
      const insufficient = state.budget < hireCost;
      const order = state.queue.find((queued) => queued.role === engineer.id);
      button.disabled = state.phase !== "running" || locked || full;
      button.classList.toggle("is-locked", locked);
      button.classList.toggle("is-insufficient", insufficient && !locked && !full);
      button.classList.toggle("is-training", Boolean(order));
      button.setAttribute("aria-label", `招聘${engineer.name}，消耗${hireCost}预算`);
      button.title = locked ? `${ERAS[engineer.era].name}解锁` : order ? `招聘中，还需 ${order.remaining.toFixed(1)} 秒` : full ? "团队或招聘队列已满" : insufficient ? `预算不足，还差${Math.ceil(hireCost - state.budget)}` : `${engineer.summary} · 当前招募成本 ${hireCost} · 重复招募同岗位会涨价`;
      const stateLabel = button.querySelector<HTMLElement>("[data-role-state]");
      const costLabel = button.querySelector<HTMLElement>("[data-role-cost]");
      if (costLabel) costLabel.textContent = hireCost.toString();
      const specialties: Record<EngineerId, string> = { intern: "基础支持", frontend: "功能专长", backend: "基础设施", qa: "缺陷专长", agent: "全领域高速" };
      if (stateLabel) stateLabel.textContent = locked ? `${ERAS[engineer.era].name}解锁` : order ? `招聘中 ${order.remaining.toFixed(1)}s` : insufficient ? "预算不足" : specialties[engineer.id];
    }

    const nextEra = getNextEra(state);
    const eraButton = this.root.querySelector<HTMLButtonElement>("#upgrade-era");
    if (eraButton) eraButton.disabled = !nextEra || state.experience < nextEra.cost || state.phase !== "running";
    this.setText("[data-era-button]", nextEra ? `升级：${nextEra.name}` : "已到达 Agent 时代");
    this.setText("[data-era-cost]", nextEra ? `需要 ${nextEra.cost} 经验 · 效率提升` : "所有角色已解锁");

    const shipItButton = this.root.querySelector<HTMLButtonElement>("#ship-it");
    if (shipItButton) {
      const activeFor = Math.max(0, state.shipItUntil - state.elapsed);
      const cooldownFor = Math.max(0, state.shipItCooldownUntil - state.elapsed);
      const isActive = activeFor > 0;
      const isCooling = !isActive && cooldownFor > 0;
      shipItButton.disabled = state.phase !== "running" || state.paused || Boolean(state.pendingEvent) || isActive || isCooling;
      shipItButton.classList.toggle("is-rushing", isActive);
      shipItButton.classList.toggle("is-cooling", isCooling);
      this.setText("[data-ship-it-state]", isActive
        ? `冲刺中 · ${Math.ceil(activeFor)} 秒`
        : isCooling ? `冷却 · ${Math.ceil(cooldownFor)} 秒` : `+${Math.round(SHIP_IT_WORK_BONUS * 100)}% · 技术债 +${SHIP_IT_DEBT_COST}`);
      this.setText("[data-ship-it-label]", isActive ? "Ship It!" : "极限冲刺");
      shipItButton.title = isActive
        ? `效率提升持续 ${Math.ceil(activeFor)} 秒；冷却共 ${SHIP_IT_COOLDOWN} 秒`
        : isCooling ? `极限冲刺冷却中，还需 ${Math.ceil(cooldownFor)} 秒` : `持续 ${SHIP_IT_DURATION} 秒，效率 +${Math.round(SHIP_IT_WORK_BONUS * 100)}%，技术债 +${SHIP_IT_DEBT_COST}，冷却 ${SHIP_IT_COOLDOWN} 秒`;
    }

    const notice = this.root.querySelector<HTMLElement>("[data-notice]");
    if (notice) {
      notice.textContent = state.noticeUntil > state.elapsed ? state.notice : "";
      notice.classList.toggle("visible", state.noticeUntil > state.elapsed);
    }
    this.syncChangePanel(state);
    this.syncResultPanel(state);
    this.syncPauseButton();
  }

  private syncChangePanel(state: BattleState): void {
    const panel = this.root.querySelector<HTMLElement>("[data-change-panel]");
    if (!panel) return;
    const event = state.pendingEvent;
    if (!event) {
      panel.hidden = true;
      panel.removeAttribute("data-event-id");
      return;
    }
    if (panel.dataset.eventId === event.id) return;
    panel.dataset.eventId = event.id;
    panel.hidden = false;
    this.setText("[data-change-title]", event.title);
    this.setText("[data-change-body]", event.body);
    const choices = this.root.querySelector<HTMLElement>("[data-change-choices]");
    if (!choices) return;
    choices.innerHTML = event.choices.map((choice) => `
      <button class="change-choice" data-choice="${choice.id}">
        <strong>${choice.label}</strong><span>${choice.description}</span>
      </button>`).join("");
    for (const button of choices.querySelectorAll<HTMLButtonElement>("[data-choice]")) {
      if (button.dataset.choice === "fix-alert" && state.budget < 40) {
        button.disabled = true;
        button.title = "预算不足，需要 40 预算才能修复";
      }
      button.addEventListener("click", () => {
        chooseChange(state, button.dataset.choice ?? "");
        this.updateHud(state);
      });
    }
  }

  private syncResultPanel(state: BattleState): void {
    const result = this.root.querySelector<HTMLElement>("[data-result]");
    if (!result || state.phase === "running" || !result.hidden) return;
    result.hidden = false;
    const won = state.phase === "victory";
    result.classList.toggle("defeat", !won);
    this.setText("[data-result-stamp]", won ? "上线成功" : "项目复盘");
    this.setText("[data-result-title]", won ? "项目准时上线" : "本次未能上线");
    const delivery = getDeliveryProgress(state.telemetry, state.plan);
    const bossActive = state.requests.some((request) => request.isBoss);
    const bossStatus = delivery.bossCompleted ? "已完成" : delivery.bossMissed ? "已漏单"
      : bossActive ? "攻坚中" : state.bossSpawned ? "未拦截" : "未登场";
    const reason = state.notice || (won ? "最终需求在截止前完成" : "项目窗口已关闭");
    const recap = won
      ? `常规验收 ${delivery.normalCompleted}/${delivery.normalTotal} 项，Boss ${bossStatus}，最终 GO-LIVE 准时完成。`
      : delivery.goLiveCompleted
        ? `最终 GO-LIVE 已完成，但项目未能保持上线：${reason}。Boss ${bossStatus}。`
        : `常规验收 ${delivery.normalCompleted}/${delivery.normalTotal} 项，Boss ${bossStatus}。最终 GO-LIVE 未完成：${reason}。`;
    this.setText("[data-result-copy]", recap);
    this.setText("[data-final-health]", `${Math.ceil(state.projectHealth)}%`);
    this.setText("[data-final-debt]", Math.floor(state.techDebt).toString());
    this.setText("[data-final-era]", ERAS[state.techEra].name);
    const summary = summarizeRun(state.telemetry);
    this.setText("[data-run-requests]", `${delivery.normalCompleted} / ${delivery.normalTotal}`);
    this.setText("[data-run-extras]", delivery.extraCompleted.toString());
    this.setText("[data-run-boss]", bossStatus);
    this.setText("[data-run-go-live]", delivery.goLiveCompleted ? "已完成" : "未完成");
    this.setText("[data-run-hires]", summary.recruitedEngineers.toString());
    this.setText("[data-run-events]", summary.answeredChanges.toString());
    const outcome = won ? "win" : "loss";
    const score = calculateRunScore({
      result: outcome,
      completedRequests: summary.completedRequests,
      missedRequests: summary.missedRequests,
      finalProjectHealth: state.projectHealth,
      finalTechDebt: state.techDebt
    });
    const runStartedAt = this.telemetry.getRunStartedAt();
    const wallClockSeconds = runStartedAt ? Math.max(0, (Date.now() - Date.parse(runStartedAt)) / 1000) : state.elapsed;
    const achievements = evaluateCurrentRun({
      result: outcome,
      completedRequests: summary.completedRequests,
      recruitCount: summary.recruitedEngineers,
      missedRequests: summary.missedRequests,
      finalEra: state.techEra,
      finalTechDebt: state.techDebt,
      finalProjectHealth: state.projectHealth,
      durationSeconds: Math.round(wallClockSeconds * 10) / 10
    }, state.telemetry).filter((achievement) => achievement.unlocked);
    const achievementPoints = achievements.reduce((total, achievement) => total + achievement.points, 0);
    this.setText("[data-run-score]", score.toString());
    this.setText("[data-run-achievement-summary]", achievements.length > 0
      ? `解锁 ${achievements.length} 项成就 · ${achievementPoints} 点`
      : "本局未解锁成就");
    const achievementList = this.root.querySelector<HTMLElement>("[data-result-achievements]");
    if (achievementList) {
      achievementList.innerHTML = achievements.length === 0
        ? `<span class="result-achievement-empty">继续尝试：零漏单、低技术债或极速上线都能解锁成就。</span>`
        : achievements.map((achievement) => `
          <span class="result-achievement tier-${achievement.tier}" title="${escapeAttribute(achievement.description)}">
            <i>${escapeText(achievement.icon)}</i><b>${escapeText(achievement.name)}</b>
          </span>`).join("");
    }
    void this.telemetry.finishRun({
      result: outcome,
      completedRequests: summary.completedRequests,
      recruitCount: summary.recruitedEngineers,
      missedRequests: summary.missedRequests,
      finalEra: state.techEra,
      finalTechDebt: state.techDebt,
      finalProjectHealth: state.projectHealth
    });
  }

  private consumeTelemetry(state: BattleState): void {
    if (this.telemetryCursor >= state.telemetry.length) return;
    const fresh = state.telemetry.slice(this.telemetryCursor);
    this.telemetryCursor = state.telemetry.length;
    this.telemetry.consume(fresh);
    this.audio.handleTelemetry(fresh);
  }

  private updateBar(selector: string, amount: number): void {
    const bar = this.root.querySelector<HTMLElement>(selector);
    if (bar) bar.style.width = `${Math.max(0, Math.min(1, amount)) * 100}%`;
  }

  private setText(selector: string, value: string): void {
    const element = this.root.querySelector<HTMLElement>(selector);
    if (element) element.textContent = value;
  }

  private setResourceText(selector: string, value: string): void {
    const element = this.root.querySelector<HTMLElement>(selector);
    if (!element) return;
    const previous = element.dataset.resourceValue;
    element.textContent = value;
    element.dataset.resourceValue = value;
    if (previous !== undefined && previous !== value && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      element.animate(
        [{ transform: "scale(1)", filter: "brightness(1)" }, { transform: "scale(1.12)", filter: "brightness(1.5)", offset: 0.45 }, { transform: "scale(1)", filter: "brightness(1)" }],
        { duration: 260, easing: "cubic-bezier(.2,.8,.25,1)" }
      );
    }
  }
}

function readNickname(): string {
  try {
    return localStorage.getItem(NICKNAME_KEY) ?? "";
  } catch {
    return "";
  }
}

function saveNickname(value: string): void {
  try {
    const trimmed = value.trim().replace(/\s+/g, " ").slice(0, 24);
    if (trimmed) localStorage.setItem(NICKNAME_KEY, trimmed);
    else localStorage.removeItem(NICKNAME_KEY);
  } catch {
    // Nicknames are a convenience; storage failures must not block play.
  }
}

function escapeText(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[character] ?? character));
}

function escapeAttribute(value: string): string {
  return escapeText(value);
}
