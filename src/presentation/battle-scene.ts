import Phaser from "phaser";
import {
  advanceBattle,
  getEngineerDefinition,
  WORLD_WIDTH,
  type BattleState,
  type Engineer,
  type EngineerId,
  type Requirement
} from "../core/game";

const WIDTH = 1280;
const HEIGHT = 720;
const FLOOR_Y = 536;
const UNIT_Y = 487;
const REQUEST_Y = [310, 360, 410] as const;

interface EngineerView {
  shape: Phaser.GameObjects.Graphics;
  role: EngineerId;
}

interface RequestView {
  container: Phaser.GameObjects.Container;
  plate: Phaser.GameObjects.Graphics;
  title: Phaser.GameObjects.Text;
  code: Phaser.GameObjects.Text;
  progress: Phaser.GameObjects.Graphics;
}

export class BattleScene extends Phaser.Scene {
  private state: BattleState | null = null;
  private lastHudUpdate = 0;
  private lastEra = -1;
  private landscape!: Phaser.GameObjects.Graphics;
  private lane!: Phaser.GameObjects.Graphics;
  private engineers = new Map<number, EngineerView>();
  private requests = new Map<number, RequestView>();

  constructor() {
    super({ key: "battle", active: false });
  }

  create(data: { state?: BattleState } = {}): void {
    this.state = data.state ?? this.game.registry.get("battleState") ?? null;
    this.engineers.clear();
    this.requests.clear();
    this.landscape = this.add.graphics().setDepth(0);
    this.lane = this.add.graphics().setDepth(1);
    this.drawLandscape(this.state?.techEra ?? 0);
    this.lastHudUpdate = 0;
    this.lastEra = this.state?.techEra ?? 0;
  }

  update(_time: number, deltaMs: number): void {
    if (!this.state) return;
    advanceBattle(this.state, deltaMs / 1000);
    if (this.lastEra !== this.state.techEra) {
      this.lastEra = this.state.techEra;
      this.drawLandscape(this.lastEra);
    }
    this.syncEngineers(this.state);
    this.syncRequests(this.state);

    if (this.time.now - this.lastHudUpdate >= 100) {
      this.lastHudUpdate = this.time.now;
      const updateHud = this.game.registry.get("updateHud") as ((state: BattleState) => void) | undefined;
      updateHud?.(this.state);
    }
  }

  private drawLandscape(era: number): void {
    this.landscape.clear();
    const sky = [0xb7dfd4, 0xa7d0d2, 0x9eb9d2][era] ?? 0xb7dfd4;
    const farCity = [0x86b7b0, 0x6e9c9f, 0x6a83a8][era] ?? 0x86b7b0;
    this.landscape.fillStyle(sky).fillRect(0, 0, WIDTH, HEIGHT);
    this.landscape.fillStyle(0xd9e9d8).fillRect(0, 282, WIDTH, 112);
    this.landscape.fillStyle(0xe9dcaa).fillRect(0, FLOOR_Y, WIDTH, HEIGHT - FLOOR_Y);

    this.drawPixelCloud(118, 112);
    this.drawPixelCloud(388, 180);
    this.drawPixelCloud(944, 101);

    for (let i = 0; i < 15; i += 1) {
      const x = i * 92 - 16;
      const width = 52 + (i % 3) * 12;
      const height = 64 + (i % 5) * 17;
      const y = 386 - height;
      this.landscape.fillStyle(farCity).fillRect(x, y, width, height);
      this.landscape.fillStyle(0xc9dfcf, 0.72);
      for (let row = 0; row < Math.floor(height / 18); row += 1) {
        for (let col = 0; col < Math.floor(width / 17); col += 1) {
          this.landscape.fillRect(x + 8 + col * 17, y + 9 + row * 18, 6, 7);
        }
      }
    }

    this.landscape.fillStyle(0x98b96f).fillRect(0, 386, WIDTH, 18);
    this.landscape.fillStyle(0x658b63).fillRect(0, 404, WIDTH, 9);
    this.drawFloorGrid();
    this.drawHeadquarters(158, era);
    this.drawDeadlineGate(1122);

    if (era > 0) {
      this.landscape.fillStyle(0x476e86, 0.15).fillRect(0, 0, WIDTH, HEIGHT);
      this.landscape.lineStyle(1, era === 1 ? 0x348f91 : 0x536eb6, 0.24);
      for (let x = 35; x < WIDTH; x += 50) this.landscape.lineBetween(x, 275, x, FLOOR_Y);
      for (let y = 298; y < FLOOR_Y; y += 42) this.landscape.lineBetween(0, y, WIDTH, y);
    }
    if (era > 1) {
      this.landscape.fillStyle(0xf5d375, 0.08).fillRect(0, 0, WIDTH, HEIGHT);
      this.landscape.fillStyle(0x334c75, 0.9).fillRect(960, 308, 188, 95);
      this.landscape.fillStyle(0x76d8cf, 0.48).fillRect(974, 320, 160, 6);
      this.landscape.fillStyle(0x93e6d8, 0.25).fillRect(984, 340, 42, 47);
      this.landscape.fillStyle(0x93e6d8, 0.25).fillRect(1038, 340, 42, 47);
      this.landscape.fillStyle(0x93e6d8, 0.25).fillRect(1092, 340, 42, 47);
    }

    this.lane.clear();
    this.lane.lineStyle(2, 0xf7f1d4, 0.72).lineBetween(280, FLOOR_Y - 2, 1210, FLOOR_Y - 2);
    this.lane.lineStyle(2, 0x58794f, 0.48).lineBetween(280, FLOOR_Y + 15, 1210, FLOOR_Y + 15);
    this.lane.fillStyle(0xfff8d9, 0.8);
    for (let x = 304; x < 1210; x += 64) this.lane.fillRect(x, FLOOR_Y + 5, 22, 3);
  }

  private drawFloorGrid(): void {
    this.landscape.fillStyle(0x819a63, 0.2);
    for (let x = 0; x < WIDTH; x += 48) {
      for (let y = FLOOR_Y + ((x / 48) % 2) * 12; y < HEIGHT; y += 24) this.landscape.fillRect(x, y, 22, 2);
    }
    this.landscape.fillStyle(0x5d7255, 0.3).fillRect(0, FLOOR_Y, WIDTH, 4);
  }

  private drawPixelCloud(x: number, y: number): void {
    this.landscape.fillStyle(0xf5f2dc, 0.82);
    this.landscape.fillRect(x, y + 12, 84, 19);
    this.landscape.fillRect(x + 14, y, 29, 23);
    this.landscape.fillRect(x + 38, y + 4, 32, 20);
    this.landscape.fillStyle(0xd6e5d9, 0.65).fillRect(x + 9, y + 27, 70, 5);
  }

  private drawHeadquarters(x: number, era: number): void {
    this.landscape.fillStyle(0x536b60).fillRect(x - 74, 428, 150, 108);
    this.landscape.fillStyle(0xe7d29a).fillRect(x - 84, 416, 168, 17);
    this.landscape.fillStyle(0x3c5553).fillRect(x - 67, 441, 135, 68);
    this.landscape.fillStyle(0x4cbdb2).fillRect(x - 53, 451, 106, 39);
    this.landscape.fillStyle(0xd8f4d6).fillRect(x - 42, 460, 27, 17);
    this.landscape.fillStyle(0x538c94).fillRect(x - 9, 460, 51, 5);
    this.landscape.fillStyle(0x538c94).fillRect(x - 9, 470, 38, 5);
    this.landscape.fillStyle(0xd5a965).fillRect(x - 54, 499, 107, 9);
    this.landscape.fillStyle(0x5b4030).fillRect(x - 37, 509, 11, 27);
    this.landscape.fillRect(x + 25, 509, 11, 27);
    if (era >= 1) {
      this.landscape.fillStyle(0x405a69).fillRect(x - 69, 396, 61, 22);
      this.landscape.fillStyle(0x86dfd1).fillRect(x - 61, 402, 45, 5);
      this.landscape.fillStyle(0x405a69).fillRect(x + 9, 390, 61, 28);
      this.landscape.fillStyle(0xb3e5d4).fillRect(x + 17, 398, 45, 5);
    }
    if (era >= 2) {
      this.landscape.fillStyle(0xf2cb70).fillRect(x - 8, 384, 20, 8);
      this.landscape.fillStyle(0xb5e7df).fillRect(x - 4, 372, 12, 12);
      this.landscape.fillStyle(0xeaf2ce).fillRect(x - 1, 375, 6, 6);
    }
    this.landscape.fillStyle(0xede3c7).fillRect(x - 42, 424, 84, 5);
  }

  private drawDeadlineGate(x: number): void {
    this.landscape.fillStyle(0x526773).fillRect(x - 79, 388, 158, 148);
    this.landscape.fillStyle(0xd5a95c).fillRect(x - 94, 377, 188, 17);
    this.landscape.fillStyle(0xe9e1c5).fillRect(x - 60, 404, 120, 76);
    this.landscape.fillStyle(0x5f8390).fillRect(x - 48, 414, 96, 49);
    this.landscape.fillStyle(0xa7e1d5).fillRect(x - 37, 424, 75, 5);
    this.landscape.fillStyle(0xdcefd7).fillRect(x - 37, 435, 55, 5);
    this.landscape.fillStyle(0xe2b66d).fillRect(x - 51, 470, 103, 8);
    this.landscape.fillStyle(0x485d5a).fillRect(x - 58, 480, 16, 56);
    this.landscape.fillRect(x + 42, 480, 16, 56);
    this.landscape.fillStyle(0xf4db88).fillRect(x - 8, 351, 16, 16);
    this.landscape.fillStyle(0x496c70).fillRect(x - 3, 356, 6, 6);
  }

  private syncEngineers(state: BattleState): void {
    const present = new Set<number>();
    for (const engineer of state.engineers) {
      present.add(engineer.id);
      let view = this.engineers.get(engineer.id);
      if (!view) {
        view = { shape: this.add.graphics().setDepth(5), role: engineer.role };
        this.engineers.set(engineer.id, view);
      }
      this.drawEngineer(view.shape, engineer, state);
    }
    for (const [id, view] of this.engineers) {
      if (present.has(id)) continue;
      view.shape.destroy();
      this.engineers.delete(id);
    }
  }

  private drawEngineer(graphics: Phaser.GameObjects.Graphics, engineer: Engineer, state: BattleState): void {
    const x = engineer.x / WORLD_WIDTH * WIDTH;
    const bob = engineer.action === "moving" ? Math.sin(state.elapsed * 12 + engineer.id) * 2 : engineer.action === "working" ? Math.sin(state.elapsed * 8 + engineer.id) : 0;
    const y = UNIT_Y + (engineer.lane - 2) * 20 + bob;
    const definition = getEngineerDefinition(engineer.role);
    const color = definition.color;
    const legOffset = engineer.action === "moving" ? Math.sin(state.elapsed * 15 + engineer.id) * 3 : 0;
    graphics.clear();
    graphics.fillStyle(0x394b3d, 0.3).fillRect(x - 18, y + 24, 37, 7);
    graphics.fillStyle(0x4a3f34).fillRect(x - 10, y + 12 + legOffset, 7, 14);
    graphics.fillRect(x + 3, y + 12 - legOffset, 7, 14);
    graphics.fillStyle(0x514736).fillRect(x - 13, y + 24 + legOffset, 12, 5);
    graphics.fillRect(x + 1, y + 24 - legOffset, 12, 5);
    graphics.fillStyle(color).fillRect(x - 15, y - 5, 30, 20);
    graphics.fillStyle(0xe7b88b).fillRect(x - 10, y - 24, 20, 18);
    graphics.fillStyle(0x51483c).fillRect(x - 12, y - 28, 23, 8);
    graphics.fillRect(x + 6, y - 19, 6, 7);
    graphics.fillStyle(0x2e3738).fillRect(x + 3, y - 17, 3, 3);
    graphics.fillStyle(color).fillRect(x - 19, y - 1, 7, 17);
    graphics.fillRect(x + 12, y - 1, 7, 17);
    graphics.fillStyle(0x3a4a50).fillRect(x - 15, y + 10, 30, 5);
    graphics.fillStyle(0xffe2a1).fillRect(x - 4, y - 2, 7, 4);

    if (engineer.role === "intern") {
      graphics.fillStyle(0xf7d877).fillRect(x - 10, y - 33, 21, 6);
      graphics.fillStyle(0xf2f0df).fillRect(x - 7, y - 18, 4, 3);
    } else if (engineer.role === "qa") {
      graphics.fillStyle(0xedf0e8).fillRect(x + 11, y - 22, 8, 17);
      graphics.fillStyle(0x8a79a8).fillRect(x + 13, y - 19, 4, 9);
    } else if (engineer.role === "agent") {
      graphics.fillStyle(0xeee8d5).fillRect(x - 10, y - 35, 20, 7);
      graphics.fillStyle(0x92e8dc).fillRect(x - 3, y - 40, 6, 5);
      graphics.fillStyle(0xf5e9cb).fillRect(x - 18, y - 2, 5, 8);
    } else {
      graphics.fillStyle(0x2d494c).fillRect(x + 12, y + 2, 10, 8);
      graphics.fillStyle(0xf1d995).fillRect(x + 14, y + 4, 5, 2);
    }
    if (engineer.action === "working") {
      graphics.fillStyle(0xffefb0, 0.9).fillRect(x + 20, y - 12, 4, 4);
      graphics.fillRect(x + 27, y - 18, 3, 3);
    }
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
    const title = this.add.text(-46, -14, request.title, { fontFamily: "monospace", fontSize: "12px", color: "#25353b", fontStyle: "bold" }).setOrigin(0, 0.5);
    const code = this.add.text(-46, 1, request.code, { fontFamily: "monospace", fontSize: "9px", color: "#526168" }).setOrigin(0, 0.5);
    const progress = this.add.graphics();
    const container = this.add.container(0, 0, [plate, title, code, progress]).setDepth(request.isFinal ? 4 : 3);
    return { container, plate, title, code, progress };
  }

  private updateRequestView(view: RequestView, request: Requirement): void {
    const row = request.id % REQUEST_Y.length;
    const x = request.x / WORLD_WIDTH * WIDTH;
    const y = REQUEST_Y[row];
    const accent = request.isFinal ? 0xefbd59 : request.kind === "bug" ? 0xb888ce : request.kind === "infra" ? 0x699bc5 : 0x4aafa6;
    view.container.setPosition(x, y);
    view.container.setDepth(request.isFinal ? 4 : 3);
    view.title.setText(request.title);
    view.code.setText(request.isFinal ? "P0 · RELEASE" : `${request.code} · ${request.kind.toUpperCase()}`);
    view.plate.clear();
    view.plate.fillStyle(0xf8f3de).fillRect(-60, -24, 120, 48);
    view.plate.fillStyle(0x465e61).fillRect(-60, -24, 120, 5);
    view.plate.fillStyle(accent).fillRect(-60, -24, 8, 48);
    view.plate.fillStyle(0x61746f, 0.18).fillRect(-53, 19, 106, 2);
    view.progress.clear();
    view.progress.fillStyle(0xc9d3c1).fillRect(-46, 14, 94, 5);
    view.progress.fillStyle(accent).fillRect(-46, 14, 94 * (1 - request.remainingWork / request.totalWork), 5);
    view.progress.fillStyle(0xfff2bd).fillRect(-56, -16, 3, 3);
  }
}
