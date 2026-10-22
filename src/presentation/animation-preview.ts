import Phaser from "phaser";
import {
  ENGINEER_ANIMATIONS,
  ENGINEER_ANIMATION_SHEETS,
  ENGINEER_SPRITE_SHEETS,
  engineerAnimationKey,
  type EngineerAction
} from "./game-assets";
import type { EngineerId } from "../core/game";
import "./animation-preview.css";

const PREVIEW_WIDTH = 1280;
const PREVIEW_HEIGHT = 390;
const FLOOR_Y = 310;
const ENGINEER_NAMES: Record<EngineerId, string> = {
  intern: "实习生",
  frontend: "前端工程师",
  backend: "后端工程师",
  qa: "测试工程师",
  agent: "AI Agent"
};
const ENGINEER_ROLES = Object.keys(ENGINEER_NAMES) as EngineerId[];

interface PreviewActor {
  sprite: Phaser.GameObjects.Sprite;
  action: EngineerAction;
  paused: boolean;
  rate: number;
  frameIndex: number;
}

class AnimationPreviewScene extends Phaser.Scene {
  private actors = new Map<EngineerId, PreviewActor>();

  constructor() {
    super({ key: "animation-preview", active: true });
  }

  preload(): void {
    for (const sheet of ENGINEER_SPRITE_SHEETS) {
      if (!this.textures.exists(sheet.key)) {
        this.load.spritesheet(sheet.key, sheet.src, { frameWidth: sheet.frameWidth, frameHeight: sheet.frameHeight });
      }
    }
  }

  private registerAnimations(): void {
    for (const role of ENGINEER_ROLES) {
      const sheet = ENGINEER_ANIMATION_SHEETS[role];
      for (const action of ["idle", "moving", "working"] as const) {
        const definition = ENGINEER_ANIMATIONS[role][action];
        const key = engineerAnimationKey(role, action);
        if (!this.anims.exists(key)) {
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
  }

  create(): void {
    this.registerAnimations();
    this.cameras.main.setBackgroundColor("#1d2038");
    const grid = this.add.graphics().setDepth(0);
    const cardWidth = 224;
    const gap = 20;
    const firstX = (PREVIEW_WIDTH - ENGINEER_ROLES.length * cardWidth - (ENGINEER_ROLES.length - 1) * gap) / 2;

    ENGINEER_ROLES.forEach((role, index) => {
      const x = firstX + index * (cardWidth + gap) + cardWidth / 2;
      this.add.rectangle(x, 190, cardWidth, 250, 0x282b43, 0.72).setStrokeStyle(1, 0x606580, 0.55).setDepth(0);
      for (let y = 82; y < FLOOR_Y; y += 16) {
        for (let tileX = x - 94; tileX < x + 94; tileX += 16) {
          if (((Math.floor((tileX - (x - 94)) / 16) + Math.floor((y - 82) / 16)) & 1) === 0) {
            grid.fillStyle(0x40445d, 0.22).fillRect(tileX, y, 16, 16);
          }
        }
      }
      this.add.text(x, 72, ENGINEER_NAMES[role], {
        fontFamily: "sans-serif", fontSize: "15px", fontStyle: "bold", color: "#f7edd9"
      }).setOrigin(0.5).setDepth(2);
      this.add.line(x, FLOOR_Y, 0, 0, 0, 18, 0x64dccf, 0.65).setOrigin(0.5, 0).setDepth(2);
      this.add.circle(x, FLOOR_Y, 4, 0xffbd73, 0.9).setDepth(3);

      const sheet = ENGINEER_ANIMATION_SHEETS[role];
      const sprite = this.add.sprite(x, FLOOR_Y, sheet.key, 0).setOrigin(0.5, 1).setDepth(1);
      sprite.setScale(Math.min(158 / sheet.frameHeight, 164 / sheet.frameWidth));
      this.actors.set(role, { sprite, action: "idle", paused: false, rate: 1, frameIndex: 0 });
      this.play(role, "idle");
    });
  }

  setAction(role: EngineerId, action: EngineerAction): void {
    this.play(role, action);
  }

  setRate(role: EngineerId, rate: number): void {
    const actor = this.actors.get(role);
    if (!actor) return;
    actor.rate = rate;
    actor.sprite.anims.timeScale = rate;
  }

  togglePaused(role: EngineerId): boolean {
    const actor = this.actors.get(role);
    if (!actor) return false;
    actor.paused = !actor.paused;
    if (actor.paused) {
      actor.frameIndex = this.currentFrameIndex(role, actor);
      actor.sprite.anims.pause();
    } else {
      const definition = ENGINEER_ANIMATIONS[role][actor.action];
      actor.sprite.play(engineerAnimationKey(role, actor.action), true);
      actor.sprite.anims.setProgress(actor.frameIndex / definition.frameCount);
      actor.sprite.anims.timeScale = actor.rate;
    }
    return actor.paused;
  }

  stepFrame(role: EngineerId, delta: -1 | 1): number | null {
    const actor = this.actors.get(role);
    if (!actor) return null;
    if (!actor.paused) {
      actor.paused = true;
      actor.frameIndex = this.currentFrameIndex(role, actor);
      actor.sprite.anims.pause();
    }
    const definition = ENGINEER_ANIMATIONS[role][actor.action];
    actor.frameIndex = (actor.frameIndex + delta + definition.frameCount) % definition.frameCount;
    actor.sprite.setFrame(definition.start + actor.frameIndex);
    return actor.frameIndex;
  }

  private play(role: EngineerId, action: EngineerAction): void {
    const actor = this.actors.get(role);
    if (!actor) return;
    actor.action = action;
    actor.frameIndex = 0;
    actor.sprite.play(engineerAnimationKey(role, action), true);
    actor.sprite.anims.timeScale = actor.rate;
    if (actor.paused) actor.sprite.anims.pause();
  }

  private currentFrameIndex(role: EngineerId, actor: PreviewActor): number {
    const definition = ENGINEER_ANIMATIONS[role][actor.action];
    const index = actor.sprite.anims.currentFrame?.index;
    return typeof index === "number" ? index % definition.frameCount : actor.frameIndex;
  }
}

export function mountAnimationPreview(root: HTMLElement): void {
  root.className = "animation-preview-page";
  root.innerHTML = `
    <main class="animation-preview-shell">
      <header class="animation-preview-header">
        <div><span class="animation-preview-kicker">DEV TOOL · PHASER 4.2.1</span><h1>角色逐帧动画检视器</h1><p>切换 Idle / Run / Work，检查动作边界、帧数、透明通道与脚底锚点。</p></div>
        <a class="animation-preview-back" href="/">返回游戏</a>
      </header>
      <section class="animation-preview-stage" aria-label="五个工程师动画预览"><div id="animation-preview-canvas"></div></section>
      <section class="animation-preview-controls" aria-label="动画控制">
        ${ENGINEER_ROLES.map((role, index) => `
          <article class="animation-preview-card" data-preview-role="${role}">
            <div class="animation-preview-card-heading"><strong>${ENGINEER_NAMES[role]}</strong><kbd>${index + 1}</kbd></div>
            <div class="animation-preview-actions" role="group" aria-label="${ENGINEER_NAMES[role]}动作">
              <button type="button" data-action="idle">待机</button>
              <button type="button" data-action="moving">移动</button>
              <button type="button" data-action="working">工作</button>
            </div>
            <div class="animation-preview-info" data-preview-info>载入动画元数据…</div>
            <label class="animation-preview-speed">播放速度 <output data-rate-label>1.0×</output>
              <input data-preview-rate type="range" min="0.5" max="2" step="0.1" value="1" aria-label="${ENGINEER_NAMES[role]}动画速度">
            </label>
            <div class="animation-preview-frame-controls">
              <button type="button" data-step="-1" aria-label="${ENGINEER_NAMES[role]}上一帧">◀ 帧</button>
              <button type="button" data-toggle aria-pressed="false">暂停</button>
              <button type="button" data-step="1" aria-label="${ENGINEER_NAMES[role]}下一帧">帧 ▶</button>
            </div>
            <div class="animation-preview-frame-index" data-frame-index>当前帧 —</div>
          </article>`).join("")}
      </section>
      <p class="animation-preview-note">灰色棋盘表示透明区域；金色圆点表示 origin=(0.5, 1) 的脚底锚点。此检视器仅在 Vite 开发模式启用。</p>
    </main>`;

  const scene = new AnimationPreviewScene();
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: "animation-preview-canvas",
    width: PREVIEW_WIDTH,
    height: PREVIEW_HEIGHT,
    backgroundColor: "#1d2038",
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene: [scene]
  });

  for (const card of root.querySelectorAll<HTMLElement>("[data-preview-role]")) {
    const role = card.dataset.previewRole as EngineerId;
    const info = card.querySelector<HTMLElement>("[data-preview-info]");
    const frameIndex = card.querySelector<HTMLElement>("[data-frame-index]");
    const toggle = card.querySelector<HTMLButtonElement>("[data-toggle]");
    let currentAction: EngineerAction = "idle";
    const reportAction = (action: EngineerAction): void => {
      currentAction = action;
      const definition = ENGINEER_ANIMATIONS[role][action];
      info!.textContent = `${engineerAnimationKey(role, action)} · ${definition.frameCount} 帧 · RGBA alpha · anchor (0.5, 1)`;
      if (frameIndex) frameIndex.textContent = `当前帧 1 / ${definition.frameCount}`;
      card.querySelectorAll<HTMLButtonElement>("[data-action]").forEach((button) => {
        button.setAttribute("aria-pressed", String(button.dataset.action === action));
      });
      scene.setAction(role, action);
    };

    card.querySelectorAll<HTMLButtonElement>("[data-action]").forEach((button) => {
      button.addEventListener("click", () => reportAction(button.dataset.action as EngineerAction));
    });
    const rate = card.querySelector<HTMLInputElement>("[data-preview-rate]");
    const rateLabel = card.querySelector<HTMLOutputElement>("[data-rate-label]");
    rate?.addEventListener("input", () => {
      const value = Number(rate.value);
      scene.setRate(role, value);
      if (rateLabel) rateLabel.value = `${value.toFixed(1)}×`;
    });
    toggle?.addEventListener("click", () => {
      const paused = scene.togglePaused(role);
      toggle.textContent = paused ? "继续" : "暂停";
      toggle.setAttribute("aria-pressed", String(paused));
    });
    card.querySelectorAll<HTMLButtonElement>("[data-step]").forEach((button) => {
      button.addEventListener("click", () => {
        const definition = ENGINEER_ANIMATIONS[role][currentAction];
        const index = scene.stepFrame(role, button.dataset.step === "-1" ? -1 : 1);
        if (index !== null && frameIndex) frameIndex.textContent = `当前帧 ${index + 1} / ${definition.frameCount} · 已暂停`;
        if (toggle) {
          toggle.textContent = "继续";
          toggle.setAttribute("aria-pressed", "true");
        }
      });
    });
    reportAction("idle");
  }

  window.addEventListener("pagehide", () => game.destroy(true), { once: true });
}
