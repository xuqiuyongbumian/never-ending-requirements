import "./style.css";
import { GameApp } from "./ui/app";

const overlay = document.querySelector<HTMLElement>("#overlay");
if (!overlay) throw new Error("Missing #overlay root");

if (import.meta.env.DEV && new URLSearchParams(location.search).has("animation-preview")) {
  void import("./presentation/animation-preview").then(({ mountAnimationPreview }) => mountAnimationPreview(overlay));
} else {
  new GameApp(overlay, async (updateHud) => {
    const [{ default: Phaser }, { BattleScene }] = await Promise.all([
      import("phaser"),
      import("./presentation/battle-scene")
    ]);
    const renderScale = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    const stage = document.querySelector<HTMLElement>("#stage");
    if (!stage) throw new Error("Missing #stage root");
    const syncPlayfieldBounds = () => {
      const rect = stage.querySelector("canvas")?.getBoundingClientRect();
      if (!rect) return;
      overlay.style.setProperty("--playfield-left", `${rect.left}px`);
      overlay.style.setProperty("--playfield-top", `${rect.top}px`);
      overlay.style.setProperty("--playfield-width", `${rect.width}px`);
      overlay.style.setProperty("--playfield-height", `${rect.height}px`);
    };
    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: "stage",
      width: 1280 * renderScale,
      height: 720 * renderScale,
      backgroundColor: "#191c31",
      scale: {
        // Keep the whole playfield visible at every aspect ratio. ENVELOP crops
        // the request entry and UI-safe lanes on non-16:9 desktop windows.
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH
      },
      scene: [BattleScene]
    });
    game.events.once("ready", syncPlayfieldBounds);
    game.scale.on(Phaser.Scale.Events.RESIZE, syncPlayfieldBounds);
    window.addEventListener("resize", syncPlayfieldBounds);
    document.addEventListener("fullscreenchange", syncPlayfieldBounds);
    new ResizeObserver(syncPlayfieldBounds).observe(stage);
    game.registry.set("updateHud", updateHud);
    return game;
  });
}
