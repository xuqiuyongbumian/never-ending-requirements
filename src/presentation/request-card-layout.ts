export interface RequestCardLayoutItem {
  id: number;
  anchorX: number;
  width: number;
  height: number;
  isBoss?: boolean;
  prioritized?: boolean;
}

export interface RequestCardLayoutOptions {
  viewportWidth: number;
  safeTop: number;
  safeBottom: number;
  horizontalMargin?: number;
  horizontalGap?: number;
  verticalGap?: number;
}

export interface RequestCardPosition {
  x: number;
  y: number;
}

export interface RequestCardLayout {
  positions: Map<number, RequestCardPosition>;
  overflowIds: number[];
}

interface PlacedCard extends RequestCardLayoutItem {
  x: number;
}

interface Row {
  height: number;
  cards: PlacedCard[];
}

export function layoutRequestCards(
  items: readonly RequestCardLayoutItem[],
  options: RequestCardLayoutOptions
): RequestCardLayout {
  const margin = options.horizontalMargin ?? 12;
  const horizontalGap = options.horizontalGap ?? 12;
  const verticalGap = options.verticalGap ?? 8;
  const rows: Row[] = [];
  const positions = new Map<number, RequestCardPosition>();
  const overflowIds: number[] = [];
  const ordered = [...items].sort((a, b) => Number(b.isBoss === true) - Number(a.isBoss === true)
    || Number(b.prioritized === true) - Number(a.prioritized === true)
    || a.id - b.id);

  for (const item of ordered) {
    let placement: { rowIndex: number; x: number; distance: number } | null = null;
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex]!;
      const grownHeight = Math.max(row.height, item.height);
      const extraHeight = grownHeight - row.height;
      if (!fitsVertically(rows, options, verticalGap, extraHeight)) continue;
      const x = nearestFreeX(item.anchorX, item.width, row.cards, options.viewportWidth, margin, horizontalGap);
      if (x === null) continue;
      const distance = Math.abs(x - item.anchorX);
      if (!placement || distance < placement.distance) placement = { rowIndex, x, distance };
    }

    if (placement) {
      const row = rows[placement.rowIndex]!;
      row.height = Math.max(row.height, item.height);
      row.cards.push({ ...item, x: placement.x });
      continue;
    }

    if (fitsVertically(rows, options, verticalGap, item.height, true)) {
      const rowIndex = rows.length;
      const x = nearestFreeX(item.anchorX, item.width, [], options.viewportWidth, margin, horizontalGap);
      if (x !== null) {
        rows.push({ height: item.height, cards: [{ ...item, x }] });
        continue;
      }
    }

    overflowIds.push(item.id);
  }

  let y = options.safeTop;
  for (const row of rows) {
    const centerY = y + row.height / 2;
    for (const card of row.cards) positions.set(card.id, { x: card.x, y: centerY });
    y += row.height + verticalGap;
  }
  return { positions, overflowIds };
}

function fitsVertically(rows: readonly Row[], options: RequestCardLayoutOptions, gap: number, extraHeight: number, addRow = false): boolean {
  const usedHeight = rows.reduce((sum, row) => sum + row.height, 0) + Math.max(0, rows.length - 1) * gap;
  return usedHeight + extraHeight + (addRow && rows.length > 0 ? gap : 0) <= options.safeBottom - options.safeTop;
}

function nearestFreeX(
  anchorX: number,
  width: number,
  occupied: readonly PlacedCard[],
  viewportWidth: number,
  margin: number,
  gap: number
): number | null {
  const min = margin + width / 2;
  const max = viewportWidth - margin - width / 2;
  if (min > max) return null;
  const clamp = (value: number) => Math.max(min, Math.min(max, value));
  const candidates = [clamp(anchorX)];
  for (const card of occupied) {
    const offset = (card.width + width) / 2 + gap;
    candidates.push(card.x - offset, card.x + offset);
  }
  return candidates
    .filter((candidate) => candidate >= min && candidate <= max)
    .filter((candidate) => occupied.every((card) => Math.abs(candidate - card.x) >= (card.width + width) / 2 + gap - 0.01))
    .sort((a, b) => Math.abs(a - anchorX) - Math.abs(b - anchorX))[0] ?? null;
}
