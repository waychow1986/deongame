export interface SeatPosition {
  seat: number;
  /** Percent of the table box width, 0 = left edge. */
  x: number;
  /** Percent of the table box height, 0 = top edge (screen coordinates). */
  y: number;
}

/**
 * TD-018: seats on the oval rim. Display index k = (seat − mySeat + capacity) % capacity and
 * angle θ = 90° + k·360°/capacity with y pointing down, so the viewer sits at the bottom and the
 * others follow clockwise in seat order. The oval's aspect ratio comes from the table box itself.
 */
export function seatLayout(capacity: number, mySeat: number | null): SeatPosition[] {
  const me = mySeat ?? 0;
  const out: SeatPosition[] = [];
  for (let seat = 0; seat < capacity; seat++) {
    const k = (seat - me + capacity) % capacity;
    const theta = ((90 + (k * 360) / capacity) * Math.PI) / 180;
    out.push({ seat, x: 50 + 50 * Math.cos(theta), y: 50 + 50 * Math.sin(theta) });
  }
  return out;
}

/** Portrait oval (3:4) below 600px width, landscape (2:1) otherwise. */
export function tableShape(width: number): 'landscape' | 'portrait' {
  return width < 600 ? 'portrait' : 'landscape';
}
