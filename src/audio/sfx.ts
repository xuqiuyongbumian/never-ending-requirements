import type { SfxCue } from "./music-plan";

/**
 * Tiny 8-bit SFX synthesiser.
 *
 * Every cue is a couple of oscillators plus an envelope, so the game ships no
 * audio payload at all. Voices are capped and rate limited because bursts like
 * "three requirements cleared in one frame" would otherwise turn into noise.
 */

const MAX_VOICES = 12;

const MIN_GAP_MS: Partial<Record<SfxCue, number>> = {
  ui_tick: 30,
  request_in: 60,
  clear: 45,
  hire: 60,
  priority: 60,
  miss: 80
};

export interface SfxOptions {
  pan?: number;
  gain?: number;
}

export class SfxPlayer {
  private voices = 0;
  private readonly lastPlayedMs = new Map<SfxCue, number>();
  private noiseBuffer: AudioBuffer | null = null;

  constructor(private readonly ctx: AudioContext) {}

  play(cue: SfxCue, destination: AudioNode, options: SfxOptions = {}): void {
    const nowMs = this.ctx.currentTime * 1000;
    if (nowMs - (this.lastPlayedMs.get(cue) ?? -Infinity) < (MIN_GAP_MS[cue] ?? 40)) return;
    if (this.voices >= MAX_VOICES) return;
    this.lastPlayedMs.set(cue, nowMs);

    const out = this.ctx.createGain();
    out.gain.value = Math.max(0, Math.min(1.5, options.gain ?? 1));
    const panner = this.ctx.createStereoPanner();
    panner.pan.value = Math.max(-0.85, Math.min(0.85, options.pan ?? 0));
    out.connect(panner).connect(destination);

    const duration = this.render(cue, out);
    this.voices += 1;
    window.setTimeout(() => {
      this.voices = Math.max(0, this.voices - 1);
      panner.disconnect();
      out.disconnect();
    }, duration * 1000 + 90);
  }

  get activeVoices(): number {
    return this.voices;
  }

  dispose(): void {
    this.noiseBuffer = null;
    this.lastPlayedMs.clear();
  }

  private render(cue: SfxCue, out: AudioNode): number {
    const jitter = 1 + (Math.random() * 0.06 - 0.03);
    const f = (hz: number) => hz * jitter;
    switch (cue) {
      case "hire":
        this.tone(out, "square", f(660), f(660), 0, 0.07, 0.26);
        this.tone(out, "square", f(990), f(990), 0.075, 0.1, 0.22);
        return 0.2;
      case "denied":
        this.tone(out, "sawtooth", f(300), f(190), 0, 0.14, 0.16);
        return 0.16;
      case "request_in":
        this.tone(out, "triangle", f(880), f(740), 0, 0.1, 0.14);
        return 0.12;
      case "priority":
        this.tone(out, "square", f(990), f(990), 0, 0.05, 0.2);
        this.tone(out, "square", f(1320), f(1320), 0.06, 0.07, 0.18);
        return 0.14;
      case "clear":
        this.tone(out, "square", f(880), f(880), 0, 0.06, 0.2);
        this.tone(out, "square", f(1108), f(1108), 0.06, 0.06, 0.2);
        this.tone(out, "square", f(1318), f(1318), 0.12, 0.12, 0.22);
        this.noiseBurst(out, 0.12, 0.1, 0.05, 4200, "highpass");
        return 0.3;
      case "miss":
        this.tone(out, "sawtooth", f(420), f(150), 0, 0.24, 0.2);
        return 0.26;
      case "alert":
        for (const at of [0, 0.1, 0.2]) this.tone(out, "square", f(1480), f(1480), at, 0.05, 0.18);
        return 0.3;
      case "choice":
        this.tone(out, "square", f(1180), f(1180), 0, 0.05, 0.16);
        return 0.08;
      case "era_up":
        this.tone(out, "square", f(330), f(988), 0, 0.28, 0.22);
        this.tone(out, "triangle", f(440), f(1320), 0.08, 0.26, 0.16);
        return 0.4;
      case "rush":
        this.tone(out, "sawtooth", f(220), f(1320), 0, 0.26, 0.2);
        this.noiseBurst(out, 0, 0.24, 0.09, 900, "highpass");
        return 0.34;
      case "rush_end":
        this.tone(out, "square", f(880), f(880), 0, 0.06, 0.16);
        this.tone(out, "square", f(660), f(660), 0.07, 0.06, 0.16);
        this.tone(out, "square", f(440), f(440), 0.14, 0.1, 0.16);
        return 0.26;
      case "incident":
        this.tone(out, "sawtooth", f(110), f(52), 0, 0.5, 0.24);
        this.noiseBurst(out, 0, 0.42, 0.1, 700, "lowpass");
        return 0.55;
      case "win":
        [523, 659, 784, 1046].forEach((hz, index) => this.tone(out, "square", f(hz), f(hz), index * 0.11, 0.2, 0.2));
        return 0.7;
      case "lose":
        [392, 330, 262].forEach((hz, index) => this.tone(out, "triangle", f(hz), f(hz), index * 0.16, 0.26, 0.2));
        return 0.7;
      case "ui_tick":
        this.tone(out, "square", f(1600), f(1600), 0, 0.025, 0.12);
        return 0.04;
      default:
        return 0;
    }
  }

  private tone(
    out: AudioNode,
    type: OscillatorType,
    from: number,
    to: number,
    at: number,
    duration: number,
    peak: number
  ): void {
    const start = this.ctx.currentTime + at;
    const osc = this.ctx.createOscillator();
    const env = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(20, from), start);
    if (to !== from) osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), start + duration);
    env.gain.setValueAtTime(0.0001, start);
    env.gain.linearRampToValueAtTime(peak, start + 0.008);
    env.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(env).connect(out);
    osc.start(start);
    osc.stop(start + duration + 0.02);
  }

  private noiseBurst(
    out: AudioNode,
    at: number,
    duration: number,
    peak: number,
    cutoff: number,
    type: BiquadFilterType
  ): void {
    const start = this.ctx.currentTime + at;
    const source = this.ctx.createBufferSource();
    source.buffer = this.noiseSample();
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(cutoff, start);
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(peak, start);
    env.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    source.connect(filter).connect(env).connect(out);
    source.start(start);
    source.stop(start + duration + 0.02);
  }

  private noiseSample(): AudioBuffer {
    if (this.noiseBuffer) return this.noiseBuffer;
    const length = Math.floor(this.ctx.sampleRate * 0.2);
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buffer;
    return buffer;
  }
}
