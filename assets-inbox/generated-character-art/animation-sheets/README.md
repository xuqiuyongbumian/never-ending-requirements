# Engineer animation sheet provenance

Runtime sheets live in `public/assets/game/animations/`. They are transparent RGBA PNGs, each 2048×768 pixels, arranged as 8 columns × 3 action rows with 256×256 cells. The actor faces right; the runtime origin is `(0.5, 1)` and each source cell is bottom-aligned by the preparation script.

| Role | Source | Idle frames / FPS | Run frames / FPS | Work frames / FPS |
| --- | --- | ---: | ---: | ---: |
| Intern | `source/supplied-intern-sheet.png` | 6 / 6 | 8 / 14 | 6 / 8 |
| Frontend | `source/frontend-mixed-candidate.png` + `source/frontend-work-candidate.png` | 4 / 6 | 8 / 14 | 8 / 8 |
| Backend | `source/supplied-backend-sheet.png` | 6 / 6 | 8 / 14 | 6 / 8 |
| Tester | `source/tester-mixed-candidate.png` + `source/tester-work-candidate.png` | 4 / 6 | 8 / 14 | 8 / 8 |
| AI Agent | `source/supplied-agent-sheet.png` | 6 / 7 | 8 / 14 | 6 / 10 |

Rows start at frame 0 (Idle), 8 (Run), and 16 (Work). Unused cells are transparent, never duplicate frames. The v3 Frontend and Tester sheets were excluded because they reuse the Intern-like character design; the generated alternatives are based on the project’s supplied individual Frontend and Tester illustrations. Small disconnected row-edge fragments in generated Frontend and Tester sheets are removed by `scripts/prepare-engineer-sprite-sheets.py`; source art remains unchanged here for review.

The three supplied sheets needed to rebuild the runtime files are kept individually under `source/`; the full source archive was removed from Git history. Rebuild the normalized runtime sheets with Python 3 and Pillow:

```sh
python3 scripts/prepare-engineer-sprite-sheets.py
```

Static contact sheet for the current normalized frames: `assets-inbox/generated-character-art/animation-sheets/preview/engineer-frames-contact.jpg` (review aid; not a runtime dependency).
