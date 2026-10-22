import Phaser from "phaser";
import {
  advanceBattle,
  getInterpolatedWorldX,
  prioritizeRequirement,
  SHIP_IT_WORK_BONUS,
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
const STRIDE_PHASE_STEP = 0.61803398875;
const REQUEST_CARD_WIDTH = 224;
const REQUEST_CARD_HEIGHT = 72;
const REQUEST_CARD_ROW_GAP = 76;
const REQUEST_CARD_BASE_OFFSET = 112;
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
  motionPhaseInitialized: boolean;
  lastWorldX: number | null;
  facingLeft: boolean;
  motionPaused: boolean;
  motionTimeScale: number;
}

interface RequestView {
  container: Phaser.GameObjects.Container;
  mascot: Phaser.GameObjects.Image;
  connector: Phaser.GameObjects.Graphics;
  plate: Phaser.GameObjects.Graphics;
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
  cardX: number;
  cardY: number;
  mascotScale: number;
}

interface RequestCardPosition {
  x: number;
  y: number;
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
        fontFamily: "sans-serif", fontSize: "13px", fontStyle: "bold", color: "#fff4dc", backgroundColor: "#282b43"
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
            fontFamily: "ui-monospace, monospace", fontSize: "16px", fontStyle: "bold",
            color: activityColor(engineer.role), stroke: "#20243a", strokeThickness: 4
          }).setOrigin(0.5).setDepth(6).setVisible(false),
          motionAction: null,
          motionPhaseInitialized: false,
          lastWorldX: null,
          facingLeft: false,
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
    const formation = formationOffset(engineer.lane);
    // Core world X is authoritative. Never add a lane-only horizontal render offset:
    // movement, work range, target links and visible feet must share this coordinate.
    const x = worldX / WORLD_WIDTH * WIDTH;
    const working = engineer.action === "working";
    const target = state.requests.find((request) => request.id === engineer.targetRequestId);
    const workRushScale = state.elapsed < state.rushUntil
      ? 1.55
      : state.elapsed < state.shipItUntil ? 1 + SHIP_IT_WORK_BONUS : 1;
    this.playEngineerMotion(view, engineer.id, engineer.role, engineer.action, state.paused || state.pendingEvent !== null, state.speed, workRushScale);
    const hover = engineer.role === "agent" ? Math.sin(state.elapsed * 4 + engineer.id) * 3 : 0;
    const spriteY = FLOOR_Y + formation.y + hover;
    if (view.sprite.x !== x || view.sprite.y !== spriteY) view.sprite.setPosition(x, spriteY);
    const targetX = target ? getInterpolatedWorldX(state, "request", target.id) ?? target.x : worldX;
    if (working && target) {
      view.facingLeft = targetX < worldX;
    } else if (view.lastWorldX !== null && Math.abs(worldX - view.lastWorldX) > 0.05) {
      view.facingLeft = worldX < view.lastWorldX;
    }
    view.lastWorldX = worldX;
    if (view.sprite.flipX !== view.facingLeft) view.sprite.setFlipX(view.facingLeft);
    view.shadow.setPosition(x, FLOOR_Y + formation.y - 2);
    view.aura.setPosition(x, FLOOR_Y + formation.y - 48 + hover);
    if (view.activity.visible !== working) view.activity.setVisible(working);
    if (working) {
      const activity = ({ intern: "DOC", frontend: "UI ✦", backend: "API ↕", qa: "QA ✓", agent: "AI ✧" })[engineer.role];
      if (view.activity.text !== activity) view.activity.setText(activity);
      const activityX = x + 3;
      const activityY = FLOOR_Y + formation.y - (engineer.role === "agent" ? 158 : 146) + hover;
      if (view.activity.x !== activityX || view.activity.y !== activityY) view.activity.setPosition(activityX, activityY);
      view.activity.setAlpha(0.88 + (Math.sin(state.elapsed * 5 + engineer.id) + 1) * 0.06);
    } else {
      view.activity.setAlpha(1);
    }
  }

  private playEngineerMotion(
    view: EngineerView,
    engineerId: number,
    role: Engineer["role"],
    action: Engineer["action"],
    paused: boolean,
    speed: BattleState["speed"],
    workRushScale: number
  ): void {
    if (view.motionAction !== action) {
      view.sprite.play(engineerAnimationKey(role, action));
      // Offset each actor's stride whenever they start moving so a team does
      // not snap into the same pose in lockstep. Keep the first idle loop
      // desynchronized too, while action transitions remain deterministic.
      if (action === "moving" || !view.motionPhaseInitialized) {
        view.sprite.anims.setProgress((engineerId * STRIDE_PHASE_STEP) % 1);
      }
      view.motionPhaseInitialized = true;
      view.motionAction = action;
      view.motionTimeScale = -1;
    }
    // Ship It and other rush effects boost work, not travel speed.
    const actionScale = action === "working" ? workRushScale : 1;
    const timeScale = speed * actionScale;
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
    const cardPositions = this.getRequestCardPositions(state);
    for (const request of state.requests) {
      present.add(request.id);
      let view = this.requests.get(request.id);
      if (!view) {
        view = this.createRequestView(request);
        this.requests.set(request.id, view);
      }
      this.updateRequestView(view, request, state, cardPositions.get(request.id) ?? { x: WIDTH / 2, y: FLOOR_Y - REQUEST_CARD_BASE_OFFSET });
    }
    for (const [id, view] of this.requests) {
      if (present.has(id)) continue;
      if (view.completing) continue;
      view.container.destroy(true);
      view.mascot.destroy();
      view.connector.destroy();
      this.requests.delete(id);
    }
  }

  private getRequestCardPositions(state: BattleState): Map<number, RequestCardPosition> {
    const rows: number[][] = [];
    const positions = new Map<number, RequestCardPosition>();
    const requests = state.requests.map((request) => {
      const worldX = getInterpolatedWorldX(state, "request", request.id) ?? request.x;
      const unitX = worldX / WORLD_WIDTH * WIDTH;
      return { request, x: Math.max(REQUEST_CARD_WIDTH / 2 + 12, Math.min(WIDTH - REQUEST_CARD_WIDTH / 2 - 12, unitX)) };
    }).sort((a, b) => a.x - b.x || a.request.id - b.request.id);

    for (const { request, x } of requests) {
      let row = rows.findIndex((claimed) => claimed.every((claimedX) => Math.abs(claimedX - x) >= REQUEST_CARD_WIDTH + 16));
      if (row < 0) row = rows.length;
      rows[row] ??= [];
      rows[row].push(x);
      positions.set(request.id, {
        x,
        y: FLOOR_Y - REQUEST_CARD_BASE_OFFSET - row * REQUEST_CARD_ROW_GAP
      });
    }
    return positions;
  }

  private createRequestView(request: Requirement): RequestView {
    const plate = this.add.graphics();
    const textureKey = requestTexture(request);
    const connector = this.add.graphics().setDepth(2);
    const mascot = this.add.image(0, FLOOR_Y, textureKey).setOrigin(0.5, 1).setDepth(5);
    const mascotScale = Math.min(70 / mascot.width, 70 / mascot.height);
    mascot.setScale(mascotScale);
    const title = this.add.text(-96, -17, request.title, { fontFamily: "sans-serif", fontSize: "14px", color: "#f7edd9", fontStyle: "bold" }).setOrigin(0, 0.5);
    const code = this.add.text(-96, 7, `${request.code} · ${REQUEST_KIND_LABEL[request.kind]}`, { fontFamily: "ui-monospace, monospace", fontSize: "12px", color: "#b4bbcc" }).setOrigin(0, 0.5);
    const remaining = this.add.text(96, 7, "", { fontFamily: "ui-monospace, monospace", fontSize: "12px", color: "#f7edd9", fontStyle: "bold" }).setOrigin(1, 0.5);
    const progress = this.add.rectangle(-96, 27, 0, 7, 0x45aaa0).setOrigin(0, 0.5);
    const priorityMark = this.add.text(96, -17, "★ 优先", {
      fontFamily: "sans-serif", fontSize: "11px", fontStyle: "bold", color: "#ffcf83", stroke: "#20243a", strokeThickness: 3
    }).setOrigin(1, 0.5).setVisible(false);
    const container = this.add.container(0, 0, [plate, title, code, remaining, progress, priorityMark]).setDepth(request.isFinal ? 6 : 5);
    const accent = request.isFinal ? 0xefbd59 : request.kind === "bug" ? 0xe57175 : request.kind === "infra" ? 0x679cc6 : 0x45aaa0;
    progress.setFillStyle(accent);
    plate.setInteractive(new Phaser.Geom.Rectangle(-REQUEST_CARD_WIDTH / 2, -REQUEST_CARD_HEIGHT / 2, REQUEST_CARD_WIDTH, REQUEST_CARD_HEIGHT), Phaser.Geom.Rectangle.Contains);
    plate.on("pointerdown", (_pointer: Phaser.Input.Pointer, _localX: number, _localY: number, event: Phaser.Types.Input.EventData) => {
      event.stopPropagation();
      if (!this.state) return;
      prioritizeRequirement(this.state, request.id);
      const updateHud = this.game.registry.get("updateHud") as ((state: BattleState) => void) | undefined;
      updateHud?.(this.state);
    });
    const view: RequestView = {
      container, mascot, connector, plate, title, code, remaining, progress, priorityMark,
      id: request.id,
      requestCode: request.code,
      accent,
      textureKey,
      progressWidth: -1,
      lastRemainingText: "",
      lastPrioritized: null,
      completing: false,
      introPlayed: false,
      cardX: Number.NaN,
      cardY: Number.NaN,
      mascotScale
    };
    this.drawRequestPlate(view, request.isFinal, false);
    return view;
  }

  private updateRequestView(view: RequestView, request: Requirement, state: BattleState, cardPosition: RequestCardPosition): void {
    const worldX = getInterpolatedWorldX(state, "request", request.id) ?? request.x;
    const unitX = worldX / WORLD_WIDTH * WIDTH;
    const prioritized = state.prioritizedRequestId === request.id;
    if (view.mascot.x !== unitX) view.mascot.setX(unitX);
    if (view.mascot.y !== FLOOR_Y) view.mascot.setY(FLOOR_Y);
    if (view.cardX !== cardPosition.x || view.cardY !== cardPosition.y) {
      view.cardX = cardPosition.x;
      view.cardY = cardPosition.y;
      view.container.setPosition(cardPosition.x, cardPosition.y);
    }
    view.connector.clear();
    view.connector.lineStyle(2, prioritized ? 0xffc875 : view.accent, prioritized ? 0.62 : 0.42)
      .lineBetween(cardPosition.x, cardPosition.y + REQUEST_CARD_HEIGHT / 2, unitX, FLOOR_Y - view.mascot.displayHeight + 4);
    const depth = prioritized ? 7 : request.isFinal ? 6 : 5;
    if (view.container.depth !== depth) view.container.setDepth(depth);
    if (request.isFinal && !view.introPlayed) {
      view.introPlayed = true;
      view.container.setScale(0.82).setAlpha(0);
      this.tweens.add({ targets: view.container, scale: 1.16, alpha: 1, duration: 480, ease: "Back.Out" });
      view.mascot.setScale(view.mascotScale * 0.82).setAlpha(0);
      this.tweens.add({ targets: view.mascot, scaleX: view.mascotScale, scaleY: view.mascotScale, alpha: 1, duration: 480, ease: "Back.Out" });
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
    const progressWidth = Math.max(0, Math.round((REQUEST_CARD_WIDTH - 32) * (1 - request.remainingWork / request.totalWork) * 100) / 100);
    if (view.progressWidth !== progressWidth) {
      view.progressWidth = progressWidth;
      view.progress.setSize(progressWidth, 7);
    }
  }

  private drawRequestPlate(view: RequestView, isFinal: boolean, prioritized: boolean): void {
    const { plate, accent } = view;
    plate.clear();
    if (isFinal) plate.fillStyle(0xffd27d, 0.1).fillRoundedRect(-REQUEST_CARD_WIDTH / 2 - 4, -REQUEST_CARD_HEIGHT / 2 - 4, REQUEST_CARD_WIDTH + 8, REQUEST_CARD_HEIGHT + 8, 11);
    plate.fillStyle(0x191c31, 0.94).fillRoundedRect(-REQUEST_CARD_WIDTH / 2, -REQUEST_CARD_HEIGHT / 2, REQUEST_CARD_WIDTH, REQUEST_CARD_HEIGHT, 9);
    plate.fillStyle(0x282b43, 0.98).fillRoundedRect(-REQUEST_CARD_WIDTH / 2 + 1, -REQUEST_CARD_HEIGHT / 2 + 1, REQUEST_CARD_WIDTH - 2, REQUEST_CARD_HEIGHT - 2, 8);
    plate.fillStyle(accent).fillRoundedRect(-REQUEST_CARD_WIDTH / 2, -REQUEST_CARD_HEIGHT / 2, REQUEST_CARD_WIDTH, 5, 3);
    plate.lineStyle(prioritized || isFinal ? 2 : 1, prioritized ? 0xffc875 : accent, prioritized || isFinal ? 0.9 : 0.6).strokeRoundedRect(-REQUEST_CARD_WIDTH / 2, -REQUEST_CARD_HEIGHT / 2, REQUEST_CARD_WIDTH, REQUEST_CARD_HEIGHT, 9);
    plate.fillStyle(0x555a73).fillRoundedRect(-96, 23, REQUEST_CARD_WIDTH - 32, 8, 4);
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
      const formation = formationOffset(engineer.lane);
      const engineerX = worldX / WORLD_WIDTH * WIDTH;
      this.priorityLink.lineStyle(2, 0xffc875, engineer.action === "working" ? 0.6 : 0.34)
        .lineBetween(requestView.mascot.x, FLOOR_Y - 48, engineerX, FLOOR_Y + formation.y - 96);
      this.priorityLink.fillStyle(0xffd38a, 0.8).fillCircle(requestView.mascot.x, FLOOR_Y - 48, 3);
    }
  }

  private playCompletionFeedback(state: BattleState): void {
    const events = state.telemetry.slice(this.telemetryCursor);
    this.telemetryCursor = state.telemetry.length;
    for (const event of events) {
      if (event.type !== "request_complete" || typeof event.detail.request !== "string") continue;
      const view = [...this.requests.values()].find((candidate) => candidate.requestCode === event.detail.request);
      const x = view?.mascot.x ?? WIDTH / 2;
      const y = FLOOR_Y - 82;
      if (view) {
        view.completing = true;
        view.priorityMark.setVisible(false);
        view.code.setText("验收通过 · CLEAR");
        view.remaining.setText("✓ 已完成");
        view.progress.setFillStyle(0x57cc91, 0.95).setSize(REQUEST_CARD_WIDTH - 32, 7);
        view.progressWidth = REQUEST_CARD_WIDTH - 32;
        view.connector.clear();
        this.tweens.add({
          targets: view.container,
          alpha: 0,
          scale: 1.05,
          duration: 390,
          ease: "Cubic.In",
          onComplete: () => {
            view.container.destroy(true);
            view.mascot.destroy();
            view.connector.destroy();
            this.requests.delete(view.id);
          }
        });
        this.tweens.add({ targets: view.mascot, alpha: 0, scaleX: view.mascotScale * 1.1, scaleY: view.mascotScale * 1.1, duration: 390, ease: "Cubic.In" });
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

function formationOffset(lane: number): { y: number } {
  const depthLane = (lane % 5) - 2;
  const formationRow = Math.floor(lane / 5) % 4;
  return { y: depthLane * 6 + formationRow * 4 };
}

function activityColor(role: Engineer["role"]): string {
  return ({ intern: "#ffce80", frontend: "#b79cff", backend: "#85c3ff", qa: "#91e4b2", agent: "#92a7ff" })[role];
}
