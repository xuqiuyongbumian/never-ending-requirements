import { AUDIO_SLIDERS, type AudioSettings } from "../audio/audio-settings";

export interface AudioPanelHandlers {
  onChange: (patch: Partial<AudioSettings>) => void;
  onPreview?: () => void;
}

let detachDocumentListeners: (() => void) | null = null;

function percent(value: number): number {
  return Math.round(Math.max(0, Math.min(1, value)) * 100);
}

export function audioPanelMarkup(settings: AudioSettings): string {
  const rows = AUDIO_SLIDERS.map(({ channel, label, hint }) => `
    <label class="audio-row" for="audio-${channel}">
      <span class="audio-row-copy"><b>${label}</b><small>${hint}</small></span>
      <input type="range" id="audio-${channel}" data-audio-channel="${channel}" min="0" max="100" step="1"
        value="${percent(settings[channel])}" aria-label="${label}" aria-valuetext="${percent(settings[channel])}%">
    </label>`).join("");
  return `
    <div class="audio-control">
      <button class="icon-button audio-toggle" id="audio-toggle" type="button"
        aria-label="声音设置" aria-expanded="false" aria-controls="audio-panel" title="声音设置 · M 静音">♪</button>
      <section class="audio-panel" id="audio-panel" data-audio-panel hidden aria-label="声音设置">
        <header class="audio-panel-head">
          <span>声音</span>
          <button class="audio-mute" id="audio-mute" type="button" aria-pressed="false">静音</button>
        </header>
        ${rows}
        <p class="audio-panel-foot">配乐与音效均由浏览器实时合成，不含任何音频文件。</p>
      </section>
    </div>`;
}

export function syncAudioPanel(root: HTMLElement, settings: AudioSettings): void {
  for (const { channel } of AUDIO_SLIDERS) {
    const input = root.querySelector<HTMLInputElement>(`[data-audio-channel="${channel}"]`);
    if (!input) continue;
    const value = percent(settings[channel]);
    input.value = String(value);
    input.setAttribute("aria-valuetext", `${value}%`);
    input.style.setProperty("--audio-fill", `${value}%`);
  }
  const mute = root.querySelector<HTMLButtonElement>("#audio-mute");
  if (mute) {
    mute.setAttribute("aria-pressed", String(settings.muted));
    mute.textContent = settings.muted ? "取消静音" : "静音";
  }
  const toggle = root.querySelector<HTMLButtonElement>("#audio-toggle");
  if (toggle) {
    toggle.classList.toggle("is-muted", settings.muted);
    toggle.classList.toggle("is-off", settings.master <= 0);
    toggle.setAttribute("aria-label", settings.muted ? "声音设置，当前静音" : "声音设置");
  }
}

export function bindAudioPanel(root: HTMLElement, settings: () => AudioSettings, handlers: AudioPanelHandlers): void {
  const toggle = root.querySelector<HTMLButtonElement>("#audio-toggle");
  const panel = root.querySelector<HTMLElement>("[data-audio-panel]");
  if (!toggle || !panel) return;

  const setOpen = (open: boolean) => {
    panel.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    toggle.classList.toggle("is-open", open);
  };

  toggle.addEventListener("click", (event) => {
    event.stopPropagation();
    setOpen(panel.hidden !== false);
    handlers.onPreview?.();
  });

  panel.addEventListener("click", (event) => event.stopPropagation());

  // The HUD is re-rendered on every run; keep a single document listener pair.
  detachDocumentListeners?.();
  const onDocumentClick = () => setOpen(false);
  const onDocumentKeydown = (event: KeyboardEvent) => {
    if (event.key === "Escape") setOpen(false);
  };
  document.addEventListener("click", onDocumentClick);
  document.addEventListener("keydown", onDocumentKeydown);
  detachDocumentListeners = () => {
    document.removeEventListener("click", onDocumentClick);
    document.removeEventListener("keydown", onDocumentKeydown);
  };

  for (const input of root.querySelectorAll<HTMLInputElement>("[data-audio-channel]")) {
    const channel = input.dataset.audioChannel as keyof AudioSettings;
    const apply = () => {
      const value = Number(input.value) / 100;
      input.setAttribute("aria-valuetext", `${Math.round(value * 100)}%`);
      input.style.setProperty("--audio-fill", `${Math.round(value * 100)}%`);
      handlers.onChange({ [channel]: value });
    };
    input.addEventListener("input", apply);
  }

  root.querySelector<HTMLButtonElement>("#audio-mute")?.addEventListener("click", () => {
    handlers.onChange({ muted: !settings().muted });
    handlers.onPreview?.();
  });

  syncAudioPanel(root, settings());
}
