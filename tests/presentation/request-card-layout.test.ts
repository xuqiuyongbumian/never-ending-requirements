import assert from "node:assert/strict";
import test from "node:test";
import { layoutRequestCards, type RequestCardLayoutItem, type RequestCardLayoutOptions } from "../../src/presentation/request-card-layout.ts";

const bounds: RequestCardLayoutOptions = { viewportWidth: 1280, safeTop: 160, safeBottom: 420, horizontalMargin: 12, horizontalGap: 12, verticalGap: 8 };

function assertNoCollisions(items: readonly RequestCardLayoutItem[], positions: Map<number, { x: number; y: number }>): void {
  const byId = new Map(items.map((item) => [item.id, item]));
  const placed = [...positions].map(([id, position]) => ({ ...byId.get(id)!, ...position }));
  for (const card of placed) {
    assert.ok(card.x - card.width / 2 >= 12, `card ${card.id} left edge`);
    assert.ok(card.x + card.width / 2 <= bounds.viewportWidth - 12, `card ${card.id} right edge`);
    assert.ok(card.y - card.height / 2 >= bounds.safeTop, `card ${card.id} safe top`);
    assert.ok(card.y + card.height / 2 <= bounds.safeBottom, `card ${card.id} safe bottom`);
  }
  for (let left = 0; left < placed.length; left += 1) {
    for (let right = left + 1; right < placed.length; right += 1) {
      const a = placed[left]!;
      const b = placed[right]!;
      const overlapsX = Math.abs(a.x - b.x) < (a.width + b.width) / 2 + bounds.horizontalGap! - 0.01;
      const overlapsY = Math.abs(a.y - b.y) < (a.height + b.height) / 2 + bounds.verticalGap! - 0.01;
      assert.equal(overlapsX && overlapsY, false, `cards ${a.id} and ${b.id} overlap`);
    }
  }
}

test("fits a boss and five clustered requests without overlap or safe-area clipping", () => {
  const items: RequestCardLayoutItem[] = Array.from({ length: 5 }, (_, index) => ({ id: index + 1, anchorX: 1120, width: 224, height: 72 }));
  items.push({ id: 90, anchorX: 1120, width: 320, height: 100, isBoss: true });
  const layout = layoutRequestCards(items, bounds);
  assert.equal(layout.positions.size, items.length);
  assert.deepEqual(layout.overflowIds, []);
  assertNoCollisions(items, layout.positions);
});

test("packs dense ordinary waves across rows instead of assigning a row per task", () => {
  const items: RequestCardLayoutItem[] = Array.from({ length: 12 }, (_, index) => ({ id: index + 1, anchorX: 640, width: 224, height: 72 }));
  const layout = layoutRequestCards(items, bounds);
  assert.equal(layout.positions.size, items.length);
  assert.equal(new Set([...layout.positions.values()].map(({ y }) => y)).size, 3);
  assertNoCollisions(items, layout.positions);
});

test("keeps prioritized requests visible and reports only genuinely unplaceable overflow", () => {
  const items: RequestCardLayoutItem[] = Array.from({ length: 24 }, (_, index) => ({ id: index + 1, anchorX: 640, width: 224, height: 72 }));
  items[23]!.prioritized = true;
  const layout = layoutRequestCards(items, bounds);
  assert.ok(layout.positions.has(24));
  assert.ok(layout.overflowIds.length > 0);
  assert.equal(layout.positions.size + layout.overflowIds.length, items.length);
  assertNoCollisions(items, layout.positions);
});

test("returns stable positions for an unchanged formation", () => {
  const items: RequestCardLayoutItem[] = [
    { id: 2, anchorX: 700, width: 224, height: 72 },
    { id: 1, anchorX: 700, width: 224, height: 72 }
  ];
  assert.deepEqual([...layoutRequestCards(items, bounds).positions], [...layoutRequestCards(items, bounds).positions]);
});
