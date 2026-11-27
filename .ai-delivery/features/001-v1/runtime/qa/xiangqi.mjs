// Independent jieqi (blind xiangqi) rules oracle built from the spec, used to judge moves on public boards.
export const COLS = 'abcdefghi';
export const toXY = (p) => [COLS.indexOf(p[0]), Number(p[1])];
export const toPos = (x, y) => COLS[x] + y;
const inBoard = (x, y) => x >= 0 && x < 9 && y >= 0 && y < 10;

export function startType(pos) {
  const [x, y] = toXY(pos);
  if (y === 0 || y === 9) return ['rook', 'horse', 'elephant', 'advisor', 'king', 'advisor', 'elephant', 'horse', 'rook'][x];
  if ((y === 2 || y === 7) && (x === 1 || x === 7)) return 'cannon';
  if ((y === 3 || y === 6) && x % 2 === 0) return 'pawn';
  return null;
}
export const START_POSITIONS = (() => {
  const r = { red: [], black: [] };
  for (let x = 0; x < 9; x++) for (let y = 0; y < 10; y++) {
    const p = toPos(x, y);
    if (startType(p) && startType(p) !== 'king') (y <= 4 ? r.red : r.black).push(p);
  }
  return r;
})();

// board: Map pos -> {side, piece}  (piece 'hidden' or actual type)
export function boardFromSnapshot(chess) {
  const m = new Map();
  for (const c of chess.board) m.set(c.pos, { side: c.side, piece: c.piece });
  return m;
}
const inPalace = (side, x, y) => x >= 3 && x <= 5 && (side === 'red' ? y <= 2 : y >= 7);
const ownHalf = (side, y) => (side === 'red' ? y <= 4 : y >= 5);

function moveType(board, pos) {
  const pc = board.get(pos);
  if (!pc) return null;
  return pc.piece === 'hidden' ? { type: startType(pos), hidden: true } : { type: pc.piece, hidden: false };
}

// Pseudo-legal targets (ignores own-king safety)
export function pseudoTargets(board, pos) {
  const pc = board.get(pos);
  if (!pc) return [];
  const mt = moveType(board, pos);
  if (!mt || !mt.type) return [];
  const { type, hidden } = mt;
  const side = pc.side;
  const [x, y] = toXY(pos);
  const out = [];
  const add = (nx, ny) => {
    if (!inBoard(nx, ny)) return;
    const t = board.get(toPos(nx, ny));
    if (!t || t.side !== side) out.push(toPos(nx, ny));
  };
  const fwd = side === 'red' ? 1 : -1;
  switch (type) {
    case 'rook':
    case 'cannon':
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        let nx = x + dx, ny = y + dy, jumped = false;
        while (inBoard(nx, ny)) {
          const t = board.get(toPos(nx, ny));
          if (type === 'rook') {
            if (!t) out.push(toPos(nx, ny)); else { if (t.side !== side) out.push(toPos(nx, ny)); break; }
          } else if (!jumped) {
            if (!t) out.push(toPos(nx, ny)); else jumped = true;
          } else if (t) { if (t.side !== side) out.push(toPos(nx, ny)); break; }
          nx += dx; ny += dy;
        }
      }
      break;
    case 'horse':
      for (const [dx, dy, lx, ly] of [[1, 2, 0, 1], [-1, 2, 0, 1], [1, -2, 0, -1], [-1, -2, 0, -1], [2, 1, 1, 0], [2, -1, 1, 0], [-2, 1, -1, 0], [-2, -1, -1, 0]]) {
        if (inBoard(x + lx, y + ly) && !board.get(toPos(x + lx, y + ly))) add(x + dx, y + dy);
      }
      break;
    case 'elephant':
      for (const [dx, dy] of [[2, 2], [2, -2], [-2, 2], [-2, -2]]) {
        const nx = x + dx, ny = y + dy;
        if (!inBoard(nx, ny)) continue;
        if (board.get(toPos(x + dx / 2, y + dy / 2))) continue;
        if (hidden && !ownHalf(side, ny)) continue;
        add(nx, ny);
      }
      break;
    case 'advisor':
      for (const [dx, dy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (hidden && !inPalace(side, nx, ny)) continue;
        add(nx, ny);
      }
      break;
    case 'king':
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (inPalace(side, x + dx, y + dy)) add(x + dx, y + dy);
      }
      break;
    case 'pawn':
      add(x, y + fwd);
      if (!ownHalf(side, y)) { add(x + 1, y); add(x - 1, y); }
      break;
    default:
  }
  return out;
}

function kingPos(board, side) {
  for (const [p, pc] of board) if (pc.side === side && pc.piece === 'king') return p;
  return null;
}
export function isAttacked(board, side) {
  const kp = kingPos(board, side);
  if (!kp) return true;
  const opp = side === 'red' ? 'black' : 'red';
  for (const [p, pc] of board) {
    if (pc.side !== opp) continue;
    if (pseudoTargets(board, p).includes(kp)) return true;
  }
  // flying kings
  const ok = kingPos(board, opp);
  if (ok && ok[0] === kp[0]) {
    const [x, y1] = toXY(kp); const y2 = toXY(ok)[1];
    let blocked = false;
    for (let y = Math.min(y1, y2) + 1; y < Math.max(y1, y2); y++) if (board.get(toPos(x, y))) { blocked = true; break; }
    if (!blocked) return true;
  }
  return false;
}
export function applyMove(board, from, to) {
  const b = new Map(board);
  b.set(to, b.get(from));
  b.delete(from);
  return b;
}
export function isLegal(board, side, from, to) {
  const pc = board.get(from);
  if (!pc || pc.side !== side) return false;
  if (!pseudoTargets(board, from).includes(to)) return false;
  return !isAttacked(applyMove(board, from, to), side);
}
export function legalMoves(board, side) {
  const out = [];
  for (const [p, pc] of board) {
    if (pc.side !== side) continue;
    for (const t of pseudoTargets(board, p)) if (!isAttacked(applyMove(board, p, t), side)) out.push([p, t]);
  }
  return out;
}
// Targets for an explicit type ignoring hidden-ness (used to build "by position type" vs "by identity" moves)
export function targetsAsType(board, pos, type, hidden) {
  const b = new Map(board);
  const pc = b.get(pos);
  b.set(pos, { side: pc.side, piece: hidden ? 'hidden' : type });
  if (hidden) {
    // emulate a hidden piece of given type: only valid when type equals startType(pos)
    if (startType(pos) !== type) return [];
  }
  return pseudoTargets(b, pos);
}
export const STD_COUNTS = { rook: 2, horse: 2, elephant: 2, advisor: 2, cannon: 2, pawn: 5 };
