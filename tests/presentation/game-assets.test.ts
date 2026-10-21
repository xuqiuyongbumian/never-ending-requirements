import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  GAME_ASSETS,
  GAME_TEXTURES,
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

test("selects the request mascot from its live type and workload", () => {
  assert.equal(requestTexture({ kind: "feature", isFinal: false, totalWork: 135 }), GAME_ASSETS.tasks.ui.key);
  assert.equal(requestTexture({ kind: "infra", isFinal: false, totalWork: 190 }), GAME_ASSETS.tasks.api.key);
  assert.equal(requestTexture({ kind: "bug", isFinal: false, totalWork: 145 }), GAME_ASSETS.tasks.bug.key);
  assert.equal(requestTexture({ kind: "feature", isFinal: false, totalWork: 220 }), GAME_ASSETS.tasks.feature.key);
  assert.equal(requestTexture({ kind: "launch", isFinal: true, totalWork: 880 }), GAME_ASSETS.tasks.feature.key);
});
