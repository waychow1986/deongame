// TS-11 ~ TS-15, TS-17 ~ TS-23, TS-26 ~ TS-30: blind xiangqi (jieqi) through the public API (+ page checks where the plan asks).
import * as L from '../lib.mjs';
import * as X from '../xiangqi.mjs';

const { BASE } = L;
const NAMES = {
  red: { king: '帅', advisor: '仕', elephant: '相', horse: '马', rook: '车', cannon: '炮', pawn: '兵', hidden: '暗子' },
  black: { king: '将', advisor: '士', elephant: '象', horse: '马', rook: '车', cannon: '炮', pawn: '卒', hidden: '暗子' },
};
const SIDE_CN = { red: '红', black: '黑' };
const TYPES = ['king', 'advisor', 'elephant', 'horse', 'rook', 'cannon', 'pawn'];
const other = (s) => (s === 'red' ? 'black' : 'red');

export async function newGame(u1, u2) {
  await u1.leaveCurrent(); await u2.leaveCurrent();
  const r = await u1.createRoom('chess');
  if (r.status !== 201) throw new Error('create room failed ' + r.status);
  const id = r.body.room.roomId;
  const j = await u2.join(id);
  if (j.status !== 200) throw new Error('join failed ' + j.status);
  return id;
}
export async function startOnline(role = 'c') {
  const u1 = await L.newUser(role + 'R');
  const u2 = await L.newUser(role + 'B');
  const id = await newGame(u1, u2);
  return { u1, u2, id };
}
const chessOf = async (u, id) => { const s = await u.state(id); return s && s.chess; };
const boardSig = (c) => JSON.stringify([...c.board].sort((a, b) => (a.pos < b.pos ? -1 : 1)));

// Setup move the scenario depends on; throws if rejected.
async function must(u, id, from, to) {
  const r = await u.move(id, from, to);
  if (r.status !== 200) throw new Error(`setup move ${from}->${to} rejected: ${r.status} ${r.code}`);
  return r.body.room.chess;
}
// A legal, non-capturing move for `side` that avoids given squares and does not check the opponent.
function filler(board, side, avoid = () => false) {
  const opp = other(side);
  const ms = X.legalMoves(board, side).filter(([f, t]) => !avoid(f, t) && !board.get(t) && !X.isAttacked(X.applyMove(board, f, t), opp));
  const score = ([f, t]) => X.toXY(f)[0] + X.toXY(t)[0];
  ms.sort((a, b) => score(b) - score(a));
  return ms[0] || null;
}
async function playFiller(u, id, side, avoid) {
  const c = await chessOf(u, id);
  const mv = filler(X.boardFromSnapshot(c), side, avoid);
  if (!mv) throw new Error('no filler move');
  return must(u, id, mv[0], mv[1]);
}

async function boardButtons(page) {
  const g = page.getByRole('group', { name: '棋盘' });
  await g.waitFor({ timeout: L.WAIT_MS });
  await page.waitForTimeout(300);
  const btns = g.getByRole('button');
  const n = await btns.count();
  const names = [];
  for (let i = 0; i < n; i++) {
    const el = btns.nth(i);
    names.push(((await el.getAttribute('aria-label')) || (await el.innerText())).trim());
  }
  return names;
}
function expectedName(pos, cell) {
  if (!cell) return `${pos} 空`;
  return `${pos} ${SIDE_CN[cell.side]}${NAMES[cell.side][cell.piece]}`;
}
async function pageBoardMatches(page, chess) {
  const names = await boardButtons(page);
  const b = X.boardFromSnapshot(chess);
  const bad = [];
  for (let x = 0; x < 9; x++) for (let y = 0; y < 10; y++) {
    const p = X.toPos(x, y);
    const exp = expectedName(p, b.get(p));
    if (!names.includes(exp)) bad.push(exp);
  }
  return { ok: names.length === 90 && bad.length === 0, count: names.length, missing: bad.slice(0, 10) };
}
export async function clickMove(page, from, to) {
  const g = page.getByRole('group', { name: '棋盘' });
  await g.getByRole('button', { name: new RegExp(`^${from} `) }).click();
  await g.getByRole('button', { name: new RegExp(`^${to} `) }).click();
}

function checkLayout(chess) {
  const b = X.boardFromSnapshot(chess);
  const errs = [];
  const k1 = b.get('e0'), k2 = b.get('e9');
  if (!(k1 && k1.side === 'red' && k1.piece === 'king')) errs.push('e0 not red king');
  if (!(k2 && k2.side === 'black' && k2.piece === 'king')) errs.push('e9 not black king');
  for (const side of ['red', 'black']) for (const p of X.START_POSITIONS[side]) {
    const c = b.get(p);
    if (!(c && c.side === side && c.piece === 'hidden')) errs.push(`${p} expected ${side} hidden got ${JSON.stringify(c)}`);
  }
  if (chess.board.length !== 32) errs.push('board count ' + chess.board.length);
  for (const c of chess.board) if (c.piece === 'hidden' && Object.keys(c).sort().join() !== 'piece,pos,side') errs.push('extra keys at ' + c.pos);
  return errs;
}

// Deep-scan a room snapshot for any identity attached to a currently hidden position.
export function leakScan(room) {
  const ch = room && room.chess;
  if (!ch) return [];
  const hidden = new Set(ch.board.filter((c) => c.piece === 'hidden').map((c) => c.pos));
  const leaks = [];
  for (const c of ch.board) if (c.piece === 'hidden' && Object.keys(c).sort().join() !== 'piece,pos,side') leaks.push(`extra keys ${c.pos}`);
  const walk = (o, p) => {
    if (!o || typeof o !== 'object') return;
    if (!Array.isArray(o)) {
      const vals = Object.values(o).filter((v) => typeof v === 'string');
      const hp = vals.find((v) => hidden.has(v));
      const ty = vals.find((v) => TYPES.includes(v));
      if (hp && ty && !(p.startsWith('chess.board') && o.piece === 'hidden')) leaks.push(`${p}: ${JSON.stringify(o)}`);
    }
    for (const [k, v] of Object.entries(o)) walk(v, p ? `${p}.${k}` : k);
  };
  walk(room, '');
  return leaks;
}
const hiddenView = (ch) => JSON.stringify(ch.board.filter((c) => c.piece === 'hidden').sort((a, b) => (a.pos < b.pos ? -1 : 1)));

const part1 = [
  {
    id: 'TS-11',
    async fn(ctx) {
      const { u1, u2, id } = await startOnline('lay');
      for (const [u, label, color] of [[u1, 'U1(红)', 'red'], [u2, 'U2(黑)', 'black']]) {
        const c = await chessOf(u, id);
        const errs = checkLayout(c);
        ctx.cp(`${label} 读取状态：帅 e0、将 e9 翻开，30 枚盖棋在本方开局位置，其余为空`, errs.length === 0, errs.slice(0, 10));
        ctx.cp(`${label} 读取状态：轮到红方`, c.turn === 'red' && c.yourColor === color, { turn: c.turn, yourColor: c.yourColor });
        const page = await L.newPage(u);
        await page.goto(`${BASE}/room/${id}`);
        const m = await pageBoardMatches(page, c);
        ctx.cp(`${label} 页面：90 个位置按布局显示（帅/将、红暗子/黑暗子、空）`, m.ok, m);
        if (color === 'red') {
          const st = await page.getByRole('status', { name: '对局状态' }).innerText().catch(() => '');
          ctx.cp('U1 页面显示轮到你走棋', st.includes('轮到你走棋'), st);
        }
      }
    },
  },
  {
    id: 'TS-12',
    budgetMs: 240000,
    async fn(ctx) {
      const u1 = await L.newUser('shR'), u2 = await L.newUser('shB');
      const seqs = [];
      const red = ['a3', 'c3', 'e3', 'g3', 'i3'], black = ['a6', 'c6', 'e6', 'g6', 'i6'];
      for (let g = 0; g < 6; g++) {
        if (g === 3 && new Set(seqs).size > 1) break;
        const id = await newGame(u1, u2);
        const ids = {};
        const pend = { red: [...red], black: [...black] };
        let side = 'red';
        let guard = 0;
        while ((pend.red.length || pend.black.length) && guard++ < 40) {
          const u = side === 'red' ? u1 : u2;
          const c = await chessOf(u, id);
          const b = X.boardFromSnapshot(c);
          let done = false;
          if (pend[side].length) {
            const p = pend[side][0];
            const [x, y] = X.toXY(p);
            const to = X.toPos(x, y + (side === 'red' ? 1 : -1));
            if (X.isLegal(b, side, p, to)) {
              const nc = await must(u, id, p, to);
              ids[p] = nc.lastMove.revealed;
              pend[side].shift();
              done = true;
            }
          }
          if (!done) {
            const all = [...red, ...black];
            await playFiller(u, id, side, (f) => all.includes(f) && b.get(f) && b.get(f).piece === 'hidden');
          }
          side = other(side);
        }
        if (pend.red.length || pend.black.length) throw new Error('could not complete 10 reveals');
        seqs.push([...red, ...black].map((p) => ids[p]).join(','));
        for (const [s, ps] of [['red', red], ['black', black]]) {
          const cnt = {};
          let bad = false;
          for (const p of ps) { const t = ids[p]; cnt[t] = (cnt[t] || 0) + 1; if (!X.STD_COUNTS[t] || cnt[t] > X.STD_COUNTS[t]) bad = true; }
          ctx.cp(`第 ${g + 1} 局 ${s} 翻开身份均为标准棋子且数量不超过标准、无帅/将`, !bad, cnt);
        }
        await u1.resign(id);
      }
      await u1.leaveCurrent(); await u2.leaveCurrent();
      ctx.cp(`${seqs.length} 局翻开的身份序列不全相同`, new Set(seqs).size > 1, seqs);
    },
  },
  {
    id: 'TS-13',
    budgetMs: 180000,
    async fn(ctx) {
      const { u1, u2, id } = await startOnline('hid');
      const u3 = await L.newUser('hidAI');
      const ai = await u3.createAi();
      const aid = ai.body.room.roomId;
      const s1 = L.connectSocket(u1.cookie), s2 = L.connectSocket(u2.cookie), s3 = L.connectSocket(u3.cookie);
      await Promise.all([s1.ready, s2.ready, s3.ready]);
      const p1 = await L.newPage(u1), p2 = await L.newPage(u2), p3 = await L.newPage(u3);
      await Promise.all([p1.goto(`${BASE}/room/${id}`), p2.goto(`${BASE}/room/${id}`), p3.goto(`${BASE}/room/${aid}`)]);
      const records = [];
      const pageIssues = [];
      const pairIssues = [];
      const snapshotAll = async () => {
        const a = await u1.state(id), b = await u2.state(id), c = await u3.state(aid);
        records.push({ who: 'U1-api', room: a }, { who: 'U2-api', room: b }, { who: 'U3-api', room: c });
        if (a.version === b.version && hiddenView(a.chess) !== hiddenView(b.chess)) pairIssues.push(a.version);
        for (const [pg, room, who] of [[p1, a, 'U1-page'], [p2, b, 'U2-page'], [p3, c, 'U3-page']]) {
          await pg.waitForTimeout(700);
          const names = await boardButtons(pg).catch(() => []);
          if (names.length !== 90) pageIssues.push(`${who} buttons ${names.length}`);
          const hidden = new Set(room.chess.board.filter((x) => x.piece === 'hidden').map((x) => x.pos));
          for (const n of names) {
            const [pos, content] = n.split(' ');
            if (hidden.has(pos) && !/^[红黑]暗子$/.test(content)) pageIssues.push(`${who} ${n}`);
          }
        }
        return { a, b, c };
      };
      await snapshotAll();
      const seen = [];
      const steps = [['u1', 'a3', 'a4'], ['u2', 'a6', 'a5'], ['u1', 'b2', 'b9'], ['u2', null], ['u1', 'c3', 'c4'], ['u2', null]];
      for (const [who, f, t] of steps) {
        const u = who === 'u1' ? u1 : u2;
        const side = who === 'u1' ? 'red' : 'black';
        const b = X.boardFromSnapshot(await chessOf(u, id));
        if (f && X.isLegal(b, side, f, t)) await must(u, id, f, t);
        else await playFiller(u, id, side);
        const { a, b: bb } = await snapshotAll();
        seen.push({ a: a.chess.lastMove, b: bb.chess.lastMove });
      }
      for (let i = 0; i < 3; i++) {
        const c = await chessOf(u3, aid);
        if (c.status !== 'active') break;
        const bd = X.boardFromSnapshot(c);
        const mv = filler(bd, 'red') || X.legalMoves(bd, 'red')[0];
        const r = await u3.move(aid, mv[0], mv[1]);
        if (r.status !== 200) break;
        const v = r.body.room.version;
        await L.mustWait(async () => { const s = await u3.state(aid); return s && ((s.version > v && s.chess.turn === 'red') || s.chess.status !== 'active') ? s : null; }, 'AI move');
        await snapshotAll();
      }
      await L.sleep(800);
      for (const s of [s1, s2, s3]) for (const e of s.events) if (e.ev === 'room:state') records.push({ who: 'socket', room: e.st });
      s1.close(); s2.close(); s3.close();
      const leaks = [];
      for (const r of records) for (const l of leakScan(r.room)) leaks.push(`${r.who} v${r.room.version}: ${l}`);
      const nSock = records.filter((r) => r.who === 'socket').length;
      ctx.cp('1 接口读取与实时推送的全部记录中，盖着的位置只有所属方，无身份与位置对应', leaks.length === 0 && nSock > 0, { leaks: leaks.slice(0, 10), records: records.length, socket: nSock });
      ctx.cp('1 页面控件名称中盖着的位置只显示所属方', pageIssues.length === 0, pageIssues.slice(0, 10));
      ctx.cp('2 同一版本下 U1 与 U2 读取的盖棋内容相同', pairIssues.length === 0, pairIssues);
      const vis = seen.filter((x) => x.a && x.a.revealed);
      const same = vis.every((x) => x.b && x.a.revealed === x.b.revealed && JSON.stringify(x.a.captured) === JSON.stringify(x.b.captured));
      const capt = seen.filter((x) => x.a && x.a.captured);
      ctx.cp('3 翻开与被吃的身份对双方都可见且一致', vis.length > 0 && same && capt.every((x) => TYPES.includes(x.a.captured.piece) && x.b.captured && TYPES.includes(x.b.captured.piece)), { revealed: vis.map((x) => [x.a.revealed, x.b.revealed]), captured: capt.map((x) => [x.a.captured, x.b.captured]) });
    },
  },
];

async function expectReject(ctx, label, u, id, from, to, opts = {}) {
  const before = await chessOf(opts.reader || u, id);
  const r = await u.move(id, from, to);
  const after = await chessOf(opts.reader || u, id);
  const msgOk = opts.code ? r.code === opts.code : (r.code === 'ILLEGAL_MOVE' && r.message === '走法不合规');
  const ok = r.status >= 400 && msgOk && boardSig(before) === boardSig(after) && before.turn === after.turn;
  ctx.cp(label, ok, { status: r.status, code: r.code, message: r.message, turnBefore: before.turn, turnAfter: after.turn, boardSame: boardSig(before) === boardSig(after) });
  return ok;
}
async function expectAccept(ctx, label, u, id, from, to) {
  const before = await chessOf(u, id);
  const r = await u.move(id, from, to);
  const c = r.status === 200 ? r.body.room.chess : null;
  const ok = !!c && c.turn === other(before.turn) && !c.board.some((x) => x.pos === from) && c.board.some((x) => x.pos === to && x.side === before.turn);
  ctx.cp(label, ok, { status: r.status, code: r.code, turn: c && c.turn, lastMove: c && c.lastMove });
  return c;
}

const part2 = [
  {
    id: 'TS-14',
    budgetMs: 120000,
    async fn(ctx) {
      const { u1, u2, id } = await startOnline('typ');
      const avoidLeft = (f, t) => X.toXY(f)[0] <= 4 || X.toXY(t)[0] <= 4;
      await expectReject(ctx, '1 车位 a0→a4 被拒绝（a3 挡路）', u1, id, 'a0', 'a4');
      await expectReject(ctx, '1 车位 a0→b1 被拒绝', u1, id, 'a0', 'b1');
      await expectAccept(ctx, '1 车位 a0→a2 被接受', u1, id, 'a0', 'a2');
      await expectReject(ctx, '7 黑卒位 a6→a4 被拒绝', u2, id, 'a6', 'a4');
      await expectReject(ctx, '7 黑卒位 a6→a7 被拒绝', u2, id, 'a6', 'a7');
      await expectAccept(ctx, '7 黑卒位 a6→a5 被接受', u2, id, 'a6', 'a5');
      await expectReject(ctx, '2 马位 b0→d1 被拒绝（马腿 c0）', u1, id, 'b0', 'd1');
      await expectReject(ctx, '2 马位 b0→b1 被拒绝', u1, id, 'b0', 'b1');
      await expectAccept(ctx, '2 马位 b0→c2 被接受', u1, id, 'b0', 'c2');
      await playFiller(u2, id, 'black', avoidLeft);
      await expectReject(ctx, '3 象位 c0→c2 被拒绝', u1, id, 'c0', 'c2');
      await expectReject(ctx, '3 象位 c0→d1 被拒绝', u1, id, 'c0', 'd1');
      const ok3 = X.isLegal(X.boardFromSnapshot(await chessOf(u1, id)), 'red', 'c0', 'e2');
      if (!ok3) throw new Error('c0->e2 not legal in this position');
      await expectAccept(ctx, '3 象位 c0→e2 被接受（象眼 d1 空）', u1, id, 'c0', 'e2');
      await playFiller(u2, id, 'black', avoidLeft);
      await expectReject(ctx, '4 士位 d0→d1 被拒绝', u1, id, 'd0', 'd1');
      await expectReject(ctx, '4 士位 d0→c1 被拒绝（出九宫）', u1, id, 'd0', 'c1');
      if (!X.isLegal(X.boardFromSnapshot(await chessOf(u1, id)), 'red', 'd0', 'e1')) throw new Error('d0->e1 not legal in this position');
      await expectAccept(ctx, '4 士位 d0→e1 被接受', u1, id, 'd0', 'e1');
      await playFiller(u2, id, 'black', avoidLeft);
      await expectReject(ctx, '5 炮位 b2→c3 被拒绝', u1, id, 'b2', 'c3');
      await expectReject(ctx, '5 炮位 b2→b8 被拒绝（不吃子时中间有子）', u1, id, 'b2', 'b8');
      await expectReject(ctx, '5 炮位 b2→b7 被拒绝（吃子时没有炮架）', u1, id, 'b2', 'b7');
      if (!X.isLegal(X.boardFromSnapshot(await chessOf(u1, id)), 'red', 'b2', 'b9')) throw new Error('b2->b9 not legal in this position');
      await expectAccept(ctx, '5 炮位 b2→b9 被接受（隔 b7 吃 b9）', u1, id, 'b2', 'b9');
      await u1.resign(id);
      const id2 = await newGame(u1, u2);
      await expectReject(ctx, '6 兵位 a3→b3 被拒绝（未过河不能横走）', u1, id2, 'a3', 'b3');
      await expectReject(ctx, '6 兵位 a3→a5 被拒绝', u1, id2, 'a3', 'a5');
      await expectReject(ctx, '6 兵位 a3→a2 被拒绝', u1, id2, 'a3', 'a2');
      await expectAccept(ctx, '6 兵位 a3→a4 被接受', u1, id2, 'a3', 'a4');
    },
  },
  {
    id: 'TS-15',
    async fn(ctx) {
      const { u1, u2, id } = await startOnline('turn');
      const u3 = await L.newUser('turnX');
      await expectReject(ctx, '1 轮到红方时 U2 走黑方 a6→a5 被拒绝', u2, id, 'a6', 'a5', { code: 'NOT_YOUR_TURN', reader: u1 });
      const r2 = await u1.move(id, 'a6', 'a5');
      await expectReject(ctx, '2 U1 走黑方棋子 a6→a5 被拒绝', u1, id, 'a6', 'a5', { code: r2.code || 'ILLEGAL_MOVE' });
      ctx.cp('2 拒绝 U1 走黑方棋子（状态码）', r2.status >= 400, [r2.status, r2.code]);
      await expectReject(ctx, '3 U1 从空位置 e5→e4 走棋被拒绝', u1, id, 'e5', 'e4', { code: 'ILLEGAL_MOVE' });
      await expectReject(ctx, '4 不在房间的 U3 走棋被拒绝（不在该房间）', u3, id, 'a3', 'a4', { code: 'NOT_IN_ROOM', reader: u1 });
      const c = await expectAccept(ctx, '对照：U1 走 a3→a4 被接受，轮到 U2', u1, id, 'a3', 'a4');
      ctx.cp('对照：U2 读取状态为轮到黑方', (await chessOf(u2, id)).turn === 'black' && !!c, 'ok');
    },
  },
  {
    id: 'TS-17',
    async fn(ctx) {
      const { u1, u2, id } = await startOnline('rev');
      await must(u1, id, 'a3', 'a4');
      const c1 = await chessOf(u1, id), c2 = await chessOf(u2, id);
      const a1 = X.boardFromSnapshot(c1).get('a4'), a2 = X.boardFromSnapshot(c2).get('a4');
      const ident = a1 && a1.piece;
      ctx.cp('1 a3→a4 后 U1、U2 读取 a4 均为相同的实际身份', a1 && TYPES.includes(ident) && a2 && a2.piece === ident && c1.lastMove.revealed === ident, { a1, a2 });
      const pg1 = await L.newPage(u1), pg2 = await L.newPage(u2);
      await pg1.goto(`${BASE}/room/${id}`); await pg2.goto(`${BASE}/room/${id}`);
      const exp = expectedName('a4', a1);
      const n1 = await boardButtons(pg1), n2 = await boardButtons(pg2);
      ctx.cp('1 双方页面 a4 显示实际身份', n1.includes(exp) && n2.includes(exp), { exp, p1: n1.find((n) => n.startsWith('a4 ')), p2: n2.find((n) => n.startsWith('a4 ')) });
      const avoid = (f, t) => f === 'a4' || t === 'a4' || f[0] === 'b' || t[0] === 'b';
      const stable = [];
      for (let i = 0; i < 4; i++) {
        const side = i % 2 === 0 ? 'black' : 'red';
        await playFiller(side === 'red' ? u1 : u2, id, side, avoid);
        const x1 = X.boardFromSnapshot(await chessOf(u1, id)).get('a4'), x2 = X.boardFromSnapshot(await chessOf(u2, id)).get('a4');
        stable.push(x1 && x1.piece === ident && x2 && x2.piece === ident);
      }
      ctx.cp('2 之后双方再走 4 步，a4 一直翻开且身份不变', stable.every(Boolean), stable);
      await playFiller(u2, id, 'black', avoid);
      const b = X.boardFromSnapshot(await chessOf(u1, id));
      if (!(b.get('b9') && b.get('b9').piece === 'hidden' && X.isLegal(b, 'red', 'b2', 'b9'))) throw new Error('b2xb9 not available');
      const r = await u1.move(id, 'b2', 'b9');
      const k1 = await chessOf(u1, id), k2 = await chessOf(u2, id);
      const cap1 = k1.lastMove && k1.lastMove.captured, cap2 = k2.lastMove && k2.lastMove.captured;
      ctx.cp('3 b2 吃 b9：被吃棋子的实际身份对 U1、U2 都公开', r.status === 200 && cap1 && TYPES.includes(cap1.piece) && cap1.side === 'black' && JSON.stringify(cap1) === JSON.stringify(cap2)
        && k1.captured.some((c) => c.side === 'black' && c.piece === cap1.piece) && k2.captured.some((c) => c.side === 'black' && c.piece === cap1.piece), { status: r.status, cap1, cap2, captured1: k1.captured, captured2: k2.captured });
      const m1 = X.boardFromSnapshot(k1).get('b9'), m2 = X.boardFromSnapshot(k2).get('b9');
      ctx.cp('3 走动的 b2 棋子同时翻开', m1 && m1.side === 'red' && TYPES.includes(m1.piece) && m2 && m2.piece === m1.piece && k1.lastMove.revealed === m1.piece, { m1, m2 });
    },
  },
];

// Play red/black hidden "forward" moves to reveal pieces; calls onState(after each own move) until it returns truthy.
async function revealSearch(u1, u2, maxGames, onPosition) {
  for (let g = 0; g < maxGames; g++) {
    const id = await newGame(u1, u2);
    const order = { red: ['a3', 'c3', 'e3', 'g3', 'i3', 'b2', 'h2'], black: ['a9', 'i9', 'b9', 'h9', 'a6', 'i6'] };
    for (let step = 0; step < 16; step++) {
      const c = await chessOf(u1, id);
      if (c.status !== 'active') break;
      const res = await onPosition(id, c);
      if (res === 'done') return true;
      if (res === 'abort') break;
      const side = c.turn;
      const u = side === 'red' ? u1 : u2;
      const b = X.boardFromSnapshot(c);
      let mv = null;
      for (const p of order[side]) {
        const cell = b.get(p);
        if (!cell || cell.piece !== 'hidden') continue;
        const [x, y] = X.toXY(p);
        const to = side === 'red' && y === 3 ? X.toPos(x, 4) : null;
        const cands = to ? [to] : X.pseudoTargets(b, p).filter((t) => !b.get(t));
        const t = cands.find((tt) => X.isLegal(b, side, p, tt) && !X.isAttacked(X.applyMove(b, p, tt), other(side)));
        if (t) { mv = [p, t]; break; }
      }
      if (!mv) mv = filler(b, side);
      if (!mv) break;
      const r = await u.move(id, mv[0], mv[1]);
      if (r.status !== 200) throw new Error(`search move ${mv} rejected ${r.code}`);
    }
    await u1.resign(id).catch(() => {});
  }
  return false;
}

const part3 = [
  {
    id: 'TS-18',
    budgetMs: 300000,
    async fn(ctx) {
      const u1 = await L.newUser('idR'), u2 = await L.newUser('idB');
      const found = await revealSearch(u1, u2, 6, async (id, c) => {
        const side = c.turn;
        const u = side === 'red' ? u1 : u2;
        const b = X.boardFromSnapshot(c);
        for (const [p, cell] of b) {
          if (cell.side !== side || cell.piece === 'hidden' || cell.piece === 'king') continue;
          const orig = origins.get(`${id}:${p}`);
          if (!orig) continue;
          const posType = X.startType(orig);
          if (!posType || posType === cell.piece) continue;
          const byId = X.pseudoTargets(b, p).filter((t) => X.isLegal(b, side, p, t));
          const bt = new Map(b); bt.set(p, { side, piece: posType });
          const hiddenOk = (t) => {
            const [tx, ty] = X.toXY(t);
            if (posType === 'elephant') return side === 'red' ? ty <= 4 : ty >= 5;
            if (posType === 'advisor') return tx >= 3 && tx <= 5 && (side === 'red' ? ty <= 2 : ty >= 7);
            return true;
          };
          const byType = X.pseudoTargets(bt, p).filter((t) => hiddenOk(t) && !X.isAttacked(X.applyMove(bt, p, t), side));
          const m1 = byId.find((t) => !byType.includes(t));
          const m2 = byType.find((t) => !X.pseudoTargets(b, p).includes(t));
          if (!m1 || !m2) continue;
          ctx.cp('局面：翻开棋子身份与开局位置类型不同', true, { pos: p, origin: orig, identity: cell.piece, positionType: posType, M1: m1, M2: m2 });
          await expectReject(ctx, `M2 ${p}→${m2}（按位置类型合规、按身份不合规）被拒绝`, u, id, p, m2);
          await expectAccept(ctx, `M1 ${p}→${m1}（按身份合规、按位置类型不合规）被接受`, u, id, p, m1);
          return 'done';
        }
        return null;
      });
      if (!found) throw new L.Unreportable('6 局内未出现可用局面');
    },
  },
  {
    id: 'TS-19',
    budgetMs: 400000,
    async fn(ctx) {
      const u1 = await L.newUser('elR'), u2 = await L.newUser('elB');
      let blockedTested = false;
      const found = await revealSearch(u1, u2, 12, async (id, c) => {
        if (c.turn !== 'red') return null;
        const b = X.boardFromSnapshot(c);
        for (const [p, cell] of b) {
          if (cell.side !== 'red' || cell.piece !== 'elephant' || X.toXY(p)[1] !== 4) continue;
          const [x] = X.toXY(p);
          const cross = [x - 2, x + 2].filter((tx) => tx >= 0 && tx < 9).map((tx) => X.toPos(tx, 6))
            .find((t) => X.isLegal(b, 'red', p, t));
          if (!cross) continue;
          const c1 = await expectAccept(ctx, `1 翻开的相 ${p}→${cross} 过河被接受`, u1, id, p, cross);
          ctx.cp('1 相到达 6 行', !!c1 && X.boardFromSnapshot(c1).get(cross)?.piece === 'elephant', cross);
          if (!c1) return 'done';
          const [cx] = X.toXY(cross);
          const near = (sq) => { const [sx, sy] = X.toXY(sq); return Math.abs(sx - cx) <= 2 && sy >= 4; };
          await playFiller(u2, id, 'black', (f, t) => near(f) || near(t));
          const b2 = X.boardFromSnapshot(await chessOf(u1, id));
          if (b2.get(cross)?.piece !== 'elephant') return 'done';
          const blocked = [[2, 2], [-2, 2], [2, -2], [-2, -2]].map(([dx, dy]) => [cx + dx, 6 + dy, cx + dx / 2, 6 + dy / 2])
            .filter(([tx, ty]) => tx >= 0 && tx < 9 && ty >= 0 && ty < 10)
            .find(([tx, ty, ex, ey]) => b2.get(X.toPos(ex, ey)) && !(b2.get(X.toPos(tx, ty))?.side === 'red'));
          if (blocked) {
            blockedTested = true;
            await expectReject(ctx, `3 象眼 ${X.toPos(blocked[2], blocked[3])} 被堵的田字 ${cross}→${X.toPos(blocked[0], blocked[1])} 被拒绝`, u1, id, cross, X.toPos(blocked[0], blocked[1]));
          }
          const next = [[2, 2], [-2, 2]].map(([dx, dy]) => X.toPos(cx + dx, 6 + dy)).filter((t) => X.toXY(t)[0] >= 0 && X.toXY(t)[0] < 9)
            .find((t) => X.isLegal(b2, 'red', cross, t));
          if (next) await expectAccept(ctx, `2 相在对方一侧再走田字 ${cross}→${next} 被接受`, u1, id, cross, next);
          else ctx.cp('2 相在对方一侧再走田字', false, '当前局面没有象眼为空的合规田字（测试局面）');
          return 'done';
        }
        return null;
      });
      if (!found) throw new L.Unreportable('12 局内未翻出可过河的相');
      if (!blockedTested) L.log && L.log('TS-19: 未出现象眼被堵的局面，由 DC-03 覆盖');
    },
  },
  {
    id: 'TS-20',
    budgetMs: 400000,
    async fn(ctx) {
      const u1 = await L.newUser('adR'), u2 = await L.newUser('adB');
      const found = await revealSearch(u1, u2, 12, async (id, c) => {
        if (c.turn !== 'red') return null;
        const b = X.boardFromSnapshot(c);
        for (const [p, cell] of b) {
          if (cell.side !== 'red' || cell.piece !== 'advisor' || X.toXY(p)[1] !== 4) continue;
          const [x] = X.toXY(p);
          const t1 = [x - 1, x + 1].filter((tx) => tx >= 0 && tx < 9).map((tx) => X.toPos(tx, 5)).find((t) => X.isLegal(b, 'red', p, t));
          if (!t1) continue;
          const c1 = await expectAccept(ctx, `1 翻开的仕 ${p}→${t1}（出九宫且过河）被接受`, u1, id, p, t1);
          if (!c1) return 'done';
          const [tx1] = X.toXY(t1);
          const near = (sq) => { const [sx, sy] = X.toXY(sq); return Math.abs(sx - tx1) <= 1 && sy >= 4 && sy <= 6; };
          await playFiller(u2, id, 'black', (f, t) => near(f) || near(t));
          const b2 = X.boardFromSnapshot(await chessOf(u1, id));
          if (b2.get(t1)?.piece !== 'advisor') return 'done';
          const straight = [[0, 1], [1, 0], [-1, 0], [0, -1]].map(([dx, dy]) => [tx1 + dx, 5 + dy]).filter(([a, bb]) => a >= 0 && a < 9 && bb >= 0 && bb < 10)
            .map(([a, bb]) => X.toPos(a, bb)).filter((t) => b2.get(t)?.side !== 'red');
          const vert = straight.find((t) => X.toXY(t)[0] === tx1);
          const hori = straight.find((t) => X.toXY(t)[1] === 5);
          if (vert) await expectReject(ctx, `2 仕直走一格 ${t1}→${vert} 被拒绝`, u1, id, t1, vert);
          if (hori) await expectReject(ctx, `2 仕横走一格 ${t1}→${hori} 被拒绝`, u1, id, t1, hori);
          const t2 = [[1, 1], [-1, 1], [1, -1], [-1, -1]].map(([dx, dy]) => [tx1 + dx, 5 + dy]).filter(([a]) => a >= 0 && a < 9)
            .map(([a, bb]) => X.toPos(a, bb)).find((t) => X.isLegal(b2, 'red', t1, t));
          if (t2) await expectAccept(ctx, `2 仕再斜走一格 ${t1}→${t2} 被接受`, u1, id, t1, t2);
          else ctx.cp('2 仕再斜走一格', false, '当前局面没有合规的斜走（测试局面）');
          return 'done';
        }
        return null;
      });
      if (!found) throw new L.Unreportable('12 局内未翻出仕');
    },
  },
  {
    id: 'TS-21',
    async fn(ctx) {
      const u1 = await L.newUser('kgR'), u2 = await L.newUser('kgB');
      // Black's in-between move: any legal move, preferring ones far from the e file and the red palace;
      // never touching the red palace or e3/e4 (the king's route and its blocker).
      const keepOff = (sq) => { const [x, y] = X.toXY(sq); return (x >= 3 && x <= 5 && y <= 2) || sq === 'e3' || sq === 'e4'; };
      const blackMove = async (id) => {
        const c = await chessOf(u2, id);
        if (c.status !== 'active' || c.turn !== 'black') return false;
        const b = X.boardFromSnapshot(c);
        const ms = X.legalMoves(b, 'black').filter(([f, t]) => !keepOff(f) && !keepOff(t));
        const checks = ([f, t]) => X.isAttacked(X.applyMove(b, f, t), 'red');
        const prefs = [
          ([f, t]) => !'def'.includes(f[0]) && !'def'.includes(t[0]) && !b.get(t) && !checks([f, t]),
          ([f, t]) => f[0] !== 'e' && t[0] !== 'e' && !b.get(t) && !checks([f, t]),
          ([f, t]) => !b.get(t) && !checks([f, t]),
          ([f, t]) => !checks([f, t]),
          () => true,
        ];
        for (const ok of prefs) {
          const mv = ms.find(ok);
          if (!mv) continue;
          const r = await u2.move(id, mv[0], mv[1]);
          return r.status === 200;
        }
        return false;
      };
      const flush = (buf) => { for (const a of buf) ctx.cp(...a); };
      for (let g = 0; g < 8; g++) {
        const id = await newGame(u1, u2);
        const buf = [];
        const bctx = { cp: (...a) => buf.push(a) };
        const legal = async (f, t) => X.isLegal(X.boardFromSnapshot(await chessOf(u1, id)), 'red', f, t);
        const retry = async () => { await u1.resign(id).catch(() => {}); };
        if (!(await legal('e3', 'e4'))) { await retry(); continue; }
        if (!(await expectAccept(bctx, '红方 e3→e4 被接受', u1, id, 'e3', 'e4'))) return flush(buf);
        if (!(await blackMove(id)) || !(await legal('e0', 'e1'))) { await retry(); continue; }
        if (!(await expectAccept(bctx, '帅 e0→e1 被接受（九宫内）', u1, id, 'e0', 'e1'))) return flush(buf);
        if (!(await blackMove(id)) || !(await legal('e1', 'e2'))) { await retry(); continue; }
        if (!(await expectAccept(bctx, '帅 e1→e2 被接受（九宫内）', u1, id, 'e1', 'e2'))) return flush(buf);
        if (!(await blackMove(id))) { await retry(); continue; }
        const c = await chessOf(u1, id);
        const b = X.boardFromSnapshot(c);
        // Only judge e2→e3 when the palace rule is the sole reason it could be rejected.
        if (c.status !== 'active' || c.turn !== 'red' || b.get('e3') || b.get('e2')?.piece !== 'king'
          || X.isAttacked(X.applyMove(b, 'e2', 'e3'), 'red')) { await retry(); continue; }
        await expectReject(bctx, '帅 e2→e3 被拒绝（出九宫），棋盘不变', u1, id, 'e2', 'e3');
        return flush(buf);
      }
      throw new L.Unreportable('8 局内都未能形成前置局面');
    },
  },
];

// origin tracking: populated by wrapping Client.move for this module
const origins = new Map();
{
  const orig = L.Client.prototype.move;
  L.Client.prototype.move = async function (id, from, to) {
    const r = await orig.call(this, id, from, to);
    if (r.status === 200) {
      const o = origins.get(`${id}:${from}`) || from;
      origins.delete(`${id}:${from}`);
      origins.set(`${id}:${to}`, o);
    }
    return r;
  };
}

// Wait until the computer has replied (turn back to red) or the game ended.
async function waitAi(u, id, afterVersion) {
  return L.mustWait(async () => {
    const s = await u.state(id);
    return s && s.version > afterVersion && (s.chess.turn === 'red' || s.chess.status !== 'active') ? s : null;
  }, 'computer move');
}
async function resultDialog(u, id) {
  const page = await L.newPage(u);
  await page.goto(`${BASE}/room/${id}`);
  const d = page.getByRole('dialog', { name: '对局结果' });
  try { await d.waitFor({ timeout: L.WAIT_MS }); } catch { return ''; }
  return d.innerText();
}
const ratingOf = async (u) => (await u.me()).rating;
const changeFor = (ch, u) => (ch.result && ch.result.ratingChanges || []).find((x) => x.userId === u.user.id);
const signed = (n) => (n > 0 ? `+${n}` : String(n));
const hasNum = (txt, label, n) => new RegExp(`${label}\\s*${n < 0 ? '[-−]' + Math.abs(n) : (n > 0 && label.startsWith('积分变化') ? '\\+' + n : n)}(?!\\d)`).test(txt);

const part4 = [
  {
    id: 'TS-22',
    async fn(ctx) {
      const u1 = await L.newUser('aiA'), u2 = await L.newUser('aiB');
      const r = await u1.createAi();
      const id = r.body && r.body.room && r.body.room.roomId;
      const c = await chessOf(u1, id);
      ctx.cp('1 U1 开始人机对局：U1 执红、对手为电脑、轮到 U1', r.status === 201 || r.status === 200 ? c.yourColor === 'red' && c.turn === 'red' && c.status === 'active' && c.players.black && c.players.black.computer === true : false, { status: r.status, players: c && c.players, turn: c && c.turn });
      ctx.cp('1 开局布局同 TS-11', checkLayout(c).length === 0, checkLayout(c).slice(0, 5));
      const page = await L.newPage(u1);
      await page.goto(`${BASE}/room/${id}`);
      const h = await page.getByRole('heading', { name: '与电脑对战' }).waitFor({ timeout: L.WAIT_MS }).then(() => true, () => false);
      ctx.cp('1 页面进入与电脑对战', h, h ? '与电脑对战' : await page.getByRole('heading').allInnerTexts());
      const list = await u2.rooms();
      ctx.cp('2 U2 大厅列表中没有该人机对局', Array.isArray(list) && !list.some((x) => x.id === id), list && list.length);
      const j = await u2.join(id);
      const st = await u1.state(id);
      ctx.cp('2 U2 加入人机对局被拒绝，对局只有 U1 与电脑', j.status >= 400 && st.members.length === 1 && st.members[0].userId === u1.user.id, { join: [j.status, j.code], members: st.members });
      const p2 = await L.newPage(u2);
      await p2.goto(`${BASE}/room/${id}`);
      await p2.waitForTimeout(1500);
      ctx.cp('2 U2 打开该房间地址后对局仍只有 U1', (await u1.state(id)).members.length === 1, 'checked');
      const mv = await u1.move(id, 'a3', 'a4');
      const s = await waitAi(u1, id, mv.body.room.version);
      ctx.cp('3 电脑自动走一步黑棋后轮到 U1', s.chess.turn === 'red' && s.chess.lastMove.side === 'black' && s.chess.status === 'active', s.chess.lastMove);
      const u3 = await L.newUser('aiC');
      const other = (await u3.createRoom('chess')).body.room.roomId;
      const a = await u1.createRoom('poker'), b = await u1.join(other);
      ctx.cp('4 U1 在人机对局中开新房间或加入他人房间被拒绝', a.status === 409 && b.status === 409 && (await u1.me()).currentRoomId === id, [a.status, a.code, b.status, b.code]);
    },
  },
  {
    id: 'TS-23',
    budgetMs: 300000,
    async fn(ctx) {
      const u1 = await L.newUser('aiL');
      let id = (await u1.createAi()).body.room.roomId;
      const problems = [];
      let checked = 0;
      for (let step = 0; step < 20; step++) {
        let c = await chessOf(u1, id);
        if (c.status !== 'active') { await u1.leave(id); id = (await u1.createAi()).body.room.roomId; c = await chessOf(u1, id); }
        const b0 = X.boardFromSnapshot(c);
        const moves = X.legalMoves(b0, 'red');
        moves.sort(() => Math.random() - 0.5);
        let r = null;
        for (const m of moves.slice(0, 5)) { r = await u1.move(id, m[0], m[1]); if (r.status === 200) break; }
        if (!r || r.status !== 200) throw new Error('red move not accepted');
        const pre = r.body.room;
        if (pre.chess.status !== 'active') continue;
        if (pre.chess.turn !== 'black' || pre.chess.lastMove.side !== 'red') { problems.push(`step ${step}: unexpected pre-state ${JSON.stringify(pre.chess.lastMove)}`); continue; }
        const post = await waitAi(u1, id, pre.version);
        const B = X.boardFromSnapshot(pre.chess);
        const A = X.boardFromSnapshot(post.chess);
        const lm = post.chess.lastMove;
        checked += 1;
        const leaks = leakScan(pre).concat(leakScan(post));
        if (leaks.length) problems.push(`step ${step}: leak ${leaks[0]}`);
        if (!lm || lm.side !== 'black') { if (post.chess.status === 'active') problems.push(`step ${step}: no black move ${JSON.stringify(lm)}`); continue; }
        const from = lm.from, to = lm.to;
        const pc = B.get(from);
        if (!pc || pc.side !== 'black') { problems.push(`step ${step}: moved non-black ${from}`); continue; }
        if (!X.isLegal(B, 'black', from, to)) problems.push(`step ${step}: illegal ${from}->${to} (${pc.piece === 'hidden' ? 'hidden as ' + X.startType(from) : pc.piece})`);
        // exactly one move happened
        const expect = X.applyMove(B, from, to);
        let diff = 0;
        for (let x = 0; x < 9; x++) for (let y = 0; y < 10; y++) {
          const p = X.toPos(x, y), e = expect.get(p), a = A.get(p);
          if (!!e !== !!a || (e && e.side !== a.side)) diff += 1;
        }
        if (diff) problems.push(`step ${step}: board differs from single move ${from}->${to} at ${diff} squares`);
        const moved = A.get(to);
        if (pc.piece === 'hidden') {
          if (!moved || moved.piece === 'hidden' || lm.revealed !== moved.piece) problems.push(`step ${step}: hidden piece not revealed ${JSON.stringify(moved)} ${lm.revealed}`);
        } else if (moved && moved.piece !== pc.piece) problems.push(`step ${step}: identity changed`);
        const victim = B.get(to);
        if (victim && victim.piece === 'hidden' && !(lm.captured && TYPES.includes(lm.captured.piece))) problems.push(`step ${step}: captured hidden identity not public`);
        if (post.chess.status === 'active' && X.isAttacked(A, 'black')) problems.push(`step ${step}: black king attacked after move`);
      }
      ctx.cp(`电脑共 ${checked} 步：都是轮到黑方时走黑方棋子、按位置类型/实际身份合规、走后不被将军、只走一步、盖棋翻开、被吃身份公开、未走动盖棋无身份`, checked >= 15 && problems.length === 0, { checked, problems: problems.slice(0, 10) });
    },
  },
  {
    id: 'TS-26',
    async fn(ctx) {
      const { u1, u2, id } = await startOnline('rs');
      await must(u1, id, 'a3', 'a4'); await must(u2, id, 'a6', 'a5');
      const r = await u2.resign(id);
      const c1 = await chessOf(u1, id), c2 = await chessOf(u2, id);
      const g1 = changeFor(c1, u1), g2 = changeFor(c2, u2);
      ctx.cp('1 对局结果：U1 +10 → 1010，U2 −10 → 990', r.status === 200 && c1.result && c1.result.outcome === 'red_win' && g1 && g1.delta === 10 && g1.rating === 1010 && g2 && g2.delta === -10 && g2.rating === 990, { result: c1.result });
      const d1 = await resultDialog(u1, id), d2 = await resultDialog(u2, id);
      ctx.cp('1 U1 页面对局结果显示 +10、当前积分 1010', d1.includes('你赢了') && hasNum(d1, '积分变化：', 10) && hasNum(d1, '当前积分：', 1010), d1);
      ctx.cp('1 U2 页面对局结果显示 −10、当前积分 990', d2.includes('你输了') && hasNum(d2, '积分变化：', -10) && hasNum(d2, '当前积分：', 990), d2);
      const r2 = await u2.resign(id);
      await u2.leave(id); await u1.leave(id);
      const t1 = await L.lobbyInfoText(u1), t2 = await L.lobbyInfoText(u2);
      ctx.cp('2 回到大厅显示积分 1010 与 990', hasNum(t1, '积分：', 1010) && hasNum(t2, '积分：', 990), { t1, t2 });
      ctx.cp('3 结束后再次认输、离开不改变积分', (await ratingOf(u1)) === 1010 && (await ratingOf(u2)) === 990, { resignAgain: [r2.status, r2.code] });
      const list = await u1.rooms();
      const n1 = await u1.createRoom('chess'), n2 = await u2.createRoom('chess');
      ctx.cp('4 房间从大厅列表消失，双方都能开新房间', !list.some((x) => x.id === id) && n1.status === 201 && n2.status === 201, [n1.status, n2.status]);
      await u1.leaveCurrent(); await u2.leaveCurrent();
      const g = await startOnline('rsc');
      await must(g.u1, g.id, 'a3', 'a4');
      const rr = await Promise.all([g.u2.resign(g.id), g.u2.resign(g.id)]);
      await L.sleep(500);
      const a = await ratingOf(g.u1), b = await ratingOf(g.u2);
      ctx.cp('5 并发认输只结算一次：胜方 1010、负方 990', a === 1010 && b === 990, { statuses: rr.map((x) => x.status), winner: a, loser: b });
    },
  },
  {
    id: 'TS-27',
    async fn(ctx) {
      const { u1, u2, id } = await startOnline('lv');
      await must(u1, id, 'a3', 'a4');
      const l = await u1.leave(id);
      const c2 = await chessOf(u2, id);
      ctx.cp('对局结束，U1（红）负、U2 胜，U2 看到对局结果', l.status === 200 && c2 && c2.status === 'finished' && c2.result && c2.result.outcome === 'black_win', c2 && c2.result);
      ctx.cp('U1 积分 990、U2 积分 1010', (await ratingOf(u1)) === 990 && (await ratingOf(u2)) === 1010, [await ratingOf(u1), await ratingOf(u2)]);
      const d2 = await resultDialog(u2, id);
      ctx.cp('U2 页面显示对局结果（你赢了，+10，当前积分 1010）', d2.includes('你赢了') && hasNum(d2, '积分变化：', 10) && hasNum(d2, '当前积分：', 1010), d2);
      ctx.cp('房间从列表消失', !(await u1.rooms()).some((x) => x.id === id), 'checked');
    },
  },
  {
    id: 'TS-28',
    async fn(ctx) {
      const u1 = await L.newUser('air');
      const id = (await u1.createAi()).body.room.roomId;
      const r = await u1.resign(id);
      const c = await chessOf(u1, id);
      const g = changeFor(c, u1);
      ctx.cp('1 人机对局认输：对局结果 −10、最新积分 990', r.status === 200 && g && g.delta === -10 && g.rating === 990, c.result);
      const d = await resultDialog(u1, id);
      ctx.cp('1 页面对局结果显示 −10 与 990', hasNum(d, '积分变化：', -10) && hasNum(d, '当前积分：', 990), d);
      await u1.leave(id);
      const t = await L.lobbyInfoText(u1);
      ctx.cp('1 大厅显示 990', hasNum(t, '积分：', 990), t);
      const id2 = (await u1.createAi()).body.room.roomId;
      await must(u1, id2, 'a3', 'a4');
      await u1.leave(id2);
      ctx.cp('2 再开人机对局走一步后离开：积分 980', (await ratingOf(u1)) === 980, await ratingOf(u1));
    },
  },
  {
    id: 'TS-29',
    async fn(ctx) {
      ctx.useDb();
      const u1 = await L.newUser('ng1'), u2 = await L.newUser('ng2'), u3 = await L.newUser('ng3'), u4 = await L.newUser('ng4');
      await L.setUserValues(u1, { rating: 5 }); await L.setUserValues(u2, { rating: 0 });
      await L.setUserValues(u3, { rating: -10 }); await L.setUserValues(u4, { rating: -5 });
      const aiResign = async (u) => { const id = (await u.createAi()).body.room.roomId; await u.resign(id); return id; };
      const i1 = await aiResign(u1);
      const d1 = await resultDialog(u1, i1);
      await u1.leave(i1);
      const t1 = await L.lobbyInfoText(u1);
      ctx.cp('1 U1 积分 5 认输后为 −5，对局结果与大厅都带负号显示', (await ratingOf(u1)) === -5 && hasNum(d1, '当前积分：', -5) && hasNum(t1, '积分：', -5), { rating: await ratingOf(u1), dialog: d1, lobby: t1 });
      const i2 = await aiResign(u2);
      await u2.leave(i2);
      ctx.cp('2 U2 积分 0 认输后为 −10', (await ratingOf(u2)) === -10, await ratingOf(u2));
      const id = (await u3.createRoom('chess')).body.room.roomId;
      await u4.join(id);
      await u3.resign(id);
      const d3 = await resultDialog(u3, id), d4 = await resultDialog(u4, id);
      await u3.leave(id); await u4.leave(id);
      const t3 = await L.lobbyInfoText(u3), t4 = await L.lobbyInfoText(u4);
      ctx.cp('3 U3 认输后积分 −20、U4 胜后积分 5', (await ratingOf(u3)) === -20 && (await ratingOf(u4)) === 5, [await ratingOf(u3), await ratingOf(u4)]);
      ctx.cp('3 双方对局结果与大厅一致（−20 带负号、5）', hasNum(d3, '当前积分：', -20) && hasNum(t3, '积分：', -20) && hasNum(d4, '当前积分：', 5) && hasNum(t4, '积分：', 5), { d3, t3, d4, t4 });
    },
  },
  {
    id: 'TS-30',
    async fn(ctx) {
      const { u1, u2, id } = await startOnline('dr');
      const p1 = await L.newPage(u1);
      await p1.goto(`${BASE}/room/${id}`);
      await p1.getByRole('group', { name: '棋盘' }).waitFor({ timeout: L.WAIT_MS });
      await p1.getByRole('button', { name: '提和', exact: true }).click();
      const pending1 = await L.waitFor(async () => { const c = await chessOf(u2, id); return c.drawOffer ? c : null; });
      const o1 = { status: pending1 ? 200 : 0 };
      const d1 = await u2.drawResponse(id, false);
      const c1 = await chessOf(u1, id);
      ctx.cp('1 U1 提和、U2 拒绝：对局继续，无待回应提和，轮次不变', o1.status === 200 && d1.status === 200 && c1.status === 'active' && !c1.drawOffer && c1.turn === 'red', { o1: o1.status, d1: d1.status, status: c1.status, drawOffer: c1.drawOffer, turn: c1.turn });
      const readStatus = async () => (await p1.getByRole('status').allInnerTexts().catch(() => [])).join(' | ');
      let seen = await L.waitFor(async () => { const t = await readStatus(); return t.includes('对方拒绝了提和') ? t : null; });
      if (!seen) {
        await p1.reload();
        await p1.getByRole('group', { name: '棋盘' }).waitFor({ timeout: L.WAIT_MS }).catch(() => {});
        seen = await L.waitFor(async () => { const t = await readStatus(); return t.includes('对方拒绝了提和') ? t : null; }, 5000);
      }
      ctx.cp('1 U1 看到对方拒绝了提和', !!seen, seen || await readStatus());
      await must(u1, id, 'a3', 'a4');
      const o2 = await u1.drawOffer(id);
      const pend = (await chessOf(u2, id)).drawOffer;
      await must(u2, id, 'a6', 'a5');
      const c2 = await chessOf(u1, id);
      ctx.cp('2 U2 不回应直接走棋：提和失效，对局继续', o2.status === 200 && pend && c2.status === 'active' && !c2.drawOffer, { pend, after: c2.drawOffer, status: c2.status });
      const o3 = await u1.drawOffer(id);
      const o4 = await u1.drawOffer(id);
      const c3 = await chessOf(u2, id);
      const offers = JSON.stringify(c3.drawOffer);
      ctx.cp('3 待回应时再次提和：仍只有一个待回应的提和', o3.status === 200 && c3.drawOffer && c3.drawOffer.by === 'red' && !Array.isArray(c3.drawOffer), { o3: o3.status, o4: [o4.status, o4.code], drawOffer: offers });
      const a = await u2.drawResponse(id, true);
      const k1 = await chessOf(u1, id), k2 = await chessOf(u2, id);
      ctx.cp('4 U2 同意：和棋结束，双方都看到和棋结果', a.status === 200 && k1.result && k1.result.outcome === 'draw' && k2.result && k2.result.outcome === 'draw', k1.result);
      const dd1 = await resultDialog(u1, id), dd2 = await resultDialog(u2, id);
      ctx.cp('4 双方页面对局结果显示和棋、积分变化 0', dd1.includes('和棋') && dd2.includes('和棋') && hasNum(dd1, '积分变化：', 0) && hasNum(dd2, '积分变化：', 0), { dd1, dd2 });
      await u1.leave(id); await u2.leave(id);
      const t1 = await L.lobbyInfoText(u1), t2 = await L.lobbyInfoText(u2);
      ctx.cp('4 积分都仍为 1000，大厅一致，房间从列表消失', (await ratingOf(u1)) === 1000 && (await ratingOf(u2)) === 1000 && hasNum(t1, '积分：', 1000) && hasNum(t2, '积分：', 1000) && !(await u1.rooms()).some((x) => x.id === id), { t1, t2 });
      const u3 = await L.newUser('dr3');
      const aid = (await u3.createAi()).body.room.roomId;
      const o5 = await u3.drawOffer(aid);
      const k3 = await chessOf(u3, aid);
      const dd3 = await resultDialog(u3, aid);
      ctx.cp('5 人机对局提和：电脑同意，立即和棋结束，积分仍 1000', o5.status === 200 && k3.result && k3.result.outcome === 'draw' && (await ratingOf(u3)) === 1000 && dd3.includes('和棋'), { result: k3.result, dialog: dd3 });
    },
  },
];

export const scenarios = [...part1, ...part2, ...part3, ...part4];
