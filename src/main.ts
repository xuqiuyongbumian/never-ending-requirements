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
    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: "stage",
      width: 1280,
      height: 720,
      backgroundColor: "#191c31",
      scale: {
        // Keep the whole playfield visible at every aspect ratio. ENVELOP crops
        // the request entry and UI-safe lanes on non-16:9 desktop windows.
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH
      },
      scene: [BattleScene]
    });
    game.registry.set("updateHud", updateHud);
    return game;
  });
}
