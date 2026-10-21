import Phaser from "phaser";
import {
  advanceBattle,
  getEngineerDefinition,
  prioritizeRequirement,
  WORLD_WIDTH,
  type BattleState,
  type Engineer,
  type Requirement
} from "../core/game";
import {
  engineerTexture,
  GAME_ASSETS,
  GAME_TEXTURES,
  requestTexture
} from "./game-assets";

const WIDTH = 1280;
const HEIGHT = 720;
const FLOOR_Y = 536;
const REQUEST_Y = [310, 370, 430] as const;
const REQUEST_KIND_LABEL: Record<Requirement["kind"], string> = {
  feature: "功能",
  bug: "缺陷",
  infra: "基础设施",
  launch: "上线"
};

interface EngineerView {
  sprite: Phaser.GameObjects.Image;
  shadow: Phaser.GameObjects.Graphics;
  aura: Phaser.GameObjects.Graphics;
  workEffect: Phaser.GameObjects.Graphics;
  activity: Phaser.GameObjects.Text;
  baseScale: number;
  motionAction: Engineer["action"];
  motionRush: boolean;
  motionTween: Phaser.Tweens.Tween | null;
}

interface RequestView {
  container: Phaser.GameObjects.Container;
  plate: Phaser.GameObjects.Graphics;
  mascot: Phaser.GameObjects.Image;
  title: Phaser.GameObjects.Text;
  code: Phaser.GameObjects.Text;
  remaining: Phaser.GameObjects.Text;
  progress: Phaser.GameObjects.Graphics;
  priorityMark: Phaser.GameObjects.Text;
  id: number;
  requestCode: string;
  accent: number;
  completing: boolean;
  introPlayed: boolean;
}

export class BattleScene extends Phaser.Scene {
  private state: BattleState | null = null;
  private lastHudUpdate = 0;
  private lastEra = -1;
  private telemetryCursor = 0;
  private background!: Phaser.GameObjects.Image;
  private lane!: Phaser.GameObjects.Graphics;
  private priorityLink!: Phaser.GameObjects.Graphics;
  private engineers = new Map<number, EngineerView>();
  private requests = new Map<number, RequestView>();

  constructor() {
    super({ key: "battle", active: false });
  }

  preload(): void {
    for (const asset of GAME_TEXTURES) {
      if (!this.textures.exists(asset.key)) this.load.image(asset.key, asset.src);
    }
  }

  create(data: { state?: BattleState } = {}): void {
    this.state = data.state ?? this.game.registry.get("battleState") ?? null;
    this.engineers.clear();
    this.requests.clear();
    const era = this.state?.techEra ?? 0;
    const background = GAME_ASSETS.backgrounds[era] ?? GAME_ASSETS.backgrounds[0];
    this.background = this.add.image(WIDTH / 2, HEIGHT / 2, background.key).setDepth(0);
    this.background.setScale(Math.max(WIDTH / this.background.width, HEIGHT / this.background.height));
    this.lane = this.add.graphics().setDepth(1);
    this.priorityLink = this.add.graphics().setDepth(2);
    this.drawLane();
    for (const [x, label] of [[160, "研发中心"], [1120, "需求入口"]] as const) {
      this.add.text(x, FLOOR_Y - 18, label, {
        fontFamily: "sans-serif", fontSize: "11px", fontStyle: "bold", color: "#fff4dc", backgroundColor: "#282b43"
      }).setOrigin(0.5).setPadding(7, 4, 7, 4).setDepth(2);
    }
    this.lastHudUpdate = 0;
    this.lastEra = era;
    this.telemetryCursor = 0;
  }

  update(_time: number, deltaMs: number): void {
    if (!this.state) return;
    advanceBattle(this.state, deltaMs / 1000);
    if (this.lastEra !== this.state.techEra) {
      this.lastEra = this.state.techEra;
      this.changeEra(this.lastEra);
    }
    this.playCompletionFeedback(this.state);
    this.syncEngineers(this.state);
    this.syncRequests(this.state);
    this.syncPriorityLink(this.state);

    if (this.time.now - this.lastHudUpdate >= 100) {
      this.lastHudUpdate = this.time.now;
      const updateHud = this.game.registry.get("updateHud") as ((state: BattleState) => void) | undefined;
      updateHud?.(this.state);
    }
  }

  private drawLane(): void {
    this.lane.clear();
    this.lane.fillStyle(0x293b40, 0.18).fillRect(280, FLOOR_Y + 4, 930, 12);
    this.lane.lineStyle(2, 0xfff5d4, 0.72).lineBetween(280, FLOOR_Y, 1210, FLOOR_Y);
    this.lane.lineStyle(2, 0x58794f, 0.44).lineBetween(280, FLOOR_Y + 16, 1210, FLOOR_Y + 16);
    this.lane.fillStyle(0xfff8d9, 0.76);
    for (let x = 304; x < 1210; x += 64) this.lane.fillRect(x, FLOOR_Y + 6, 22, 3);
  }

  private changeEra(era: number): void {
    const background = GAME_ASSETS.backgrounds[era] ?? GAME_ASSETS.backgrounds[0];
    this.background.setTexture(background.key);
    this.background.setScale(Math.max(WIDTH / this.background.width, HEIGHT / this.background.height));
    const colors = [0xffdb9a, 0x9ce5da, 0x8f99ff];
    const flash = this.add.rectangle(WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT, colors[era] ?? colors[0]).setAlpha(0).setDepth(8);
    this.tweens.add({ targets: flash, alpha: 0.24, duration: 150, yoyo: true, onComplete: () => flash.destroy() });
  }

  private syncEngineers(state: BattleState): void {
    const present = new Set<number>();
    for (const engineer of state.engineers) {
      present.add(engineer.id);
      let view = this.engineers.get(engineer.id);
      if (!view) {
        const sprite = this.add.image(0, FLOOR_Y, engineerTexture(engineer.role)).setOrigin(0.5, 1).setDepth(5);
        const maxHeight = engineer.role === "agent" ? 132 : 120;
        const baseScale = Math.min(maxHeight / sprite.height, 138 / sprite.width);
        sprite.setScale(baseScale);
        view = {
          sprite,
          shadow: this.add.graphics().setDepth(4),
          aura: this.add.graphics().setDepth(4.5),
          workEffect: this.add.graphics().setDepth(6),
          activity: this.add.text(0, 0, "</>", {
            fontFamily: "ui-monospace, monospace", fontSize: "15px", fontStyle: "bold",
            color: engineer.role === "agent" ? "#8c92ff" : "#64dccf", stroke: "#20243a", strokeThickness: 4
          }).setOrigin(0.5).setDepth(6).setVisible(false),
          baseScale,
          motionAction: "idle",
          motionRush: false,
          motionTween: null
        };
        this.playEngineerMotion(view, "idle", false);
        this.engineers.set(engineer.id, view);
      }
      this.updateEngineerView(view, engineer, state);
    }
    for (const [id, view] of this.engineers) {
      if (present.has(id)) continue;
      view.sprite.destroy();
      view.motionTween?.stop();
      view.shadow.destroy();
      view.aura.destroy();
      view.workEffect.destroy();
      view.activity.destroy();
      this.engineers.delete(id);
    }
  }

  private updateEngineerView(view: EngineerView, engineer: Engineer, state: BattleState): void {
    const definition = getEngineerDefinition(engineer.role);
    const x = engineer.x / WORLD_WIDTH * WIDTH + (engineer.lane - 2) * 56;
    const moving = engineer.action === "moving";
    const working = engineer.action === "working";
    const target = state.requests.find((request) => request.id === engineer.targetRequestId);
    this.playEngineerMotion(view, moving ? "moving" : working ? "working" : "idle", state.elapsed < state.shipItUntil);
    const hover = engineer.role === "agent" ? Math.sin(state.elapsed * 4 + engineer.id) * 3 : 0;
    view.sprite.setPosition(x, FLOOR_Y + hover).setFlipX(target ? target.x < engineer.x : false);

    view.shadow.clear().fillStyle(0x1b2929, 0.25).fillEllipse(x, FLOOR_Y - 2, 52, 12);
    view.aura.clear();
    if (engineer.role === "agent") {
      view.aura.fillStyle(0x66d9fa, 0.13).fillEllipse(x, FLOOR_Y - 48 + hover, 78, 92);
      view.aura.fillStyle(0x9c9bff, 0.2).fillCircle(x + Math.sin(state.elapsed * 2 + engineer.id) * 25, FLOOR_Y - 85 + hover, 2.5);
    }
    view.activity.setVisible(working).setPosition(x + 3, FLOOR_Y - (engineer.role === "agent" ? 158 : 146) + hover);
    if (working) view.activity.setText(({ intern: "DOC", frontend: "UI", backend: "API", qa: "✓", agent: "AI" })[engineer.role]);
    view.activity.setColor(engineer.role === "agent" ? "#a9a8ff" : `#${definition.color.toString(16).padStart(6, "0")}`);
    this.drawRoleWorkEffect(view, engineer, state, x, hover);
  }

  private drawRoleWorkEffect(view: EngineerView, engineer: Engineer, state: BattleState, x: number, hover: number): void {
    const graphics = view.workEffect;
    graphics.clear();
    if (engineer.action === "moving") {
      const phase = state.elapsed * (state.elapsed < state.shipItUntil ? 15 : 10) + engineer.id;
      const color = getEngineerDefinition(engineer.role).color;
      graphics.fillStyle(color, 0.38).fillCircle(x - 17 + Math.sin(phase) * 3, FLOOR_Y - 7, 2.2);
      graphics.fillStyle(color, 0.24).fillCircle(x - 27 + Math.sin(phase + 1.8) * 3, FLOOR_Y - 5, 1.6);
      return;
    }
    if (engineer.action !== "working") return;
    const y = FLOOR_Y - 100 + hover;
    const pulse = Math.sin(state.elapsed * (state.elapsed < state.shipItUntil ? 11 : 7) + engineer.id) * 2;
    switch (engineer.role) {
      case "intern":
        graphics.lineStyle(2, 0xffd27d, 0.92).strokeRect(x - 30, y - 14, 13, 20);
        graphics.lineStyle(1, 0xfff0cc, 0.8).lineBetween(x - 27, y - 9, x - 20, y - 9).lineBetween(x - 27, y - 4, x - 23, y - 4);
        graphics.lineStyle(2, 0x62d7a2, 0.95).lineBetween(x - 27, y + 1, x - 24, y + 4).lineBetween(x - 24, y + 4, x - 19, y - 2);
        break;
      case "frontend":
        graphics.lineStyle(2, 0x65ded3, 0.9).strokeRoundedRect(x + 23, y - 22, 24, 18, 3);
        graphics.lineStyle(1, 0x9df3e8, 0.75).lineBetween(x + 27, y - 16, x + 43, y - 16).lineBetween(x + 27, y - 11, x + 34, y - 11);
        graphics.fillStyle(0xffcb72, 0.95).fillCircle(x + 39 + pulse, y - 8, 2.3);
        break;
      case "backend":
        graphics.lineStyle(2, 0x82b4ff, 0.85).strokeRoundedRect(x - 36, y - 23, 20, 10, 2).strokeRoundedRect(x - 36, y - 9, 20, 10, 2);
        graphics.fillStyle(0x9bd0ff, 0.95).fillCircle(x - 31, y - 18, 1.7).fillCircle(x - 31, y - 4, 1.7);
        graphics.lineStyle(1, 0x82b4ff, 0.7).lineBetween(x - 26, y - 18, x - 19, y - 18).lineBetween(x - 26, y - 4, x - 19, y - 4);
        break;
      case "qa":
        graphics.lineStyle(2, 0x7df0ae, 0.9).strokeCircle(x + 29, y - 14, 8 + pulse * 0.15);
        graphics.lineStyle(2, 0x7df0ae, 0.9).lineBetween(x + 35, y - 8, x + 42, y - 1);
        graphics.lineStyle(1, 0xafffd0, 0.55).strokeRect(x - 39, y - 20, 16, 22);
        graphics.lineStyle(2, 0x7df0ae, 0.95).lineBetween(x - 36, y - 8, x - 33, y - 5).lineBetween(x - 33, y - 5, x - 28, y - 12);
        break;
      case "agent": {
        const orbit = state.elapsed * (state.elapsed < state.shipItUntil ? 3.8 : 2.2) + engineer.id;
        graphics.lineStyle(1.5, 0x80eaff, 0.55).strokeCircle(x + 33, y - 14, 15);
        graphics.fillStyle(0x83efff, 0.95).fillCircle(x + 33 + Math.cos(orbit) * 15, y - 14 + Math.sin(orbit) * 8, 3);
        graphics.fillStyle(0xb1a2ff, 0.9).fillCircle(x + 33 + Math.cos(orbit + 2.2) * 15, y - 14 + Math.sin(orbit + 2.2) * 8, 2.2);
        break;
      }
    }
  }

  private playEngineerMotion(view: EngineerView, action: Engineer["action"], rushing: boolean): void {
    if (view.motionAction === action && view.motionRush === rushing && view.motionTween?.isPlaying()) return;
    view.motionTween?.stop();
    view.sprite.setScale(view.baseScale).setAngle(0);
    view.motionAction = action;
    view.motionRush = rushing;

    const motion = action === "moving"
      ? { scaleY: view.baseScale * (rushing ? 1.045 : 1.035), angle: rushing ? 2 : 1.4, duration: rushing ? 115 : 170 }
      : action === "working"
        ? { scaleY: view.baseScale * (rushing ? 1.03 : 1.018), angle: rushing ? -1.2 : -0.4, duration: rushing ? 250 : 390 }
        : { scaleY: view.baseScale * 1.008, angle: 0, duration: 900 };

    view.motionTween = this.tweens.add({
      targets: view.sprite,
      scaleY: motion.scaleY,
      angle: motion.angle,
      duration: motion.duration,
      ease: "Sine.InOut",
      yoyo: true,
      repeat: -1
    });
  }

  private syncRequests(state: BattleState): void {
    const present = new Set<number>();
    for (const request of state.requests) {
      present.add(request.id);
      let view = this.requests.get(request.id);
      if (!view) {
        view = this.createRequestView(request);
        this.requests.set(request.id, view);
      }
      this.updateRequestView(view, request, state);
    }
    for (const [id, view] of this.requests) {
      if (present.has(id)) continue;
      if (view.completing) continue;
      view.container.destroy(true);
      this.requests.delete(id);
    }
  }

  private createRequestView(request: Requirement): RequestView {
    const plate = this.add.graphics();
    const mascot = this.add.image(-68, 0, requestTexture(request)).setOrigin(0.5);
    mascot.setScale(Math.min(68 / mascot.width, 68 / mascot.height));
    const title = this.add.text(-39, -12, request.title, { fontFamily: "sans-serif", fontSize: "12px", color: "#f7edd9", fontStyle: "bold" }).setOrigin(0, 0.5);
    const code = this.add.text(-39, 3, request.code, { fontFamily: "ui-monospace, monospace", fontSize: "9px", color: "#b4bbcc" }).setOrigin(0, 0.5);
    const remaining = this.add.text(88, 3, "", { fontFamily: "ui-monospace, monospace", fontSize: "9px", color: "#f7edd9", fontStyle: "bold" }).setOrigin(1, 0.5);
    const progress = this.add.graphics();
    const priorityMark = this.add.text(88, -15, "★ 优先", {
      fontFamily: "sans-serif", fontSize: "9px", fontStyle: "bold", color: "#ffcf83", stroke: "#20243a", strokeThickness: 3
    }).setOrigin(1, 0.5).setVisible(false);
    const container = this.add.container(0, 0, [plate, mascot, title, code, remaining, progress, priorityMark]).setDepth(request.isFinal ? 4 : 3);
    plate.setInteractive(new Phaser.Geom.Rectangle(-55, -26, 151, 49), Phaser.Geom.Rectangle.Contains);
    plate.on("pointerdown", (_pointer: Phaser.Input.Pointer, _localX: number, _localY: number, event: Phaser.Types.Input.EventData) => {
      event.stopPropagation();
      if (!this.state) return;
      prioritizeRequirement(this.state, request.id);
      const updateHud = this.game.registry.get("updateHud") as ((state: BattleState) => void) | undefined;
      updateHud?.(this.state);
    });
    const accent = request.isFinal ? 0xefbd59 : request.kind === "bug" ? 0xe57175 : request.kind === "infra" ? 0x679cc6 : 0x45aaa0;
    return { container, plate, mascot, title, code, remaining, progress, priorityMark, id: request.id, requestCode: request.code, accent, completing: false, introPlayed: false };
  }

  private updateRequestView(view: RequestView, request: Requirement, state: BattleState): void {
    const x = request.x / WORLD_WIDTH * WIDTH;
    const y = REQUEST_Y[request.id % REQUEST_Y.length];
    const accent = view.accent;
    const prioritized = state.prioritizedRequestId === request.id;
    view.container.setPosition(Math.min(WIDTH - 104, Math.max(106, x)), y)
      .setDepth(prioritized ? 6 : request.isFinal ? 4 : 3);
    if (request.isFinal && !view.introPlayed) {
      view.introPlayed = true;
      view.container.setScale(0.82).setAlpha(0);
      this.tweens.add({ targets: view.container, scale: 1.16, alpha: 1, duration: 480, ease: "Back.Out" });
    } else if (!request.isFinal) {
      view.container.setScale(1).setAlpha(1);
    }
    view.mascot.setTexture(requestTexture(request));
    view.priorityMark.setVisible(prioritized);
    view.title.setText(request.title);
    view.code.setText(request.isFinal ? "P0 · GO-LIVE" : `${request.code} · ${REQUEST_KIND_LABEL[request.kind]}`);
    view.remaining.setText(`${Math.ceil(request.remainingWork)} 工时`);
    view.plate.clear();
    if (request.isFinal) view.plate.fillStyle(0xffd27d, 0.1).fillRoundedRect(-60, -31, 161, 59, 9);
    view.plate.fillStyle(0x191c31, 0.82).fillRect(-55, -22, 151, 49);
    view.plate.fillStyle(0x282b43, 0.96).fillRect(-55, -26, 151, 49);
    view.plate.fillStyle(accent).fillRect(-55, -26, 151, 4);
    view.plate.lineStyle(prioritized || request.isFinal ? 2 : 1, prioritized ? 0xffc875 : accent, prioritized || request.isFinal ? 0.88 + Math.sin(state.elapsed * 3) * 0.1 : 0.6).strokeRect(-55, -26, 151, 49);
    view.plate.fillStyle(0xb4bbcc, 0.25).fillRect(-39, 11, 123, 2);
    view.progress.clear();
    view.progress.fillStyle(0x555a73).fillRect(-39, 14, 123, 5);
    view.progress.fillStyle(accent).fillRect(-39, 14, 123 * (1 - request.remainingWork / request.totalWork), 5);
  }

  private syncPriorityLink(state: BattleState): void {
    this.priorityLink.clear();
    if (state.prioritizedRequestId === null) return;
    const requestView = this.requests.get(state.prioritizedRequestId);
    if (!requestView) return;
    for (const engineerId of state.priorityEngineerIds) {
      const engineer = state.engineers.find((candidate) => candidate.id === engineerId && candidate.targetRequestId === state.prioritizedRequestId);
      if (!engineer) continue;
      const engineerX = engineer.x / WORLD_WIDTH * WIDTH + (engineer.lane - 2) * 56;
      this.priorityLink.lineStyle(2, 0xffc875, engineer.action === "working" ? 0.6 : 0.34)
        .lineBetween(requestView.container.x, requestView.container.y + 26, engineerX, FLOOR_Y - 96);
      this.priorityLink.fillStyle(0xffd38a, 0.8).fillCircle(requestView.container.x, requestView.container.y + 26, 3);
    }
  }

  private playCompletionFeedback(state: BattleState): void {
    const events = state.telemetry.slice(this.telemetryCursor);
    this.telemetryCursor = state.telemetry.length;
    for (const event of events) {
      if (event.type !== "request_complete" || typeof event.detail.request !== "string") continue;
      const view = [...this.requests.values()].find((candidate) => candidate.requestCode === event.detail.request);
      const x = view?.container.x ?? WIDTH / 2;
      const y = view?.container.y ?? FLOOR_Y - 80;
      if (view) {
        view.completing = true;
        view.priorityMark.setVisible(false);
        view.code.setText("验收通过 · CLEAR");
        view.remaining.setText("✓ 已完成");
        view.progress.clear().fillStyle(0x57cc91, 0.95).fillRoundedRect(-39, 14, 123, 5, 3);
        this.tweens.add({
          targets: view.container,
          alpha: 0,
          scale: 1.05,
          duration: 390,
          ease: "Cubic.In",
          onComplete: () => {
            view.container.destroy(true);
            this.requests.delete(view.id);
          }
        });
      }
      const check = this.add.text(x, y - 38, "✓", { fontFamily: "sans-serif", fontSize: "28px", fontStyle: "bold", color: "#42ad79", stroke: "#fff8df", strokeThickness: 6 }).setOrigin(0.5).setDepth(9);
      const particles = this.add.graphics().setPosition(x, y - 18).setDepth(8);
      [0x55c686, 0xf0c35f, 0x6db6df, 0xcc86d5, 0xef8e73].forEach((color, index) => {
        particles.fillStyle(color).fillCircle((index - 2) * 9, index % 2 ? -8 : 2, 2.8);
      });
      this.tweens.add({ targets: check, y: y - 78, alpha: 0, scale: 1.3, duration: 660, ease: "Cubic.Out", onComplete: () => check.destroy() });
      this.tweens.add({ targets: particles, y: y - 58, alpha: 0, duration: 540, ease: "Cubic.Out", onComplete: () => particles.destroy() });
      const budget = typeof event.detail.budget === "number" ? event.detail.budget : 0;
      const experience = typeof event.detail.experience === "number" ? event.detail.experience : 0;
      const reward = this.add.text(x, y + 26, `+${budget} 预算　+${experience} 经验`, {
        fontFamily: "sans-serif", fontSize: "12px", fontStyle: "bold", color: "#ffcf83", stroke: "#20243a", strokeThickness: 4
      }).setOrigin(0.5).setDepth(9);
      this.tweens.add({ targets: reward, y: y - 16, alpha: 0, duration: 850, ease: "Cubic.Out", onComplete: () => reward.destroy() });
    }
  }
}
