#!/usr/bin/env python3
"""Build the runtime 8x3 engineer sheets from supplied and generated source art.

Requires Pillow. This is an authoring script; normal npm build does not need it.
"""

from __future__ import annotations

from collections import deque
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
GENERATED = ROOT / "assets-inbox/generated-character-art/animation-sheets/source"
SUPPLIED_SHEETS = {
    "intern": GENERATED / "supplied-intern-sheet.png",
    "backend": GENERATED / "supplied-backend-sheet.png",
    "agent": GENERATED / "supplied-agent-sheet.png",
}
OUTPUT = ROOT / "public/assets/game/animations"
FRAME = 256
COLUMNS = 8
ROWS = 3
FRAME_MARGIN = 2
FRAME_SPACING = 2
SHEET_SIZE = (
    COLUMNS * FRAME + 2 * FRAME_MARGIN + (COLUMNS - 1) * FRAME_SPACING,
    ROWS * FRAME + 2 * FRAME_MARGIN + (ROWS - 1) * FRAME_SPACING,
)


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
    return [
        clear_small_edge_fragments(
            fit_frame(clear_small_edge_fragments(cell(image, index % columns, index // columns, columns, rows)))
        )
        for index in indices
    ]


def clear_small_edge_fragments(frame: Image.Image, edge: int = 32, max_area: int = 3000) -> Image.Image:
    """Remove small disconnected crop remnants around a frame's outer edge."""
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
            if area <= max_area and (
                max_x + 1 < edge
                or min_x >= width - edge
                or max_y + 1 < edge
                or min_y >= height - edge
            ):
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
        sheet.alpha_composite(
            frame,
            (FRAME_MARGIN + column * (FRAME + FRAME_SPACING), FRAME_MARGIN + row * (FRAME + FRAME_SPACING)),
        )


def assert_frames(name: str, sheet: Image.Image, counts: tuple[int, int, int]) -> None:
    if sheet.size != SHEET_SIZE:
        raise ValueError(f"{name}: expected a padded {SHEET_SIZE[0]}x{SHEET_SIZE[1]} sheet, got {sheet.size}")
    alpha = sheet.getchannel("A")
    for row, count in enumerate(counts):
        if not 4 <= count <= 8:
            raise ValueError(f"{name} row {row} has unsupported frame count {count}")
        for index in range(COLUMNS):
            left = FRAME_MARGIN + index * (FRAME + FRAME_SPACING)
            top = FRAME_MARGIN + row * (FRAME + FRAME_SPACING)
            frame_alpha = alpha.crop((left, top, left + FRAME, top + FRAME))
            if index < count and frame_alpha.getbbox() is None:
                raise ValueError(f"{name} row {row} frame {index} is empty")
            if index >= count and frame_alpha.getbbox() is not None:
                raise ValueError(f"{name} row {row} unused frame {index} is not transparent")
    for row in range(ROWS):
        top = FRAME_MARGIN + row * (FRAME + FRAME_SPACING)
        if alpha.crop((0, top, FRAME_MARGIN, top + FRAME)).getbbox() is not None:
            raise ValueError(f"{name} row {row} touches the left frame margin")
        if alpha.crop((SHEET_SIZE[0] - FRAME_MARGIN, top, SHEET_SIZE[0], top + FRAME)).getbbox() is not None:
            raise ValueError(f"{name} row {row} touches the right frame margin")
    for column in range(COLUMNS):
        left = FRAME_MARGIN + column * (FRAME + FRAME_SPACING)
        if alpha.crop((left, 0, left + FRAME, FRAME_MARGIN)).getbbox() is not None:
            raise ValueError(f"{name} column {column} touches the top frame margin")
        if alpha.crop((left, SHEET_SIZE[1] - FRAME_MARGIN, left + FRAME, SHEET_SIZE[1])).getbbox() is not None:
            raise ValueError(f"{name} column {column} touches the bottom frame margin")
    for column in range(COLUMNS - 1):
        left = FRAME_MARGIN + (column + 1) * FRAME + column * FRAME_SPACING
        if alpha.crop((left, 0, left + FRAME_SPACING, SHEET_SIZE[1])).getbbox() is not None:
            raise ValueError(f"{name} column {column} has a contaminated frame gutter")
    for row in range(ROWS - 1):
        top = FRAME_MARGIN + (row + 1) * FRAME + row * FRAME_SPACING
        if alpha.crop((0, top, SHEET_SIZE[0], top + FRAME_SPACING)).getbbox() is not None:
            raise ValueError(f"{name} row {row} has a contaminated frame gutter")


def assert_edge_filter() -> None:
    sample = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
    sample.paste((255, 0, 0, 255), (2, 20, 5, 40))
    sample.paste((0, 255, 0, 255), (20, 20, 44, 44))
    cleaned = clear_small_edge_fragments(sample)
    assert cleaned.getpixel((3, 25))[3] == 0
    assert cleaned.getpixel((30, 30))[3] == 255


def build() -> None:
    assert_edge_filter()
    OUTPUT.mkdir(parents=True, exist_ok=True)
    supplied = {
        role: Image.open(path).convert("RGBA")
        for role, path in SUPPLIED_SHEETS.items()
    }

    for role, source in supplied.items():
        if source.size != (COLUMNS * FRAME, 3 * FRAME):
            raise ValueError(f"{role}: expected a 2048x768 8x3 source sheet, got {source.size}")
        result = Image.new("RGBA", SHEET_SIZE, (0, 0, 0, 0))
        if role == "intern":
            counts = (6, 8, 6)
        elif role == "backend":
            counts = (6, 8, 6)
        else:
            counts = (6, 8, 6)
        for row, count in enumerate(counts):
            frames = [clear_small_edge_fragments(cell(source, column, row, COLUMNS, ROWS)) for column in range(count)]
            put_row(result, row, frames)
        assert_frames(role, result, counts)
        result.save(OUTPUT / f"{role}.png", optimize=True)

    frontend = Image.open(GENERATED / "frontend-mixed-candidate.png").convert("RGBA")
    frontend_work = Image.open(GENERATED / "frontend-work-candidate.png").convert("RGBA")
    tester = Image.open(GENERATED / "tester-mixed-candidate.png").convert("RGBA")
    tester_work = Image.open(GENERATED / "tester-work-candidate.png").convert("RGBA")

    generated = {
        "frontend": (frontend, frontend_work, (4, 7, 8)),
        "tester": (tester, tester_work, (4, 8, 8)),
    }
    for role, (mixed, work, counts) in generated.items():
        result = Image.new("RGBA", SHEET_SIZE, (0, 0, 0, 0))
        # Mixed sheet layout: 4 idle, up to 8 run, 4 work in a 4x4 grid.
        idle = numbered_grid(mixed, [0, 1, 2, 3], 4, 4)
        run = numbered_grid(mixed, list(range(4, 11 if role == "frontend" else 12)), 4, 4)
        # Dedicated work sheet: the first two rows are a full 8-pose work cycle.
        work_frames = numbered_grid(work, list(range(8)), 4, 4)
        if role == "tester":
            # The second source row carries the previous pose's shoe into its top edge.
            for index, frame in enumerate(work_frames[4:], start=4):
                frame.paste((0, 0, 0, 0), (0, 0, FRAME, 54))
                work_frames[index] = clear_small_edge_fragments(frame)
        put_row(result, 0, idle)
        put_row(result, 1, run)
        put_row(result, 2, work_frames)
        assert_frames(role, result, counts)
        result.save(OUTPUT / f"{role}.png", optimize=True)

    print(f"Wrote five validated {SHEET_SIZE[0]}x{SHEET_SIZE[1]} RGBA sprite sheets with gutters to {OUTPUT}")


if __name__ == "__main__":
    build()
