import "./style.css";
import { GameApp } from "./ui/app";

const overlay = document.querySelector<HTMLElement>("#overlay");
if (!overlay) throw new Error("Missing #overlay root");

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
    backgroundColor: "#111a20",
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH
    },
    scene: [BattleScene]
  });
  game.registry.set("updateHud", updateHud);
  return game;
});
