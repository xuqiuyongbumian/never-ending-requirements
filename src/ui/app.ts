import type Phaser from "phaser";
import {
  chooseChange,
  createBattle,
  ENGINEER_DEFS,
  ERAS,
  getEngineerDefinition,
  getNextEra,
  hireEngineer,
  MAX_POPULATION,
  MAX_PROJECT_HEALTH,
  MAX_TRAINING_QUEUE,
  ROUND_DURATION,
  tutorialText,
  upgradeEra,
  type BattleState,
  type EngineerId
} from "../core/game";
import { TelemetryReporter } from "./telemetry";

type CreateGame = (updateHud: (state: BattleState) => void) => Promise<Phaser.Game>;

export class GameApp {
  private state: BattleState | null = null;
  private game: Phaser.Game | null = null;
  private visibilityPaused = false;
  private telemetryCursor = 0;
  private readonly telemetry = new TelemetryReporter();

  constructor(private readonly root: HTMLElement, private readonly createGame: CreateGame) {
    document.addEventListener("keydown", (event) => this.handleKeydown(event));
    document.addEventListener("visibilitychange", () => this.handleVisibilityChange());
    this.telemetry.enter();
    this.showMenu();
  }

  private showMenu(): void {
    if (this.state) this.game?.scene.stop("battle");
    this.game?.registry.remove("battleState");
    this.state = null;
    this.visibilityPaused = false;
    this.root.innerHTML = `
      <section class="menu-screen">
        <div class="menu-grid" aria-hidden="true"></div>
        <div class="menu-content">
          <div class="eyebrow"><span class="live-dot"></span>1024 AI 游戏创作赛 · 5 分钟限时关卡</div>
          <h1>需求永不眠</h1>
          <p class="menu-subtitle">组建研发团队，处理不断涌来的需求，在最后期限前让项目上线。</p>
          <article class="mission-card">
            <div class="mission-topline"><span>极限上线挑战</span><span class="mission-tag">版本 10.24</span></div>
            <h2>需求永不眠：1024 极限上线</h2>
            <p>需求会从右侧逼近项目现场。工程师自动接单；完成后获得预算和技术经验。管理技术债，赶在 05:00 前完成 GO-LIVE。</p>
            <div class="mission-objective"><span class="pixel-check">✓</span>招人 · 进化 · 处理变更 · 准时上线</div>
            <button class="primary-button" id="start-battle"><span>开始新项目</span><span class="button-arrow">↗</span></button>
          </article>
          <div class="era-preview">
            <div><span class="era-step">01</span><strong>手搓时代</strong><small>实习生 · 前端</small></div>
            <span class="era-arrow">→</span>
            <div><span class="era-step">02</span><strong>工程化时代</strong><small>后端 · 测试</small></div>
            <span class="era-arrow">→</span>
            <div><span class="era-step">03</span><strong>Agent 时代</strong><small>AI Agent · 技术债</small></div>
          </div>
          <div class="menu-footnote"><span>PHASER 4</span><span>·</span><span>单机策略 · 浏览器即开即玩</span></div>
        </div>
      </section>`;
    this.root.querySelector<HTMLButtonElement>("#start-battle")?.addEventListener("click", () => this.startBattle());
  }

  private async startBattle(replay = false): Promise<void> {
    if (replay) this.telemetry.track("replay", {});
    this.telemetry.beginRun();
    const state = createBattle(Date.now() >>> 0);
    this.state = state;
    this.telemetryCursor = 0;
    if (!this.game) {
      this.root.innerHTML = `<section class="loading-screen"><span class="loading-pixel">1024</span><strong>正在准备项目现场</strong><small>首次启动正在载入游戏引擎…</small></section>`;
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
    this.game.scene.start("battle", { state });
    this.renderBattleHud();
    this.updateHud(state);
  }

  private renderBattleHud(): void {
    this.root.innerHTML = `
      <section class="battle-ui" aria-label="需求永不眠项目现场">
        <header class="battle-header">
          <button class="back-button" id="back-to-menu" aria-label="返回首页">← <span>项目列表</span></button>
          <div class="battle-title"><span class="title-kicker">1024 AI 创作赛</span><strong>需求永不眠</strong></div>
          <div class="header-actions">
            <div class="metric-pill budget-pill"><span class="metric-glyph">$</span><strong data-budget>145</strong><small>预算</small></div>
            <div class="metric-pill exp-pill"><span class="metric-glyph">✦</span><strong data-exp>0</strong><small>经验</small></div>
            <button class="icon-button" id="pause-game" aria-label="暂停">Ⅱ</button>
          </div>
        </header>

        <div class="deadline-clock"><span>上线倒计时</span><strong data-time>05:00</strong></div>
        <div class="project-status left-status">
          <div class="status-copy"><span>项目健康</span><strong data-health-label>100%</strong></div>
          <span class="status-track"><i data-health-bar></i></span>
        </div>
        <div class="project-status right-status">
          <div class="status-copy"><span>技术债</span><strong data-debt-label>0</strong></div>
          <span class="status-track debt-track"><i data-debt-bar></i></span>
        </div>
        <div class="tutorial-callout" data-tutorial role="status" aria-live="polite"></div>
        <div class="battle-notice" data-notice role="status" aria-live="polite"></div>

        <div class="team-strip" aria-live="polite">
          <span class="team-label">研发团队</span>
          <span data-team>1 / ${MAX_POPULATION}</span>
          <span class="team-separator">·</span>
          <span data-queue>招聘队列：空</span>
          <span class="team-separator">·</span>
          <span data-open-requests>待办 0</span>
          <button id="speed-game" class="speed-button">速度　1×</button>
        </div>

        <section class="unit-deck" aria-label="招聘工程师">
          <div class="deck-heading"><span><i class="heading-pixel"></i>组建交付小组</span><small data-era-heading>手搓时代</small></div>
          <div class="unit-cards">${ENGINEER_DEFS.map((engineer, index) => `
            <button class="unit-card role-${engineer.id}" data-role="${engineer.id}" aria-label="招聘${engineer.name}，消耗${engineer.cost}预算">
              <span class="unit-card-top"><span class="pixel-avatar role-${engineer.id}" aria-hidden="true"><i></i><b></b></span><span class="unit-key">${index + 1}</span></span>
              <strong>${engineer.name}</strong>
              <span class="unit-card-bottom"><span>${engineer.summary}</span><b>◈ ${engineer.cost}</b></span>
              <small class="role-state" data-role-state>${engineer.era ? `${ERAS[engineer.era].name}解锁` : `交付 ${engineer.workRate}/秒`}</small>
            </button>`).join("")}
          </div>
          <div class="deck-footer">
            <span class="hint-copy">快捷键 1–5 招聘 · E 升级时代 · Space 暂停</span>
            <button id="upgrade-era" class="era-button" aria-label="升级技术时代"><span data-era-button>升级时代</span><small data-era-cost>需要 80 经验</small></button>
          </div>
        </section>

        <section class="change-panel" data-change-panel aria-modal="true" role="dialog" hidden>
          <div class="change-stamp">需求变更</div>
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
          <div class="result-stats"><span>最终健康<strong data-final-health></strong></span><span>技术债<strong data-final-debt></strong></span><span>完成时代<strong data-final-era></strong></span></div>
          <div class="result-actions"><button class="primary-button" id="replay-battle">再开一个项目 <span>↻</span></button><button class="secondary-button" id="export-analytics">导出本局行为数据</button><button class="tertiary-button" id="result-home">返回首页</button></div>
        </section>
      </section>`;

    for (const button of this.root.querySelectorAll<HTMLButtonElement>("[data-role]")) {
      button.addEventListener("click", () => this.hire(button.dataset.role as EngineerId));
    }
    this.root.querySelector("#upgrade-era")?.addEventListener("click", () => this.advanceEra());
    this.root.querySelector("#pause-game")?.addEventListener("click", () => this.togglePause());
    this.root.querySelector("#speed-game")?.addEventListener("click", () => this.toggleSpeed());
    this.root.querySelector("#back-to-menu")?.addEventListener("click", () => this.showMenu());
    this.root.querySelector("#replay-battle")?.addEventListener("click", () => this.startBattle(true));
    this.root.querySelector("#export-analytics")?.addEventListener("click", () => this.telemetry.exportCurrentRun());
    this.root.querySelector("#result-home")?.addEventListener("click", () => this.showMenu());
  }

  private hire(role: EngineerId): void {
    if (!this.state) return;
    hireEngineer(this.state, role);
    this.updateHud(this.state);
  }

  private advanceEra(): void {
    if (!this.state) return;
    upgradeEra(this.state);
    this.updateHud(this.state);
  }

  private togglePause(): void {
    if (!this.state || this.state.phase !== "running") return;
    this.state.paused = !this.state.paused;
    this.syncPauseButton();
  }

  private handleVisibilityChange(): void {
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
    const button = this.root.querySelector<HTMLButtonElement>("#speed-game");
    if (button) button.textContent = `速度　${this.state.speed}×`;
  }

  private handleKeydown(event: KeyboardEvent): void {
    if (!this.state || this.state.phase !== "running" || event.repeat) return;
    if (event.code === "Space") {
      event.preventDefault();
      this.togglePause();
      return;
    }
    if (event.key.toLowerCase() === "e") {
      this.advanceEra();
      return;
    }
    const role = ENGINEER_DEFS[Number(event.key) - 1];
    if (role) this.hire(role.id);
  }

  private updateHud(state: BattleState): void {
    if (!this.root.querySelector(".battle-ui")) return;
    this.consumeTelemetry(state);
    const timeLeft = Math.max(0, Math.ceil(ROUND_DURATION - state.elapsed));
    this.setText("[data-time]", `${String(Math.floor(timeLeft / 60)).padStart(2, "0")}:${String(timeLeft % 60).padStart(2, "0")}`);
    this.setText("[data-budget]", Math.floor(state.budget).toString());
    this.setText("[data-exp]", Math.floor(state.experience).toString());
    this.setText("[data-health-label]", `${Math.ceil(state.projectHealth)}%`);
    this.setText("[data-debt-label]", Math.floor(state.techDebt).toString());
    this.setText("[data-team]", `${state.engineers.length + state.queue.length} / ${MAX_POPULATION}`);
    this.setText("[data-open-requests]", `待办 ${state.requests.length}`);
    this.setText("[data-era-heading]", ERAS[state.techEra].name);
    this.setText("[data-tutorial]", tutorialText(state));
    this.updateBar("[data-health-bar]", state.projectHealth / MAX_PROJECT_HEALTH);
    this.updateBar("[data-debt-bar]", state.techDebt / 200);
    this.root.querySelector(".battle-ui")?.setAttribute("data-era", String(state.techEra));
    this.root.querySelector(".right-status")?.classList.toggle("debt-critical", state.techDebt >= 100);

    const order = state.queue[0];
    this.setText("[data-queue]", order
      ? `招聘中：${getEngineerDefinition(order.role).name} ${Math.max(0, order.remaining).toFixed(1)} 秒 · 队列 ${state.queue.length}/${MAX_TRAINING_QUEUE}`
      : `招聘队列：空 · ${state.queue.length}/${MAX_TRAINING_QUEUE}`);

    for (const button of this.root.querySelectorAll<HTMLButtonElement>("[data-role]")) {
      const engineer = getEngineerDefinition(button.dataset.role as EngineerId);
      const locked = engineer.era > state.techEra;
      const full = state.engineers.length + state.queue.length >= MAX_POPULATION || state.queue.length >= MAX_TRAINING_QUEUE;
      const insufficient = state.budget < engineer.cost;
      button.disabled = state.phase !== "running" || locked || full;
      button.classList.toggle("is-locked", locked);
      button.classList.toggle("is-insufficient", insufficient && !locked && !full);
      button.title = locked ? `${ERAS[engineer.era].name}解锁` : full ? "团队或招聘队列已满" : insufficient ? `预算不足，还差${Math.ceil(engineer.cost - state.budget)}` : engineer.summary;
      const stateLabel = button.querySelector<HTMLElement>("[data-role-state]");
      if (stateLabel) stateLabel.textContent = locked ? `${ERAS[engineer.era].name}解锁` : insufficient ? `预算不足 · ${engineer.cost}` : `交付 ${engineer.workRate}/秒`;
    }

    const nextEra = getNextEra(state);
    const eraButton = this.root.querySelector<HTMLButtonElement>("#upgrade-era");
    if (eraButton) eraButton.disabled = !nextEra || state.experience < nextEra.cost || state.phase !== "running";
    this.setText("[data-era-button]", nextEra ? `升级：${nextEra.name}` : "已到达 Agent 时代");
    this.setText("[data-era-cost]", nextEra ? `需要 ${nextEra.cost} 经验 · 效率提升` : "所有角色已解锁");

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
    this.setText("[data-result-copy]", state.notice || (won ? "最终需求在截止前完成，团队交付成功。" : "项目窗口已关闭，调整团队与技术债后再试一次。"));
    this.setText("[data-final-health]", `${Math.ceil(state.projectHealth)}%`);
    this.setText("[data-final-debt]", Math.floor(state.techDebt).toString());
    this.setText("[data-final-era]", ERAS[state.techEra].name);
  }

  private consumeTelemetry(state: BattleState): void {
    if (this.telemetryCursor >= state.telemetry.length) return;
    this.telemetry.consume(state.telemetry.slice(this.telemetryCursor));
    this.telemetryCursor = state.telemetry.length;
  }

  private updateBar(selector: string, amount: number): void {
    const bar = this.root.querySelector<HTMLElement>(selector);
    if (bar) bar.style.width = `${Math.max(0, Math.min(1, amount)) * 100}%`;
  }

  private setText(selector: string, value: string): void {
    const element = this.root.querySelector<HTMLElement>(selector);
    if (element) element.textContent = value;
  }
}
