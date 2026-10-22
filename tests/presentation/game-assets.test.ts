import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { getEngineerDefinition } from "../../src/core/game.ts";
import {
  animationFrameOffset,
  runAnimationFrameOffset,
  runContactFrameIndex,
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
    ...Object.values(GAME_ASSETS.icons),
    ...Object.values(GAME_ASSETS.structures)
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
    assert.equal(png.readUInt32BE(16), 2066, `${role} padded sheet width`);
    assert.equal(png.readUInt32BE(20), 776, `${role} padded sheet height`);
    assert.equal(png[24], 8, `${role} must use 8-bit channels`);
    assert.equal(png[25], 6, `${role} must retain RGBA alpha`);
    assert.equal(sheet.frameWidth, 256);
    assert.equal(sheet.frameHeight, 256);
    assert.equal(sheet.margin, 2);
    assert.equal(sheet.spacing, 2);

    const actions = ENGINEER_ANIMATIONS[role];
    assert.ok(actions.idle.frameCount >= 4 && actions.idle.frameCount <= 6, `${role} idle frames`);
    assert.ok(actions.moving.frameCount >= 4 && actions.moving.frameCount <= 8, `${role} run frames`);
    assert.ok(actions.working.frameCount >= 6 && actions.working.frameCount <= 8, `${role} work frames`);
    assert.equal(actions.idle.start, 0);
    assert.ok(actions.moving.start >= 8 && actions.moving.start <= 12, `${role} run start`);
    assert.ok((actions.moving.start % 8) + actions.moving.frameCount <= 8, `${role} run frames stay inside the run row`);
    assert.equal(actions.working.start, 16);
    for (const action of Object.values(actions)) {
      assert.ok(action.start % 8 === 0, `${role} action starts at a sprite-sheet row boundary`);
      assert.ok(action.frameCount <= 8, `${role} action stays within one sprite-sheet row`);
    }

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

test("converts global spritesheet frame indexes to local action-frame indexes", () => {
  const working = ENGINEER_ANIMATIONS.intern.working;
  assert.equal(animationFrameOffset(working, 16), 0);
  assert.equal(animationFrameOffset(working, 21), 5);
  assert.equal(animationFrameOffset(working, 15), 5);
});

test("paces each run cycle across 64 world units at the role's real movement speed", () => {
  for (const role of Object.keys(ENGINEER_ANIMATIONS) as Array<keyof typeof ENGINEER_ANIMATIONS>) {
    const run = ENGINEER_ANIMATIONS[role].moving;
    const cycleDistance = getEngineerDefinition(role).moveSpeed * run.frameCount / run.frameRate;
    assert.ok(Math.abs(cycleDistance - 64) < 1e-9, `${role} run cycle length`);
  }
});

test("run animation advances by its stride spacing and loops by traveled distance", () => {
  for (const role of Object.keys(ENGINEER_ANIMATIONS) as Array<keyof typeof ENGINEER_ANIMATIONS>) {
    const definition = ENGINEER_ANIMATIONS[role].moving;
    const speed = getEngineerDefinition(role).moveSpeed;
    const stride = speed / definition.frameRate;
    assert.equal(runAnimationFrameOffset(definition, 0, speed), 0);
    assert.equal(runAnimationFrameOffset(definition, stride - 1e-6, speed), 0);
    assert.equal(runAnimationFrameOffset(definition, stride + 1e-6, speed), 1);
    assert.equal(runAnimationFrameOffset(definition, 64 - 1e-6, speed), definition.frameCount - 1);
    assert.equal(runAnimationFrameOffset(definition, 64, speed), 0);
  }
});

test("frontend run cycle excludes the standing pose at the end of its source row", () => {
  assert.equal(ENGINEER_ANIMATIONS.frontend.moving.frameCount, 7);
});

test("ending a run selects the closest alternating contact pose", () => {
  const run = ENGINEER_ANIMATIONS.backend.moving;
  assert.equal(runContactFrameIndex(run, run.start + 1), run.start);
  assert.equal(runContactFrameIndex(run, run.start + 3), run.start + 4);
  assert.equal(runContactFrameIndex(run, run.start + 7), run.start);
});

test("selects the request mascot from its live type and workload", () => {
  assert.equal(requestTexture({ kind: "feature", isFinal: false, totalWork: 135 }), GAME_ASSETS.tasks.ui.key);
  assert.equal(requestTexture({ kind: "infra", isFinal: false, totalWork: 190 }), GAME_ASSETS.tasks.api.key);
  assert.equal(requestTexture({ kind: "bug", isFinal: false, totalWork: 145 }), GAME_ASSETS.tasks.bug.key);
  assert.equal(requestTexture({ kind: "feature", isFinal: false, totalWork: 220 }), GAME_ASSETS.tasks.feature.key);
  assert.equal(requestTexture({ kind: "launch", isFinal: true, totalWork: 880 }), GAME_ASSETS.tasks.feature.key);
});
