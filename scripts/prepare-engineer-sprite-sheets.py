#!/usr/bin/env python3
"""Build overlap-aware runtime sprite sheets from supplied and generated source art.

Requires Pillow. This is an authoring script; normal npm build does not need it.
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter


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
FRAME_PADDING = 4
COMPONENT_ALPHA = 64
MIN_COMPONENT_AREA = 8
SHEET_SIZE = (
    COLUMNS * FRAME + 2 * FRAME_MARGIN + (COLUMNS - 1) * FRAME_SPACING,
    ROWS * FRAME + 2 * FRAME_MARGIN + (ROWS - 1) * FRAME_SPACING,
)


def extract_grid_frames(
    image: Image.Image,
    indices: list[int],
    columns: int,
    rows: int,
) -> list[dict[str, object]]:
    """Group complete alpha components by their nearest source-cell centre."""
    image = image.convert("RGBA")
    width, height = image.size
    alpha = image.getchannel("A").tobytes()
    parents: list[int] = []
    runs: list[tuple[int, int, int, int]] = []
    previous: list[tuple[int, int, int]] = []

    def find(label: int) -> int:
        while parents[label] != label:
            parents[label] = parents[parents[label]]
            label = parents[label]
        return label

    def union(left: int, right: int) -> None:
        left, right = find(left), find(right)
        if left != right:
            parents[right] = left

    for y in range(height):
        row = alpha[y * width:(y + 1) * width]
        current: list[tuple[int, int, int]] = []
        x = 0
        while x < width:
            while x < width and row[x] < COMPONENT_ALPHA:
                x += 1
            if x == width:
                break
            left = x
            while x < width and row[x] >= COMPONENT_ALPHA:
                x += 1
            right = x
            label = len(parents)
            parents.append(label)
            for previous_left, previous_right, previous_label in previous:
                if previous_right >= left and previous_left <= right:
                    union(label, previous_label)
            current.append((left, right, label))
            runs.append((left, right, y, label))
        previous = current

    components: dict[int, dict[str, object]] = {}
    for left, right, y, label in runs:
        root = find(label)
        width_run = right - left
        component = components.setdefault(root, {
            "bounds": [left, y, right, y + 1], "area": 0, "sum_x": 0, "sum_y": 0, "runs": []
        })
        bounds = component["bounds"]
        assert isinstance(bounds, list)
        bounds[0] = min(bounds[0], left)
        bounds[1] = min(bounds[1], y)
        bounds[2] = max(bounds[2], right)
        bounds[3] = max(bounds[3], y + 1)
        component["area"] = int(component["area"]) + width_run
        component["sum_x"] = int(component["sum_x"]) + width_run * (left + right - 1) // 2
        component["sum_y"] = int(component["sum_y"]) + width_run * y
        component_runs = component["runs"]
        assert isinstance(component_runs, list)
        component_runs.append((left, right, y))

    requested = set(indices)
    grouped: dict[int, list[dict[str, object]]] = {index: [] for index in indices}
    for component in components.values():
        area = int(component["area"])
        if area < MIN_COMPONENT_AREA:
            continue
        bounds = component["bounds"]
        assert isinstance(bounds, list)
        cell_width, cell_height = width / columns, height / rows
        if bounds[2] - bounds[0] > cell_width * 1.4 or bounds[3] - bounds[1] > cell_height * 1.4:
            split: dict[int, dict[str, object]] = {}
            component_runs = component["runs"]
            assert isinstance(component_runs, list)
            for run_left, run_right, y in component_runs:
                row = min(rows - 1, int(y * rows / height))
                x = run_left
                while x < run_right:
                    column = min(columns - 1, int(x * columns / width))
                    boundary = round((column + 1) * width / columns)
                    end = min(run_right, boundary)
                    index = row * columns + column
                    if index in requested:
                        piece = split.setdefault(index, {"bounds": [x, y, end, y + 1], "runs": []})
                        piece_bounds = piece["bounds"]
                        assert isinstance(piece_bounds, list)
                        piece_bounds[0] = min(piece_bounds[0], x)
                        piece_bounds[1] = min(piece_bounds[1], y)
                        piece_bounds[2] = max(piece_bounds[2], end)
                        piece_bounds[3] = max(piece_bounds[3], y + 1)
                        piece_runs = piece["runs"]
                        assert isinstance(piece_runs, list)
                        piece_runs.append((x, end, y))
                    x = end
            for index, piece in split.items():
                grouped[index].append(piece)
            continue
        center_x = int(component["sum_x"]) / area
        center_y = int(component["sum_y"]) / area
        column = min(columns - 1, int(center_x * columns / width))
        row = min(rows - 1, int(center_y * rows / height))
        index = row * columns + column
        if index in requested:
            grouped[index].append(component)

    frames: list[dict[str, object]] = []
    for index in indices:
        pieces = grouped[index]
        if not pieces:
            raise ValueError(f"source grid frame {index} has no visible character components")
        left = min(piece["bounds"][0] for piece in pieces)
        top = min(piece["bounds"][1] for piece in pieces)
        right = max(piece["bounds"][2] for piece in pieces)
        bottom = max(piece["bounds"][3] for piece in pieces)
        crop_box = (
            max(0, left - 2), max(0, top - 2),
            min(width, right + 2), min(height, bottom + 2),
        )
        crop = image.crop(crop_box)
        mask = Image.new("L", crop.size, 0)
        draw = ImageDraw.Draw(mask)
        for piece in pieces:
            piece_runs = piece["runs"]
            assert isinstance(piece_runs, list)
            for run_left, run_right, y in piece_runs:
                draw.line(
                    (run_left - crop_box[0], y - crop_box[1], run_right - 1 - crop_box[0], y - crop_box[1]),
                    fill=255,
                )
        mask = mask.filter(ImageFilter.MaxFilter(3))
        crop.putalpha(ImageChops.multiply(crop.getchannel("A"), mask))
        cell_column, cell_row = index % columns, index // columns
        frames.append({
            "image": crop,
            "bounds": crop_box,
            "center_x": (cell_column + 0.5) * width / columns,
        })
    return frames


def fit_frames(frames: list[dict[str, object]]) -> list[Image.Image]:
    """Apply one scale per role, recovering overlaps while keeping a stable anchor."""
    max_half_width = 0.0
    max_height = 0.0
    for frame in frames:
        left, top, right, bottom = frame["bounds"]
        center_x = float(frame["center_x"])
        max_half_width = max(max_half_width, center_x - left, right - center_x)
        max_height = max(max_height, bottom - top)
    scale = min(
        (FRAME - FRAME_PADDING * 2) / (max_half_width * 2),
        (FRAME - FRAME_PADDING * 2) / max_height,
    )
    result: list[Image.Image] = []
    for frame in frames:
        crop = frame["image"]
        left, top, right, bottom = frame["bounds"]
        width = max(1, round(crop.width * scale))
        height = max(1, round(crop.height * scale))
        resized = crop.resize((width, height), Image.Resampling.LANCZOS)
        destination_x = round(FRAME / 2 + (left - float(frame["center_x"])) * scale)
        destination_y = FRAME - FRAME_PADDING - height
        normalized = Image.new("RGBA", (FRAME, FRAME), (0, 0, 0, 0))
        normalized.alpha_composite(resized, (destination_x, destination_y))
        result.append(normalized)
    return result


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
            bounds = frame_alpha.getbbox()
            if index < count and bounds is None:
                raise ValueError(f"{name} row {row} frame {index} is empty")
            if index < count and bounds is not None and (
                bounds[0] < FRAME_PADDING - 1
                or bounds[1] < FRAME_PADDING - 1
                or bounds[2] > FRAME - FRAME_PADDING + 1
                or bounds[3] > FRAME - FRAME_PADDING + 1
            ):
                raise ValueError(f"{name} row {row} frame {index} is clipped at its cell edge: {bounds}")
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


def assert_component_cropping() -> None:
    horizontal = Image.new("RGBA", (200, 100), (0, 0, 0, 0))
    draw = ImageDraw.Draw(horizontal)
    draw.rectangle((64, 20, 111, 80), fill=(255, 0, 0, 255))
    draw.rectangle((120, 20, 176, 80), fill=(0, 0, 255, 255))
    frames = extract_grid_frames(horizontal, [0, 1], 2, 1)
    assert frames[0]["bounds"][2] > 100
    for frame, expected in zip(frames, ("red", "blue")):
        data = frame["image"].tobytes()
        pixels = [data[index:index + 4] for index in range(0, len(data), 4) if data[index + 3] >= COMPONENT_ALPHA]
        if expected == "red":
            assert pixels and all(pixel[0] > pixel[2] and pixel[1] < pixel[0] for pixel in pixels)
        else:
            assert pixels and all(pixel[2] > pixel[0] and pixel[1] < pixel[2] for pixel in pixels)

    vertical = Image.new("RGBA", (100, 200), (0, 0, 0, 0))
    draw = ImageDraw.Draw(vertical)
    draw.rectangle((20, 50, 50, 130), fill=(0, 255, 0, 255))
    draw.rectangle((20, 90, 50, 190), fill=(0, 255, 0, 255))
    split_frames = extract_grid_frames(vertical, [0, 1], 1, 2)
    assert split_frames[0]["bounds"][3] <= 102
    assert split_frames[1]["bounds"][1] >= 98


def build() -> None:
    assert_component_cropping()
    OUTPUT.mkdir(parents=True, exist_ok=True)
    supplied = {
        role: Image.open(path).convert("RGBA")
        for role, path in SUPPLIED_SHEETS.items()
    }

    for role, source in supplied.items():
        if source.size != (COLUMNS * FRAME, 3 * FRAME):
            raise ValueError(f"{role}: expected a 2048x768 8x3 source sheet, got {source.size}")
        counts = (6, 8, 6)
        extracted = [
            frame
            for row, count in enumerate(counts)
            for frame in extract_grid_frames(source, list(range(row * COLUMNS, row * COLUMNS + count)), COLUMNS, ROWS)
        ]
        frames = fit_frames(extracted)
        result = Image.new("RGBA", SHEET_SIZE, (0, 0, 0, 0))
        offset = 0
        for row, count in enumerate(counts):
            put_row(result, row, frames[offset:offset + count])
            offset += count
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
        idle = extract_grid_frames(mixed, list(range(4)), 4, 4)
        run = extract_grid_frames(mixed, list(range(4, 11 if role == "frontend" else 12)), 4, 4)
        work_frames = extract_grid_frames(work, list(range(8)), 4, 4)
        frames = fit_frames([*idle, *run, *work_frames])
        result = Image.new("RGBA", SHEET_SIZE, (0, 0, 0, 0))
        put_row(result, 0, frames[:counts[0]])
        put_row(result, 1, frames[counts[0]:counts[0] + counts[1]])
        put_row(result, 2, frames[counts[0] + counts[1]:])
        assert_frames(role, result, counts)
        result.save(OUTPUT / f"{role}.png", optimize=True)

    print(f"Wrote five validated {SHEET_SIZE[0]}x{SHEET_SIZE[1]} RGBA sprite sheets with gutters to {OUTPUT}")


if __name__ == "__main__":
    build()
