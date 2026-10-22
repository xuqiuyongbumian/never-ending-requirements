import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  GAME_ASSETS,
  ENGINEER_ANIMATIONS,
  ENGINEER_ANIMATION_SHEETS,
  GAME_TEXTURES,
  ENGINEER_SPRITE_SHEETS,
  engineerAnimationKey,
  engineerTexture,
  requestTexture
} from "../../src/presentation/game-assets.ts";

test("maps every engineer role to a distinct high-resolution portrait", () => {
  const roles = Object.keys(GAME_ASSETS.characters) as Array<keyof typeof GAME_ASSETS.characters>;
  const keys = roles.map(engineerTexture);
  assert.equal(new Set(keys).size, 5);

  const assets = [
    ...Object.values(GAME_ASSETS.characters),
    ...Object.values(GAME_ASSETS.tasks),
    ...GAME_ASSETS.backgrounds,
    ...Object.values(GAME_ASSETS.icons)
  ];
  for (const asset of assets) assert.ok(existsSync(resolve("public", asset.src.replace(/^\.\//, "").replace(/^\//, ""))), asset.src);
  assert.equal(new Set(GAME_TEXTURES.map((asset) => asset.key)).size, GAME_TEXTURES.length);
  for (const role of roles) assert.ok(GAME_TEXTURES.some((asset) => asset.key === engineerTexture(role)));
});

test("maps five valid RGBA sprite sheets with distinct, correctly sized action ranges", () => {
  const roles = Object.keys(ENGINEER_ANIMATION_SHEETS) as Array<keyof typeof ENGINEER_ANIMATION_SHEETS>;
  assert.equal(roles.length, 5);
  assert.equal(ENGINEER_SPRITE_SHEETS.length, roles.length);

  const animationKeys = new Set<string>();
  for (const role of roles) {
    const sheet = ENGINEER_ANIMATION_SHEETS[role];
    const path = resolve("public", sheet.src.replace(/^\//, ""));
    assert.ok(existsSync(path), sheet.src);
    const png = readFileSync(path);
    assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", `${role} must be a PNG`);
    assert.equal(png.readUInt32BE(16), 2048, `${role} sheet width`);
    assert.equal(png.readUInt32BE(20), 768, `${role} sheet height`);
    assert.equal(png[24], 8, `${role} must use 8-bit channels`);
    assert.equal(png[25], 6, `${role} must retain RGBA alpha`);
    assert.equal(sheet.frameWidth, 256);
    assert.equal(sheet.frameHeight, 256);

    const actions = ENGINEER_ANIMATIONS[role];
    assert.ok(actions.idle.frameCount >= 4 && actions.idle.frameCount <= 6, `${role} idle frames`);
    assert.ok(actions.moving.frameCount >= 6 && actions.moving.frameCount <= 8, `${role} run frames`);
    assert.ok(actions.working.frameCount >= 6 && actions.working.frameCount <= 8, `${role} work frames`);
    assert.equal(actions.idle.start, 0);
    assert.equal(actions.moving.start, 8);
    assert.equal(actions.working.start, 16);

    for (const action of ["idle", "moving", "working"] as const) {
      const key = engineerAnimationKey(role, action);
      assert.ok(!animationKeys.has(key), `animation key collision: ${key}`);
      animationKeys.add(key);
      const actionName = action === "moving" ? "run" : action === "working" ? "work" : "idle";
      assert.equal(key, `${sheet.key}-${actionName}`, `${role} ${action} must map to the matching frame animation`);
    }
  }
  assert.equal(animationKeys.size, 15);
});

test("selects the request mascot from its live type and workload", () => {
  assert.equal(requestTexture({ kind: "feature", isFinal: false, totalWork: 135 }), GAME_ASSETS.tasks.ui.key);
  assert.equal(requestTexture({ kind: "infra", isFinal: false, totalWork: 190 }), GAME_ASSETS.tasks.api.key);
  assert.equal(requestTexture({ kind: "bug", isFinal: false, totalWork: 145 }), GAME_ASSETS.tasks.bug.key);
  assert.equal(requestTexture({ kind: "feature", isFinal: false, totalWork: 220 }), GAME_ASSETS.tasks.feature.key);
  assert.equal(requestTexture({ kind: "launch", isFinal: true, totalWork: 880 }), GAME_ASSETS.tasks.feature.key);
});
