import type { EngineerId, Requirement } from "../core/game";

const asset = (path: string) => `${import.meta.env?.BASE_URL ?? "/"}${path}`;

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
    src: asset("assets/game/animations/intern.png"),
    frameWidth: 256,
    frameHeight: 256,
    displayHeight: 126,
  },
  frontend: {
    key: "engineer-anim-frontend",
    src: asset("assets/game/animations/frontend.png"),
    frameWidth: 256,
    frameHeight: 256,
    displayHeight: 126,
  },
  backend: {
    key: "engineer-anim-backend",
    src: asset("assets/game/animations/backend.png"),
    frameWidth: 256,
    frameHeight: 256,
    displayHeight: 126,
  },
  qa: {
    key: "engineer-anim-tester",
    src: asset("assets/game/animations/tester.png"),
    frameWidth: 256,
    frameHeight: 256,
    displayHeight: 126,
  },
  agent: {
    key: "engineer-anim-agent",
    src: asset("assets/game/animations/agent.png"),
    frameWidth: 256,
    frameHeight: 256,
    displayHeight: 136,
  },
} as const;

// One frame per four travelled world units keeps footfalls tied to movement.
const ENGINEER_MOVE_SPEEDS: Record<EngineerId, number> = {
  intern: 58,
  frontend: 62,
  backend: 54,
  qa: 57,
  agent: 70
};
const runFrameRate = (role: EngineerId): number => ENGINEER_MOVE_SPEEDS[role] * 0.25;

export const ENGINEER_ANIMATIONS: Record<EngineerId, Record<EngineerAction, EngineerAnimationDefinition>> = {
  intern: {
    idle: { start: 0, frameCount: 6, frameRate: 6 },
    moving: { start: 8, frameCount: 8, frameRate: runFrameRate("intern") },
    working: { start: 16, frameCount: 6, frameRate: 8 }
  },
  frontend: {
    idle: { start: 0, frameCount: 4, frameRate: 6 },
    moving: { start: 8, frameCount: 8, frameRate: runFrameRate("frontend") },
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
