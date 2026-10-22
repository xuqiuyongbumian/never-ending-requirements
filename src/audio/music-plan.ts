/**
 * Pure audio planning helpers.
 *
 * This module deliberately avoids any Web Audio reference so it can be unit
 * tested with plain Node. The runtime wrappers live in `music.ts`, `sfx.ts`
 * and `audio-engine.ts`.
 */

export type SfxCue =
  | "hire"
  | "denied"
  | "request_in"
  | "priority"
  | "clear"
  | "miss"
  | "alert"
  | "choice"
  | "era_up"
  | "rush"
  | "rush_end"
  | "incident"
  | "win"
  | "lose"
  | "ui_tick";

export interface CueRequest {
  cue: SfxCue;
  pan: number;
}

export type AudioChannelName = "master" | "music" | "sfx" | "ui";

/** Seconds the era re-orchestration takes to cross over. */
export const CROSSFADE_SECONDS = 1.2;

/** Music level while a modal / result panel owns the screen. */
export const DUCK_LEVEL = 0.45;

/** Reference project used 18/s attack and 4/s release for its ducking gain. */
export const DUCK_ATTACK_RATE = 18;
export const DUCK_RELEASE_RATE = 4;

const TELEMETRY_CUES: Record<string, SfxCue> = {
  recruit: "hire",
  requirement_prioritized: "priority",
  request_complete: "clear",
  request_missed: "miss",
  change_event: "alert",
  event_choice: "choice",
  era_upgrade: "era_up",
  rush_activated: "rush",
  rush_completed: "rush_end",
  online_incident: "incident"
};

/**
 * Map a telemetry event onto a cue. Unknown events stay silent so new
 * instrumentation never produces surprise noises.
 */
export function cueForEvent(
  type: string,
  detail: Record<string, string | number | boolean> = {}
): CueRequest | null {
  if (type === "result") {
    return { cue: detail.result === "victory" ? "win" : "lose", pan: 0 };
  }
  const cue = TELEMETRY_CUES[type];
  return cue ? { cue, pan: 0 } : null;
}

/**
 * Equal-power crossfade. Returns [outgoing, incoming]; both gains squared sum
 * to 1 at every point, which keeps perceived loudness flat while fading.
 */
export function equalPowerGains(t: number): readonly [number, number] {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0));
  const angle = (clamped * Math.PI) / 2;
  return [Math.cos(angle), Math.sin(angle)];
}

/**
 * Pick the next variation from a shuffled bag, never repeating the previous
 * pick when more than one candidate exists. Mirrors the reference playlist
 * guard (`playlist_queue[0] == last_bgm` triggers a re-draw).
 */
export function pickNextVariant(
  bag: readonly string[],
  last: string | null,
  random: () => number = Math.random
): string {
  if (bag.length === 0) throw new Error("pickNextVariant needs at least one candidate");
  const candidates = bag.length > 1 ? bag.filter((candidate) => candidate !== last) : [...bag];
  const roll = Math.max(0, Math.min(0.999999, random()));
  return candidates[Math.floor(roll * candidates.length)];
}

/**
 * Asymmetric one-pole smoothing: ducking drops fast and recovers slowly, the
 * same shape as the reference `duck_gain` lerp.
 */
export function approachGain(current: number, target: number, deltaSeconds: number): number {
  const rate = target < current ? DUCK_ATTACK_RATE : DUCK_RELEASE_RATE;
  const alpha = 1 - Math.exp(-Math.max(0, deltaSeconds) * rate);
  const next = current + (target - current) * alpha;
  return Math.max(0, Math.min(1, next));
}

/** Perceptual curve for a 0..1 slider: linear faders feel dead near zero. */
export function settingToGain(value: number): number {
  const clamped = clampUnit(value, 1);
  return clamped * clamped;
}

export function clampUnit(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(1, value));
}

/** Map a world coordinate to a stereo pan position. */
export function panFromX(x: number, min: number, max: number, spread = 0.7): number {
  if (!Number.isFinite(x) || max <= min) return 0;
  const ratio = Math.max(0, Math.min(1, (x - min) / (max - min)));
  return (ratio * 2 - 1) * spread;
}
