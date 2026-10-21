import Phaser from "phaser";
import {
  advanceBattle,
  getUnitDefinition,
  WORLD_WIDTH,
  type BattleState,
  type BattleUnit
} from "../core/game";

const WIDTH = 1280;
const HEIGHT = 720;
const LANE_Y = 502;

export class BattleScene extends Phaser.Scene {
  private state: BattleState | null = null;
  private actors!: Phaser.GameObjects.Graphics;
  private lastHudUpdate = 0;

  constructor() {
    super({ key: "battle", active: false });
  }

  create(data: { state?: BattleState } = {}): void {
    this.state = data.state ?? this.game.registry.get("battleState") ?? null;
    this.drawLandscape();
    this.drawBases();
    this.actors = this.add.graphics();
  }

  update(_time: number, deltaMs: number): void {
    if (!this.state) return;

    advanceBattle(this.state, deltaMs / 1000);
    this.drawActors();

    if (this.time.now - this.lastHudUpdate >= 100) {
      this.lastHudUpdate = this.time.now;
      const updateHud = this.game.registry.get("updateHud") as ((state: BattleState) => void) | undefined;
      updateHud?.(this.state);
    }
  }

  private drawLandscape(): void {
    const sky = this.add.graphics();
    sky.fillStyle(0x14232d).fillRect(0, 0, WIDTH, HEIGHT);
    sky.fillStyle(0x263947).fillRect(0, 288, WIDTH, 150);
    sky.fillStyle(0x344238).fillRect(0, 398, WIDTH, 140);
    sky.fillStyle(0x69563d).fillRect(0, 526, WIDTH, HEIGHT - 526);

    sky.fillStyle(0xe6b76a, 0.75).fillCircle(1050, 180, 62);
    sky.fillStyle(0xd9b16b).fillRect(0, 430, WIDTH, 5);
    sky.fillStyle(0x806a4c).fillRect(0, LANE_Y + 12, WIDTH, 22);
    sky.fillStyle(0x9e8054, 0.75).fillRect(0, LANE_Y + 11, WIDTH, 4);

    for (let i = 0; i < 16; i += 1) {
      const x = 34 + i * 83;
      const y = 408 + ((i * 31) % 36);
      const radius = 13 + ((i * 17) % 15);
      sky.fillStyle(i % 2 === 0 ? 0x3b4936 : 0x46513a, 0.95).fillCircle(x, y, radius);
    }

    for (let i = 0; i < 23; i += 1) {
      const x = 20 + i * 57;
      const y = 570 + ((i * 19) % 120);
      sky.fillStyle(i % 3 === 0 ? 0x806b4c : 0x5a5b3d, 0.7).fillCircle(x, y, 2 + (i % 3));
    }

    this.add.text(WIDTH / 2, 431, "石器前线", {
      color: "#d8c49a",
      fontFamily: "system-ui, PingFang SC, sans-serif",
      fontSize: "15px",
      letterSpacing: 5
    }).setOrigin(0.5);
  }

  private drawBases(): void {
    const bases = this.add.graphics();
    this.drawBase(bases, 18, 0x92724c, 0x473e32);
    this.drawBase(bases, WIDTH - 100, 0xa25b4e, 0x473635);
  }

  private drawBase(graphics: Phaser.GameObjects.Graphics, x: number, wall: number, shadow: number): void {
    graphics.fillStyle(shadow).fillRect(x - 7, 430, 90, 115);
    graphics.fillStyle(wall).fillRect(x, 445, 76, 101);
    graphics.fillStyle(shadow).fillRect(x + 8, 457, 13, 89);
    graphics.fillStyle(shadow).fillRect(x + 54, 457, 13, 89);
    graphics.fillStyle(0xc7a66e).fillRect(x - 4, 435, 84, 15);
    graphics.fillStyle(0x302d29).fillRect(x + 26, 494, 25, 52);
    graphics.fillStyle(0xdbc08b).fillRect(x + 20, 470, 10, 15);
    graphics.fillStyle(0xdbc08b).fillRect(x + 47, 470, 10, 15);
  }

  private drawActors(): void {
    const state = this.state;
    if (!state) return;
    const graphics = this.actors;
    graphics.clear();

    this.drawBaseHealth(graphics, 0, state.baseHp[0], 18);
    this.drawBaseHealth(graphics, 1, state.baseHp[1], WIDTH - 100);

    for (const unit of state.units) this.drawUnit(graphics, unit, state);
  }

  private drawBaseHealth(graphics: Phaser.GameObjects.Graphics, side: 0 | 1, hp: number, x: number): void {
    const ratio = Phaser.Math.Clamp(hp / 2400, 0, 1);
    graphics.fillStyle(0x1b211f, 0.9).fillRect(x - 2, 554, 80, 8);
    graphics.fillStyle(side === 0 ? 0x80b878 : 0xd36d5c).fillRect(x, 556, 76 * ratio, 4);
  }

  private drawUnit(graphics: Phaser.GameObjects.Graphics, unit: BattleUnit, state: BattleState): void {
    const definition = getUnitDefinition(unit.unitId);
    const x = unit.x / WORLD_WIDTH * WIDTH;
    const y = LANE_Y + ((unit.id % 3) - 1) * 17;
    const radius = definition.heavy ? 22 : (definition.role === "远程" ? 15 : 18);
    const mainColor = unit.side === 0 ? definition.color : tintTowardRed(definition.color);
    const edgeColor = unit.side === 0 ? 0x18221f : 0x371f1d;

    if (unit.flashUntil > state.elapsed) {
      const target = unit.targetId === null ? null : state.units.find((candidate) => candidate.id === unit.targetId);
      const targetX = target ? target.x / WORLD_WIDTH * WIDTH : (unit.side === 0 ? WIDTH - 64 : 64);
      graphics.lineStyle(3, unit.side === 0 ? 0xf5dca5 : 0xffa08b, 0.9).lineBetween(x, y - 5, targetX, LANE_Y - 4);
    }

    graphics.fillStyle(edgeColor).fillCircle(x, y, radius + 3);
    graphics.fillStyle(mainColor).fillCircle(x, y, radius);
    graphics.fillStyle(0xe5d1a6).fillCircle(x, y - radius * 0.58, radius * 0.43);
    graphics.fillStyle(edgeColor).fillRect(x - radius * 0.65, y + radius * 0.22, radius * 1.3, radius * 0.24);

    if (definition.role === "破甲") {
      graphics.lineStyle(3, 0xe7e0c7).lineBetween(x, y - 3, x + (unit.side === 0 ? 27 : -27), y - 10);
    } else if (definition.role === "远程") {
      graphics.fillStyle(0x463b2c).fillCircle(x + (unit.side === 0 ? 11 : -11), y + 3, 4);
    } else {
      graphics.fillStyle(0x66513a).fillRect(x + (unit.side === 0 ? 10 : -15), y - 5, 5, 24);
    }

    const healthRatio = Phaser.Math.Clamp(unit.hp / unit.maxHp, 0, 1);
    graphics.fillStyle(0x202421, 0.95).fillRect(x - 19, y - radius - 11, 38, 5);
    graphics.fillStyle(unit.side === 0 ? 0x9bc879 : 0xe27c69).fillRect(x - 18, y - radius - 10, 36 * healthRatio, 3);
  }
}

function tintTowardRed(color: number): number {
  const red = color >> 16 & 0xff;
  const green = color >> 8 & 0xff;
  const blue = color & 0xff;
  return (Math.min(255, Math.round(red * 0.8 + 190 * 0.2)) << 16)
    | (Math.round(green * 0.55) << 8)
    | Math.round(blue * 0.55);
}
