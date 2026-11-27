// TS-14 .. TS-20: Chinese chess (blind) board, pieces, selection, moving, animation, turn & captured
import {
  BASE, openPage, gotoRoom, sleep, waitFor, onlineChess, boardGeom, posCenter, cell,
  waitBoardIdle, parseRgb, isRed, CHESS_NAMES,
} from '../lib.mjs';

const BOARD = (page) => page.getByRole('group', { name: '棋盘' });
const COLS = 'abcdefghi';
const dist = (a, b) => Math.max(Math.abs(a.r - b.r), Math.abs(a.g - b.g), Math.abs(a.b - b.b));

async function openRoom(ctx, api, roomId, viewport) {
  const page = await openPage(ctx, api, viewport ? { viewport } : {});
  await gotoRoom(page, roomId);
  await BOARD(page).waitFor({ timeout: 20000 });
  await waitBoardIdle(page, 60000);
  await sleep(500);
  return page;
}

// pixel sampler: decode a PNG buffer in a helper page, keep it on window.__img
async function pixHelper(ctx) {
  const p = await openPage(ctx, null);
  await p.goto('about:blank');
  return {
    async load(buf) {
      await p.evaluate(async (b64) => {
        const img = new Image();
        img.src = 'data:image/png;base64,' + b64;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = img.width; c.height = img.height;
        const g = c.getContext('2d');
        g.drawImage(img, 0, 0);
        window.__img = { w: img.width, h: img.height, d: g.getImageData(0, 0, img.width, img.height).data };
      }, buf.toString('base64'));
    },
    eval(fn, arg) { return p.evaluate(fn, arg); },
    async px(points) {
      return p.evaluate((pts) => pts.map(([x, y]) => {
        const I = window.__img; const xi = Math.round(x); const yi = Math.round(y);
        if (xi < 0 || yi < 0 || xi >= I.w || yi >= I.h) return null;
        const o = (yi * I.w + xi) * 4; return { r: I.d[o], g: I.d[o + 1], b: I.d[o + 2] };
      }), points);
    },
  };
}

// board screenshot (element) -> sizes in image pixels (dpr 1)
async function boardShot(page) {
  const b = BOARD(page);
  await b.scrollIntoViewIfNeeded();
  const buf = await b.screenshot();
  const box = await b.boundingBox();
  return { buf, W: box.width, H: box.height };
}

// all cells: pos, label, face, marks, pressed, button center, piece graphic center
async function cells(page) {
  return page.evaluate(() => {
    const b = [...document.querySelectorAll('[role="group"]')].find((e) => e.getAttribute('aria-label') === '棋盘');
    return [...b.querySelectorAll('button')].map((btn) => {
      const r = btn.getBoundingClientRect();
      const label = btn.getAttribute('aria-label') || '';
      const kid = btn.firstElementChild;
      const kr = kid ? kid.getBoundingClientRect() : null;
      return {
        pos: label.split(' ')[0], label, content: label.split(' ').slice(1).join(' '),
        face: btn.getAttribute('data-face'), marks: (btn.getAttribute('data-marks') || '').split(/\s+/).filter(Boolean),
        pressed: btn.getAttribute('aria-pressed'),
        bx: r.x + r.width / 2, by: r.y + r.height / 2,
        px: kr && kr.width ? kr.x + kr.width / 2 : null, py: kr && kr.width ? kr.y + kr.height / 2 : null,
      };
    });
  });
}
const cellMap = (cs) => Object.fromEntries(cs.map((c) => [c.pos, c]));
const hintText = (page) => page.getByRole('status', { name: '操作提示' }).innerText().catch(() => '');
const statusText = (page) => page.getByRole('status', { name: '对局状态' }).innerText().catch(() => '');

// check every piece graphic centre is on its intersection (<=2px)
async function piecesOnPoints(page) {
  const g = await boardGeom(page);
  const cs = await cells(page);
  const bad = [];
  let n = 0;
  for (const c of cs) {
    if (!c.face) continue;
    n += 1;
    const e = posCenter(c.pos, g);
    if (c.px == null || Math.abs(c.px - e.x) > 2 || Math.abs(c.py - e.y) > 2) bad.push(`${c.pos}:(${c.px?.toFixed(1)},${c.py?.toFixed(1)}) vs (${e.x.toFixed(1)},${e.y.toFixed(1)})`);
  }
  return { n, bad };
}

const MARK_POS = ['a3', 'c3', 'e3', 'g3', 'i3', 'b2', 'h2', 'a6', 'c6', 'e6', 'g6', 'i6', 'b7', 'h7'];
const occupied = (st, pos) => (st.chess.board || []).find((x) => x.pos === pos);

// move via API: prefer from in `prefer`, never capture, never land on `avoid`
// The server does not push the requester's own move to the requester, so moves of a user whose
// page is under observation are made by clicking on that page (opts.page).
async function uiMove(page, api, roomId, f, t) {
  const v0 = (await api.state(roomId)).version;
  await waitBoardIdle(page, 60000);
  await cell(page, f).click(); await sleep(250);
  await cell(page, t).click();
  return waitFor(async () => (await api.state(roomId)).version !== v0, { timeout: 10000 });
}
async function apiMovePref(api, roomId, prefer, avoid, { capture = false, page = null, soft = [] } = {}) {
  const st = await api.state(roomId);
  const lm = st.chess?.legalMoves || {};
  let opts = [];
  for (const [f, tos] of Object.entries(lm)) for (const t of tos) {
    if (avoid.includes(t)) continue;
    const occ = occupied(st, t);
    if (!capture && occ) continue;
    opts.push([f, t, occ]);
  }
  // soft-avoided destinations are only used when nothing else is available
  if (soft.length && opts.some((o) => !soft.includes(o[1]))) opts = opts.filter((o) => !soft.includes(o[1]));
  let pick = null;
  if (capture) pick = opts.find((o) => o[2]);
  for (const p of prefer) { if (pick) break; pick = opts.find((o) => o[0] === p); }
  if (!pick) pick = opts.find((o) => !o[2]) || opts[0];
  if (!pick) return null;
  if (page) return (await uiMove(page, api, roomId, pick[0], pick[1])) ? [pick[0], pick[1]] : null;
  const r = await api.move(roomId, pick[0], pick[1]);
  return r.status === 200 ? [pick[0], pick[1]] : null;
}

// wait until page shows API version (board labels equal API board)
async function pageMatchesApi(page, api, roomId, timeout = 60000) {
  return waitFor(async () => {
    const st = await api.state(roomId);
    if (!(await waitBoardIdle(page, 2000))) return null;
    const m = cellMap(await cells(page));
    for (const pc of st.chess.board) { if (!m[pc.pos] || m[pc.pos].content === '空') return null; }
    const occ = new Set(st.chess.board.map((x) => x.pos));
    for (const c of Object.values(m)) if (!occ.has(c.pos) && c.content !== '空') return null;
    return st;
  }, { timeout, interval: 400 });
}

// frame recorder (rAF) on a page
async function startRec(page) {
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('[role="group"]')].find((e) => e.getAttribute('aria-label') === '棋盘');
    const R = window.__rec = { frames: [], on: true };
    const step = () => {
      if (!R.on) return;
      const br = b.getBoundingClientRect(); const dx = br.width / 9;
      const pieces = [];
      for (const el of b.querySelectorAll('*')) {
        if (el.tagName === 'BUTTON' || el.closest('svg')) continue;
        const r = el.getBoundingClientRect();
        if (r.width > 0.4 * dx && r.width < 1.2 * dx && Math.abs(r.width - r.height) < 0.25 * dx) {
          const op = getComputedStyle(el).opacity;
          pieces.push([r.x + r.width / 2, r.y + r.height / 2, el.closest('button')?.getAttribute('data-pos') || null, op]);
        }
      }
      const cl = {};
      for (const btn of b.querySelectorAll('button')) cl[btn.getAttribute('data-pos')] = [btn.getAttribute('aria-label'), btn.getAttribute('data-face'), btn.getAttribute('data-marks') || ''];
      R.frames.push({ t: performance.now(), anim: b.getAttribute('data-anim'), pieces, cl });
      if (R.frames.length < 3000) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}
async function stopRec(page) {
  return page.evaluate(() => { const R = window.__rec; R.on = false; return R.frames; });
}
// was the moving piece observed strictly between from and to?
function sawMidFrame(frames, from, to, g) {
  const a = posCenter(from, g); const b = posCenter(to, g);
  const L = Math.hypot(b.x - a.x, b.y - a.y);
  for (const f of frames) {
    if (f.anim === 'idle') continue;
    for (const [x, y] of f.pieces) {
      const da = Math.hypot(x - a.x, y - a.y); const db = Math.hypot(x - b.x, y - b.y);
      if (da > 3 && db > 3 && da + db < L + 4) return { x, y, anim: f.anim };
    }
  }
  return null;
}

export const scenarios = [
  // ---------------------------------------------------------------- TS-14
  {
    id: 'TS-14', group: 'A', limitMinutes: 8,
    async run(ctx) {
      const u = await ctx.reg('w');
      const room = await u.aiGame();
      const page = await openRoom(ctx, u, room.id);
      const pix = await pixHelper(ctx);
      const { buf, W, H } = await boardShot(page);
      await ctx.shot(page, 'board');
      require0(ctx, buf, 'board-element');
      await pix.load(buf);
      const dx = W / 9; const dy = H / 10;
      const X = (c) => (c + 0.5) * dx; const Y = (r) => (r + 0.5) * dy;
      // line-like at (x,y): any pixel within ±1px differs from interior ref by >T
      const T = 40;
      async function lineAt(x, y, ref, horiz) {
        const pts = [-1, 0, 1].map((k) => (horiz ? [x, y + k] : [x + k, y]));
        const ps = await pix.px(pts);
        const d = Math.max(...ps.filter(Boolean).map((p) => dist(p, ref)));
        return { d, ok: d > T };
      }
      // CP1 lines
      const fails1 = []; const obs1 = [];
      for (let r = 0; r <= 9; r++) for (let c = 0; c <= 7; c++) {
        const rr = r < 9 ? r + 1 : r - 1;
        const [ref] = await pix.px([[X(c) + dx / 2, (Y(r) + Y(rr)) / 2]]);
        const l = await lineAt((X(c) + X(c + 1)) / 2, Y(r), ref, true);
        if (!l.ok) fails1.push(`H r${r} c${c}-${c + 1} d=${l.d}`);
      }
      for (let c = 0; c <= 8; c++) for (let r = 0; r <= 8; r++) {
        const cc = c < 8 ? c + 1 : c - 1;
        const [ref] = await pix.px([[(X(c) + X(cc)) / 2, Y(r) + dy / 2]]);
        const l = await lineAt(X(c), (Y(r) + Y(r + 1)) / 2, ref, false);
        const river = r === 4;
        const edge = c === 0 || c === 8;
        if (river) {
          // a continuous vertical line is line-coloured at 20%/50%/80% of the gap; river text is not
          const ls = [];
          // interior reference taken outside the river (river text may cover the river square centre)
          const [ref] = await pix.px([[(X(c) + X(cc)) / 2 + 3, Y(3) + dy / 2]]);
          for (let y = Math.ceil(Y(r) + 3); y <= Y(r + 1) - 3; y++) ls.push(await lineAt(X(c), y, ref, false));
          const frac = ls.filter((x) => x.ok).length / ls.length;
          const cont = frac > 0.9;
          obs1.push(`c${c}:${frac.toFixed(2)}`);
          if (edge && !cont) fails1.push(`V 边线 c${c} 河界处不贯通`);
          if (!edge && cont) fails1.push(`V c${c} 河界处未断开`);
        } else if (!l.ok) fails1.push(`V c${c} r${r}-${r + 1} d=${l.d}`);
      }
      ctx.check('1 9 条竖线 10 条横线，中间 7 条竖线在河界断开、两侧边线贯通', fails1.length === 0, fails1.length ? fails1.slice(0, 20).join('; ') : `全部中点为线条像素；河界：${obs1.join(',')}`);
      // CP2
      const chu = await page.getByText('楚河').count(); const han = await page.getByText('汉界').count();
      ctx.check('2 河界处有“楚河”“汉界”文字', chu > 0 && han > 0, `楚河=${chu} 汉界=${han}`);
      // CP3 palace diagonals quarter points
      const fails3 = [];
      for (const [r0] of [[0], [7]]) {
        const qs = [[3.5, r0 + 0.5], [4.5, r0 + 1.5], [4.5, r0 + 0.5], [3.5, r0 + 1.5]];
        for (const [cq, rq] of qs) {
          const x = (cq + 0.5) * dx; const y = (rq + 0.5) * dy;
          const [ref] = await pix.px([[x + dx * 0.25, y]]);
          const ps = await pix.px([[x, y], [x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]);
          const d = Math.max(...ps.map((p) => dist(p, ref)));
          if (d <= T) fails3.push(`(${cq},${rq}) d=${d}`);
        }
      }
      ctx.check('3 双方九宫各有两条交叉斜线（对角线四分点为线条像素）', fails3.length === 0, fails3.length ? fails3.join('; ') : '8 个四分点均为线条像素');
      // CP5 wood
      const pts = [];
      for (let i = 0; i < 20; i++) { const c = i % 8; const r = [0, 2, 5, 7, 8][i % 5]; pts.push([X(c) + dx / 2 + (i % 3) - 1, Y(r) + dy / 2 + (i % 2)]); }
      const ps5 = await pix.px(pts);
      const avg = ps5.reduce((a, p) => ({ r: a.r + p.r / 20, g: a.g + p.g / 20, b: a.b + p.b / 20 }), { r: 0, g: 0, b: 0 });
      const uniq = new Set(ps5.map((p) => `${p.r},${p.g},${p.b}`)).size;
      ctx.check('5 木纹底色：方格内 20 像素平均为暖色木色（R>G>B）且不是同一颜色', avg.r > avg.g && avg.g > avg.b && uniq > 1, `avg=(${avg.r.toFixed(0)},${avg.g.toFixed(0)},${avg.b.toFixed(0)}) 不同颜色数=${uniq}`);
      await u.leave(room.id);

      // CP4 position marks on online game: each side must vacate both cannon points, one middle
      // pawn point (c/e/g) and one edge pawn point (a/i). Keep moving until that is achieved.
      const SIDE = {
        red: { cannon: ['b2', 'h2'], mid: ['e3', 'c3', 'g3'], edge: ['a3', 'i3'], fwd: ['a4', 'i4'] },
        black: { cannon: ['b7', 'h7'], mid: ['e6', 'c6', 'g6'], edge: ['a6', 'i6'], fwd: ['a5', 'i5'] },
      };
      const sideNeeds = (st, s) => {
        const S = SIDE[s]; const emp = (p) => !occupied(st, p);
        const out = S.cannon.filter((p) => !emp(p));
        if (!S.mid.some(emp)) out.push(...S.mid);
        if (!S.edge.some(emp)) out.push(...S.edge);
        return out;
      };
      let u1; let u2; let roomId; let p1 = null; let done = false;
      for (let game = 0; game < 3 && !done; game++) {
        if (p1) { await p1.close().catch(() => {}); await u1.leave(roomId).catch(() => {}); }
        ({ u1, u2, roomId } = await onlineChess());
        ctx.track(u1); ctx.track(u2);
        p1 = await openRoom(ctx, u1, roomId);
        for (let i = 0; i < 30; i++) {
          const st = await u1.state(roomId);
          if (st.chess?.status !== 'active') { ctx.log(`game ${game} ended: ${st.chess?.status}`); break; }
          const side = st.chess.turn;
          const otherSide = side === 'red' ? 'black' : 'red';
          if (!sideNeeds(st, 'red').length && !sideNeeds(st, 'black').length) { done = true; break; }
          const mover = side === 'red' ? u1 : u2;
          // do not block the opponent's edge pawns' forward step
          const soft = SIDE[otherSide].fwd;
          let mv = null;
          for (let k = 0; k < 3 && !mv; k++) {
            mv = await apiMovePref(mover, roomId, sideNeeds(st, side), MARK_POS, { page: mover === u1 ? p1 : null, soft });
            if (!mv) await sleep(1000);
          }
          ctx.log(`game ${game} move ${i} ${side}: ${mv}`);
          if (!mv) break;
          if (!(await pageMatchesApi(p1, u1, roomId, 60000))) ctx.notReported('棋盘 1 分钟内未回到 idle');
        }
      }
      const st = await u1.state(roomId);
      const empties = MARK_POS.filter((p) => !occupied(st, p));
      const m = cellMap(await cells(p1));
      const shot = await boardShot(p1);
      await ctx.shot(p1, 'marks');
      await pix.load(shot.buf);
      const g = await boardGeom(p1);
      const res = await pix.eval(({ list, dx }) => {
        const I = window.__img;
        const at = (x, y) => { const o = (Math.round(y) * I.w + Math.round(x)) * 4; return [I.d[o], I.d[o + 1], I.d[o + 2]]; };
        const out = {};
        for (const { pos, cx, cy } of list) {
          const q = {};
          for (const [sx, sy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
            const ref = at(cx + sx * dx * 0.45, cy + sy * dx * 0.45);
            let cnt = 0;
            for (let a = 3; a <= dx * 0.35; a++) for (let b = 3; b <= dx * 0.35; b++) {
              const p = at(cx + sx * a, cy + sy * b);
              if (Math.max(Math.abs(p[0] - ref[0]), Math.abs(p[1] - ref[1]), Math.abs(p[2] - ref[2])) > 40) cnt++;
            }
            q[`${sx > 0 ? 'R' : 'L'}${sy > 0 ? 'D' : 'U'}`] = cnt;
          }
          out[pos] = q;
        }
        return out;
      }, { list: empties.map((pos) => { const e = posCenter(pos, { box: { x: 0, y: 0, width: shot.W, height: shot.H }, orientation: g.orientation }); return { pos, cx: e.x, cy: e.y }; }), dx: shot.W / 9 });
      ctx.saveJson('marks', { empties, res });
      const fails4 = []; const obs4 = [];
      const needed = { redCannon: ['b2', 'h2'].filter((p) => empties.includes(p)).length, redMid: ['c3', 'e3', 'g3'].some((p) => empties.includes(p)), redEdge: ['a3', 'i3'].some((p) => empties.includes(p)), blkCannon: ['b7', 'h7'].filter((p) => empties.includes(p)).length, blkMid: ['c6', 'e6', 'g6'].some((p) => empties.includes(p)), blkEdge: ['a6', 'i6'].some((p) => empties.includes(p)) };
      for (const pos of empties) {
        const c = m[pos];
        if (!(c && c.content === '空' && !c.face)) { fails4.push(`${pos} 非空 ${c?.label}`); continue; }
        const q = res[pos]; const MIN = 3;
        const disp = posCenter(pos, g);
        const leftEdge = disp.c === 0; const rightEdge = disp.c === 8;
        for (const [k, v] of Object.entries(q)) {
          const outer = (leftEdge && k[0] === 'L') || (rightEdge && k[0] === 'R');
          if (outer && v >= MIN) fails4.push(`${pos} 外侧象限${k} 有标记(${v})`);
          if (!outer && v < MIN) fails4.push(`${pos} 象限${k} 无折角(${v})`);
        }
        obs4.push(`${pos}:${JSON.stringify(q)}`);
      }
      const coverage = needed.redCannon >= 2 && needed.redMid && needed.redEdge && needed.blkCannon >= 2 && needed.blkMid && needed.blkEdge;
      if (!coverage) ctx.log(`coverage incomplete: ${JSON.stringify(needed)}`);
      ctx.check('4 兵卒与炮位折角标记：中间位置四象限都有、边上位置只在内侧两象限', fails4.length === 0 && empties.length > 0 && coverage, `空出=${empties.join(',')} 覆盖=${JSON.stringify(needed)} ${fails4.join('; ')} | ${obs4.join(' ')}`);
    },
  },
  // ---------------------------------------------------------------- TS-15
  {
    id: 'TS-15', group: 'A', limitMinutes: 5,
    async run(ctx) {
      const u = await ctx.reg('p');
      const room = await u.aiGame();
      const page = await openRoom(ctx, u, room.id);
      const r1 = await piecesOnPoints(page);
      await ctx.shot(page, 'cp1');
      ctx.check('1 开局 32 枚棋子中心都在交叉点上（≤2px）', r1.n === 32 && r1.bad.length === 0, `棋子数=${r1.n} 偏差=${r1.bad.slice(0, 8).join('; ')}`);
      const st0 = await u.state(room.id);
      const hidden = Object.keys(st0.chess.legalMoves).filter((p) => occupied(st0, p)?.piece === 'hidden');
      const mv = await apiMovePref(u, room.id, hidden, []);
      ctx.log(`red move ${mv}`);
      const st1 = await waitFor(async () => { const s = await u.state(room.id); return s.chess.turn === 'red' || s.chess.status !== 'active' ? s : null; }, { timeout: 60000 });
      if (!st1) ctx.notReported('电脑 1 分钟内未走棋');
      if (!(await pageMatchesApi(page, u, room.id))) ctx.notReported('棋盘 1 分钟内未回到 idle');
      const r2 = await piecesOnPoints(page);
      await ctx.shot(page, 'cp2');
      const rev = cellMap(await cells(page))[mv[1]];
      ctx.check('2 走一步（暗子翻开）与电脑走后全部棋子仍在交叉点上', r2.bad.length === 0 && r2.n >= 31 && rev?.face === 'up', `棋子数=${r2.n} 翻开=${rev?.label}/${rev?.face} 电脑=${JSON.stringify(st1.chess.lastMove)} 偏差=${r2.bad.slice(0, 8).join('; ')}`);
      const sizes = [[1280, 800], [1024, 768], [800, 600], [430, 932], [360, 800]];
      const fails = []; const obs = [];
      let ratio0 = null;
      for (const [w, h] of sizes) {
        await page.setViewportSize({ width: w, height: h });
        await sleep(800);
        await waitBoardIdle(page, 10000);
        const box = await BOARD(page).boundingBox();
        const dims = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth, sy: window.scrollY, sh: document.documentElement.scrollHeight }));
        const ratio = box.width / box.height;
        if (ratio0 == null) ratio0 = ratio;
        const ratioOk = Math.abs(box.width - 0.9 * box.height) <= 1.5;
        const topDoc = box.y + dims.sy;
        const inView = box.x >= -0.5 && box.x + box.width <= dims.iw + 0.5 && topDoc >= -0.5 && topDoc + box.height <= dims.sh + 0.5 && dims.sw <= dims.iw;
        const rp = await piecesOnPoints(page);
        await ctx.shot(page, `vp${w}x${h}`);
        obs.push(`${w}x${h}: ${box.width.toFixed(1)}x${box.height.toFixed(1)} 比=${ratio.toFixed(4)} x=${box.x.toFixed(0)} sw=${dims.sw} 偏差=${rp.bad.length}`);
        if (!ratioOk) fails.push(`${w}x${h} 宽高比 ${ratio.toFixed(4)}`);
        if (!inView) fails.push(`${w}x${h} 棋盘不完整在视口内/横向滚动 ${JSON.stringify(dims)}`);
        if (rp.bad.length) fails.push(`${w}x${h} 棋子偏离 ${rp.bad.slice(0, 3).join('; ')}`);
      }
      ctx.check('3 各视口尺寸下宽高比 0.9、棋盘完整可见无横向滚动、棋子仍在交叉点上', fails.length === 0, `${fails.join(' | ')} || ${obs.join(' ; ')}`);
    },
  },
  // ---------------------------------------------------------------- TS-16
  {
    id: 'TS-16', group: 'A', limitMinutes: 5,
    async run(ctx) {
      const { u1, u2, roomId } = await onlineChess();
      ctx.track(u1); ctx.track(u2);
      // each side reveals a few pieces
      for (let i = 0; i < 6; i++) {
        const mover = i % 2 === 0 ? u1 : u2;
        const st = await mover.state(roomId);
        const hid = Object.keys(st.chess.legalMoves).filter((p) => occupied(st, p)?.piece === 'hidden');
        await apiMovePref(mover, roomId, hid, []);
      }
      const p1 = await openRoom(ctx, u1, roomId);
      const p2 = await openRoom(ctx, u2, roomId);
      await pageMatchesApi(p1, u1, roomId); await pageMatchesApi(p2, u2, roomId);
      await ctx.shot(p1, 'u1'); await ctx.shot(p2, 'u2');
      const info = async (page) => page.evaluate((names) => {
        const b = [...document.querySelectorAll('[role="group"]')].find((e) => e.getAttribute('aria-label') === '棋盘');
        return [...b.querySelectorAll('button')].filter((x) => x.getAttribute('data-face')).map((btn) => {
          const pc = btn.firstElementChild; const cs = getComputedStyle(pc); const r = pc.getBoundingClientRect();
          let textEl = null;
          for (const el of [pc, ...pc.querySelectorAll('*')]) if ([...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) textEl = el;
          const attrs = [];
          for (const el of [btn, ...btn.querySelectorAll('*')]) for (const a of el.attributes) attrs.push(a.value);
          return {
            label: btn.getAttribute('aria-label'), face: btn.getAttribute('data-face'), text: btn.textContent,
            w: r.width, h: r.height, radius: cs.borderTopLeftRadius, shadow: cs.boxShadow, bg: cs.backgroundColor, bgImg: cs.backgroundImage, border: cs.borderTopColor, borderW: cs.borderTopWidth,
            textColor: textEl ? getComputedStyle(textEl).color : null,
            leak: names.filter((n) => btn.textContent.includes(n) || attrs.some((v) => v.includes(n))),
          };
        });
      }, CHESS_NAMES);
      const i1 = await info(p1); const i2 = await info(p2);
      ctx.saveJson('pieces', { u1: i1, u2: i2 });
      // CP1
      const bad1 = [];
      for (const x of i1) {
        const rad = x.radius.endsWith('%') ? parseFloat(x.radius) / 100 * x.w : parseFloat(x.radius);
        if (Math.abs(x.w - x.h) > 1 || rad < x.w / 2 - 1 || !x.shadow || x.shadow === 'none') bad1.push(`${x.label} ${x.w}x${x.h} r=${x.radius} sh=${x.shadow}`);
      }
      // non-flat face: gradient/url background or pixel variety
      const pix = await pixHelper(ctx);
      const upCell = i1.find((x) => x.face === 'up');
      const loc = cell(p1, upCell.label.split(' ')[0]).locator('xpath=./*[1]');
      await pix.load(await loc.screenshot());
      const pb = await loc.boundingBox();
      const ring = []; for (let k = 0; k < 12; k++) { const a = (k / 12) * 2 * Math.PI; ring.push([pb.width / 2 + Math.cos(a) * pb.width * 0.38, pb.height / 2 + Math.sin(a) * pb.height * 0.38]); }
      const rp = (await pix.px(ring)).filter(Boolean);
      const variety = new Set(rp.map((p) => `${p.r},${p.g},${p.b}`)).size;
      const notFlat = /gradient|url\(/.test(upCell.bgImg || '') || variety > 1;
      ctx.check('1 棋子圆形、有阴影、面不是单一平涂色', bad1.length === 0 && notFlat, `${bad1.slice(0, 5).join('; ')} 示例=${i1[0].w}x${i1[0].h} r=${i1[0].radius} shadow=${i1[0].shadow} bgImg=${(upCell.bgImg || '').slice(0, 80)} 环上颜色数=${variety}`);
      // CP2
      const bad2 = []; let nr = 0; let nb = 0;
      for (const x of [...i1, ...i2].filter((y) => y.face === 'up')) {
        const c = parseRgb(x.textColor);
        if (x.label.includes(' 红')) { nr++; if (!isRed(c)) bad2.push(`${x.label} ${x.textColor}`); } else { nb++; if (!(c && c.r <= 80 && c.g <= 80 && c.b <= 80)) bad2.push(`${x.label} ${x.textColor}`); }
      }
      ctx.check('2 翻开的红方棋子文字红色、黑方棋子文字深色', bad2.length === 0 && nr > 0 && nb > 0, `红=${nr} 黑=${nb} ${bad2.slice(0, 6).join('; ')}`);
      // CP3
      const bad3 = [];
      for (const x of [...i1, ...i2].filter((y) => y.face === 'down')) {
        if (!/^[a-i]\d (红暗子|黑暗子)$/.test(x.label) || x.leak.length) bad3.push(`${x.label} leak=${x.leak.join('')} text=${x.text}`);
      }
      ctx.check('3 暗子名称只为“红暗子/黑暗子”，文字、名称、属性中无棋子身份（双方页面）', bad3.length === 0, bad3.length ? bad3.slice(0, 6).join('; ') : `暗子数 u1=${i1.filter((y) => y.face === 'down').length} u2=${i2.filter((y) => y.face === 'down').length}`);
      // CP4
      const style = (arr, side) => arr.find((y) => y.face === 'down' && y.label.includes(side + '暗子'));
      const rh = style(i1, '红'); const bh = style(i1, '黑');
      const firstRgb = (s) => parseRgb((/rgba?\([^)]*\)/.exec(s || '') || [''])[0]);
      const diffs = [['bg', parseRgb(rh?.bg), parseRgb(bh?.bg)], ['bgImg', firstRgb(rh?.bgImg), firstRgb(bh?.bgImg)], ['border', parseRgb(rh?.border), parseRgb(bh?.border)]]
        .map(([k, a, b]) => [k, a && b && !(a.a === 0 && b.a === 0) ? dist(a, b) : 0]);
      ctx.check('4 红方暗子与黑方暗子背景或边框颜色明显不同（任一分量差>60）', diffs.some(([, d]) => d > 60), `红=${rh?.bg}/${(rh?.bgImg || '').slice(0, 60)}/${rh?.border} 黑=${bh?.bg}/${(bh?.bgImg || '').slice(0, 60)}/${bh?.border} 差=${JSON.stringify(diffs)}`);
      // CP5
      const key = (x) => x && `${x.bg}|${x.bgImg}|${x.border}`;
      const same = key(style(i1, '红')) === key(style(i2, '红')) && key(style(i1, '黑')) === key(style(i2, '黑'));
      ctx.check('5 双方页面上红方暗子、黑方暗子的背景与边框颜色相同', same && rh && bh, `u1红=${key(style(i1, '红'))} u2红=${key(style(i2, '红'))} u1黑=${key(style(i1, '黑'))} u2黑=${key(style(i2, '黑'))}`.slice(0, 780));
    },
  },
  // ---------------------------------------------------------------- TS-17
  {
    id: 'TS-17', group: 'A', limitMinutes: 5,
    async run(ctx) {
      const u = await ctx.reg('s');
      const room = await u.aiGame();
      const page = await openRoom(ctx, u, room.id);
      const targets = async () => (await cells(page)).filter((c) => c.marks.includes('target')).map((c) => c.pos).sort();
      const pressedOf = async (pos) => cellMap(await cells(page))[pos]?.pressed;
      const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
      async function selCheck(pos, lm) {
        await cell(page, pos).click();
        await sleep(400);
        const t = await targets(); const pr = await pressedOf(pos);
        return { ok: pr === 'true' && same(t, lm[pos] || []), obs: `${pos}: pressed=${pr} dots=${t.join(',')} api=${(lm[pos] || []).slice().sort().join(',')}` };
      }
      let st = await u.state(room.id);
      const r1 = [];
      for (const pos of ['a0', 'b0', 'b2', 'a3']) r1.push(await selCheck(pos, st.chess.legalMoves));
      await ctx.shot(page, 'cp1');
      ctx.check('1 选中暗子（车位、马位、炮位、兵位）aria-pressed 为 true，小圆点集合等于 legalMoves', r1.every((x) => x.ok), r1.map((x) => x.obs).join(' | '));
      // CP3 at opening
      const own = st.chess.board.filter((p) => p.side === 'red').map((p) => p.pos);
      const noMove = own.find((p) => !(st.chess.legalMoves[p] || []).length);
      let cp3done = false;
      async function cp3(stx) {
        const own2 = stx.chess.board.filter((p) => p.side === 'red').map((p) => p.pos);
        const nm = own2.find((p) => !(stx.chess.legalMoves[p] || []).length);
        if (!nm || cp3done) return;
        await cell(page, nm).click(); await sleep(400);
        const t = await targets();
        ctx.check('3 选中没有可走位置的己方棋子后棋盘上没有小圆点', t.length === 0, `${nm}: pressed=${await pressedOf(nm)} dots=${t.join(',')}`);
        cp3done = true;
        await cell(page, nm).click(); await sleep(300);
      }
      if (noMove) await cp3(st); else ctx.log('CP3: 开局无 legalMoves 为空的己方棋子');
      // deselect
      if ((await pressedOf('a3')) === 'true') { await cell(page, 'a3').click(); await sleep(300); }
      // play moves until >=3 revealed own pieces with legal moves
      for (let i = 0; i < 12; i++) {
        st = await u.state(room.id);
        const rev = Object.keys(st.chess.legalMoves).filter((p) => { const o = occupied(st, p); return o && o.piece !== 'hidden' && o.piece !== 'king'; });
        if (rev.length >= 3) break;
        const hid = Object.keys(st.chess.legalMoves).filter((p) => occupied(st, p)?.piece === 'hidden');
        await apiMovePref(u, room.id, hid, []);
        const s2 = await waitFor(async () => { const s = await u.state(room.id); return s.chess.turn === 'red' || s.chess.status !== 'active' ? s : null; }, { timeout: 60000 });
        if (!s2) ctx.notReported('电脑 1 分钟内未走棋');
        if (s2.chess.status !== 'active') break;
      }
      st = await pageMatchesApi(page, u, room.id);
      if (!st) ctx.notReported('棋盘 1 分钟内未回到 idle');
      if (st.chess.status !== 'active') throw new Error('对局意外结束，无法继续检查');
      if (!cp3done) await cp3(st);
      if (!cp3done) ctx.log('CP3 跳过：未出现没有可走位置的己方棋子');
      const revd = Object.keys(st.chess.legalMoves).filter((p) => { const o = occupied(st, p); return o && o.piece !== 'hidden'; });
      const r2 = [];
      for (const pos of revd.slice(0, 3)) r2.push(await selCheck(pos, st.chess.legalMoves));
      await ctx.shot(page, 'cp2');
      ctx.check('2 选中翻开的己方棋子（3 枚），小圆点集合等于 legalMoves', r2.length >= 3 && r2.every((x) => x.ok), r2.map((x) => x.obs).join(' | '));
      // CP4: a selected (last of r2) -> select another -> click again
      const keys = Object.keys(st.chess.legalMoves);
      const A = revd[2] || keys[0];
      const B = keys.find((p) => p !== A);
      if ((await pressedOf(A)) !== 'true') { await cell(page, A).click(); await sleep(300); }
      await cell(page, B).click(); await sleep(400);
      const tB = await targets(); const pa = await pressedOf(A); const pb = await pressedOf(B);
      await cell(page, B).click(); await sleep(400);
      const tB2 = await targets(); const pb2 = await pressedOf(B);
      await ctx.shot(page, 'cp4');
      ctx.check('4 改选另一枚己方棋子后小圆点为新棋子的 legalMoves；再点取消选中、小圆点消失', pb === 'true' && pa === 'false' && same(tB, st.chess.legalMoves[B]) && pb2 === 'false' && tB2.length === 0,
        `${A}->${B}: A.pressed=${pa} B.pressed=${pb} dots=${tB.join(',')} api=${st.chess.legalMoves[B].join(',')}; 再点后 pressed=${pb2} dots=${tB2.join(',')}`);
    },
  },
  // ---------------------------------------------------------------- TS-18
  {
    id: 'TS-18', group: 'A', limitMinutes: 5,
    async run(ctx) {
      const { u1, u2, roomId } = await onlineChess();
      ctx.track(u1); ctx.track(u2);
      const page = await openRoom(ctx, u1, roomId);
      const sig = (st) => JSON.stringify([st.chess.turn, st.chess.board]);
      const blackMove = async () => { await apiMovePref(u2, roomId, [], ['a5', 'b5', 'c5', 'd5', 'e5', 'f5', 'g5', 'h5', 'i5']); return pageMatchesApi(page, u1, roomId); };
      // CP1 normal move via UI
      let st = await u1.state(roomId);
      const nonCap = []; for (const [f, ts] of Object.entries(st.chess.legalMoves)) for (const t of ts) if (!occupied(st, t) && !['b2', 'h2'].includes(f)) nonCap.push([f, t]);
      const [f1, t1] = nonCap[0];
      await cell(page, f1).click(); await sleep(300);
      await cell(page, t1).click();
      await sleep(500); await waitBoardIdle(page);
      let m = cellMap(await cells(page));
      st = await u1.state(roomId);
      const okA = m[t1].content !== '空' && m[f1].content === '空' && !Object.values(m).some((c) => c.pressed === 'true' || c.marks.includes('target')) && !occupied(st, f1) && occupied(st, t1) && st.chess.turn === 'black';
      await ctx.shot(page, 'cp1-move');
      const obsA = `${f1}->${t1}: 页面 ${m[f1].label} / ${m[t1].label}; 接口 turn=${st.chess.turn}`;
      // capture
      st = await blackMove();
      const caps = []; for (const [f, ts] of Object.entries(st.chess.legalMoves)) for (const t of ts) if (occupied(st, t)?.side === 'black') caps.push([f, t]);
      let okB = false; let obsB = '无可吃子走法';
      if (caps.length) {
        const [f, t] = caps[0];
        await cell(page, f).click(); await sleep(300); await cell(page, t).click();
        await sleep(500); await waitBoardIdle(page);
        m = cellMap(await cells(page)); const s2 = await u1.state(roomId);
        okB = m[t].label.includes(' 红') && m[f].content === '空' && occupied(s2, t)?.side === 'red' && s2.chess.turn === 'black';
        obsB = `${f}x${t}: 页面 ${m[t].label}; 接口 ${JSON.stringify(occupied(s2, t))} turn=${s2.chess.turn}`;
      }
      ctx.check('1 点有小圆点的位置后棋子走到该位置、选中与小圆点消失、轮到黑方；吃子后对方棋子不在棋盘上', okA && okB, `${obsA} | ${obsB}`);
      // CP2
      st = await blackMove();
      const lm = st.chess.legalMoves; const P = Object.keys(lm)[0];
      const notDot = Object.values(cellMap(await cells(page))).find((c) => c.content === '空' && !lm[P].includes(c.pos));
      const before = sig(st);
      await cell(page, P).click(); await sleep(300);
      await cell(page, notDot.pos).click();
      const h1 = await waitFor(async () => (await hintText(page)).trim(), { timeout: 3000, interval: 100 });
      await ctx.shot(page, 'cp2-hint');
      const gone = await waitFor(async () => !(await hintText(page)).trim(), { timeout: 10000, interval: 300 });
      const after2 = sig(await u1.state(roomId));
      ctx.check('2 选中后点没有小圆点的位置：出现简短中文提示并几秒后消失，局面与轮次不变', !!h1 && /[\u4e00-\u9fff]/.test(h1) && !!gone && before === after2, `点 ${P} 后点 ${notDot.pos}: 提示="${h1}" 消失=${!!gone} 局面不变=${before === after2}`);
      // CP3: no selection, click opponent piece
      for (const c of (await cells(page)).filter((x) => x.pressed === 'true')) { await cell(page, c.pos).click(); await sleep(300); }
      const opp = st.chess.board.find((p) => p.side === 'black').pos;
      const noSel = !(await cells(page)).some((x) => x.pressed === 'true');
      await cell(page, opp).click();
      const h3 = await waitFor(async () => (await hintText(page)).trim(), { timeout: 3000, interval: 100 });
      await ctx.shot(page, 'cp3-hint');
      const after3 = sig(await u1.state(roomId));
      ctx.check('3 没有选中棋子时点对方棋子：一句简短提示，局面不变', noSel && !!h3 && /[\u4e00-\u9fff]/.test(h3) && before === after3, `未选中=${noSel} 点 ${opp}: 提示="${h3}" 局面不变=${before === after3}`);
      await waitFor(async () => !(await hintText(page)).trim(), { timeout: 10000 });
      // CP4: black's turn, click own piece
      await apiMovePref(u1, roomId, [], [], { page });
      st = await pageMatchesApi(page, u1, roomId);
      await waitFor(async () => (await statusText(page)).includes('轮到黑方'), { timeout: 10000 });
      const own = st.chess.board.find((p) => p.side === 'red').pos;
      const b4 = sig(st);
      await cell(page, own).click();
      const h4 = await waitFor(async () => (await hintText(page)).trim(), { timeout: 3000, interval: 100 });
      await sleep(300);
      const pr4 = cellMap(await cells(page))[own].pressed;
      const a4 = sig(await u1.state(roomId));
      await ctx.shot(page, 'cp4-hint');
      ctx.check('4 轮到黑方时红方点自己的棋子：一句简短提示，不选中、局面不变', !!h4 && /[\u4e00-\u9fff]/.test(h4) && pr4 !== 'true' && b4 === a4, `点 ${own}: 提示="${h4}" pressed=${pr4} 局面不变=${b4 === a4}`);
      // CP5: tap areas
      st = await blackMove();
      const g = await boardGeom(page); const dxp = g.box.width / 9;
      let mv = null;
      for (const [f, ts] of Object.entries(st.chess.legalMoves)) { const t = ts.find((x) => !occupied(st, x)); if (t) { mv = [f, t]; break; } }
      await cell(page, mv[0]).click(); await sleep(300);
      let c = posCenter(mv[1], g);
      await page.mouse.click(c.x + 0.4 * dxp, c.y + 0.4 * dxp);
      await sleep(600); await waitBoardIdle(page);
      let s5 = await u1.state(roomId);
      const ok5a = s5.chess.lastMove?.from === mv[0] && s5.chess.lastMove?.to === mv[1];
      const obs5a = `0.4 偏移: 期望 ${mv[0]}->${mv[1]} 接口 lastMove=${JSON.stringify(s5.chess.lastMove)}`;
      st = await blackMove();
      // 0.6 offset: choose P,T so that neighbour N=(display c+1,r+1) exists
      const g2 = await boardGeom(page);
      const posAt = (cc, rr) => (g2.orientation === 'black-bottom' ? `${COLS[8 - cc]}${rr}` : `${COLS[cc]}${9 - rr}`);
      let best = null;
      for (const [f, ts] of Object.entries(st.chess.legalMoves)) for (const t of ts) {
        if (occupied(st, t)) continue;
        const d = posCenter(t, g2); if (d.c >= 8 || d.r >= 9) continue;
        const N = posAt(d.c + 1, d.r + 1);
        const cand = { f, t, N, nLegal: ts.includes(N) };
        if (!best || (cand.nLegal && !best.nLegal)) best = cand;
      }
      const b5 = sig(st);
      await cell(page, best.f).click(); await sleep(300);
      c = posCenter(best.t, g2);
      await page.mouse.click(c.x + 0.6 * g2.box.width / 9, c.y + 0.6 * g2.box.height / 10);
      await sleep(800); await waitBoardIdle(page);
      s5 = await u1.state(roomId);
      const ok5b = best.nLegal ? (s5.chess.lastMove?.from === best.f && s5.chess.lastMove?.to === best.N) : (sig(s5) === b5 || s5.chess.lastMove?.to === best.N);
      ctx.check('5 点按区域：偏右下 0.4 倍间距视为点中该交叉点，偏 0.6 倍间距视为点中相邻交叉点', ok5a && ok5b, `${obs5a} | 0.6 偏移: ${best.f} 目标 ${best.t} 相邻 ${best.N}(合法=${best.nLegal}) 接口 lastMove=${JSON.stringify(s5.chess.lastMove)}`);
      // CP6: held submission + opponent resigns
      if (s5.chess.turn !== 'red') st = await blackMove(); else st = await pageMatchesApi(page, u1, roomId);
      let mv6 = null;
      for (const [f, ts] of Object.entries(st.chess.legalMoves)) { const t = ts.find((x) => !occupied(st, x)); if (t) { mv6 = [f, t]; break; } }
      let release; const held = new Promise((r) => { release = r; });
      let gotReq = false;
      await page.route('**/chess/move', async (route) => { gotReq = true; await held; await route.continue(); });
      await cell(page, mv6[0]).click(); await sleep(300);
      await cell(page, mv6[1]).click();
      await waitFor(async () => gotReq, { timeout: 5000, interval: 100 });
      const rs = await u2.resign(roomId);
      await sleep(300);
      release();
      const hints = [];
      await waitFor(async () => { const h = (await hintText(page)).trim(); if (h) hints.push(h); return false; }, { timeout: 3000, interval: 100 });
      await waitBoardIdle(page, 10000);
      await sleep(500);
      await ctx.shot(page, 'cp6');
      const s6 = await u1.state(roomId);
      m = cellMap(await cells(page));
      const back = m[mv6[0]].content !== '空' && m[mv6[1]].content === '空' && !!occupied(s6, mv6[0]);
      const dlg = await page.getByRole('dialog', { name: '对局结果' }).isVisible().catch(() => false);
      const alerts = await page.getByRole('alert').allInnerTexts().catch(() => []);
      const reason = hints[0] || alerts.find((a) => a.trim());
      const latest = s6.chess.status !== 'active' ? dlg : true;
      ctx.check('6 提交未被接受：显示一句原因，棋子回到原位，页面显示最新局面（结果画面）', gotReq && rs.status === 200 && !!reason && back && latest,
        `暂扣=${gotReq} 认输=${rs.status} 原因="${reason || ''}" ${mv6[0]}=${m[mv6[0]].label} ${mv6[1]}=${m[mv6[1]].label} 接口 status=${s6.chess.status} 结果画面=${dlg}`);
      await page.unroute('**/chess/move');
    },
  },
  // ---------------------------------------------------------------- TS-19
  {
    id: 'TS-19', group: 'A', limitMinutes: 5,
    async run(ctx) {
      const { u1, u2, roomId } = await onlineChess();
      ctx.track(u1); ctx.track(u2);
      const p1 = await openRoom(ctx, u1, roomId);
      const p2 = await openRoom(ctx, u2, roomId);
      // CP1: hidden-piece move via UI
      let st = await u1.state(roomId);
      let mv = null;
      for (const [f, ts] of Object.entries(st.chess.legalMoves)) { if (occupied(st, f)?.piece !== 'hidden') continue; const t = ts.find((x) => !occupied(st, x)); if (t) { mv = [f, t]; break; } }
      await cell(p1, mv[0]).click(); await sleep(300);
      await startRec(p1); await startRec(p2);
      await cell(p1, mv[1]).click();
      await sleep(500); await waitBoardIdle(p1); await waitBoardIdle(p2); await sleep(400);
      const fr1 = await stopRec(p1); const fr2 = await stopRec(p2);
      ctx.saveJson('cp1-frames', { mv, u1: fr1.slice(0, 200).map((f) => ({ t: f.t, anim: f.anim, to: f.cl[mv[1]], from: f.cl[mv[0]] })), u2: fr2.slice(0, 200).map((f) => ({ t: f.t, anim: f.anim, to: f.cl[mv[1]] })) });
      const g1 = await boardGeom(p1); const g2 = await boardGeom(p2);
      const judge1 = (fr, g) => {
        const anims = fr.map((f) => f.anim);
        const firstNonIdle = anims.findIndex((a) => a !== 'idle');
        const firstFlip = anims.indexOf('flipping');
        const firstUp = fr.findIndex((f) => f.cl[mv[1]]?.[1] === 'up');
        const mid = sawMidFrame(fr, mv[0], mv[1], g);
        const preUpLabels = fr.slice(0, firstUp < 0 ? fr.length : firstUp).map((f) => f.cl[mv[1]]?.[0]).filter((l) => l && !/(暗子|空)$/.test(l));
        const endIdle = anims[anims.length - 1] === 'idle';
        const ok = firstNonIdle >= 0 && !!mid && firstFlip > firstNonIdle && firstUp >= firstFlip && preUpLabels.length === 0 && endIdle;
        return { ok, obs: `非idle首帧=${firstNonIdle} 中间帧=${mid ? `${mid.x.toFixed(0)},${mid.y.toFixed(0)}@${mid.anim}` : '无'} flipping首帧=${firstFlip} up首帧=${firstUp} 翻面前名称泄露=${preUpLabels.slice(0, 2)} 序列=${[...new Set(anims)].join('>')} 结束idle=${endIdle}` };
      };
      const j1 = judge1(fr1, g1); const j2 = judge1(fr2, g2);
      ctx.check('1 暗子走棋：双方页面 data-anim 先非 idle、采到中间帧、随后 flipping 且翻面后才 up、最后回到 idle', j1.ok && j2.ok, `${mv.join('->')} U1: ${j1.obs} | U2: ${j2.obs}`);
      // CP3 (after U1 move)
      const marksOk = async (page, f, t) => {
        const cs = await cells(page);
        const lf = cs.filter((c) => c.marks.includes('last-from')).map((c) => c.pos);
        const lt = cs.filter((c) => c.marks.includes('last-to')).map((c) => c.pos);
        return { ok: lf.length === 1 && lf[0] === f && lt.length === 1 && lt[0] === t, obs: `from=${lf} to=${lt}` };
      };
      const m1a = await marksOk(p1, mv[0], mv[1]); const m1b = await marksOk(p2, mv[0], mv[1]);
      await ctx.shot(p1, 'cp3-u1'); await ctx.shot(p2, 'cp3-u2');
      // U2 moves: prefer capture to also cover CP2
      st = await u2.state(roomId);
      let bmv = null;
      for (const [f, ts] of Object.entries(st.chess.legalMoves)) { const t = ts.find((x) => occupied(st, x)?.side === 'red'); if (t) { bmv = [f, t]; break; } }
      const capFrames = [];
      if (!bmv) { for (const [f, ts] of Object.entries(st.chess.legalMoves)) { const t = ts.find((x) => !occupied(st, x)); if (t) { bmv = [f, t]; break; } } }
      const isCap = !!occupied(st, bmv[1]);
      const victimLabel = cellMap(await cells(p1))[bmv[1]]?.label;
      await startRec(p1); await startRec(p2);
      await cell(p2, bmv[0]).click(); await sleep(300); await cell(p2, bmv[1]).click();
      await sleep(500); await waitBoardIdle(p1); await waitBoardIdle(p2); await sleep(400);
      capFrames.push(await stopRec(p1), await stopRec(p2));
      const m2a = await marksOk(p1, bmv[0], bmv[1]); const m2b = await marksOk(p2, bmv[0], bmv[1]);
      ctx.check('3 上一步标记：走后双方起点 last-from、终点 last-to 且仅此两处；下一步后标记移到新位置、旧标记消失', m1a.ok && m1b.ok && m2a.ok && m2b.ok, `第1步 ${mv.join('->')} U1 ${m1a.obs} U2 ${m1b.obs} | 第2步 ${bmv.join('->')} U1 ${m2a.obs} U2 ${m2b.obs}`);
      // CP2 capture
      let capObs = ''; let capOk = false;
      let cap = isCap ? { mv: bmv, frames: capFrames, victim: victimLabel } : null;
      for (let i = 0; i < 6 && !cap; i++) {
        // keep playing via UI (alternating) until a capture is available
        const turnApi = i % 2 === 0 ? u1 : u2; const tp = i % 2 === 0 ? p1 : p2;
        const s = await turnApi.state(roomId);
        let c = null; let any = null;
        for (const [f, ts] of Object.entries(s.chess.legalMoves)) for (const t of ts) { const o = occupied(s, t); if (o && o.side !== s.chess.yourColor && !c) c = [f, t]; if (!o && !any) any = [f, t]; }
        const pick = c || any;
        const vl = cellMap(await cells(p1))[pick[1]]?.label;
        await startRec(p1); await startRec(p2);
        await cell(tp, pick[0]).click(); await sleep(300); await cell(tp, pick[1]).click();
        await sleep(500); await waitBoardIdle(p1); await waitBoardIdle(p2); await sleep(400);
        const frs = [await stopRec(p1), await stopRec(p2)];
        if (c) cap = { mv: pick, frames: frs, victim: vl };
      }
      if (cap) {
        const res = cap.frames.map((fr) => {
          const capF = fr.filter((f) => f.anim === 'capturing');
          const stillThere = capF.some((f) => (f.cl[cap.mv[1]]?.[0] || '').split(' ')[1]?.[0] !== cap.mv[0] && f.pieces.length >= 2 && (f.cl[cap.mv[1]]?.[0] === cap.victim || f.pieces.filter((p) => p[2] === cap.mv[1] || p[2] === null).length >= 2));
          const last = fr[fr.length - 1].cl[cap.mv[1]]?.[0];
          return { ok: capF.length > 0 && stillThere && last !== cap.victim, obs: `capturing帧=${capF.length} 被吃仍可见=${stillThere} 结束=${last}` };
        });
        capOk = res.every((r) => r.ok); capObs = `${cap.mv.join('x')} 被吃=${cap.victim} U1 ${res[0].obs} U2 ${res[1].obs}`;
      } else capObs = '多步内未出现可吃子走法';
      ctx.check('2 吃子：采到 capturing 状态时被吃棋子仍在页面上，之后消失', capOk, capObs);
      // CP4: AI game
      const u3 = await ctx.reg('ai');
      const r3 = await u3.aiGame();
      const p3 = await openRoom(ctx, u3, r3.id);
      await startRec(p3);
      await apiMovePref(u3, r3.id, [], [], { page: p3 });
      const s3 = await waitFor(async () => { const s = await u3.state(r3.id); return s.chess.turn === 'red' || s.chess.status !== 'active' ? s : null; }, { timeout: 60000 });
      if (!s3) ctx.notReported('电脑 1 分钟内未走棋');
      await sleep(500); await waitBoardIdle(p3); await sleep(400);
      const fr3 = await stopRec(p3);
      const lm3 = s3.chess.lastMove;
      const g3 = await boardGeom(p3);
      const mid3 = sawMidFrame(fr3.filter((f) => f.cl[lm3.from]?.[0]?.includes('黑') || f.anim !== 'idle'), lm3.from, lm3.to, g3);
      const mk3 = await marksOk(p3, lm3.from, lm3.to);
      await ctx.shot(p3, 'cp4');
      ctx.check('4 电脑走棋同样采到动画中间帧，并有上一步标记', !!mid3 && mk3.ok, `电脑 ${lm3.from}->${lm3.to} 中间帧=${mid3 ? `${mid3.x.toFixed(0)},${mid3.y.toFixed(0)}@${mid3.anim}` : '无'} 标记 ${mk3.obs}`);
    },
  },
  // ---------------------------------------------------------------- TS-20
  {
    id: 'TS-20', group: 'A', limitMinutes: 5,
    async run(ctx) {
      const { u1, u2, roomId } = await onlineChess();
      ctx.track(u1); ctx.track(u2);
      const p1 = await openRoom(ctx, u1, roomId);
      const p2 = await openRoom(ctx, u2, roomId);
      const TYPE = { 车: 'rook', 車: 'rook', 马: 'horse', 馬: 'horse', 相: 'elephant', 象: 'elephant', 仕: 'advisor', 士: 'advisor', 帅: 'king', 将: 'king', 炮: 'cannon', 砲: 'cannon', 兵: 'pawn', 卒: 'pawn' };
      const turnFails = []; let steps = 0;
      const checkTurn = async () => {
        const st = await u1.state(roomId);
        const want = st.chess.turn === 'red' ? '轮到红方' : '轮到黑方';
        const ok = await waitFor(async () => (await statusText(p1)).includes(want) && (await statusText(p2)).includes(want), { timeout: 10000 });
        const t1 = await statusText(p1); const t2 = await statusText(p2);
        const you1 = t1.includes('轮到你'); const you2 = t2.includes('轮到你');
        const youOk = st.chess.turn === 'red' ? you1 && !you2 : you2 && !you1;
        steps++;
        if (!ok || !youOk) turnFails.push(`步${steps} 接口=${st.chess.turn} U1="${t1}" U2="${t2}"`);
        return st;
      };
      let st = await checkTurn();
      const capN = (s, side) => (Array.isArray(s.chess.captured) ? s.chess.captured.filter((x) => x.side === side).length : (s.chess.captured?.[side] || []).length);
      for (let i = 0; i < 40 && st.chess.status === 'active'; i++) {
        const mover = st.chess.turn === 'red' ? u1 : u2;
        const s = await mover.state(roomId);
        const enough = capN(s, 'red') >= 1 && capN(s, 'black') >= 1;
        if (enough && i >= 2) break;
        // prefer capture, avoid capturing king
        let pick = null; const all = [];
        for (const [f, ts] of Object.entries(s.chess.legalMoves)) for (const t of ts) { const o = occupied(s, t); all.push([f, t]); if (o && o.piece !== 'king' && !pick) pick = [f, t]; }
        if (!pick) pick = all[Math.floor(Math.random() * all.length)];
        const r = await uiMove(mover === u1 ? p1 : p2, mover, roomId, pick[0], pick[1]);
        ctx.log(`move ${pick} -> ${!!r}`);
        await waitBoardIdle(p1); await waitBoardIdle(p2);
        st = await checkTurn();
      }
      ctx.check('1 每步之后双方页面显示当前轮到哪一方与接口一致，仅轮到的一方显示“轮到你”', turnFails.length === 0 && steps > 2, `检查 ${steps} 步 ${turnFails.slice(0, 4).join(' | ')}`);
      st = await pageMatchesApi(p1, u1, roomId);
      await pageMatchesApi(p2, u2, roomId);
      await ctx.shot(p1, 'cp2-u1'); await ctx.shot(p2, 'cp2-u2');
      ctx.saveJson('captured', st.chess.captured);
      const capList = (side) => (Array.isArray(st.chess.captured) ? st.chess.captured.filter((x) => x.side === side) : (st.chess.captured?.[side] || [])).map((x) => (typeof x === 'string' ? x : x.piece)).sort();
      const pageList = async (page, name) => page.getByRole('list', { name }).getByRole('listitem').allInnerTexts();
      const fails = []; const obs = [];
      for (const [page, who] of [[p1, 'U1'], [p2, 'U2']]) {
        for (const [name, side, ch] of [['红方被吃', 'red', '红'], ['黑方被吃', 'black', '黑']]) {
          const items = (await pageList(page, name)).map((x) => x.trim());
          const types = items.map((x) => TYPE[x.slice(-1)] || x).sort();
          const api = capList(side);
          const ok = items.every((x) => x.startsWith(ch) && !x.includes('暗子')) && JSON.stringify(types) === JSON.stringify(api);
          obs.push(`${who} ${name}=[${items.join(',')}] 接口=[${api.join(',')}]`);
          if (!ok) fails.push(`${who} ${name}`);
        }
        const bb = await BOARD(page).boundingBox();
        const rb = await page.getByRole('list', { name: '红方被吃' }).boundingBox();
        const kb = await page.getByRole('list', { name: '黑方被吃' }).boundingBox();
        const mid = bb.y + bb.height / 2;
        const redBottom = who === 'U1';
        const sideOk = rb && kb && (redBottom ? rb.y > mid && kb.y + kb.height < mid : kb.y > mid && rb.y + rb.height < mid);
        obs.push(`${who} 红列表y=${rb?.y.toFixed(0)} 黑列表y=${kb?.y.toFixed(0)} 棋盘中线=${mid.toFixed(0)}`);
        if (!sideOk) fails.push(`${who} 列表位置`);
      }
      const both = capList('red').length >= 1 && capList('black').length >= 1;
      ctx.check('2 双方各被吃至少一枚后，“红方被吃”“黑方被吃”列表为实际身份且与接口 captured 一致，列表在各自一侧', both && fails.length === 0, `${fails.join(',')} || ${obs.join(' ; ')}`);
    },
  },
];

function require0(ctx, buf, name) { ctx.log(`${name} screenshot ${buf.length} bytes`); }
