import type Phaser from "phaser";
import {
  BASE_MAX_HP,
  createBattle,
  deployUnit,
  getUnitDefinition,
  MAX_POPULATION,
  MAX_TRAINING_QUEUE,
  UNIT_DEFS,
  type BattleState,
  type UnitId
} from "../core/game";

type CreateGame = (updateHud: (state: BattleState) => void) => Promise<Phaser.Game>;

export class GameApp {
  private state: BattleState | null = null;
  private game: Phaser.Game | null = null;
  private visibilityPaused = false;

  constructor(private readonly root: HTMLElement, private readonly createGame: CreateGame) {
    document.addEventListener("keydown", (event) => this.handleKeydown(event));
    document.addEventListener("visibilitychange", () => this.handleVisibilityChange());
    this.showMenu();
  }

  private showMenu(): void {
    if (this.state) this.game?.scene.stop("battle");
    this.game?.registry.remove("battleState");
    this.state = null;
    this.visibilityPaused = false;
    this.root.innerHTML = `
      <section class="menu-screen">
        <div class="menu-content">
          <div class="eyebrow"><span class="eyebrow-dot"></span>文明冲锋 · 网页先行版</div>
          <h1>一线万年</h1>
          <p class="menu-subtitle">从石器营地出发，带领部族赢下第一场冲锋。</p>

          <article class="mission-card">
            <div class="mission-topline"><span>首场战役</span><span class="mission-tag">A1 · 石器时代</span></div>
            <h2>石器前线</h2>
            <p>招募部族战士与投石手，击破敌方营地。部队会自动推进并交战。</p>
            <div class="mission-objective"><span class="objective-mark">✦</span>摧毁敌方营地，守住自己的基地</div>
            <button class="primary-button" id="start-battle">
              <span>进入战场</span><span class="button-arrow">↗</span>
            </button>
          </article>

          <div class="roster-heading"><span>可用兵种</span><span>石器时代 · 4 个兵种</span></div>
          <div class="roster-preview">${UNIT_DEFS.map((unit) => `
            <div class="preview-unit">
              <span class="unit-token"><img src="/assets/ui/units/${unit.id}.png" alt=""></span>
              <span class="preview-unit-copy"><strong>${unit.name}</strong><small>${unit.role}</small></span>
              <span class="preview-cost">${unit.cost}<small> 金</small></span>
            </div>`).join("")}
          </div>
          <div class="menu-footnote"><span>PHASER 4</span><span>·</span><span>本地单机试玩</span></div>
        </div>
      </section>`;
    this.root.querySelector<HTMLButtonElement>("#start-battle")?.addEventListener("click", () => this.startBattle());
  }

  private async startBattle(): Promise<void> {
    const state = createBattle();
    this.state = state;
    if (!this.game) {
      this.root.innerHTML = `<section class="loading-screen"><span class="loading-mark">✦</span><strong>正在载入战场</strong><small>首次启动正在准备游戏引擎…</small></section>`;
      try {
        this.game = await this.createGame((nextState) => this.updateHud(nextState));
      } catch {
        this.state = null;
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
      <section class="battle-ui" aria-label="战斗界面">
        <header class="battle-header">
          <button class="back-button" id="back-to-menu" aria-label="返回首页">← <span>首页</span></button>
          <div class="battle-title"><span class="title-kicker">A1 · 石器时代</span><strong>石器前线</strong></div>
          <div class="battle-clock"><span class="clock-label">战斗时间</span><strong data-time>00:00</strong></div>
          <div class="header-actions">
            <div class="gold-counter"><img class="gold-icon" src="/assets/ui/resources/gold.png" alt=""><strong data-gold>240</strong><small>金币</small></div>
            <div class="exp-counter"><span aria-hidden="true">✦</span><strong data-experience>0</strong><small>经验</small></div>
            <button class="icon-button" id="pause-game" aria-label="暂停">Ⅱ</button>
          </div>
        </header>

        <div class="base-status left-status">
          <span class="base-side-label">我方基地</span>
          <span class="base-hp-label" data-base-label="0">2,400 / 2,400</span>
          <span class="base-hp-track"><i data-base-bar="0"></i></span>
        </div>
        <div class="base-status right-status">
          <span class="base-side-label">敌方基地</span>
          <span class="base-hp-label" data-base-label="1">2,400 / 2,400</span>
          <span class="base-hp-track"><i data-base-bar="1"></i></span>
        </div>

        <div class="battle-callout"><span class="callout-star">✦</span>训练部队并摧毁敌方营地</div>
        <div class="battle-notice" data-notice role="status" aria-live="polite"></div>

        <div class="unit-deck" aria-label="训练兵种">
          <div class="deck-heading"><span>训练部队</span><small>快捷键 1–4</small></div>
          <div class="unit-cards">${UNIT_DEFS.map((unit, index) => `
            <button class="unit-card" data-unit="${unit.id}" aria-label="训练${unit.name}，花费${unit.cost}金币">
              <span class="unit-card-top"><span class="unit-token"><img src="/assets/ui/units/${unit.id}.png" alt=""></span><span class="unit-key">${index + 1}</span></span>
              <strong>${unit.name}</strong>
              <span class="unit-card-bottom"><span>${unit.role} · ${unit.trainingTime.toFixed(1)}秒</span><b>◈ ${unit.cost}</b></span>
            </button>`).join("")}
          </div>
          <div class="deck-footer"><span data-queue>训练队列：空</span><span data-population>部队 0/${MAX_POPULATION}</span><button id="speed-game" class="speed-button">速度　1×</button></div>
        </div>

        <section class="result-panel" data-result aria-live="assertive" hidden>
          <div class="result-seal" data-result-seal>✦</div>
          <span class="result-kicker">石器前线 · 战斗结束</span>
          <h2 data-result-title>胜利</h2>
          <p data-result-copy>敌方营地已被摧毁。</p>
          <div class="result-actions"><button class="primary-button" id="replay-battle">再战一次 <span>↻</span></button><button class="secondary-button" id="result-home">返回首页</button></div>
        </section>
      </section>`;

    for (const button of this.root.querySelectorAll<HTMLButtonElement>("[data-unit]")) {
      button.addEventListener("click", () => this.train(button.dataset.unit as UnitId));
    }
    this.root.querySelector("#pause-game")?.addEventListener("click", () => this.togglePause());
    this.root.querySelector("#speed-game")?.addEventListener("click", () => this.toggleSpeed());
    this.root.querySelector("#back-to-menu")?.addEventListener("click", () => this.showMenu());
    this.root.querySelector("#replay-battle")?.addEventListener("click", () => this.startBattle());
    this.root.querySelector("#result-home")?.addEventListener("click", () => this.showMenu());
  }

  private train(unitId: UnitId): void {
    if (!this.state) return;
    deployUnit(this.state, unitId);
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
    if (!this.state || this.state.phase !== "running") return;
    if (event.code === "Space") {
      event.preventDefault();
      this.togglePause();
      return;
    }
    const unit = UNIT_DEFS[Number(event.key) - 1];
    if (unit) this.train(unit.id);
  }

  private updateHud(state: BattleState): void {
    if (!this.root.querySelector(".battle-ui")) return;
    const time = Math.floor(state.elapsed);
    this.setText("[data-time]", `${String(Math.floor(time / 60)).padStart(2, "0")}:${String(time % 60).padStart(2, "0")}`);
    this.setText("[data-gold]", Math.floor(state.gold[0]).toString());
    this.setText("[data-experience]", Math.floor(state.experience[0]).toString());
    this.setBaseStatus(0, state.baseHp[0]);
    this.setBaseStatus(1, state.baseHp[1]);
    const population = state.units.filter((unit) => unit.side === 0).length;
    this.setText("[data-population]", `部队 ${population}/${MAX_POPULATION}`);

    const order = state.queues[0][0];
    if (!order) this.setText("[data-queue]", state.queues[0].length === 0 ? "训练队列：空" : `训练队列：${state.queues[0].length} 个单位`);
    else {
      const unit = getUnitDefinition(order.unitId);
      this.setText("[data-queue]", `训练中：${unit.name}　${Math.max(0, order.remaining).toFixed(1)} 秒 · 队列 ${state.queues[0].length}/${MAX_TRAINING_QUEUE}`);
    }

    for (const button of this.root.querySelectorAll<HTMLButtonElement>("[data-unit]")) {
      const unit = getUnitDefinition(button.dataset.unit as UnitId);
      const queueFull = state.queues[0].length >= MAX_TRAINING_QUEUE;
      const populationFull = population + state.queues[0].length >= MAX_POPULATION;
      const insufficientGold = state.gold[0] < unit.cost;
      button.disabled = state.phase !== "running" || queueFull || populationFull;
      button.classList.toggle("is-insufficient", insufficientGold);
      button.title = queueFull ? "训练队列已满" : populationFull ? "部队数量已达上限" : insufficientGold ? `金币不足，还差${Math.ceil(unit.cost - state.gold[0])}金` : "";
    }

    const notice = this.root.querySelector<HTMLElement>("[data-notice]");
    if (notice) {
      notice.textContent = state.noticeUntil > state.elapsed ? state.notice : "";
      notice.classList.toggle("visible", state.noticeUntil > state.elapsed);
    }

    const result = this.root.querySelector<HTMLElement>("[data-result]");
    if (result && state.phase !== "running" && result.hidden) {
      result.hidden = false;
      this.setText("[data-result-title]", state.phase === "victory" ? "胜利" : "战败");
      this.setText("[data-result-copy]", state.phase === "victory" ? "敌方营地已被摧毁，石器前线归你掌控。" : "我方基地失守了。调整部队组合，再发起冲锋。");
      this.root.querySelector<HTMLElement>("[data-result-seal]")?.classList.toggle("defeat", state.phase === "defeat");
      this.root.querySelector<HTMLElement>("[data-result-title]")?.classList.toggle("defeat", state.phase === "defeat");
    }
  }

  private setBaseStatus(side: 0 | 1, hp: number): void {
    const bar = this.root.querySelector<HTMLElement>(`[data-base-bar="${side}"]`);
    const label = this.root.querySelector<HTMLElement>(`[data-base-label="${side}"]`);
    if (bar) bar.style.width = `${Math.max(0, hp / BASE_MAX_HP * 100)}%`;
    if (label) label.textContent = `${Math.ceil(hp).toLocaleString()} / ${BASE_MAX_HP.toLocaleString()}`;
  }

  private setText(selector: string, value: string): void {
    const element = this.root.querySelector<HTMLElement>(selector);
    if (element) element.textContent = value;
  }
}
