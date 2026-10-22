import assert from "node:assert/strict";
import test from "node:test";
import {
  approachGain,
  clampUnit,
  cueForEvent,
  DUCK_ATTACK_RATE,
  DUCK_LEVEL,
  DUCK_RELEASE_RATE,
  equalPowerGains,
  panFromX,
  pickNextVariant,
  settingToGain
} from "../../src/audio/music-plan.ts";
import {
  DEFAULT_AUDIO_SETTINGS,
  normalizeAudioSettings,
  withAudioPatch
} from "../../src/audio/audio-settings.ts";

function seeded(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

test("equal-power crossfade keeps total power flat and clamps its input", () => {
  assert.deepEqual([...equalPowerGains(0)], [1, 0]);
  assert.deepEqual([...equalPowerGains(1)].map((gain) => Math.round(gain * 1000) / 1000), [0, 1]);
  for (let i = 0; i <= 20; i += 1) {
    const [out, incoming] = equalPowerGains(i / 20);
    assert.ok(Math.abs(out * out + incoming * incoming - 1) < 1e-9);
    assert.ok(out >= 0 && incoming >= 0);
  }
  const mid = equalPowerGains(0.5);
  assert.ok(Math.abs(mid[0] - Math.SQRT1_2) < 1e-9);
  assert.deepEqual([...equalPowerGains(-3)], [1, 0]);
  assert.deepEqual([...equalPowerGains(Number.NaN)], [1, 0]);
});

test("random variants never repeat the previous pick", () => {
  const bag = ["a", "b", "c"];
  const random = seeded(42);
  let last: string | null = null;
  const picked: string[] = [];
  for (let i = 0; i < 60; i += 1) {
    const next = pickNextVariant(bag, last, random);
    assert.notEqual(next, last);
    last = next;
    picked.push(next);
  }
  assert.equal(new Set(picked).size, bag.length);
  assert.equal(pickNextVariant(["only"], "only", random), "only");
  assert.throws(() => pickNextVariant([], null, random));
});

test("every telemetry event that should make noise maps to a cue", () => {
  const expected: Record<string, string> = {
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
  for (const [type, cue] of Object.entries(expected)) {
    assert.equal(cueForEvent(type, {})?.cue, cue);
  }
  assert.equal(cueForEvent("result", { result: "victory" })?.cue, "win");
  assert.equal(cueForEvent("result", { result: "defeat" })?.cue, "lose");
  assert.equal(cueForEvent("debt_change", { delta: 25 }), null);
  assert.equal(cueForEvent("enter", {}), null);
});

test("ducking attacks faster than it releases and stays in range", () => {
  assert.ok(DUCK_ATTACK_RATE > DUCK_RELEASE_RATE);
  const attacked = approachGain(1, DUCK_LEVEL, 0.1);
  assert.ok(attacked < 0.85, "a key moment should be audible as a duck within 100ms");
  assert.ok(attacked > DUCK_LEVEL);
  const released = approachGain(DUCK_LEVEL, 1, 0.05);
  assert.ok(released > DUCK_LEVEL);
  assert.ok(released < 0.6, "recovery must be slow, not a jump");
  assert.equal(approachGain(0.7, 0.7, 0.5), 0.7);
  assert.equal(approachGain(0.2, 1, 0), 0.2);
  assert.equal(approachGain(1.4, 1, 0.5), 1);
});

test("slider values follow a perceptual curve", () => {
  assert.equal(settingToGain(0), 0);
  assert.equal(settingToGain(0.5), 0.25);
  assert.equal(settingToGain(1), 1);
  assert.equal(settingToGain(4), 1);
  assert.equal(clampUnit(Number.NaN, 0.4), 0.4);
  assert.equal(clampUnit(-1, 0.4), 0);
  assert.equal(clampUnit("0.3", 0.4), 0.4, "persisted strings are not silently coerced");
});

test("pan follows screen position and survives a degenerate range", () => {
  assert.equal(panFromX(0, 0, 1000, 0.7), -0.7);
  assert.equal(panFromX(1000, 0, 1000, 0.7), 0.7);
  assert.equal(panFromX(500, 0, 1000, 0.7), 0);
  assert.equal(panFromX(500, 0, 0), 0);
  assert.equal(panFromX(Number.NaN, 0, 1000), 0);
});

test("persisted settings are sanitised instead of trusted", () => {
  assert.deepEqual(normalizeAudioSettings(null), DEFAULT_AUDIO_SETTINGS);
  assert.deepEqual(normalizeAudioSettings("nonsense"), DEFAULT_AUDIO_SETTINGS);
  const repaired = normalizeAudioSettings({ master: 4, music: -2, sfx: 0.25, ui: "0.5", muted: "yes" });
  assert.equal(repaired.master, 1);
  assert.equal(repaired.music, 0);
  assert.equal(repaired.sfx, 0.25);
  assert.equal(repaired.ui, DEFAULT_AUDIO_SETTINGS.ui);
  assert.equal(repaired.muted, DEFAULT_AUDIO_SETTINGS.muted);
});

test("patching one channel leaves the rest alone", () => {
  const patched = withAudioPatch({ ...DEFAULT_AUDIO_SETTINGS }, { music: 0.1, muted: true });
  assert.equal(patched.music, 0.1);
  assert.equal(patched.muted, true);
  assert.equal(patched.sfx, DEFAULT_AUDIO_SETTINGS.sfx);
  assert.equal(patched.master, DEFAULT_AUDIO_SETTINGS.master);
});
