# 游戏素材记录

本项目的初版角色、需求与 HUD 图标来自用户提供的 `game_assets_pack.zip`。新版角色方向、需求图集和时代背景来自 `needs_no_sleep_asset_bundle_v3.zip`，源压缩包保存在 `assets-inbox/needs_no_sleep_asset_bundle_v3.zip`。运行时 WebP 位于 `public/assets/game/`。

| 内容 | 游戏资源 | 源文件 |
| --- | --- | --- |
| 五类工程师角色立绘 | `characters/{intern,frontend,backend,tester,ai-agent}.webp` | intern/frontend/tester 按 v3 角色方向修订；backend/agent 来自初版素材 |
| 角色图片规格 | 上述 5 张透明 WebP | intern/frontend/tester 为 1254×1254；backend/agent 为 768×768；当前分别按 120 / 132 逻辑像素图框等比显示 |
| 待机、跑动、工作动作 | Phaser Tween 驱动静态立绘，锚点 `(0.5, 1)` 对齐脚底 | 每个动作使用 1 张静态图，无逐帧帧率；Idle 900ms、Run 170ms、Work 390ms 往返缓动 |
| v3 动作表（未采用） | 未复制到运行时资源目录 | ZIP `02_character_sheets/` 下每角色 2048×768、8×3、256×256 格；行内有效帧数为 Idle 6、Run 8、Work 6。因未通过风格及角色一致性验收，不记录运行帧率或锚点 |
| UI、API、大型功能需求 | `tasks/ui-task.webp`、`api-task.webp`、`feature-task.webp` | v3 的 `04_tasks_ui_misc/01_task_characters_sheet.png` 裁切 |
| Bug 需求 | `tasks/bug-task.webp` | 初版独立透明素材；v3 图集该角色与相邻装饰重叠，保留完整旧裁切 |
| 手搓、工程化、Agent 时代背景 | `backgrounds/*.webp` | v3 的 `03_backgrounds/01`、`02`、`03` 场景图 |
| 预算、经验、技术债、稳定度、事件图标 | `icons/*.webp` | `10_ui_icons_sheet.png` 裁切 |

`src/presentation/game-assets.ts` 是 Phaser 和 DOM HUD 共用的资源映射。Phaser 在同一纹理映射中加载五种角色静态立绘、需求图和背景；角色在工作世界与招募卡使用相同身份素材，`src/presentation/battle-scene.ts` 按逻辑 Idle / Run / Work 状态套用轻量 Tween，并用 `(0.5, 1)` 对齐地面。每种状态目前只有 1 张静态图，没有逐帧 FPS。角色在同样的 120 逻辑像素基准下按原图长宽比缩放，AI Agent 为 132 像素。

v3 的 `02_character_sheets/` 角色表依据其 README 标记为“参考/过渡素材”，未作为生产资源接入。视觉检查发现人类角色动作表的像素感与高清办公室背景不统一，且实习生、前端、测试的发型和人体剪影相近，不能满足本项目的风格及辨识度要求。原图仍保留在用户提供的 ZIP 中供后续重制；正式接入前还需重做统一画风的帧表，并验证每帧身份、透明边界、脚底基线及游戏尺寸连续性。

需求图集中的 UI、API 和功能形象已裁切，Bug 形象因与相邻装饰重叠而保留初版完整透明图；背景按原始 16:9 比例适配 1280×720。所有资源仍以独立文件加载，没有编码进代码。

素材包未附独立授权说明，来源为用户提供。项目此前移除了参考仓库中授权无法确认的素材；本次没有复用那些素材。
