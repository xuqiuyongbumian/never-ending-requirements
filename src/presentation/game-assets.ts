import type { EngineerId, Requirement } from "../core/game";

const asset = (path: string) => `${import.meta.env?.BASE_URL ?? "/"}${path}`;
const engineerFrame = { frameWidth: 256, frameHeight: 256, margin: 2, spacing: 2 };

export const GAME_ASSETS = {
  characters: {
    intern: {
      key: "engineer-intern",
      src: asset("assets/game/characters/intern.webp"),
    },
    frontend: {
      key: "engineer-frontend",
      src: asset("assets/game/characters/frontend.webp"),
    },
    backend: {
      key: "engineer-backend",
      src: asset("assets/game/characters/backend.webp"),
    },
    qa: {
      key: "engineer-tester",
      src: asset("assets/game/characters/tester.webp"),
    },
    agent: {
      key: "engineer-agent",
      src: asset("assets/game/characters/ai-agent.webp"),
    },
  },
  tasks: {
    ui: { key: "task-ui", src: asset("assets/game/tasks/ui-task.webp") },
    api: { key: "task-api", src: asset("assets/game/tasks/api-task.webp") },
    bug: { key: "task-bug", src: asset("assets/game/tasks/bug-task.webp") },
    feature: {
      key: "task-feature",
      src: asset("assets/game/tasks/feature-task.webp"),
    },
  },
  backgrounds: [
    {
      key: "era-handcrafted",
      src: asset("assets/game/backgrounds/handcrafted-era.webp"),
    },
    {
      key: "era-engineering",
      src: asset("assets/game/backgrounds/engineering-era.webp"),
    },
    { key: "era-agent", src: asset("assets/game/backgrounds/agent-era.webp") },
  ],
  icons: {
    budget: { src: asset("assets/game/icons/budget.webp") },
    experience: { src: asset("assets/game/icons/experience.webp") },
    techDebt: { src: asset("assets/game/icons/tech-debt.webp") },
    stability: { src: asset("assets/game/icons/stability.webp") },
    event: { src: asset("assets/game/icons/event.webp") },
  },
  structures: {
    base: { key: "structure-base", src: asset("assets/game/structures/rd-base.png") },
    inbox: { key: "structure-inbox", src: asset("assets/game/structures/inbox-gate.png") },
  },
} as const;

export type EngineerAction = "idle" | "moving" | "working";

export interface EngineerAnimationDefinition {
  start: number;
  frameCount: number;
  frameRate: number;
}

export function animationFrameOffset(definition: EngineerAnimationDefinition, textureFrameIndex: number): number {
  const offset = textureFrameIndex - definition.start;
  return ((offset % definition.frameCount) + definition.frameCount) % definition.frameCount;
}

export function runAnimationFrameOffset(
  definition: EngineerAnimationDefinition,
  distance: number,
  moveSpeed: number,
  phase = 0
): number {
  return animationFrameOffset(definition, definition.start + Math.floor(distance / (moveSpeed / definition.frameRate) + phase));
}

export function runContactFrameIndex(definition: EngineerAnimationDefinition, frameIndex: number): number {
  const offset = animationFrameOffset(definition, frameIndex);
  const oppositeContact = Math.floor(definition.frameCount / 2);
  const distanceToFirst = Math.min(offset, definition.frameCount - offset);
  const distanceToOpposite = Math.abs(offset - oppositeContact);
  return definition.start + (distanceToFirst <= distanceToOpposite ? 0 : oppositeContact);
}

export const ENGINEER_ANIMATION_SHEETS = {
  intern: {
    key: "engineer-anim-intern",
    cdnSrc: "https://ali.static.yximgs.com/kos/nlav10567/omxuz1fw1792723334930.png",
    src: asset("assets/game/animations/intern.png"),
    ...engineerFrame,
    displayHeight: 126,
  },
  frontend: {
    key: "engineer-anim-frontend",
    cdnSrc: "https://ali.static.yximgs.com/kos/nlav10567/zydys75z1792723341495.png",
    src: asset("assets/game/animations/frontend.png"),
    ...engineerFrame,
    displayHeight: 126,
  },
  backend: {
    key: "engineer-anim-backend",
    cdnSrc: "https://ali.static.yximgs.com/kos/nlav10567/mu1tllzn1792723343032.png",
    src: asset("assets/game/animations/backend.png"),
    ...engineerFrame,
    displayHeight: 126,
  },
  qa: {
    key: "engineer-anim-tester",
    cdnSrc: "https://ali.static.yximgs.com/kos/nlav10567/0h10ulu61792723343998.png",
    src: asset("assets/game/animations/tester.png"),
    ...engineerFrame,
    displayHeight: 126,
  },
  agent: {
    key: "engineer-anim-agent",
    cdnSrc: "https://ali.static.yximgs.com/kos/nlav10567/vrd361v71792723345265.png",
    src: asset("assets/game/animations/agent.png"),
    ...engineerFrame,
    displayHeight: 136,
  },
} as const;

// A full run cycle covers 64 world units; the previous four-unit stride made feet cycle too fast.
const RUN_CYCLE_DISTANCE = 64;
const ENGINEER_MOVE_SPEEDS: Record<EngineerId, number> = {
  intern: 58,
  frontend: 62,
  backend: 54,
  qa: 57,
  agent: 70
};
const runFrameRate = (role: EngineerId, frameCount = 8): number =>
  ENGINEER_MOVE_SPEEDS[role] * frameCount / RUN_CYCLE_DISTANCE;

export const ENGINEER_ANIMATIONS: Record<EngineerId, Record<EngineerAction, EngineerAnimationDefinition>> = {
  intern: {
    idle: { start: 0, frameCount: 6, frameRate: 6 },
    moving: { start: 8, frameCount: 8, frameRate: runFrameRate("intern") },
    working: { start: 16, frameCount: 6, frameRate: 8 }
  },
  frontend: {
    idle: { start: 0, frameCount: 4, frameRate: 6 },
    // The final source cell is a standing pose, so it is intentionally not part of the run loop.
    moving: { start: 8, frameCount: 7, frameRate: runFrameRate("frontend", 7) },
    working: { start: 16, frameCount: 8, frameRate: 8 }
  },
  backend: {
    idle: { start: 0, frameCount: 6, frameRate: 6 },
    moving: { start: 8, frameCount: 8, frameRate: runFrameRate("backend") },
    working: { start: 16, frameCount: 6, frameRate: 8 }
  },
  qa: {
    idle: { start: 0, frameCount: 4, frameRate: 6 },
    moving: { start: 8, frameCount: 8, frameRate: runFrameRate("qa") },
    working: { start: 16, frameCount: 8, frameRate: 8 }
  },
  agent: {
    idle: { start: 0, frameCount: 6, frameRate: 7 },
    moving: { start: 8, frameCount: 8, frameRate: runFrameRate("agent") },
    working: { start: 16, frameCount: 6, frameRate: 10 }
  }
};

export const ENGINEER_SPRITE_SHEETS = Object.values(ENGINEER_ANIMATION_SHEETS);

export const GAME_TEXTURES = [
  ...Object.values(GAME_ASSETS.characters),
  ...Object.values(GAME_ASSETS.tasks),
  ...Object.values(GAME_ASSETS.structures),
  ...GAME_ASSETS.backgrounds,
] as const;

export function engineerAnimationKey(
  role: EngineerId,
  action: EngineerAction,
): string {
  const actionName =
    action === "moving" ? "run" : action === "working" ? "work" : "idle";
  return `${ENGINEER_ANIMATION_SHEETS[role].key}-${actionName}`;
}

export function engineerTexture(role: EngineerId): string {
  return GAME_ASSETS.characters[role].key;
}

export function requestTexture(
  request: Pick<Requirement, "kind" | "isFinal" | "totalWork">,
): string {
  if (request.isFinal || request.kind === "launch")
    return GAME_ASSETS.tasks.feature.key;
  if (request.kind === "bug") return GAME_ASSETS.tasks.bug.key;
  if (request.kind === "infra") return GAME_ASSETS.tasks.api.key;
  return request.totalWork >= 220
    ? GAME_ASSETS.tasks.feature.key
    : GAME_ASSETS.tasks.ui.key;
}
