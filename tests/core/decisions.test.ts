import assert from "node:assert/strict";
import test from "node:test";
import { CHANGE_EVENTS } from "../../src/core/game.ts";
import { DECISION_CATALOG, getDecisionChoice } from "../../shared/catalog.ts";

test("shared decision catalog stays aligned with the playable change events", () => {
  assert.deepEqual(
    DECISION_CATALOG.map((event) => event.id),
    CHANGE_EVENTS.map((event) => event.id)
  );

  for (const event of CHANGE_EVENTS) {
    const catalogEvent = DECISION_CATALOG.find((candidate) => candidate.id === event.id);
    assert.ok(catalogEvent, `missing catalog entry for ${event.id}`);
    assert.deepEqual(
      catalogEvent.choices.map((choice) => ({ id: choice.id, label: choice.label })),
      event.choices.map((choice) => ({ id: choice.id, label: choice.label }))
    );
    for (const choice of event.choices) {
      const resolved = getDecisionChoice(choice.id);
      assert.equal(resolved?.event.id, event.id);
      assert.equal(resolved?.choice.label, choice.label);
      assert.ok(resolved?.choice.tone === "speed" || resolved?.choice.tone === "quality");
    }
  }
});
