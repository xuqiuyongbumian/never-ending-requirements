import Phaser from "phaser";
import {
  advanceBattle,
  getEngineerDefinition,
  WORLD_WIDTH,
  type BattleState,
  type Engineer,
  type Requirement
} from "../core/game";
import { engineerTexture, GAME_ASSETS, GAME_TEXTURES, requestTexture } from "./game-assets";

const WIDTH = 1280;
const HEIGHT = 720;
const FLOOR_Y = 536;
const REQUEST_Y = [310, 370, 430] as const;

interface EngineerView {
  image: Phaser.GameObjects.Image;
  shadow: Phaser.GameObjects.Graphics;
  aura: Phaser.GameObjects.Graphics;
  activity: Phaser.GameObjects.Text;
  baseScale: number;
}

interface RequestView {
  container: Phaser.GameObjects.Container;
  plate: Phaser.GameObjects.Graphics;
  mascot: Phaser.GameObjects.Image;
  title: Phaser.GameObjects.Text;
  code: Phaser.GameObjects.Text;
  remaining: Phaser.GameObjects.Text;
  progress: Phaser.GameObjects.Graphics;
  requestCode: string;
}

export class BattleScene extends Phaser.Scene {
  private state: BattleState | null = null;
  private lastHudUpdate = 0;
  private lastEra = -1;
  private telemetryCursor = 0;
  private background!: Phaser.GameObjects.Image;
  private lane!: Phaser.GameObjects.Graphics;
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
    this.drawLane();
    for (const [x, label] of [[160, "研发中心"], [1120, "需求入口"]] as const) {
      this.add.text(x, FLOOR_Y - 18, label, {
        fontFamily: "sans-serif", fontSize: "11px", fontStyle: "bold", color: "#fff6da", backgroundColor: "#365c57"
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
        const image = this.add.image(0, FLOOR_Y, engineerTexture(engineer.role)).setOrigin(0.5, 1).setDepth(5);
        const maxHeight = engineer.role === "agent" ? 105 : 96;
        const baseScale = Math.min(maxHeight / image.height, 118 / image.width);
        image.setScale(baseScale);
        view = {
          image,
          shadow: this.add.graphics().setDepth(4),
          aura: this.add.graphics().setDepth(4.5),
          activity: this.add.text(0, 0, "</>", {
            fontFamily: "ui-monospace, monospace", fontSize: "15px", fontStyle: "bold",
            color: engineer.role === "agent" ? "#6776e7" : "#248d78", stroke: "#fff8de", strokeThickness: 4
          }).setOrigin(0.5).setDepth(6).setVisible(false),
          baseScale
        };
        this.engineers.set(engineer.id, view);
      }
      this.updateEngineerView(view, engineer, state);
    }
    for (const [id, view] of this.engineers) {
      if (present.has(id)) continue;
      view.image.destroy();
      view.shadow.destroy();
      view.aura.destroy();
      view.activity.destroy();
      this.engineers.delete(id);
    }
  }

  private updateEngineerView(view: EngineerView, engineer: Engineer, state: BattleState): void {
    const definition = getEngineerDefinition(engineer.role);
    const x = engineer.x / WORLD_WIDTH * WIDTH + (engineer.lane - 2) * 34;
    const moving = engineer.action === "moving";
    const working = engineer.action === "working";
    const bob = Math.sin(state.elapsed * (moving ? 12 : 6) + engineer.id) * (moving ? 2.8 : 1.3);
    const target = state.requests.find((request) => request.id === engineer.targetRequestId);
    view.image.setPosition(x, FLOOR_Y + bob).setFlipX(target ? target.x < engineer.x : false);
    view.image.setRotation(moving ? Math.sin(state.elapsed * 10 + engineer.id) * 0.035 : 0);
    const pulse = working ? 1 + Math.sin(state.elapsed * 8 + engineer.id) * 0.012 : 1 + Math.sin(state.elapsed * 3 + engineer.id) * 0.008;
    view.image.setScale(view.baseScale * pulse);

    view.shadow.clear().fillStyle(0x1b2929, 0.25).fillEllipse(x, FLOOR_Y - 2, 52, 12);
    view.aura.clear();
    if (engineer.role === "agent") {
      view.aura.fillStyle(0x66d9fa, 0.13).fillEllipse(x, FLOOR_Y - 48 + bob, 78, 92);
      view.aura.fillStyle(0x9c9bff, 0.2).fillCircle(x + Math.sin(state.elapsed * 2 + engineer.id) * 25, FLOOR_Y - 85 + bob, 2.5);
    }
    view.activity.setVisible(working).setPosition(x + 3, FLOOR_Y - (engineer.role === "agent" ? 123 : 112) + bob);
    if (working && engineer.role === "agent") view.activity.setText("AI");
    else if (working) view.activity.setText("</>");
    view.activity.setColor(engineer.role === "agent" ? "#6776e7" : `#${definition.color.toString(16).padStart(6, "0")}`);
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
      this.updateRequestView(view, request);
    }
    for (const [id, view] of this.requests) {
      if (present.has(id)) continue;
      view.container.destroy(true);
      this.requests.delete(id);
    }
  }

  private createRequestView(request: Requirement): RequestView {
    const plate = this.add.graphics();
    const mascot = this.add.image(-68, 0, requestTexture(request)).setOrigin(0.5);
    mascot.setScale(Math.min(68 / mascot.width, 68 / mascot.height));
    const title = this.add.text(-39, -12, request.title, { fontFamily: "sans-serif", fontSize: "11px", color: "#25353b", fontStyle: "bold" }).setOrigin(0, 0.5);
    const code = this.add.text(-39, 3, request.code, { fontFamily: "ui-monospace, monospace", fontSize: "8px", color: "#526168" }).setOrigin(0, 0.5);
    const remaining = this.add.text(88, 3, "", { fontFamily: "ui-monospace, monospace", fontSize: "8px", color: "#526168", fontStyle: "bold" }).setOrigin(1, 0.5);
    const progress = this.add.graphics();
    const container = this.add.container(0, 0, [plate, mascot, title, code, remaining, progress]).setDepth(request.isFinal ? 4 : 3);
    return { container, plate, mascot, title, code, remaining, progress, requestCode: request.code };
  }

  private updateRequestView(view: RequestView, request: Requirement): void {
    const x = request.x / WORLD_WIDTH * WIDTH;
    const y = REQUEST_Y[request.id % REQUEST_Y.length];
    const accent = request.isFinal ? 0xefbd59 : request.kind === "bug" ? 0xe57175 : request.kind === "infra" ? 0x679cc6 : 0x45aaa0;
    view.container.setPosition(Math.min(WIDTH - 104, Math.max(106, x)), y).setDepth(request.isFinal ? 4 : 3);
    view.mascot.setTexture(requestTexture(request));
    view.title.setText(request.title);
    view.code.setText(request.isFinal ? "P0 · RELEASE" : `${request.code} · ${request.kind.toUpperCase()}`);
    view.remaining.setText(`${Math.ceil(request.remainingWork)} 工时`);
    view.plate.clear();
    view.plate.fillStyle(0x25353b, 0.3).fillRect(-55, -22, 151, 49);
    view.plate.fillStyle(0xfff9e8, 0.97).fillRect(-55, -26, 151, 49);
    view.plate.fillStyle(accent).fillRect(-55, -26, 151, 4);
    view.plate.fillStyle(0x61746f, 0.17).fillRect(-39, 11, 123, 2);
    view.progress.clear();
    view.progress.fillStyle(0xc9d3c1).fillRect(-39, 14, 123, 5);
    view.progress.fillStyle(accent).fillRect(-39, 14, 123 * (1 - request.remainingWork / request.totalWork), 5);
  }

  private playCompletionFeedback(state: BattleState): void {
    const events = state.telemetry.slice(this.telemetryCursor);
    this.telemetryCursor = state.telemetry.length;
    for (const event of events) {
      if (event.type !== "request_complete" || typeof event.detail.request !== "string") continue;
      const view = [...this.requests.values()].find((candidate) => candidate.requestCode === event.detail.request);
      const x = view?.container.x ?? WIDTH / 2;
      const y = view?.container.y ?? FLOOR_Y - 80;
      const check = this.add.text(x, y - 38, "✓", { fontFamily: "sans-serif", fontSize: "28px", fontStyle: "bold", color: "#42ad79", stroke: "#fff8df", strokeThickness: 6 }).setOrigin(0.5).setDepth(9);
      const pixels = this.add.graphics().setPosition(x, y - 18).setDepth(8);
      [0x55c686, 0xf0c35f, 0x6db6df, 0xcc86d5, 0xef8e73].forEach((color, index) => {
        pixels.fillStyle(color).fillRect((index - 2) * 9, index % 2 ? -8 : 2, 4, 4);
      });
      this.tweens.add({ targets: check, y: y - 78, alpha: 0, scale: 1.3, duration: 660, ease: "Cubic.Out", onComplete: () => check.destroy() });
      this.tweens.add({ targets: pixels, y: y - 58, alpha: 0, duration: 540, ease: "Cubic.Out", onComplete: () => pixels.destroy() });
    }
  }
}
