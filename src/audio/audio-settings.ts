import { clampUnit, type AudioChannelName } from "./music-plan.ts";

export interface AudioSettings {
  master: number;
  music: number;
  sfx: number;
  ui: number;
  muted: boolean;
}

export const AUDIO_STORAGE_KEY = "ner.audio.v1";

export const DEFAULT_AUDIO_SETTINGS: AudioSettings = {
  master: 0.8,
  music: 0.7,
  sfx: 0.8,
  ui: 0.6,
  muted: false
};

export const AUDIO_SLIDERS: ReadonlyArray<{ channel: AudioChannelName; label: string; hint: string }> = [
  { channel: "master", label: "总音量", hint: "所有声音" },
  { channel: "music", label: "配乐", hint: "背景音乐" },
  { channel: "sfx", label: "音效", hint: "交付与事件" },
  { channel: "ui", label: "界面", hint: "按钮反馈" }
];

function readStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Never trust persisted values: clamp, default and drop unknown shapes. */
export function normalizeAudioSettings(raw: unknown): AudioSettings {
  const source = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<keyof AudioSettings, unknown>>;
  return {
    master: clampUnit(source.master, DEFAULT_AUDIO_SETTINGS.master),
    music: clampUnit(source.music, DEFAULT_AUDIO_SETTINGS.music),
    sfx: clampUnit(source.sfx, DEFAULT_AUDIO_SETTINGS.sfx),
    ui: clampUnit(source.ui, DEFAULT_AUDIO_SETTINGS.ui),
    muted: typeof source.muted === "boolean" ? source.muted : DEFAULT_AUDIO_SETTINGS.muted
  };
}

export function loadAudioSettings(storage: Storage | null = readStorage()): AudioSettings {
  if (!storage) return { ...DEFAULT_AUDIO_SETTINGS };
  try {
    const raw = storage.getItem(AUDIO_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_AUDIO_SETTINGS };
    return normalizeAudioSettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_AUDIO_SETTINGS };
  }
}

export function saveAudioSettings(settings: AudioSettings, storage: Storage | null = readStorage()): void {
  if (!storage) return;
  try {
    storage.setItem(AUDIO_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Private mode or a full quota should never break the game.
  }
}

export function withAudioPatch(settings: AudioSettings, patch: Partial<AudioSettings>): AudioSettings {
  return normalizeAudioSettings({ ...settings, ...patch });
}

export function isMuted(settings: AudioSettings): boolean {
  return settings.muted || settings.master <= 0;
}
