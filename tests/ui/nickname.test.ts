import test from "node:test";
import assert from "node:assert/strict";
import {
  generateNickname,
  NICKNAME_KEY,
  NICKNAME_MAX_LENGTH,
  normalizeNickname,
  readNickname,
  saveNickname
} from "../../src/ui/nickname.ts";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value)
  };
}

test("generated nicknames are readable and bounded", () => {
  const name = generateNickname();
  assert.ok(name.length > 4, "nickname should carry a theme stem");
  assert.ok(name.length <= NICKNAME_MAX_LENGTH, "nickname must respect the storage limit");
  assert.match(name, /-[0-9A-F]{4}$/, "nickname should end with a short random suffix");
  assert.notEqual(generateNickname(), generateNickname(), "two draws should not collide");
});

test("readNickname persists a placeholder when nothing is stored", () => {
  const storage = memoryStorage();
  const name = readNickname(storage);
  assert.ok(name.length > 0, "a nickname is always returned");
  assert.equal(storage.data.get(NICKNAME_KEY), name, "the placeholder must be stored for later runs");
  assert.equal(readNickname(storage), name, "subsequent reads keep the same identity");
});

test("readNickname trims and reuses a stored value", () => {
  const storage = memoryStorage({ [NICKNAME_KEY]: "  夜班组长  " });
  assert.equal(readNickname(storage), "夜班组长");
});

test("saveNickname replaces blank input with a generated placeholder", () => {
  const storage = memoryStorage();
  const saved = saveNickname("   ", storage);
  assert.ok(saved.length > 0, "blank names are rejected");
  assert.equal(storage.data.get(NICKNAME_KEY), saved);
});

test("saveNickname normalizes spaces and clamps the length", () => {
  const storage = memoryStorage();
  const saved = saveNickname("  赶工   队长 加上一个特别特别长的后缀用来测试截断逻辑  ", storage);
  assert.equal(saved, normalizeNickname(saved));
  assert.ok(saved.length <= NICKNAME_MAX_LENGTH);
  assert.equal(storage.data.get(NICKNAME_KEY), saved);
});
