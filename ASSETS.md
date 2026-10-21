# 游戏素材记录

本项目的初版角色、需求与 HUD 图标来自用户提供的 `game_assets_pack.zip`。新版角色方向、需求图集和时代背景来自 `needs_no_sleep_asset_bundle_v3.zip`，源压缩包保存在 `assets-inbox/needs_no_sleep_asset_bundle_v3.zip`。运行时 WebP 位于 `public/assets/game/`。

| 内容 | 游戏资源 | 源文件 |
| --- | --- | --- |
| 实习生、前端、测试 | `characters/intern.webp`、`frontend.webp`、`tester.webp` | `assets-inbox/generated-character-art/*.png`，按 v3 角色方向修订的静态立绘 |
| 后端、AI Agent | `characters/backend.webp`、`ai-agent.webp` | 初版素材包中的 `03_backend_engineer.png`、`05_ai_agent.png` |
| 五类角色的待机、跑动、工作动作 | `animations/{intern,frontend,backend,qa,agent}.webp` | v3 `02_character_sheets/` 的角色表，每表 6/8/6 帧 |
| UI、API、大型功能需求 | `tasks/ui-task.webp`、`api-task.webp`、`feature-task.webp` | v3 的 `04_tasks_ui_misc/01_task_characters_sheet.png` 裁切 |
| Bug 需求 | `tasks/bug-task.webp` | 初版独立透明素材；v3 图集该角色与相邻装饰重叠，保留完整旧裁切 |
| 手搓、工程化、Agent 时代背景 | `backgrounds/*.webp` | v3 的 `03_backgrounds/01`、`02`、`03` 场景图 |
| 预算、经验、技术债、稳定度、事件图标 | `icons/*.webp` | `10_ui_icons_sheet.png` 裁切 |

`src/presentation/game-assets.ts` 是 Phaser 和 DOM HUD 共用的资源映射。Phaser 加载需求、背景及五张角色动画图；DOM 招募卡继续使用独立角色头像。v3 角色表为 8 列 × 3 行、256×256 格，行分别是待机 6 帧、跑动 8 帧、工作 6 帧。处理时裁掉各格 1px 的表格线并补回透明边距，导出为质量 94、保留 alpha 的 WebP；Phaser 将行映射为 Idle / Run / Work 循环，并按游戏中的移动、工作状态切换。需求图集中的 UI、API 和功能形象已裁切，Bug 形象因与相邻装饰重叠而保留初版完整透明图；背景按原始 16:9 比例适配 1280×720。图片仍以独立资源加载，没有编码进代码。

素材包未附独立授权说明，来源为用户提供。项目此前移除了参考仓库中授权无法确认的素材；本次没有复用那些素材。
