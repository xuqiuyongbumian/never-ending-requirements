import Phaser from "phaser";
import {
  advanceBattle,
  BASE_MAX_HP,
  getUnitDefinition,
  UNIT_DEFS,
  WORLD_WIDTH,
  type BattleState,
  type BattleUnit,
  type Side,
  type UnitId
} from "../core/game";

const WIDTH = 1280;
const HEIGHT = 720;
const LANE_Y = 518;
const BASE_Y = 568;
const UNIT_FRAME_SIZE: Record<UnitId, number> = { U11: 128, U12: 128, U13: 128, U14: 160 };
const CLIPS = {
  idle: { frames: [0, 1, 2, 3, 4, 5], frameRate: 6, repeat: -1 },
  walk: { frames: [6, 7, 8, 9, 10, 11], frameRate: 10, repeat: -1 },
  attack: { frames: [12, 13, 14, 15, 16, 17], frameRate: 12, repeat: 0 },
  hurt: { frames: [18, 19, 20, 21, 22, 23], frameRate: 12, repeat: 0 },
  death: { frames: [24, 25, 26, 27, 28, 29], frameRate: 9, repeat: 0 }
} as const;
type ClipName = keyof typeof CLIPS;
type BaseCondition = "intact" | "worn" | "critical" | "ruin";

interface ActorVisual {
  sprite: Phaser.GameObjects.Sprite;
  unitId: UnitId;
  side: Side;
  lastX: number;
  lastHp: number;
  lastFlashUntil: number;
  actionUntil: number;
  action: ClipName;
  deadAt: number | null;
}

export class BattleScene extends Phaser.Scene {
  private state: BattleState | null = null;
  private lastHudUpdate = 0;
  private actors = new Map<number, ActorVisual>();
  private bases!: [Phaser.GameObjects.Image, Phaser.GameObjects.Image];
  private baseTextureKeys: [string, string] = ["", ""];
  private shadows!: Phaser.GameObjects.Graphics;
  private overlays!: Phaser.GameObjects.Graphics;

  constructor() {
    super({ key: "battle", active: false });
  }

  preload(): void {
    this.load.image("battle-background", "/assets/environment/backgrounds/A1-battle.webp");
    this.load.image("base-friendly-intact", "/assets/environment/bases/A1.png");
    this.load.image("base-enemy-intact", "/assets/environment/bases/A1-enemy.png");
    this.load.image("base-friendly-worn", "/assets/base/A1-worn.png");
    this.load.image("base-enemy-worn", "/assets/base/A1-worn-enemy.png");
    this.load.image("base-friendly-critical", "/assets/base/A1-critical.png");
    this.load.image("base-enemy-critical", "/assets/base/A1-critical-enemy.png");
    this.load.image("base-friendly-ruin", "/assets/base/A1-ruin.png");
    this.load.image("base-enemy-ruin", "/assets/base/A1-ruin-enemy.png");
    this.load.image("fx-dust", "/assets/fx/dust.png");
    this.load.image("fx-stone-impact", "/assets/fx/stone_impact.png");

    for (const unit of UNIT_DEFS) {
      for (const side of [0, 1] as const) {
        const texture = actorTexture(unit.id, side);
        const palette = side === 0 ? "" : "-enemy";
        this.load.spritesheet(texture, `/assets/characters/animations/${unit.id}${palette}.png`, {
          frameWidth: UNIT_FRAME_SIZE[unit.id],
          frameHeight: UNIT_FRAME_SIZE[unit.id]
        });
      }
    }
  }

  create(data: { state?: BattleState } = {}): void {
    this.state = data.state ?? this.game.registry.get("battleState") ?? null;
    this.actors.clear();
    this.createAnimations();
    this.drawLandscape();
    this.drawBases();
    this.shadows = this.add.graphics().setDepth(3);
    this.overlays = this.add.graphics().setDepth(6);
    this.lastHudUpdate = 0;
  }

  update(_time: number, deltaMs: number): void {
    if (!this.state) return;

    advanceBattle(this.state, deltaMs / 1000);
    this.syncActors(this.state);
    this.updateBases(this.state);
    this.drawActorOverlays(this.state);

    if (this.time.now - this.lastHudUpdate >= 100) {
      this.lastHudUpdate = this.time.now;
      const updateHud = this.game.registry.get("updateHud") as ((state: BattleState) => void) | undefined;
      updateHud?.(this.state);
    }
  }

  private createAnimations(): void {
    for (const unit of UNIT_DEFS) {
      for (const side of [0, 1] as const) {
        const texture = actorTexture(unit.id, side);
        for (const [name, clip] of Object.entries(CLIPS) as [ClipName, typeof CLIPS[ClipName]][]) {
          const key = animationKey(unit.id, side, name);
          if (this.anims.exists(key)) continue;
          this.anims.create({
            key,
            frames: this.anims.generateFrameNumbers(texture, { frames: [...clip.frames] }),
            frameRate: clip.frameRate,
            repeat: clip.repeat
          });
        }
      }
    }
  }

  private drawLandscape(): void {
    const background = this.add.image(WIDTH / 2, HEIGHT / 2, "battle-background").setDepth(0);
    background.setScale(Math.max(WIDTH / background.width, HEIGHT / background.height));
    this.add.rectangle(WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT, 0x141b20, 0.08).setDepth(1);
    this.add.rectangle(WIDTH / 2, LANE_Y + 42, WIDTH, 1, 0xf4d39a, 0.2).setDepth(2);
  }

  private drawBases(): void {
    this.bases = [
      this.add.image(150, BASE_Y, "base-friendly-intact"),
      this.add.image(WIDTH - 150, BASE_Y, "base-enemy-intact")
    ];
    for (const base of this.bases) {
      base.setOrigin(0.5, 1).setDisplaySize(290, 290).setDepth(2);
    }
  }

  private syncActors(state: BattleState): void {
    const present = new Set<number>();
    this.shadows.clear();

    for (const unit of state.units) {
      present.add(unit.id);
      const x = unit.x / WORLD_WIDTH * WIDTH;
      const y = LANE_Y + ((unit.id % 3) - 1) * 17;
      let actor = this.actors.get(unit.id);

      if (!actor) {
        const sprite = this.add.sprite(x, y, actorTexture(unit.unitId, unit.side))
          .setOrigin(0.5, 0.9)
          .setScale(unit.unitId === "U14" ? 0.78 : 0.88)
          .setFlipX(unit.side === 1)
          .setDepth(4);
        actor = {
          sprite,
          unitId: unit.unitId,
          side: unit.side,
          lastX: x,
          lastHp: unit.hp,
          lastFlashUntil: unit.flashUntil,
          actionUntil: state.elapsed,
          action: "idle",
          deadAt: null
        };
        this.actors.set(unit.id, actor);
        this.playAction(actor, "idle");
        this.spawnDust(x, y + 7);
      }

      const moving = Math.abs(x - actor.lastX) > 0.05;
      const damaged = unit.hp < actor.lastHp;
      const attacked = unit.flashUntil > actor.lastFlashUntil && unit.flashUntil > state.elapsed;
      actor.sprite.setPosition(x, y);

      if (attacked) {
        this.playAction(actor, "attack", state.elapsed + 0.55);
        this.spawnAttackEffect(unit, state);
      } else if (damaged) {
        this.playAction(actor, "hurt", state.elapsed + 0.42);
      } else if (state.elapsed >= actor.actionUntil) {
        this.playAction(actor, moving ? "walk" : "idle");
      }

      actor.lastX = x;
      actor.lastHp = unit.hp;
      actor.lastFlashUntil = unit.flashUntil;
      this.shadows.fillStyle(0x201a14, 0.34).fillEllipse(x, y + 9, 36, 11);
    }

    for (const [id, actor] of this.actors) {
      if (present.has(id)) continue;
      if (actor.deadAt === null) {
        actor.deadAt = this.time.now + 850;
        this.playAction(actor, "death");
        this.tweens.add({ targets: actor.sprite, alpha: 0, delay: 380, duration: 470 });
      } else if (this.time.now >= actor.deadAt) {
        actor.sprite.destroy();
        this.actors.delete(id);
      }
    }
  }

  private playAction(actor: ActorVisual, action: ClipName, until = 0): void {
    actor.action = action;
    actor.actionUntil = until;
    actor.sprite.play(animationKey(actor.unitId, actor.side, action), true);
  }

  private spawnDust(x: number, y: number): void {
    const dust = this.add.image(x, y, "fx-dust").setDisplaySize(82, 62).setDepth(5).setAlpha(0.85);
    this.tweens.add({
      targets: dust,
      y: y - 8,
      alpha: 0,
      scale: 0.7,
      duration: 420,
      onComplete: () => dust.destroy()
    });
  }

  private spawnAttackEffect(source: BattleUnit, state: BattleState): void {
    const target = source.targetId === null ? undefined : state.units.find((unit) => unit.id === source.targetId);
    const x = target ? target.x / WORLD_WIDTH * WIDTH : source.side === 0 ? WIDTH - 150 : 150;
    const y = target ? LANE_Y + ((target.id % 3) - 1) * 17 - 18 : LANE_Y - 12;

    if (source.unitId === "U12") {
      const startX = source.x / WORLD_WIDTH * WIDTH;
      const startY = LANE_Y - 28;
      const stone = this.add.circle(startX, startY, 5, 0xe0bf82).setDepth(5);
      this.tweens.add({
        targets: stone,
        x,
        y,
        duration: 190,
        ease: "Quad.Out",
        onComplete: () => {
          stone.destroy();
          this.spawnImpact(x, y);
        }
      });
    } else {
      this.spawnImpact(x, y);
    }
  }

  private spawnImpact(x: number, y: number): void {
    const impact = this.add.image(x, y, "fx-stone-impact").setDisplaySize(58, 58).setDepth(5).setAlpha(0.9);
    this.tweens.add({
      targets: impact,
      scale: 0.4,
      alpha: 0,
      duration: 240,
      onComplete: () => impact.destroy()
    });
  }

  private updateBases(state: BattleState): void {
    for (const side of [0, 1] as const) {
      const key = baseTextureKey(side, state.baseHp[side]);
      if (key !== this.baseTextureKeys[side]) {
        this.baseTextureKeys[side] = key;
        this.bases[side].setTexture(key);
      }
    }
  }

  private drawActorOverlays(state: BattleState): void {
    this.overlays.clear();
    for (const unit of state.units) {
      const actor = this.actors.get(unit.id);
      if (!actor) continue;
      const { x, y } = actor.sprite;
      const definition = getUnitDefinition(unit.unitId);
      const width = definition.heavy ? 43 : 38;
      const barY = y - (definition.heavy ? 88 : 74);
      const health = Phaser.Math.Clamp(unit.hp / unit.maxHp, 0, 1);
      this.overlays.fillStyle(0x1b211f, 0.8).fillRoundedRect(x - width / 2, barY, width, 5, 2);
      this.overlays.fillStyle(unit.side === 0 ? 0xa9d17e : 0xe38270).fillRoundedRect(x - width / 2, barY + 1, width * health, 3, 1);

      if (unit.flashUntil > state.elapsed) {
        const target = unit.targetId === null ? undefined : state.units.find((candidate) => candidate.id === unit.targetId);
        const targetX = target ? target.x / WORLD_WIDTH * WIDTH : unit.side === 0 ? WIDTH - 150 : 150;
        this.overlays.lineStyle(2, unit.side === 0 ? 0xffe5a4 : 0xffa18d, 0.45).lineBetween(x, y - 25, targetX, LANE_Y - 24);
      }
    }
  }
}

function actorTexture(unitId: UnitId, side: Side): string {
  return `${unitId}-${side === 0 ? "friendly" : "enemy"}`;
}

function animationKey(unitId: UnitId, side: Side, clip: ClipName): string {
  return `${actorTexture(unitId, side)}-${clip}`;
}

function baseTextureKey(side: Side, hp: number): string {
  const condition: BaseCondition = hp <= 0 ? "ruin" : hp / BASE_MAX_HP <= 0.25 ? "critical" : hp / BASE_MAX_HP <= 0.6 ? "worn" : "intact";
  return `base-${side === 0 ? "friendly" : "enemy"}-${condition}`;
}
