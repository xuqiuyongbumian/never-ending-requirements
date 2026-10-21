import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  ENGINEER_ANIMATION_FRAMES,
  ENGINEER_SPRITE_FRAME_SIZE,
  GAME_ASSETS,
  GAME_SPRITESHEETS,
  GAME_TEXTURES,
  engineerSpriteSheet,
  requestTexture
} from "../../src/presentation/game-assets.ts";

test("maps the five engineer roles to distinct portraits and animated sheets", () => {
  const roles = Object.keys(GAME_ASSETS.characters) as Array<keyof typeof GAME_ASSETS.characters>;
  const keys = roles.map(engineerSpriteSheet);
  assert.equal(new Set(keys).size, 5);
  assert.equal(Object.keys(GAME_SPRITESHEETS).length, 5);

  const assets = [
    ...Object.values(GAME_ASSETS.characters),
    ...Object.values(GAME_SPRITESHEETS),
    ...Object.values(GAME_ASSETS.tasks),
    ...GAME_ASSETS.backgrounds,
    ...Object.values(GAME_ASSETS.icons)
  ];
  for (const asset of assets) assert.ok(existsSync(resolve("public", asset.src.replace(/^\.\//, "").replace(/^\//, ""))), asset.src);
  assert.equal(new Set(GAME_TEXTURES.map((asset) => asset.key)).size, GAME_TEXTURES.length);

  assert.equal(ENGINEER_SPRITE_FRAME_SIZE, 256);
  assert.deepEqual(Object.values(ENGINEER_ANIMATION_FRAMES).map(({ start, end }) => end - start + 1), [6, 8, 6]);
  assert.deepEqual(Object.values(ENGINEER_ANIMATION_FRAMES).map(({ start }) => Math.floor(start / 8)), [0, 1, 2]);
});

test("selects the request mascot from its live type and workload", () => {
  assert.equal(requestTexture({ kind: "feature", isFinal: false, totalWork: 135 }), GAME_ASSETS.tasks.ui.key);
  assert.equal(requestTexture({ kind: "infra", isFinal: false, totalWork: 190 }), GAME_ASSETS.tasks.api.key);
  assert.equal(requestTexture({ kind: "bug", isFinal: false, totalWork: 145 }), GAME_ASSETS.tasks.bug.key);
  assert.equal(requestTexture({ kind: "feature", isFinal: false, totalWork: 220 }), GAME_ASSETS.tasks.feature.key);
  assert.equal(requestTexture({ kind: "launch", isFinal: true, totalWork: 880 }), GAME_ASSETS.tasks.feature.key);
});
