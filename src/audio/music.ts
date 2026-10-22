import { CROSSFADE_SECONDS, equalPowerGains, pickNextVariant } from "./music-plan";

/**
 * Procedural 8-bit score.
 *
 * One sequencer drives up to two "layers". Each layer holds the arrangement of
 * one era and its own gain, so an era change is a pure equal-power crossfade
 * over notes that stay phase-locked on the same step grid. No audio files are
 * fetched, and the loop never restarts mid-run.
 */

const A3 = 220;
const BPM = 132;
const STEP_SECONDS = 60 / BPM / 2; // one eighth note
const STEPS_PER_BAR = 8;
const BAR_COUNT = 8;
const LOOP_STEPS = STEPS_PER_BAR * BAR_COUNT;
const LOOKAHEAD_SECONDS = 0.18;
const SCHEDULER_INTERVAL_MS = 25;
/** -999 marks a rest so motifs stay readable. */
const REST = -999;
/** Am - F - C - G, twice: semitone offsets from A. */
const CHORDS = [0, -4, 3, -2, 0, -4, 3, -2];

const LEAD_MOTIFS: ReadonlyArray<readonly number[]> = [
  [12, REST, 10, REST, 12, 15, REST, 12, 10, REST, 7, REST, 10, 12, REST, REST],
  [12, 15, REST, 12, 10, REST, 7, REST, 5, REST, 7, 10, REST, 12, REST, REST],
  [7, REST, 10, REST, 12, REST, 15, 12, REST, 10, REST, 7, 5, REST, 7, REST]
];

const ARP_TONES = [0, 7, 12, 7, 3, 10, 15, 10];

export interface MusicMood {
  rush: boolean;
  incident: boolean;
  urgent: boolean;
}

interface Layer {
  era: number;
  enabled: boolean;
  gain: GainNode;
}

function frequency(semitones: number): number {
  return A3 * 2 ** (semitones / 12);
}

export class MusicPlayer {
  private readonly layers: [Layer, Layer];
  private activeSlot = 0;
  private step = 0;
  private nextStepTime = 0;
  private timer: number | null = null;
  private stopped = true;
  private variant = 0;
  private lastVariant: string | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private mood: MusicMood = { rush: false, incident: false, urgent: false };

  constructor(private readonly ctx: AudioContext, destination: AudioNode) {
    this.layers = [this.createLayer(destination), this.createLayer(destination)];
  }

  private createLayer(destination: AudioNode): Layer {
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    gain.connect(destination);
    return { era: 0, enabled: false, gain };
  }

  start(era: number): void {
    if (!this.stopped) return;
    this.stopped = false;
    const variantKey = pickNextVariant(LEAD_MOTIFS.map((_, index) => String(index)), this.lastVariant);
    this.lastVariant = variantKey;
    this.variant = Number(variantKey);
    const slot = this.activeSlot;
    const layer = this.layers[slot];
    layer.era = era;
    layer.enabled = true;
    layer.gain.gain.cancelScheduledValues(this.ctx.currentTime);
    layer.gain.gain.setValueAtTime(1, this.ctx.currentTime);
    this.step = 0;
    this.nextStepTime = this.ctx.currentTime + 0.08;
    this.timer = window.setInterval(() => this.pump(), SCHEDULER_INTERVAL_MS);
    this.pump();
  }

  /** Re-orchestrate for a new era without restarting the loop. */
  setEra(era: number): void {
    if (this.stopped) return;
    const current = this.layers[this.activeSlot];
    if (current.era === era) return;
    const nextSlot = 1 - this.activeSlot;
    const next = this.layers[nextSlot];
    next.era = era;
    next.enabled = true;

    const now = this.ctx.currentTime;
    // Equal-power crossfade expressed as linear ramp segments: safer than
    // setValueCurveAtTime when an era flips again mid-fade.
    this.crossfadeParam(next.gain.gain, next.gain.gain.value, 1, (t) => equalPowerGains(t)[1], now);
    this.crossfadeParam(current.gain.gain, current.gain.gain.value, 0, (t) => 1 - equalPowerGains(t)[0], now);
    this.activeSlot = nextSlot;

    window.setTimeout(() => {
      if (this.stopped) return;
      current.enabled = false;
      current.gain.gain.cancelScheduledValues(this.ctx.currentTime);
      current.gain.gain.setValueAtTime(0, this.ctx.currentTime);
    }, CROSSFADE_SECONDS * 1000 + 80);
  }

  setMood(mood: Partial<MusicMood>): void {
    this.mood = { ...this.mood, ...mood };
  }

  /** Rebase the clock after the context was suspended (tab hidden, phone call). */
  resync(): void {
    if (this.stopped) return;
    this.nextStepTime = Math.max(this.nextStepTime, this.ctx.currentTime + 0.05);
    this.pump();
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
    for (const layer of this.layers) {
      layer.enabled = false;
      layer.gain.gain.cancelScheduledValues(this.ctx.currentTime);
      layer.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.04);
    }
  }

  dispose(): void {
    this.stop();
    for (const layer of this.layers) layer.gain.disconnect();
    this.noiseBuffer = null;
  }

  private pump(): void {
    if (this.stopped) return;
    // A suspended context freezes currentTime, so after a tab restore the
    // cursor can be far behind: rebase instead of scheduling a burst of notes.
    if (this.nextStepTime < this.ctx.currentTime - 0.25) {
      this.nextStepTime = this.ctx.currentTime + 0.02;
    }
    const horizon = this.ctx.currentTime + LOOKAHEAD_SECONDS;
    let guard = 0;
    while (this.nextStepTime < horizon && guard < 64) {
      for (const layer of this.layers) {
        if (!layer.enabled) continue;
        this.scheduleStep(layer, this.step, this.nextStepTime);
      }
      this.nextStepTime += STEP_SECONDS;
      this.step = (this.step + 1) % LOOP_STEPS;
      guard += 1;
    }
  }

  private crossfadeParam(
    param: AudioParam,
    start: number,
    target: number,
    shape: (progress: number) => number,
    now: number
  ): void {
    const segments = 16;
    param.cancelScheduledValues(now);
    param.setValueAtTime(start, now);
    for (let i = 1; i <= segments; i += 1) {
      const progress = i / segments;
      param.linearRampToValueAtTime(start + (target - start) * shape(progress), now + CROSSFADE_SECONDS * progress);
    }
  }

  private scheduleStep(layer: Layer, step: number, time: number): void {
    const bar = Math.floor(step / STEPS_PER_BAR) % BAR_COUNT;
    const chord = CHORDS[bar];
    const inBar = step % STEPS_PER_BAR;
    const lead = LEAD_MOTIFS[this.variant];
    const { rush, incident, urgent } = this.mood;

    const motif = lead[step % lead.length];
    if (motif !== REST && !(incident && inBar % 2 === 1)) {
      const shift = rush ? 12 : 0;
      const drop = incident ? 12 : 0;
      this.tone(layer, "square", frequency(chord + motif + shift - drop), time, STEP_SECONDS * 0.9, 0.085, incident ? -18 : 0);
    }

    if (layer.era >= 1 && (inBar === 0 || inBar === 3 || inBar === 4 || (layer.era >= 2 && inBar === 6))) {
      this.tone(layer, "triangle", frequency(chord - 12), time, STEP_SECONDS * 1.6, 0.13);
    }

    if (layer.era >= 2 && !incident) {
      this.tone(layer, "square", frequency(chord + ARP_TONES[step % ARP_TONES.length] + 12), time, STEP_SECONDS * 0.55, 0.04);
    }

    const hatEvery = layer.era >= 2 || rush ? 1 : layer.era >= 1 ? 2 : 0;
    if (hatEvery > 0 && inBar % hatEvery === 0) {
      this.hat(layer, time, inBar === 0 ? 0.075 : 0.04);
    }

    if (urgent && inBar === 0) {
      this.tone(layer, "square", frequency(36), time, 0.05, 0.06);
    }
  }

  private tone(
    layer: Layer,
    type: OscillatorType,
    freq: number,
    time: number,
    duration: number,
    peak: number,
    detune = 0
  ): void {
    const osc = this.ctx.createOscillator();
    const env = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, time);
    if (detune !== 0) osc.detune.setValueAtTime(detune, time);
    const attack = 0.006;
    const release = Math.min(0.08, duration * 0.5);
    env.gain.setValueAtTime(0.0001, time);
    env.gain.linearRampToValueAtTime(peak, time + attack);
    env.gain.setValueAtTime(peak, time + Math.max(attack, duration - release));
    env.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    osc.connect(env).connect(layer.gain);
    osc.start(time);
    osc.stop(time + duration + 0.02);
  }

  private hat(layer: Layer, time: number, peak: number): void {
    const source = this.ctx.createBufferSource();
    source.buffer = this.noise();
    const filter = this.ctx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.setValueAtTime(6200, time);
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(peak, time);
    env.gain.exponentialRampToValueAtTime(0.0001, time + 0.05);
    source.connect(filter).connect(env).connect(layer.gain);
    source.start(time);
    source.stop(time + 0.06);
  }

  private noise(): AudioBuffer {
    if (this.noiseBuffer) return this.noiseBuffer;
    const length = Math.floor(this.ctx.sampleRate * 0.25);
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buffer;
    return buffer;
  }
}
