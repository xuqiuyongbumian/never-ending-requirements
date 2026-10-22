# Engineer animation sheet provenance

Runtime sheets live in `public/assets/game/animations/`. They are transparent RGBA PNGs, each 2048×768 pixels, arranged as 8 columns × 3 action rows with 256×256 cells. The actor faces right; the runtime origin is `(0.5, 1)` and each source cell is bottom-aligned by the preparation script.

| Role | Source | Idle frames / FPS | Run frames / FPS | Work frames / FPS |
| --- | --- | ---: | ---: | ---: |
| Intern | `needs_no_sleep_asset_bundle_v3.zip`, sheet 01 | 6 / 6 | 8 / 12 | 6 / 8 |
| Frontend | `source/frontend-mixed-candidate.png` + `source/frontend-work-candidate.png` | 4 / 6 | 8 / 12 | 8 / 8 |
| Backend | `needs_no_sleep_asset_bundle_v3.zip`, sheet 03 | 6 / 6 | 8 / 12 | 6 / 8 |
| Tester | `source/tester-mixed-candidate.png` + `source/tester-work-candidate.png` | 4 / 6 | 8 / 12 | 8 / 8 |
| AI Agent | `needs_no_sleep_asset_bundle_v3.zip`, sheet 05 | 6 / 7 | 8 / 14 | 6 / 10 |

Rows start at frame 0 (Idle), 8 (Run), and 16 (Work). Unused cells are transparent, never duplicate frames. The v3 Frontend and Tester sheets were excluded because they reuse the Intern-like character design; the generated alternatives are based on the project’s supplied individual Frontend and Tester illustrations. Small disconnected fragments from adjacent rows in the generated Tester sheets are removed by `scripts/prepare-engineer-sprite-sheets.py`; the source art remains unchanged here for review.

The source archive is retained at `assets-inbox/needs_no_sleep_asset_bundle_v3.zip`. Rebuild the normalized runtime sheets with Python 3 and Pillow:

```sh
python3 scripts/prepare-engineer-sprite-sheets.py
```

Static contact sheet for the current normalized frames: `assets-inbox/generated-character-art/animation-sheets/preview/engineer-frames-contact.jpg` (review aid; not a runtime dependency).
