# 游戏素材记录

本项目的角色、需求、时代背景和 HUD 图标来自用户提供的 `game_assets_pack.zip`。源压缩包保存在 `assets-inbox/game_assets_pack.zip`，WebP 裁切与压缩版本保存在 `public/assets/game/`。

| 内容 | 游戏资源 | 源文件 |
| --- | --- | --- |
| 实习生、前端、后端、测试、AI Agent | `characters/*.webp` | `02`、`01`、`03`、`04`、`05` 角色图 |
| UI、API、Bug、大型功能需求 | `tasks/*.webp` | `06_task_mascots_sheet.png` 裁切 |
| 手搓、工程化、Agent 时代背景 | `backgrounds/*.webp` | `07`、`08`、`09` 场景图 |
| 预算、经验、技术债、稳定度、事件图标 | `icons/*.webp` | `10_ui_icons_sheet.png` 裁切 |

`src/presentation/game-assets.ts` 是 Phaser 和 DOM HUD 共用的资源映射。角色和背景由 Phaser Loader 加载，HUD 图标由 DOM 图片引用。套图裁切保留 alpha 通道；角色和单图图标按长宽比等比缩小，背景按原始 16:9 比例裁切适配 1280×720。资源目前约 1.7 MB（WebP），未将图片编码进代码。

素材包未附独立授权说明，来源为用户提供。项目此前移除了参考仓库中授权无法确认的素材；本次没有复用那些素材。
