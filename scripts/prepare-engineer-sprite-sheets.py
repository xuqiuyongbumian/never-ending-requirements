#!/usr/bin/env python3
"""Build the runtime 8x3 engineer sheets from supplied and generated source art.

Requires Pillow. This is an authoring script; normal npm build does not need it.
"""

from __future__ import annotations

from io import BytesIO
from collections import deque
from pathlib import Path
import zipfile

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
INPUT_ZIP = ROOT / "assets-inbox/needs_no_sleep_asset_bundle_v3.zip"
GENERATED = ROOT / "assets-inbox/generated-character-art/animation-sheets/source"
OUTPUT = ROOT / "public/assets/game/animations"
FRAME = 256
COLUMNS = 8


def read_zip_image(archive: zipfile.ZipFile, member: str) -> Image.Image:
    return Image.open(BytesIO(archive.read(member))).convert("RGBA")


def cell(image: Image.Image, column: int, row: int, columns: int, rows: int) -> Image.Image:
    left = round(column * image.width / columns)
    right = round((column + 1) * image.width / columns)
    top = round(row * image.height / rows)
    bottom = round((row + 1) * image.height / rows)
    return image.crop((left, top, right, bottom))


def fit_frame(source: Image.Image) -> Image.Image:
    """Fit one source cell without stretching, preserving transparency and foot baseline."""
    scale = min(FRAME / source.width, FRAME / source.height)
    width = max(1, round(source.width * scale))
    height = max(1, round(source.height * scale))
    resized = source.resize((width, height), Image.Resampling.LANCZOS)
    result = Image.new("RGBA", (FRAME, FRAME), (0, 0, 0, 0))
    result.alpha_composite(resized, ((FRAME - width) // 2, FRAME - height))
    return result


def numbered_grid(
    image: Image.Image,
    indices: list[int],
    columns: int,
    rows: int,
) -> list[Image.Image]:
    return [fit_frame(cell(image, index % columns, index // columns, columns, rows)) for index in indices]


def clear_small_top_seams(frame: Image.Image, top_limit: int, max_area: int = 2500) -> Image.Image:
    """Remove detached fragments from adjacent rows in generated concept sheets."""
    alpha = frame.getchannel("A")
    pixels = alpha.load()
    width, height = frame.size
    seen = bytearray(width * height)
    seam_boxes: list[tuple[int, int, int, int]] = []
    for y in range(height):
        for x in range(width):
            index = y * width + x
            if seen[index] or pixels[x, y] < 16:
                continue
            queue = deque([(x, y)])
            seen[index] = 1
            min_x = max_x = x
            min_y = max_y = y
            area = 0
            while queue:
                current_x, current_y = queue.popleft()
                area += 1
                min_x = min(min_x, current_x)
                max_x = max(max_x, current_x)
                min_y = min(min_y, current_y)
                max_y = max(max_y, current_y)
                for neighbor_y in range(max(0, current_y - 1), min(height, current_y + 2)):
                    for neighbor_x in range(max(0, current_x - 1), min(width, current_x + 2)):
                        neighbor = neighbor_y * width + neighbor_x
                        if not seen[neighbor] and pixels[neighbor_x, neighbor_y] >= 16:
                            seen[neighbor] = 1
                            queue.append((neighbor_x, neighbor_y))
            if min_y < top_limit and area <= max_area and max_y < top_limit:
                seam_boxes.append((min_x, min_y, max_x + 1, max_y + 1))

    if not seam_boxes:
        return frame
    cleaned = frame.copy()
    cleaned_alpha = cleaned.getchannel("A")
    draw = Image.new("L", frame.size, 0)
    # The isolated source fragments are fully outside the main silhouette. Clear their
    # connected-component bounds, including low-alpha antialias pixels around the seam.
    from PIL import ImageDraw

    mask = ImageDraw.Draw(draw)
    for box in seam_boxes:
        mask.rectangle(box, fill=255)
    cleaned_alpha.paste(0, mask=draw)
    cleaned.putalpha(cleaned_alpha)
    return cleaned


def put_row(sheet: Image.Image, row: int, frames: list[Image.Image]) -> None:
    if not 1 <= len(frames) <= COLUMNS:
        raise ValueError(f"row {row} has invalid frame count: {len(frames)}")
    for column, frame in enumerate(frames):
        sheet.alpha_composite(frame, (column * FRAME, row * FRAME))


def assert_frames(name: str, sheet: Image.Image, counts: tuple[int, int, int]) -> None:
    for row, count in enumerate(counts):
        if not 4 <= count <= 8:
            raise ValueError(f"{name} row {row} has unsupported frame count {count}")
        alpha = sheet.getchannel("A")
        for index in range(COLUMNS):
            frame_alpha = alpha.crop((index * FRAME, row * FRAME, (index + 1) * FRAME, (row + 1) * FRAME))
            if index < count and frame_alpha.getbbox() is None:
                raise ValueError(f"{name} row {row} frame {index} is empty")
            if index >= count and frame_alpha.getbbox() is not None:
                raise ValueError(f"{name} row {row} unused frame {index} is not transparent")


def build() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(INPUT_ZIP) as archive:
        supplied = {
            "intern": read_zip_image(archive, "needs_no_sleep_asset_bundle_v3/02_character_sheets/01_intern_current_sprite_sheet.png"),
            "backend": read_zip_image(archive, "needs_no_sleep_asset_bundle_v3/02_character_sheets/03_backend_current_sprite_sheet.png"),
            "agent": read_zip_image(archive, "needs_no_sleep_asset_bundle_v3/02_character_sheets/05_ai_agent_current_sprite_sheet.png"),
        }

    for role, source in supplied.items():
        if source.size != (COLUMNS * FRAME, 3 * FRAME):
            raise ValueError(f"{role}: expected a 2048x768 8x3 source sheet, got {source.size}")
        result = Image.new("RGBA", (COLUMNS * FRAME, 3 * FRAME), (0, 0, 0, 0))
        if role == "intern":
            counts = (6, 8, 6)
        elif role == "backend":
            counts = (6, 8, 6)
        else:
            counts = (6, 8, 6)
        for row, count in enumerate(counts):
            frames = [cell(source, column, row, COLUMNS, 3) for column in range(count)]
            put_row(result, row, frames)
        assert_frames(role, result, counts)
        result.save(OUTPUT / f"{role}.png", optimize=True)

    frontend = Image.open(GENERATED / "frontend-mixed-candidate.png").convert("RGBA")
    frontend_work = Image.open(GENERATED / "frontend-work-candidate.png").convert("RGBA")
    tester = Image.open(GENERATED / "tester-mixed-candidate.png").convert("RGBA")
    tester_work = Image.open(GENERATED / "tester-work-candidate.png").convert("RGBA")

    generated = {
        "frontend": (frontend, frontend_work, (4, 8, 8)),
        "tester": (tester, tester_work, (4, 8, 8)),
    }
    for role, (mixed, work, counts) in generated.items():
        result = Image.new("RGBA", (COLUMNS * FRAME, 3 * FRAME), (0, 0, 0, 0))
        # Mixed sheet layout: 4 idle, 8 run, 4 work in a 4x4 grid.
        idle = numbered_grid(mixed, [0, 1, 2, 3], 4, 4)
        run = numbered_grid(mixed, list(range(4, 12)), 4, 4)
        # Dedicated work sheet: the first two rows are a full 8-pose work cycle.
        work_frames = numbered_grid(work, list(range(8)), 4, 4)
        if role == "tester":
            run = [clear_small_top_seams(frame, 26) for frame in run]
            work_frames = [
                clear_small_top_seams(frame, 60) if index >= 4 else frame
                for index, frame in enumerate(work_frames)
            ]
        put_row(result, 0, idle)
        put_row(result, 1, run)
        put_row(result, 2, work_frames)
        assert_frames(role, result, counts)
        result.save(OUTPUT / f"{role}.png", optimize=True)

    print(f"Wrote five validated 2048x768 RGBA sprite sheets to {OUTPUT}")


if __name__ == "__main__":
    build()
