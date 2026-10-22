# 游戏素材记录

运行时素材位于 `public/assets/game/`，由 `src/presentation/game-assets.ts` 映射给 Phaser 和 DOM HUD。初版素材包 `game_assets_pack.zip` 已从仓库移除；处理后的运行资源仍保留。新版素材包 `assets-inbox/needs_no_sleep_asset_bundle_v3.zip` 仍保留，因为精灵表脚本会从中读取实习生、后端和 Agent 的动作表。

| 内容 | 运行时资源 | 来源 |
| --- | --- | --- |
| 五类工程师立绘 | `characters/{intern,frontend,backend,tester,ai-agent}.webp` | intern、frontend、tester 使用项目修订稿；backend 和 agent 使用初版素材 |
| 工程师动作表 | `animations/{intern,frontend,backend,tester,agent}.png` | intern、backend、agent 来自 v3 角色表；frontend、tester 来自 `generated-character-art/animation-sheets/source/` 中的候选稿 |
| UI、API、功能需求图 | `tasks/{ui-task,api-task,feature-task}.webp` | v3 `04_tasks_ui_misc/01_task_characters_sheet.png` 裁切 |
| Bug 需求图 | `tasks/bug-task.webp` | 初版独立素材处理稿；初版压缩包未保留在仓库 |
| 三个时代背景 | `backgrounds/*.webp` | v3 `03_backgrounds/` 场景图 |
| HUD 图标 | `icons/*.webp` | v3 `04_tasks_ui_misc/03_ui_icons_sheet.png` 裁切 |

动作表为透明 PNG，尺寸 2048×768，按 8 列 × 3 行排列，每格 256×256。三行动作为 Idle、Run、Work；帧数分别为 intern 6/8/6、frontend 4/8/8、backend 6/8/6、tester 4/8/8、agent 6/8/6。播放帧率和源文件说明见 `assets-inbox/generated-character-art/animation-sheets/README.md`。运行时加载映射及动画配置见 `src/presentation/game-assets.ts`。

可用 Python 3 和 Pillow 运行 `python3 scripts/prepare-engineer-sprite-sheets.py` 重建动作表。脚本只在制作素材时需要；正常网页构建不需要 Pillow。

素材由用户提供，未附独立授权说明；提交前需确认素材使用权并按比赛规则补充署名。项目没有复用授权无法确认的参考仓库素材。
