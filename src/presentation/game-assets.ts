import type { EngineerId, Requirement } from "../core/game";

const asset = (path: string) => `${import.meta.env?.BASE_URL ?? "/"}${path}`;

export const GAME_ASSETS = {
  characters: {
    intern: { key: "engineer-intern", src: asset("assets/game/characters/intern.webp") },
    frontend: { key: "engineer-frontend", src: asset("assets/game/characters/frontend.webp") },
    backend: { key: "engineer-backend", src: asset("assets/game/characters/backend.webp") },
    qa: { key: "engineer-tester", src: asset("assets/game/characters/tester.webp") },
    agent: { key: "engineer-agent", src: asset("assets/game/characters/ai-agent.webp") }
  },
  tasks: {
    ui: { key: "task-ui", src: asset("assets/game/tasks/ui-task.webp") },
    api: { key: "task-api", src: asset("assets/game/tasks/api-task.webp") },
    bug: { key: "task-bug", src: asset("assets/game/tasks/bug-task.webp") },
    feature: { key: "task-feature", src: asset("assets/game/tasks/feature-task.webp") }
  },
  backgrounds: [
    { key: "era-handcrafted", src: asset("assets/game/backgrounds/handcrafted-era.webp") },
    { key: "era-engineering", src: asset("assets/game/backgrounds/engineering-era.webp") },
    { key: "era-agent", src: asset("assets/game/backgrounds/agent-era.webp") }
  ],
  icons: {
    budget: { src: asset("assets/game/icons/budget.webp") },
    experience: { src: asset("assets/game/icons/experience.webp") },
    techDebt: { src: asset("assets/game/icons/tech-debt.webp") },
    stability: { src: asset("assets/game/icons/stability.webp") },
    event: { src: asset("assets/game/icons/event.webp") }
  }
} as const;

export const GAME_SPRITESHEETS = {
  intern: { key: "engineer-sheet-intern", src: asset("assets/game/animations/intern.webp") },
  frontend: { key: "engineer-sheet-frontend", src: asset("assets/game/animations/frontend.webp") },
  backend: { key: "engineer-sheet-backend", src: asset("assets/game/animations/backend.webp") },
  qa: { key: "engineer-sheet-qa", src: asset("assets/game/animations/qa.webp") },
  agent: { key: "engineer-sheet-agent", src: asset("assets/game/animations/agent.webp") }
} as const;

export const ENGINEER_SPRITE_FRAME_SIZE = 256;
export const ENGINEER_ANIMATION_FRAMES = {
  idle: { start: 0, end: 5, frameRate: 6 },
  run: { start: 8, end: 15, frameRate: 12 },
  work: { start: 16, end: 21, frameRate: 8 }
} as const;

export const GAME_TEXTURES = [
  ...Object.values(GAME_ASSETS.tasks),
  ...GAME_ASSETS.backgrounds
] as const;

export function engineerSpriteSheet(role: EngineerId): string {
  return GAME_SPRITESHEETS[role].key;
}

export function engineerAnimationKey(role: EngineerId, action: keyof typeof ENGINEER_ANIMATION_FRAMES): string {
  return `${role}-${action}`;
}

export function requestTexture(request: Pick<Requirement, "kind" | "isFinal" | "totalWork">): string {
  if (request.isFinal || request.kind === "launch") return GAME_ASSETS.tasks.feature.key;
  if (request.kind === "bug") return GAME_ASSETS.tasks.bug.key;
  if (request.kind === "infra") return GAME_ASSETS.tasks.api.key;
  return request.totalWork >= 220 ? GAME_ASSETS.tasks.feature.key : GAME_ASSETS.tasks.ui.key;
}
