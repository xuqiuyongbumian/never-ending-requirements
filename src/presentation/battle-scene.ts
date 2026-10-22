import Phaser from "phaser";
import {
  advanceBattle,
  getInterpolatedWorldX,
  prioritizeRequirement,
  WORLD_WIDTH,
  type BattleState,
  type Engineer,
  type Requirement
} from "../core/game";
import {
  ENGINEER_ANIMATIONS,
  ENGINEER_ANIMATION_SHEETS,
  ENGINEER_SPRITE_SHEETS,
  engineerAnimationKey,
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
  sprite: Phaser.GameObjects.Sprite;
  shadow: Phaser.GameObjects.Ellipse;
  aura: Phaser.GameObjects.Ellipse;
  activity: Phaser.GameObjects.Text;
  motionAction: Engineer["action"] | null;
  motionPaused: boolean;
  motionTimeScale: number;
}

interface RequestView {
  container: Phaser.GameObjects.Container;
  plate: Phaser.GameObjects.Graphics;
  mascot: Phaser.GameObjects.Image;
  title: Phaser.GameObjects.Text;
  code: Phaser.GameObjects.Text;
  remaining: Phaser.GameObjects.Text;
  progress: Phaser.GameObjects.Rectangle;
  priorityMark: Phaser.GameObjects.Text;
  id: number;
  requestCode: string;
  accent: number;
  textureKey: string;
  progressWidth: number;
  lastRemainingText: string;
  lastPrioritized: boolean | null;
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
  private presentEngineerIds = new Set<number>();
  private presentRequestIds = new Set<number>();
  private priorityLinkActive = false;

  constructor() {
    super({ key: "battle", active: false });
  }

  preload(): void {
    for (const asset of GAME_TEXTURES) {
      if (!this.textures.exists(asset.key)) this.load.image(asset.key, asset.src);
    }
    for (const sheet of ENGINEER_SPRITE_SHEETS) {
      if (!this.textures.exists(sheet.key)) {
        this.load.spritesheet(sheet.key, sheet.src, { frameWidth: sheet.frameWidth, frameHeight: sheet.frameHeight });
      }
    }
  }

  create(data: { state?: BattleState } = {}): void {
    this.state = data.state ?? this.game.registry.get("battleState") ?? null;
    this.engineers.clear();
    this.requests.clear();
    this.presentEngineerIds.clear();
    this.presentRequestIds.clear();
    this.priorityLinkActive = false;
    this.registerEngineerAnimations();
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

  private registerEngineerAnimations(): void {
    for (const role of Object.keys(ENGINEER_ANIMATION_SHEETS) as Array<keyof typeof ENGINEER_ANIMATION_SHEETS>) {
      const sheet = ENGINEER_ANIMATION_SHEETS[role];
      for (const action of ["idle", "moving", "working"] as const) {
        const definition = ENGINEER_ANIMATIONS[role][action];
        const key = engineerAnimationKey(role, action);
        if (this.anims.exists(key)) continue;
        this.anims.create({
          key,
          frames: this.anims.generateFrameNumbers(sheet.key, {
            start: definition.start,
            end: definition.start + definition.frameCount - 1
          }),
          frameRate: definition.frameRate,
          repeat: -1
        });
      }
    }
  }

  private syncEngineers(state: BattleState): void {
    const present = this.presentEngineerIds;
    present.clear();
    for (const engineer of state.engineers) {
      present.add(engineer.id);
      let view = this.engineers.get(engineer.id);
      if (!view) {
        const sheet = ENGINEER_ANIMATION_SHEETS[engineer.role];
        const sprite = this.add.sprite(0, FLOOR_Y, sheet.key, 0).setOrigin(0.5, 1).setDepth(5);
        const baseScale = Math.min(sheet.displayHeight / sheet.frameHeight, 146 / sheet.frameWidth);
        sprite.setScale(baseScale);
        view = {
          sprite,
          shadow: this.add.ellipse(0, FLOOR_Y - 2, 52, 12, 0x1b2929, 0.25).setDepth(4),
          aura: this.add.ellipse(0, 0, 78, 92, 0x66d9fa, 0.13).setDepth(4.5).setVisible(engineer.role === "agent"),
          activity: this.add.text(0, 0, "</>", {
            fontFamily: "ui-monospace, monospace", fontSize: "15px", fontStyle: "bold",
            color: engineer.role === "agent" ? "#8c92ff" : "#64dccf", stroke: "#20243a", strokeThickness: 4
          }).setOrigin(0.5).setDepth(6).setVisible(false),
          motionAction: null,
          motionPaused: false,
          motionTimeScale: -1
        };
        this.engineers.set(engineer.id, view);
      }
      this.updateEngineerView(view, engineer, state);
    }
    for (const [id, view] of this.engineers) {
      if (present.has(id)) continue;
      view.sprite.destroy();
      view.shadow.destroy();
      view.aura.destroy();
      view.activity.destroy();
      this.engineers.delete(id);
    }
  }

  private updateEngineerView(view: EngineerView, engineer: Engineer, state: BattleState): void {
    const worldX = getInterpolatedWorldX(state, "engineer", engineer.id) ?? engineer.x;
    const x = worldX / WORLD_WIDTH * WIDTH + (engineer.lane - 2) * 56;
    const working = engineer.action === "working";
    const target = state.requests.find((request) => request.id === engineer.targetRequestId);
    this.playEngineerMotion(view, engineer.role, engineer.action, state.elapsed < state.shipItUntil, state.paused, state.speed);
    const hover = engineer.role === "agent" ? Math.sin(state.elapsed * 4 + engineer.id) * 3 : 0;
    const targetX = target ? getInterpolatedWorldX(state, "request", target.id) ?? target.x : worldX;
    const spriteY = FLOOR_Y + hover;
    if (view.sprite.x !== x || view.sprite.y !== spriteY) view.sprite.setPosition(x, spriteY);
    const flipX = target ? targetX < worldX : false;
    if (view.sprite.flipX !== flipX) view.sprite.setFlipX(flipX);
    view.shadow.setPosition(x, FLOOR_Y - 2);
    view.aura.setPosition(x, FLOOR_Y - 48 + hover);
    if (view.activity.visible !== working) view.activity.setVisible(working);
    if (working) {
      const activity = ({ intern: "DOC", frontend: "UI", backend: "API", qa: "✓", agent: "AI" })[engineer.role];
      if (view.activity.text !== activity) view.activity.setText(activity);
      const activityX = x + 3;
      const activityY = FLOOR_Y - (engineer.role === "agent" ? 158 : 146) + hover;
      if (view.activity.x !== activityX || view.activity.y !== activityY) view.activity.setPosition(activityX, activityY);
    }
  }

  private playEngineerMotion(
    view: EngineerView,
    role: Engineer["role"],
    action: Engineer["action"],
    rushing: boolean,
    paused: boolean,
    speed: BattleState["speed"]
  ): void {
    if (view.motionAction !== action) {
      view.sprite.play(engineerAnimationKey(role, action));
      view.motionAction = action;
      view.motionTimeScale = -1;
    }
    const timeScale = speed * (rushing ? 1.2 : 1);
    if (view.motionTimeScale !== timeScale) {
      view.sprite.anims.timeScale = timeScale;
      view.motionTimeScale = timeScale;
    }
    if (view.motionPaused !== paused) {
      if (paused) view.sprite.anims.pause();
      else view.sprite.anims.resume();
      view.motionPaused = paused;
    }
  }

  private syncRequests(state: BattleState): void {
    const present = this.presentRequestIds;
    present.clear();
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
    const textureKey = requestTexture(request);
    const mascot = this.add.image(-68, 0, textureKey).setOrigin(0.5);
    mascot.setScale(Math.min(68 / mascot.width, 68 / mascot.height));
    const title = this.add.text(-39, -12, request.title, { fontFamily: "sans-serif", fontSize: "12px", color: "#f7edd9", fontStyle: "bold" }).setOrigin(0, 0.5);
    const code = this.add.text(-39, 3, request.code, { fontFamily: "ui-monospace, monospace", fontSize: "9px", color: "#b4bbcc" }).setOrigin(0, 0.5);
    const remaining = this.add.text(88, 3, "", { fontFamily: "ui-monospace, monospace", fontSize: "9px", color: "#f7edd9", fontStyle: "bold" }).setOrigin(1, 0.5);
    const progress = this.add.rectangle(-39, 16.5, 0, 5, 0x45aaa0).setOrigin(0, 0.5);
    const priorityMark = this.add.text(88, -15, "★ 优先", {
      fontFamily: "sans-serif", fontSize: "9px", fontStyle: "bold", color: "#ffcf83", stroke: "#20243a", strokeThickness: 3
    }).setOrigin(1, 0.5).setVisible(false);
    const container = this.add.container(0, 0, [plate, mascot, title, code, remaining, progress, priorityMark]).setDepth(request.isFinal ? 4 : 3);
    const accent = request.isFinal ? 0xefbd59 : request.kind === "bug" ? 0xe57175 : request.kind === "infra" ? 0x679cc6 : 0x45aaa0;
    progress.setFillStyle(accent);
    plate.setInteractive(new Phaser.Geom.Rectangle(-55, -26, 151, 49), Phaser.Geom.Rectangle.Contains);
    plate.on("pointerdown", (_pointer: Phaser.Input.Pointer, _localX: number, _localY: number, event: Phaser.Types.Input.EventData) => {
      event.stopPropagation();
      if (!this.state) return;
      prioritizeRequirement(this.state, request.id);
      const updateHud = this.game.registry.get("updateHud") as ((state: BattleState) => void) | undefined;
      updateHud?.(this.state);
    });
    const view: RequestView = {
      container, plate, mascot, title, code, remaining, progress, priorityMark,
      id: request.id,
      requestCode: request.code,
      accent,
      textureKey,
      progressWidth: -1,
      lastRemainingText: "",
      lastPrioritized: null,
      completing: false,
      introPlayed: false
    };
    this.drawRequestPlate(view, request.isFinal, false);
    return view;
  }

  private updateRequestView(view: RequestView, request: Requirement, state: BattleState): void {
    const worldX = getInterpolatedWorldX(state, "request", request.id) ?? request.x;
    const x = worldX / WORLD_WIDTH * WIDTH;
    const y = REQUEST_Y[request.id % REQUEST_Y.length];
    const prioritized = state.prioritizedRequestId === request.id;
    const clampedX = Math.min(WIDTH - 104, Math.max(106, x));
    if (view.container.x !== clampedX || view.container.y !== y) view.container.setPosition(clampedX, y);
    const depth = prioritized ? 6 : request.isFinal ? 4 : 3;
    if (view.container.depth !== depth) view.container.setDepth(depth);
    if (request.isFinal && !view.introPlayed) {
      view.introPlayed = true;
      view.container.setScale(0.82).setAlpha(0);
      this.tweens.add({ targets: view.container, scale: 1.16, alpha: 1, duration: 480, ease: "Back.Out" });
    }
    if (view.textureKey !== requestTexture(request)) {
      view.textureKey = requestTexture(request);
      view.mascot.setTexture(view.textureKey);
    }
    if (view.priorityMark.visible !== prioritized) view.priorityMark.setVisible(prioritized);
    const remainingText = `${Math.ceil(request.remainingWork)} 工时`;
    if (view.lastRemainingText !== remainingText) {
      view.lastRemainingText = remainingText;
      view.remaining.setText(remainingText);
    }
    if (view.lastPrioritized !== prioritized) {
      view.lastPrioritized = prioritized;
      this.drawRequestPlate(view, request.isFinal, prioritized);
    }
    const progressWidth = Math.max(0, Math.round(123 * (1 - request.remainingWork / request.totalWork) * 100) / 100);
    if (view.progressWidth !== progressWidth) {
      view.progressWidth = progressWidth;
      view.progress.setSize(progressWidth, 5);
    }
  }

  private drawRequestPlate(view: RequestView, isFinal: boolean, prioritized: boolean): void {
    const { plate, accent } = view;
    plate.clear();
    if (isFinal) plate.fillStyle(0xffd27d, 0.1).fillRoundedRect(-60, -31, 161, 59, 9);
    view.plate.fillStyle(0x191c31, 0.82).fillRect(-55, -22, 151, 49);
    view.plate.fillStyle(0x282b43, 0.96).fillRect(-55, -26, 151, 49);
    view.plate.fillStyle(accent).fillRect(-55, -26, 151, 4);
    view.plate.lineStyle(prioritized || isFinal ? 2 : 1, prioritized ? 0xffc875 : accent, prioritized || isFinal ? 0.9 : 0.6).strokeRect(-55, -26, 151, 49);
    view.plate.fillStyle(0xb4bbcc, 0.25).fillRect(-39, 11, 123, 2);
    view.plate.fillStyle(0x555a73).fillRect(-39, 14, 123, 5);
  }

  private syncPriorityLink(state: BattleState): void {
    if (state.prioritizedRequestId === null) {
      if (this.priorityLinkActive) this.priorityLink.clear();
      this.priorityLinkActive = false;
      return;
    }
    this.priorityLink.clear();
    this.priorityLinkActive = true;
    const requestView = this.requests.get(state.prioritizedRequestId);
    if (!requestView) return;
    for (const engineerId of state.priorityEngineerIds) {
      const engineer = state.engineers.find((candidate) => candidate.id === engineerId && candidate.targetRequestId === state.prioritizedRequestId);
      if (!engineer) continue;
      const worldX = getInterpolatedWorldX(state, "engineer", engineer.id) ?? engineer.x;
      const engineerX = worldX / WORLD_WIDTH * WIDTH + (engineer.lane - 2) * 56;
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
        view.progress.setFillStyle(0x57cc91, 0.95).setSize(123, 5);
        view.progressWidth = 123;
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
