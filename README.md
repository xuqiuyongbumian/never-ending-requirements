# Epoch Rush Web

独立的浏览器版游戏项目，参考 `Evolutionary-history-of-war` 中的玩法与内容。原仓库保持不变。

## 技术栈

- Phaser 4：战场画面、场景和输入
- TypeScript：玩法逻辑
- Vite：本地开发与静态构建
- HTML/CSS：网页外壳与后续菜单界面

## 本地启动

```sh
npm install
npm run dev
```

运行 `npm run build` 可生成静态网页文件到 `dist/`。

当前已包含石器前线的可玩切片：可训练四种 A1 兵种、加速或暂停战斗，并通过摧毁敌方基地获胜。完整战役、英雄技能、时代演进和存档尚未实现。

兵种基础属性参考原仓库 `godot/assets/data/units.json`；A1 战场、兵种动画、基地、图标与特效选用原仓库对应素材。素材来源及许可边界见 [ASSETS.md](ASSETS.md)。

## 操作

- 点击兵种卡片，或按 `1`–`4` 训练单位
- 按 `Space` 暂停或继续
- 点击速度按钮切换 `1×` / `2×`
