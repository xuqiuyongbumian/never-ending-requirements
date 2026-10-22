export const NICKNAME_KEY = "1024-ai-game-nickname";
export const NICKNAME_MAX_LENGTH = 24;

/** Placeholder stems keep the auto-generated names close to the game's theme. */
const NICKNAME_STEMS = ["赶工工程师", "上线突击手", "需求清道夫", "夜班组长", "DDL 守门人", "技术债会计"];

export type NicknameStorage = Pick<Storage, "getItem" | "setItem"> | null;

function safeStorage(): NicknameStorage {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    // Private-mode browsers can throw on access; the game must still run.
    return null;
  }
}

function randomSuffix(): string {
  const bytes = new Uint8Array(2);
  const cryptoRef = globalThis.crypto;
  if (cryptoRef?.getRandomValues) cryptoRef.getRandomValues(bytes);
  else {
    bytes[0] = Math.floor(Math.random() * 256);
    bytes[1] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
}

/** e.g. 赶工工程师-3F7A — short, readable, and collisions stay rare. */
export function generateNickname(): string {
  const stem = NICKNAME_STEMS[Math.floor(Math.random() * NICKNAME_STEMS.length)]!;
  return `${stem}-${randomSuffix()}`;
}

export function normalizeNickname(value: string): string {
  return value.trim().replace(/\s+/g, " ").slice(0, NICKNAME_MAX_LENGTH);
}

/**
 * A nickname is mandatory for cloud analytics, so a missing or blank entry is
 * replaced by a generated placeholder that is persisted immediately.
 */
export function readNickname(storage: NicknameStorage = safeStorage()): string {
  try {
    const stored = normalizeNickname(storage?.getItem(NICKNAME_KEY) ?? "");
    if (stored) return stored;
  } catch {
    // Fall through to the generated placeholder.
  }
  const generated = generateNickname();
  try {
    storage?.setItem(NICKNAME_KEY, generated);
  } catch {
    // Storage failures must not block play, the name is still returned.
  }
  return generated;
}

/** Blank input is not allowed: it falls back to a freshly generated placeholder. */
export function saveNickname(value: string, storage: NicknameStorage = safeStorage()): string {
  const normalized = normalizeNickname(value);
  const name = normalized || generateNickname();
  try {
    storage?.setItem(NICKNAME_KEY, name);
  } catch {
    // Ignore storage errors; callers still get the name they should display.
  }
  return name;
}
