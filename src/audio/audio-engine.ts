import { ROUND_DURATION, type BattleState, type GameTelemetryEvent } from "../core/game";
import {
  DUCK_ATTACK_RATE,
  DUCK_LEVEL,
  DUCK_RELEASE_RATE,
  cueForEvent,
  settingToGain,
  type SfxCue
} from "./music-plan";
import {
  isMuted,
  loadAudioSettings,
  saveAudioSettings,
  type AudioSettings
} from "./audio-settings";
import { MusicPlayer } from "./music";
import { SfxPlayer } from "./sfx";

/**
 * Owns the Web Audio graph:
 *
 *   music -> musicVolume -> duck -> master -> limiter -> destination
 *   sfx  -------------------------> master
 *   ui   -------------------------> master
 *
 * The context is created lazily so nothing is allocated before a real user
 * gesture; browsers would otherwise leave it suspended and log a warning.
 */
export class AudioEngine {
  settings: AudioSettings;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private limiter: DynamicsCompressorNode | null = null;
  private musicVolume: GainNode | null = null;
  private duck: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private uiBus: GainNode | null = null;
  private music: MusicPlayer | null = null;
  private sfx: SfxPlayer | null = null;
  private lastEra = -1;
  private duckTarget = 1;
  private playing = false;

  constructor(settings: AudioSettings = loadAudioSettings()) {
    this.settings = settings;
  }

  get ready(): boolean {
    return this.playing;
  }

  /** Mirrors the reference `duck_gain`; handy for debugging and manual QA. */
  get duckGain(): number {
    return this.duckTarget;
  }

  get contextState(): AudioContextState | "unavailable" {
    return this.ctx?.state ?? "unavailable";
  }

  /** Must be called from a user gesture (the start button). */
  async unlock(): Promise<boolean> {
    if (!this.ctx) {
      const Context = typeof window === "undefined" ? undefined : window.AudioContext;
      if (!Context) return false;
      try {
        this.ctx = new Context();
      } catch {
        return false;
      }
      this.buildGraph(this.ctx);
    }
    try {
      if (this.ctx.state !== "running") await this.ctx.resume();
    } catch {
      return false;
    }
    this.playing = this.ctx.state === "running";
    if (this.playing) this.applySettings();
    return this.playing;
  }

  startMusic(era: number): void {
    if (!this.playing) return;
    this.lastEra = era;
    this.music?.start(era);
    // Replays may start in an earlier era than the previous run ended in.
    this.music?.setEra(era);
  }

  /** Called on every HUD tick: era, intensity and ducking all live here. */
  update(state: BattleState): void {
    if (!this.playing) return;
    if (state.techEra !== this.lastEra) {
      this.lastEra = state.techEra;
      this.music?.setEra(state.techEra);
    }
    this.music?.setMood({
      rush: state.shipItUntil > state.elapsed,
      incident: state.incidentUntil > state.elapsed,
      urgent: state.phase === "running" && ROUND_DURATION - state.elapsed <= 30
    });
    const quiet = Boolean(state.pendingEvent) || state.phase !== "running" || state.paused;
    this.setDuck(quiet ? DUCK_LEVEL : 1);
  }

  /** Menu and result screens keep the score alive, only the layers change. */
  setMusicMood(mood: { rush?: boolean; incident?: boolean; urgent?: boolean }): void {
    this.music?.setMood(mood);
  }

  handleTelemetry(events: readonly GameTelemetryEvent[]): void {
    if (!this.playing) return;
    for (const event of events) {
      const request = cueForEvent(event.type, event.detail);
      if (request) this.playCue(request.cue, { pan: request.pan });
    }
  }

  playCue(cue: SfxCue, options: { pan?: number; gain?: number } = {}): void {
    if (!this.playing || !this.sfx) return;
    const destination = cue === "ui_tick" ? this.uiBus : this.sfxBus;
    if (!destination) return;
    this.sfx.play(cue, destination, options);
  }

  setSettings(next: AudioSettings): void {
    this.settings = next;
    saveAudioSettings(next);
    this.applySettings();
  }

  setDuck(target: number): void {
    this.duckTarget = Math.max(0, Math.min(1, target));
    if (!this.ctx || !this.duck) return;
    const now = this.ctx.currentTime;
    const tau = this.duckTarget < 1 ? 1 / DUCK_ATTACK_RATE : 1 / DUCK_RELEASE_RATE;
    this.duck.gain.cancelScheduledValues(now);
    this.duck.gain.setTargetAtTime(this.duckTarget, now, tau);
  }

  suspend(): void {
    if (!this.ctx || this.ctx.state !== "running") return;
    void this.ctx.suspend().catch(() => undefined);
  }

  resume(): void {
    if (!this.ctx) return;
    void this.ctx
      .resume()
      .then(() => this.music?.resync())
      .catch(() => undefined);
  }

  dispose(): void {
    this.playing = false;
    this.music?.dispose();
    this.sfx?.dispose();
    this.music = null;
    this.sfx = null;
    this.master?.disconnect();
    this.limiter?.disconnect();
    this.musicVolume?.disconnect();
    this.duck?.disconnect();
    this.sfxBus?.disconnect();
    this.uiBus?.disconnect();
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
  }

  private buildGraph(ctx: AudioContext): void {
    const master = ctx.createGain();
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -8;
    limiter.knee.value = 6;
    limiter.ratio.value = 8;
    limiter.attack.value = 0.004;
    limiter.release.value = 0.18;

    const duck = ctx.createGain();
    const musicVolume = ctx.createGain();
    const sfxBus = ctx.createGain();
    const uiBus = ctx.createGain();

    musicVolume.connect(duck).connect(master);
    sfxBus.connect(master);
    uiBus.connect(master);
    master.connect(limiter).connect(ctx.destination);

    this.master = master;
    this.limiter = limiter;
    this.duck = duck;
    this.musicVolume = musicVolume;
    this.sfxBus = sfxBus;
    this.uiBus = uiBus;
    this.music = new MusicPlayer(ctx, musicVolume);
    this.sfx = new SfxPlayer(ctx);
  }

  private applySettings(): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const muted = isMuted(this.settings);
    this.master?.gain.setTargetAtTime(muted ? 0 : settingToGain(this.settings.master), now, 0.03);
    this.musicVolume?.gain.setTargetAtTime(settingToGain(this.settings.music), now, 0.03);
    this.sfxBus?.gain.setTargetAtTime(settingToGain(this.settings.sfx), now, 0.03);
    this.uiBus?.gain.setTargetAtTime(settingToGain(this.settings.ui), now, 0.03);
  }
}
