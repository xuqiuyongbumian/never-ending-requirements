import Phaser from "phaser";
import {
  advanceBattle,
  BASE_FRONT_EDGE,
  getEngineerDefinition,
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
  runContactFrameIndex,
  runAnimationFrameOffset,
  GAME_ASSETS,
  GAME_TEXTURES,
  requestTexture
} from "./game-assets";
import type { AudioEngine } from "../audio/audio-engine";
import { panFromX } from "../audio/music-plan";
import { layoutRequestCards, type RequestCardPosition } from "./request-card-layout";

const WIDTH = 1280;
const HEIGHT = 720;
const FLOOR_Y = 536;
const STRIDE_PHASE_STEP = 0.61803398875;
const REQUEST_CARD_WIDTH = 224;
const REQUEST_CARD_HEIGHT = 72;
const BOSS_CARD_WIDTH = 320;
const BOSS_CARD_HEIGHT = 100;
const REQUEST_CARD_SAFE_TOP = 160;
const REQUEST_CARD_SAFE_BOTTOM = 420;
const REQUEST_CARD_ROW_GAP = 8;
const REQUEST_MASCOT_LIFT = 28;
const REQUEST_KIND_LABEL: Record<Requirement["kind"], string> = {
  feature: "功能",
  bug: "缺陷",
  infra: "基础设施",
  launch: "上线"
};

/** Speech-bubble copy: verbs read better than the old DOC/UI/API abbreviations. */
const ACTIVITY_LABEL: Record<Engineer["role"], string> = {
  intern: "写文档",
  frontend: "改界面",
  backend: "写接口",
  qa: "跑回归",
  agent: "AI 接管"
};
const BUBBLE_WIDTH = 96;
const BUBBLE_HEIGHT = 52;
/** Distance from the bubble centre down to the tail tip. */
const BUBBLE_TAIL_DROP = 12;
const BUBBLE_HEAD_GAP = 6;
const FACING_DEAD_ZONE = 8;
const MIN_ACTION_DWELL_MS = 120;

interface EngineerView {
  sprite: Phaser.GameObjects.Sprite;
  shadow: Phaser.GameObjects.Ellipse;
  aura: Phaser.GameObjects.Ellipse;
  bubble: Phaser.GameObjects.Container;
  bubbleLabel: Phaser.GameObjects.Text;
  motionAction: Engineer["action"] | "landing" | null;
  motionFrameIndex: number;
  motionActionAt: number;
  transitionUntil: number;
  motionPhaseInitialized: boolean;
  lastWorldX: number | null;
  facingLeft: boolean;
  facingChangedAt: number;
  renderX: number;
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
  badge?: Phaser.GameObjects.Text;
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
  cardWidth: number;
  cardHeight: number;
  barHeight: number;
  isBoss: boolean;
  mascotScale: number;
  lastRemainingWork: number;
  lastImpactAt: number;
  lastUrgent: boolean | null;
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
  private audio: AudioEngine | null = null;
  private overflowIndicator!: Phaser.GameObjects.Text;
  private overflowRequestIds: number[] = [];
  private requestCardSafeTop = REQUEST_CARD_SAFE_TOP;
  private requestCardSafeBottom = REQUEST_CARD_SAFE_BOTTOM;
  private lastSafeAreaCheckAt = Number.NEGATIVE_INFINITY;

  constructor() {
    super({ key: "battle", active: false });
  }

  preload(): void {
    for (const asset of GAME_TEXTURES) {
      if (!this.textures.exists(asset.key)) this.load.image(asset.key, asset.src);
    }
    for (const sheet of ENGINEER_SPRITE_SHEETS) {
      if (!this.textures.exists(sheet.key)) {
        this.load.spritesheet(sheet.key, sheet.src, {
          frameWidth: sheet.frameWidth,
          frameHeight: sheet.frameHeight,
          margin: sheet.margin,
          spacing: sheet.spacing
        });
      }
    }
  }

  create(data: { state?: BattleState } = {}): void {
    this.state = data.state ?? this.game.registry.get("battleState") ?? null;
    this.audio = (this.game.registry.get("audio") as AudioEngine | undefined) ?? null;
    const renderScale = this.scale.width / WIDTH;
    this.cameras.main.setZoom(renderScale).setScroll(-WIDTH * (renderScale - 1) / 2, -HEIGHT * (renderScale - 1) / 2);
    this.engineers.clear();
    this.requests.clear();
    this.presentEngineerIds.clear();
    this.presentRequestIds.clear();
    this.priorityLinkActive = false;
    this.overflowRequestIds = [];
    this.overflowIndicator = this.add.text(WIDTH / 2, REQUEST_CARD_SAFE_TOP - 15, "", {
      fontFamily: "sans-serif", fontSize: "13px", fontStyle: "bold", color: "#f7edd9",
      backgroundColor: "#24263e", stroke: "#141728", strokeThickness: 3, padding: { left: 10, right: 10, top: 5, bottom: 5 }, resolution: 2
    }).setOrigin(0.5).setDepth(8).setVisible(false).setInteractive({ useHandCursor: true });
    this.overflowIndicator.on("pointerdown", () => {
      const request = this.state?.requests.find((candidate) => candidate.id === this.overflowRequestIds[0]);
      if (!this.state || !request) return;
      prioritizeRequirement(this.state, request.id);
      const updateHud = this.game.registry.get("updateHud") as ((state: BattleState) => void) | undefined;
      updateHud?.(this.state);
    });
    this.registerEngineerAnimations();
    const era = this.state?.techEra ?? 0;
    const background = GAME_ASSETS.backgrounds[era] ?? GAME_ASSETS.backgrounds[0];
    this.background = this.add.image(WIDTH / 2, HEIGHT / 2, background.key).setDepth(0);
    this.background.setScale(Math.max(WIDTH / this.background.width, HEIGHT / this.background.height));
    this.lane = this.add.graphics().setDepth(1);
    this.priorityLink = this.add.graphics().setDepth(2);
    this.drawLane();
    const baseSprite = this.add.image(164, FLOOR_Y, GAME_ASSETS.structures.base.key).setOrigin(0.5, 1).setDepth(3);
    baseSprite.setScale(250 / baseSprite.height);
    const inboxSprite = this.add.image(1184, FLOOR_Y, GAME_ASSETS.structures.inbox.key).setOrigin(0.5, 1).setDepth(3);
    inboxSprite.setScale(160 / inboxSprite.height);
    for (const [x, y, label] of [
      [164, FLOOR_Y - baseSprite.displayHeight - 18, "研发中心"],
      [1184, FLOOR_Y - inboxSprite.displayHeight - 18, "需求入口"]
    ] as const) {
      this.add.text(x, y, label, {
        fontFamily: "sans-serif", fontSize: "14px", fontStyle: "bold", color: "#fff4dc", backgroundColor: "#282b43", resolution: 2
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
        const bubbleLabel = this.add.text(0, 1, ACTIVITY_LABEL[engineer.role], {
          fontFamily: "sans-serif", fontSize: "12px", fontStyle: "bold", color: "#262a44", resolution: 2
        }).setOrigin(0.5);
        const bubble = this.add
          .container(0, 0, [this.add.image(0, 0, this.ensureBubbleTexture(engineer.role)), bubbleLabel])
          .setDepth(4.6)
          .setVisible(false);
        view = {
          sprite,
          shadow: this.add.ellipse(0, FLOOR_Y + 2, 36, 8, 0x1b2929, 0.16).setDepth(4),
          aura: this.add.ellipse(0, 0, 78, 92, 0x66d9fa, 0.13).setDepth(4.5).setVisible(engineer.role === "agent"),
          bubble,
          bubbleLabel,
          motionAction: null,
          motionFrameIndex: -1,
          motionActionAt: 0,
          transitionUntil: 0,
          motionPhaseInitialized: false,
          lastWorldX: null,
          facingLeft: false,
          facingChangedAt: 0,
          renderX: engineer.x / WORLD_WIDTH * WIDTH,
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
      view.bubble.destroy(true);
      this.engineers.delete(id);
    }
  }

  private updateEngineerView(view: EngineerView, engineer: Engineer, state: BattleState): void {
    const worldX = getInterpolatedWorldX(state, "engineer", engineer.id) ?? engineer.x;
    const formation = formationOffset(engineer.lane);
    // Core world X is authoritative. Never add a lane-only horizontal render offset:
    // movement, work range, target links and visible feet must share this coordinate.
    const x = worldX / WORLD_WIDTH * WIDTH;
    // Render-side smoothing: the simulation moves in 1/30s steps, and snapping
    // the remainder to a station can be a few pixels. Easing the sprite toward
    // the authoritative world X keeps chases from reading as micro-jitter
    // without changing movement, work range or target links.
    const gap = x - view.renderX;
    view.renderX = Math.abs(gap) > 60 || state.paused ? x : view.renderX + gap * 0.45;
    if (Math.abs(x - view.renderX) < 0.05) view.renderX = x;
    const renderX = view.renderX;
    const working = engineer.action === "working";
    const target = state.requests.find((request) => request.id === engineer.targetRequestId);
    const workRushScale = state.elapsed < state.rushUntil
      ? 1.55
      : state.elapsed < state.shipItUntil ? 1 + SHIP_IT_WORK_BONUS : 1;
    this.playEngineerMotion(view, engineer.id, engineer.runDistance, engineer.role, engineer.action, state.paused || state.pendingEvent !== null, state.speed, workRushScale);
    const hover = engineer.role === "agent" ? Math.sin(state.elapsed * 4 + engineer.id) * 3 : 0;
    const spriteY = FLOOR_Y + formation.y + hover;
    if (view.sprite.x !== renderX || view.sprite.y !== spriteY) view.sprite.setPosition(renderX, spriteY);
    const targetX = target ? getInterpolatedWorldX(state, "request", target.id) ?? target.x : worldX;
    const now = this.time.now;
    let desiredFacing = view.facingLeft;
    if (working && target) {
      const facing = targetX - worldX;
      if (Math.abs(facing) > FACING_DEAD_ZONE) desiredFacing = facing < 0;
    } else if (view.lastWorldX !== null) {
      const travelled = worldX - view.lastWorldX;
      if (Math.abs(travelled) > 0.4) desiredFacing = travelled < 0;
    }
    if (desiredFacing !== view.facingLeft && now - view.facingChangedAt > 90) {
      view.facingLeft = desiredFacing;
      view.facingChangedAt = now;
    }
    view.lastWorldX = worldX;
    if (view.sprite.flipX !== view.facingLeft) view.sprite.setFlipX(view.facingLeft);
    view.shadow.setPosition(renderX, FLOOR_Y + formation.y + 2);
    view.aura.setPosition(renderX, FLOOR_Y + formation.y - 48 + hover);
    // Bubbles are noisy when every engineer talks at once: only the team member
    // the player explicitly prioritised, or someone fighting the boss, speaks.
    const speaking = working && (target?.isBoss === true
      || (state.prioritizedRequestId !== null && engineer.targetRequestId === state.prioritizedRequestId));
    if (view.bubble.visible !== speaking) {
      this.tweens.killTweensOf(view.bubble);
      if (speaking) {
        view.bubble.setVisible(true).setScale(0.72);
        this.tweens.add({ targets: view.bubble, scale: 1, duration: 220, ease: "Back.Out" });
      } else {
        view.bubble.setVisible(false);
      }
    }
    if (speaking) {
      const label = ACTIVITY_LABEL[engineer.role];
      if (view.bubbleLabel.text !== label) view.bubbleLabel.setText(label);
      const float = Math.sin(state.elapsed * 4 + engineer.id) * 1.5;
      const bubbleY = FLOOR_Y + formation.y - ENGINEER_ANIMATION_SHEETS[engineer.role].displayHeight
        - BUBBLE_TAIL_DROP - BUBBLE_HEAD_GAP + hover + float;
      if (view.bubble.x !== renderX || view.bubble.y !== bubbleY) view.bubble.setPosition(renderX, bubbleY);
    }
  }

  /** Cloud-shaped speech bubble, generated once per role and cached as a texture. */
  private ensureBubbleTexture(role: Engineer["role"]): string {
    const key = `engineer-bubble-${role}`;
    if (this.textures.exists(key)) return key;
    const graphics = this.add.graphics();
    const paint = (grow: number, color: number) => {
      graphics.fillStyle(color, 1);
      graphics.fillRoundedRect(4 - grow, 13 - grow, 88 + grow * 2, 28 + grow * 2, 12);
      graphics.fillCircle(24, 20, 11 + grow);
      graphics.fillCircle(48, 16, 13 + grow);
      graphics.fillCircle(72, 21, 10 + grow);
      graphics.fillTriangle(28 - grow, 38, 46 + grow, 38, 30, 49);
    };
    paint(2, 0x20243a);
    paint(0, 0xfff8e7);
    graphics.fillStyle(getEngineerDefinition(role).color, 1).fillCircle(15, 28, 3.4);
    graphics.generateTexture(key, BUBBLE_WIDTH, BUBBLE_HEIGHT);
    graphics.destroy();
    return key;
  }

  private playEngineerMotion(
    view: EngineerView,
    engineerId: number,
    runDistance: number,
    role: Engineer["role"],
    action: Engineer["action"],
    paused: boolean,
    speed: BattleState["speed"],
    workRushScale: number
  ): void {
    const now = this.time.now;
    // A one-or-two-frame dip back to idle/working must not tear the run cycle
    // apart; hold the run animation briefly so the sprite keeps its stride.
    const holdRun = view.motionAction === "moving"
      && action !== "moving"
      && now - view.motionActionAt < MIN_ACTION_DWELL_MS;
    const effectiveAction = holdRun ? "moving" : action;
    if (view.motionAction === "moving" && effectiveAction !== "moving") {
      const runDefinition = ENGINEER_ANIMATIONS[role].moving;
      const landingFrame = runContactFrameIndex(runDefinition, view.motionFrameIndex < 0 ? runDefinition.start : view.motionFrameIndex);
      view.sprite.anims.stop();
      view.sprite.setFrame(landingFrame);
      view.motionAction = "landing";
      view.motionFrameIndex = landingFrame;
      view.transitionUntil = now + 70;
    }
    if (view.motionAction === "landing") {
      if (action === "moving") {
        view.motionAction = null;
      } else if (paused || this.time.now < view.transitionUntil) {
        view.motionPaused = paused;
        return;
      } else {
        view.motionAction = null;
      }
    }
    if (view.motionAction !== effectiveAction) {
      if (effectiveAction === "moving") {
        view.sprite.anims.stop();
      } else {
        view.sprite.play(engineerAnimationKey(role, effectiveAction));
        if (!view.motionPhaseInitialized) {
          view.sprite.anims.setProgress((engineerId * STRIDE_PHASE_STEP) % 1);
        }
      }
      view.motionPhaseInitialized = true;
      view.motionAction = effectiveAction;
      view.motionActionAt = now;
      view.motionFrameIndex = -1;
      view.motionTimeScale = -1;
      view.motionPaused = !paused;
    }
    if (effectiveAction === "moving") {
      const definition = ENGINEER_ANIMATIONS[role].moving;
      const phase = engineerId * STRIDE_PHASE_STEP * definition.frameCount;
      const frameIndex = definition.start + runAnimationFrameOffset(
        definition,
        runDistance,
        getEngineerDefinition(role).moveSpeed,
        phase
      );
      if (frameIndex !== view.motionFrameIndex && (!paused || view.motionFrameIndex < 0)) {
        view.sprite.setFrame(frameIndex);
        view.motionFrameIndex = frameIndex;
      }
      view.motionPaused = paused;
      return;
    }
    // Ship It and other rush effects boost work, not travel speed.
    const actionScale = effectiveAction === "working" ? workRushScale : 1;
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
    if (this.time.now - this.lastSafeAreaCheckAt >= 250) {
      this.lastSafeAreaCheckAt = this.time.now;
      this.updateRequestCardSafeArea();
    }
    const present = this.presentRequestIds;
    present.clear();
    let layout = this.getRequestCardPositions(state);
    if (layout.overflowIds.length > 0) layout = this.getRequestCardPositions(state, this.requestCardSafeTop + 32);
    const { positions: cardPositions, overflowIds } = layout;
    this.overflowRequestIds = overflowIds;
    for (const request of state.requests) {
      present.add(request.id);
      let view = this.requests.get(request.id);
      if (!view) {
        view = this.createRequestView(request);
        this.requests.set(request.id, view);
        this.audio?.playCue("request_in", {
          pan: panFromX(request.x / WORLD_WIDTH * WIDTH, 0, WIDTH, 0.6),
          gain: request.isFinal ? 1 : 0.75
        });
      }
      const cardPosition = cardPositions.get(request.id);
      const visibleCard = cardPosition !== undefined;
      if (view.container.visible !== visibleCard) view.container.setVisible(visibleCard);
      if (view.connector.visible !== visibleCard) view.connector.setVisible(visibleCard);
      this.updateRequestView(view, request, state, cardPosition ?? { x: WIDTH / 2, y: REQUEST_CARD_SAFE_BOTTOM - view.cardHeight / 2 });
    }
    for (const [id, view] of this.requests) {
      if (present.has(id)) continue;
      if (view.completing) continue;
      view.container.destroy(true);
      view.mascot.destroy();
      view.connector.destroy();
      this.requests.delete(id);
    }
    const overflowRequest = state.requests.find((request) => request.id === overflowIds[0]);
    const overflowText = overflowRequest ? `还有 ${overflowIds.length} 项 · 点击优先 ${overflowRequest.code}` : "";
    if (this.overflowIndicator.text !== overflowText) this.overflowIndicator.setText(overflowText);
    this.overflowIndicator.setPosition(WIDTH / 2, this.requestCardSafeTop + 16);
    this.overflowIndicator.setVisible(overflowIds.length > 0);
  }

  private updateRequestCardSafeArea(): void {
    const canvas = this.game.canvas;
    const canvasRect = canvas.getBoundingClientRect();
    if (canvasRect.height <= 0) return;
    const header = document.querySelector<HTMLElement>(".battle-header")?.getBoundingClientRect();
    const tutorial = document.querySelector<HTMLElement>(".tutorial-callout")?.getBoundingClientRect();
    const notice = document.querySelector<HTMLElement>(".battle-notice.visible");
    const noticeRect = notice && getComputedStyle(notice).display !== "none" ? notice.getBoundingClientRect() : null;
    const deck = document.querySelector<HTMLElement>(".unit-deck")?.getBoundingClientRect();
    const topPixel = Math.max(header?.bottom ?? canvasRect.top, tutorial?.bottom ?? canvasRect.top, noticeRect?.bottom ?? canvasRect.top);
    const pixelsToWorld = HEIGHT / canvasRect.height;
    this.requestCardSafeTop = Math.min(FLOOR_Y - BOSS_CARD_HEIGHT - 8, Math.max(REQUEST_CARD_SAFE_TOP, Math.ceil((topPixel - canvasRect.top + 8) * pixelsToWorld)));
    const bottomPixel = (deck?.top ?? canvasRect.bottom) - canvasRect.top - 8;
    this.requestCardSafeBottom = Math.min(REQUEST_CARD_SAFE_BOTTOM, Math.floor(bottomPixel * pixelsToWorld));
  }

  private getRequestCardPositions(state: BattleState, safeTop = this.requestCardSafeTop): ReturnType<typeof layoutRequestCards> {
    const requests = state.requests.map((request) => {
      const worldX = getInterpolatedWorldX(state, "request", request.id) ?? request.x;
      return {
        id: request.id,
        anchorX: worldX / WORLD_WIDTH * WIDTH,
        width: request.isBoss ? BOSS_CARD_WIDTH : REQUEST_CARD_WIDTH,
        height: request.isBoss ? BOSS_CARD_HEIGHT : REQUEST_CARD_HEIGHT,
        isBoss: request.isBoss === true,
        prioritized: state.prioritizedRequestId === request.id
      };
    });
    return layoutRequestCards(requests, {
      viewportWidth: WIDTH,
      safeTop,
      safeBottom: this.requestCardSafeBottom,
      horizontalGap: 12,
      verticalGap: REQUEST_CARD_ROW_GAP
    });
  }

  private createRequestView(request: Requirement): RequestView {
    const isBoss = request.isBoss === true;
    const cardWidth = isBoss ? BOSS_CARD_WIDTH : REQUEST_CARD_WIDTH;
    const cardHeight = isBoss ? BOSS_CARD_HEIGHT : REQUEST_CARD_HEIGHT;
    const barHeight = isBoss ? 12 : 7;
    const halfWidth = cardWidth / 2;
    const innerLeft = -halfWidth + 12;
    const innerRight = halfWidth - 12;
    const barY = cardHeight / 2 - 13;
    const plate = this.add.graphics();
    const textureKey = requestTexture(request);
    const connector = this.add.graphics().setDepth(2);
    const mascot = this.add.image(0, FLOOR_Y - REQUEST_MASCOT_LIFT, textureKey).setOrigin(0.5, 1).setDepth(5);
    const mascotScale = Math.min((isBoss ? 116 : 78) / mascot.width, (isBoss ? 116 : 78) / mascot.height);
    mascot.setScale(mascotScale);
    const title = this.add.text(innerLeft, -17, request.title, { fontFamily: "sans-serif", fontSize: isBoss ? "20px" : "16px", color: "#f7edd9", fontStyle: "bold", resolution: 2 }).setOrigin(0, 0.5);
    const code = this.add.text(innerLeft, 7, `${request.code} · ${REQUEST_KIND_LABEL[request.kind]}`, { fontFamily: "ui-monospace, monospace", fontSize: "14px", color: "#b4bbcc", resolution: 2 }).setOrigin(0, 0.5);
    const remaining = this.add.text(innerRight, 7, "", { fontFamily: "ui-monospace, monospace", fontSize: "14px", color: "#f7edd9", fontStyle: "bold", resolution: 2 }).setOrigin(1, 0.5);
    const progress = this.add.rectangle(innerLeft, barY, 0, barHeight, 0x45aaa0).setOrigin(0, 0.5);
    const priorityMark = this.add.text(innerRight, -17, "★ 优先", {
      fontFamily: "sans-serif", fontSize: "12px", fontStyle: "bold", color: "#ffcf83", stroke: "#20243a", strokeThickness: 3, resolution: 2
    }).setOrigin(1, 0.5).setVisible(false);
    const badge = isBoss
      ? this.add.text(-halfWidth + 10, -cardHeight / 2 + 11, "BOSS", {
        fontFamily: "sans-serif", fontSize: "14px", fontStyle: "bold", color: "#fff1f1",
        backgroundColor: "#c0392b", resolution: 2
      }).setOrigin(0, 0.5).setPadding(6, 3, 6, 3)
      : undefined;
    const container = this.add.container(0, 0, badge
      ? [plate, title, code, remaining, progress, badge, priorityMark]
      : [plate, title, code, remaining, progress, priorityMark]).setDepth(request.isFinal ? 6 : 5);
    const accent = isBoss ? 0xff5a4d : request.isFinal ? 0xefbd59 : request.kind === "bug" ? 0xe57175 : request.kind === "infra" ? 0x679cc6 : 0x45aaa0;
    progress.setFillStyle(accent);
    plate.setInteractive(new Phaser.Geom.Rectangle(-halfWidth, -cardHeight / 2, cardWidth, cardHeight), Phaser.Geom.Rectangle.Contains);
    plate.on("pointerdown", (_pointer: Phaser.Input.Pointer, _localX: number, _localY: number, event: Phaser.Types.Input.EventData) => {
      event.stopPropagation();
      if (!this.state) return;
      prioritizeRequirement(this.state, request.id);
      const updateHud = this.game.registry.get("updateHud") as ((state: BattleState) => void) | undefined;
      updateHud?.(this.state);
    });
    const view: RequestView = {
      container, mascot, connector, plate, title, code, remaining, progress, priorityMark, badge,
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
      cardWidth,
      cardHeight,
      barHeight,
      isBoss,
      mascotScale,
      lastRemainingWork: request.remainingWork,
      lastImpactAt: Number.NEGATIVE_INFINITY,
      lastUrgent: null
    };
    this.drawRequestPlate(view, request.isFinal, false);
    return view;
  }

  private updateRequestView(view: RequestView, request: Requirement, state: BattleState, cardPosition: RequestCardPosition): void {
    const worldX = getInterpolatedWorldX(state, "request", request.id) ?? request.x;
    const unitX = worldX / WORLD_WIDTH * WIDTH;
    const prioritized = state.prioritizedRequestId === request.id;
    const beingWorked = state.engineers.some((engineer) => engineer.targetRequestId === request.id && engineer.action === "working");
    const mascotY = FLOOR_Y - REQUEST_MASCOT_LIFT + Math.sin(state.elapsed * (beingWorked ? 7 : 3) + request.id) * (beingWorked ? 2.8 : 1.4);
    if (request.remainingWork < view.lastRemainingWork - 0.01 && state.elapsed - view.lastImpactAt >= 0.28) {
      view.lastImpactAt = state.elapsed;
      this.tweens.killTweensOf(view.mascot);
      view.mascot.setScale(view.mascotScale);
      const hitScale = view.isBoss ? 1.12 : 1.07;
      this.tweens.add({ targets: view.mascot, scaleX: view.mascotScale * hitScale, scaleY: view.mascotScale / hitScale, duration: view.isBoss ? 125 : 95, yoyo: true, ease: "Sine.Out" });
    }
    view.lastRemainingWork = request.remainingWork;
    if (view.mascot.x !== unitX) view.mascot.setX(unitX);
    if (view.mascot.y !== mascotY) view.mascot.setY(mascotY);
    if (view.cardX !== cardPosition.x || view.cardY !== cardPosition.y) {
      view.cardX = cardPosition.x;
      view.cardY = cardPosition.y;
      view.container.setPosition(cardPosition.x, cardPosition.y);
    }
    view.connector.clear();
    view.connector.lineStyle(view.isBoss ? 3 : 2, prioritized ? 0xffc875 : view.accent, prioritized ? 0.62 : 0.42)
      .lineBetween(cardPosition.x, cardPosition.y + view.cardHeight / 2, unitX, view.mascot.y - view.mascot.displayHeight + 4);
    const depth = prioritized ? 7 : request.isFinal ? 6 : view.isBoss ? 6 : 5;
    if (view.container.depth !== depth) view.container.setDepth(depth);
    if (view.isBoss && !view.introPlayed) {
      view.introPlayed = true;
      this.cameras.main.shake(320, 0.008);
    }
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
    const eta = Math.max(0, request.x - BASE_FRONT_EDGE) / Math.max(1, request.speed * (beingWorked ? 0.55 : 1));
    const urgent = eta <= 10;
    if (view.lastPrioritized !== prioritized || view.lastUrgent !== urgent) {
      view.lastPrioritized = prioritized;
      view.lastUrgent = urgent;
      view.remaining.setColor(urgent ? "#ff7887" : "#f7edd9");
      this.drawRequestPlate(view, request.isFinal, prioritized, urgent);
    }
    const progressWidth = Math.max(0, Math.round((view.cardWidth - 32) * (1 - request.remainingWork / request.totalWork) * 100) / 100);
    if (view.progressWidth !== progressWidth) {
      view.progressWidth = progressWidth;
      view.progress.setSize(progressWidth, view.barHeight);
    }
  }

  private drawRequestPlate(view: RequestView, isFinal: boolean, prioritized: boolean, urgent = false): void {
    const { plate, accent } = view;
    const width = view.cardWidth;
    const height = view.cardHeight;
    const halfWidth = width / 2;
    const halfHeight = height / 2;
    plate.clear();
    if (isFinal || view.isBoss || urgent) {
      plate.fillStyle(view.isBoss ? 0xff5a4d : 0xffd27d, view.isBoss ? 0.16 : 0.1)
        .fillRoundedRect(-halfWidth - 4, -halfHeight - 4, width + 8, height + 8, 11);
    }
    plate.fillStyle(0x191c31, view.isBoss ? 0.95 : 0.86).fillRoundedRect(-halfWidth, -halfHeight, width, height, 9);
    plate.fillStyle(0x282b43, view.isBoss ? 0.98 : 0.91).fillRoundedRect(-halfWidth + 1, -halfHeight + 1, width - 2, height - 2, 8);
    plate.fillStyle(urgent ? 0xff6b83 : accent).fillRoundedRect(-halfWidth, -halfHeight, width, 5, 3);
    const border = urgent ? 0xff6b83 : prioritized ? 0xffc875 : accent;
    plate.lineStyle(prioritized || isFinal || view.isBoss || urgent ? 2 : 1, border, prioritized || isFinal || view.isBoss || urgent ? 0.9 : 0.6).strokeRoundedRect(-halfWidth, -halfHeight, width, height, 9);
    plate.fillStyle(0x555a73).fillRoundedRect(-halfWidth + 12, halfHeight - 13, width - 24, view.barHeight + 1, 4);
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
        .lineBetween(requestView.mascot.x, requestView.mascot.y - 48, engineerX, FLOOR_Y + formation.y - 96);
      this.priorityLink.fillStyle(0xffd38a, 0.8).fillCircle(requestView.mascot.x, requestView.mascot.y - 48, 3);
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
        view.progress.setFillStyle(0x57cc91, 0.95).setSize(view.cardWidth - 32, view.barHeight);
        view.progressWidth = view.cardWidth - 32;
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
  return { y: -Math.abs(depthLane) * 12 - formationRow * 8 };
}
