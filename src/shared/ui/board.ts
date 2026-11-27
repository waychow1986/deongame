/** Display geometry of the chess board (design "几何约定"): a 9×10 grid of equal cells, aspect 9/10. */
export type Orientation = 'red-bottom' | 'black-bottom';

export const BOARD_COLS = 'abcdefghi';
/** SVG viewBox units per cell; intersections sit at cell centres (5, 15, …, 85 / 5, …, 95). */
export const CELL = 10;

export function orientationFor(yourColor: 'red' | 'black' | null | undefined): Orientation {
  return yourColor === 'black' ? 'black-bottom' : 'red-bottom';
}

/** Display column / row (0 = left / top) of a board position such as "a0". */
export function toDisplay(pos: string, orientation: Orientation): { c: number; r: number } {
  const col = BOARD_COLS.indexOf(pos[0] ?? '');
  const row = Number(pos.slice(1));
  return orientation === 'red-bottom' ? { c: col, r: 9 - row } : { c: 8 - col, r: row };
}

export function fromDisplay(c: number, r: number, orientation: Orientation): string {
  return orientation === 'red-bottom' ? `${BOARD_COLS[c]}${9 - r}` : `${BOARD_COLS[8 - c]}${r}`;
}

/** Intersection centre as a fraction of the board width and height. */
export function centreFraction(pos: string, orientation: Orientation): { x: number; y: number } {
  const { c, r } = toDisplay(pos, orientation);
  return { x: (c + 0.5) / 9, y: (r + 0.5) / 10 };
}

/** All 90 positions in display order (row by row from the top). */
export function displayOrder(orientation: Orientation): string[] {
  const out: string[] = [];
  for (let r = 0; r < 10; r += 1) for (let c = 0; c < 9; c += 1) out.push(fromDisplay(c, r, orientation));
  return out;
}

/** Pawn and cannon start points that get corner markers (FR-030). */
export const MARK_POSITIONS = ['a3', 'c3', 'e3', 'g3', 'i3', 'b2', 'h2', 'a6', 'c6', 'e6', 'g6', 'i6', 'b7', 'h7'];

/** SVG path for the corner markers around one intersection; the side on the board edge is omitted. */
export function markerPath(c: number, r: number): string {
  const x = c * CELL + CELL / 2;
  const y = r * CELL + CELL / 2;
  const gap = 1.25;
  const len = 2.5;
  const parts: string[] = [];
  for (const dx of [-1, 1]) {
    if ((dx < 0 && c === 0) || (dx > 0 && c === 8)) continue;
    for (const dy of [-1, 1]) {
      const cx = x + dx * gap;
      const cy = y + dy * gap;
      parts.push(`M${cx + dx * len} ${cy}L${cx} ${cy}L${cx} ${cy + dy * len}`);
    }
  }
  return parts.join('');
}
