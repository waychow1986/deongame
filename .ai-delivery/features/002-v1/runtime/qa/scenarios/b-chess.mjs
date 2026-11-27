// TS-21 将军提示, TS-22 结果画面与积分, TS-23 再来一局, TS-40c 翻开的相过河, TS-40d 翻开的仕出九宫并过河
import { BASE, openPage, gotoLobby, gotoRoom, sounds, sleep, waitFor, waitMyTurn, waitBoardIdle, cell } from '../lib.mjs';

// ---------- helpers ----------
const statusText = (page) => page.getByRole('status', { name: '对局状态' }).innerText({ timeout: 5000 }).catch(() => '');
const resultDialog = (page) => page.getByRole('dialog', { name: '对局结果' });

// Read the result dialog; waits until numeric rating change and latest rating are shown (no reload).
async function readResult(page, timeout = 60000) {
  const dlg = resultDialog(page);
  let sawSettling = false;
  const r = await waitFor(async () => {
    if (!(await dlg.isVisible())) return null;
    const text = await dlg.innerText();
    if (/积分结算中/.test(text)) sawSettling = true;
    const d = /积分变化[：:]?\s*([+-]?\d+)/.exec(text);
    const l = /最新积分\s*[：:]?\s*(-?\d+)/.exec(text);
    if (!d || !l) return null;
    const has = async (w) => (await dlg.getByText(w, { exact: true }).count()) > 0;
    const outcome = (await has('胜')) ? '胜' : (await has('负')) ? '负' : (await has('和')) ? '和' : '?';
    const btnAgain = await dlg.getByRole('button', { name: '再来一局' }).isVisible();
    const btnLobby = await dlg.getByRole('button', { name: '回到大厅' }).isVisible();
    return { text: text.replace(/\s+/g, ' '), outcome, delta: d[1], latest: Number(l[1]), btnAgain, btnLobby };
  }, { timeout });
  return r ? { ...r, sawSettling } : { text: null, sawSettling };
}

// Move through the UI (click from, click to); returns true once the API shows that move as last move.
async function uiMove(page, api, roomId, from, to) {
  await waitBoardIdle(page, 60000);
  const v0 = (await api.state(roomId)).version;
  await cell(page, from).click();
  await sleep(150);
  await cell(page, to).click();
  return !!(await waitFor(async () => {
    const st = await api.state(roomId);
    const lm = st.chess?.lastMove;
    return st.version > v0 && lm && lm.from === from && lm.to === to ? st : null;
  }, { timeout: 15000 }));
}

// Piece-type of a hidden piece = type of its opening position.
const POS_TYPE = {};
for (const [row, side] of [[0, 'red'], [9, 'black']]) {
  'R H E A K A E H R'.split(' ').forEach((t, i) => { POS_TYPE[String.fromCharCode(97 + i) + row] = t; });
}
for (const r of [2, 7]) { POS_TYPE['b' + r] = 'C'; POS_TYPE['h' + r] = 'C'; }
for (const r of [3, 6]) for (const c of 'acegi') POS_TYPE[c + r] = 'P';
const NAME_TYPE = { rook: 'R', chariot: 'R', horse: 'H', knight: 'H', elephant: 'E', bishop: 'E', advisor: 'A', guard: 'A', king: 'K', general: 'K', cannon: 'C', pawn: 'P', soldier: 'P' };
const xy = (p) => [p.charCodeAt(0) - 97, Number(p[1])];
const ps = (x, y) => String.fromCharCode(97 + x) + y;

function attacks(map, from, type, side, target) {
  const [x, y] = xy(from); const [tx, ty] = xy(target);
  const dx = tx - x; const dy = ty - y;
  if (type === 'R' || type === 'C') {
    if (dx !== 0 && dy !== 0) return false;
    const sx = Math.sign(dx); const sy = Math.sign(dy);
    let n = 0;
    for (let cx = x + sx, cy = y + sy; cx !== tx || cy !== ty; cx += sx, cy += sy) if (map[ps(cx, cy)]) n++;
    return type === 'R' ? n === 0 : n === 1;
  }
  if (type === 'H') {
    if (!((Math.abs(dx) === 1 && Math.abs(dy) === 2) || (Math.abs(dx) === 2 && Math.abs(dy) === 1))) return false;
    const leg = Math.abs(dx) === 2 ? ps(x + Math.sign(dx), y) : ps(x, y + Math.sign(dy));
    return !map[leg];
  }
  if (type === 'P') {
    const fwd = side === 'red' ? 1 : -1;
    if (dx === 0 && dy === fwd) return true;
    const crossed = side === 'red' ? y >= 5 : y <= 4;
    return crossed && Math.abs(dx) === 1 && dy === 0;
  }
  return false;
}
// Would move from->to (by side) give check to the opponent (using known/positional types)?
function givesCheck(board, side, from, to) {
  const map = {};
  for (const b of board) map[b.pos] = b;
  const mover = map[from];
  delete map[from];
  map[to] = { ...mover, pos: to, unknown: mover.piece === 'hidden' };
  const king = Object.values(map).find((b) => b.side !== side && b.piece === 'king');
  if (!king) return false;
  for (const b of Object.values(map)) {
    if (b.side !== side || b.unknown) continue;
    const t = b.piece === 'hidden' ? POS_TYPE[b.pos] : NAME_TYPE[b.piece];
    if (t && attacks(map, b.pos, t, side, king.pos)) return true;
  }
  return false;
}

async function newOnlineGame(ctx, u1, u2, p1, p2) {
  await u1.leaveAll(); await u2.leaveAll();
  const room = await u1.createRoom('chess');
  await u2.join(room.id);
  await gotoRoom(p1, room.id); await gotoRoom(p2, room.id);
  await p1.getByRole('group', { name: '棋盘' }).waitFor({ timeout: 20000 });
  await p2.getByRole('group', { name: '棋盘' }).waitFor({ timeout: 20000 });
  ctx.log(`new online game ${room.id}`);
  return room.id;
}

const RED_START = ['a0', 'b0', 'c0', 'd0', 'f0', 'g0', 'h0', 'i0', 'b2', 'h2', 'a3', 'c3', 'e3', 'g3', 'i3'];
const BLACK_START = RED_START.map((p) => p[0] + (9 - Number(p[1])));

async function cellNames(page) {
  return page.getByRole('group', { name: '棋盘' }).getByRole('button').evaluateAll((els) => els.map((e) => (e.getAttribute('aria-label') || e.textContent || '').trim()));
}
const lobbyRating = async (page) => {
  const t = await page.getByRole('region', { name: '我的信息' }).innerText().catch(() => '');
  const m = /象棋积分\s*(-?\d+)/.exec(t);
  return m ? Number(m[1]) : null;
};

// ---------- TS-40c / TS-40d helpers ----------
const findRed = (st, piece) => (st.chess.board || []).filter((b) => b.side === 'red' && b.piece === piece);
const occ = (st, pos) => (st.chess.board || []).find((b) => b.pos === pos);

export const scenarios = [
  {
    id: 'TS-21', group: 'L1', limitMinutes: 7, timeoutNotReported: true,
    async run(ctx) {
      const WAIT_LIMIT = Date.now() + 5 * 60_000;
      const u1 = await ctx.reg('r'); const u2 = await ctx.reg('b');
      const p1 = await openPage(ctx, u1); const p2 = await openPage(ctx, u2);
      let roomId = await newOnlineGame(ctx, u1, u2, p1, p2);
      const users = { red: [u1, p1], black: [u2, p2] };
      let found = null;
      while (Date.now() < WAIT_LIMIT && !found) {
        const st = await u1.state(roomId);
        const c = st.chess;
        if (c.status !== 'active') { roomId = await newOnlineGame(ctx, u1, u2, p1, p2); continue; }
        const [api, page] = users[c.turn];
        const ms = await api.state(roomId);
        const lm = ms.chess.legalMoves || {};
        const all = []; for (const [f, ts] of Object.entries(lm)) for (const t of ts) all.push([f, t]);
        if (!all.length) { await sleep(500); continue; }
        const checks = all.filter(([f, t]) => givesCheck(ms.chess.board, c.turn, f, t));
        const caps = all.filter(([, t]) => occ(ms, t));
        const pool = checks.length ? checks : caps.length && Math.random() < 0.6 ? caps : all;
        const [f, t] = pool[Math.floor(Math.random() * pool.length)];
        const ok = await uiMove(page, api, roomId, f, t);
        if (!ok) { ctx.log(`ui move ${f}-${t} not applied; fallback reload`); await page.reload(); continue; }
        const after = await u1.state(roomId);
        ctx.log(`move ${c.turn} ${f}-${t} inCheck=${after.chess.inCheck} status=${after.chess.status}`);
        if (after.chess.inCheck && after.chess.status === 'active') found = after;
      }
      if (!found) ctx.notReported('5 分钟内未出现可解除的将军');
      // 1 both pages show 将军
      const ok1 = await waitFor(async () => /将军/.test(await statusText(p1)) && /将军/.test(await statusText(p2)), { timeout: 15000 });
      const s1 = await statusText(p1); const s2 = await statusText(p2);
      await ctx.shot(p1, 'cp1-red'); await ctx.shot(p2, 'cp1-black');
      ctx.check('1 出现将军时双方页面都显示“将军”', !!ok1, `api inCheck=true turn=${found.chess.turn}; 红方页面=「${s1}」 黑方页面=「${s2}」`);
      // 3 chess-check sound
      await sleep(1000);
      const snd1 = (await sounds(p1)).filter((e) => e.name === 'chess-check').length;
      const snd2 = (await sounds(p2)).filter((e) => e.name === 'chess-check').length;
      ctx.check('3 出现将军时收集到 chess-check 音效事件', snd1 + snd2 >= 1, `红方页面 chess-check ${snd1} 次，黑方页面 ${snd2} 次`);
      // 2 resolve check
      let cur = found; let resolved = null;
      for (let i = 0; i < 6 && cur.chess.status === 'active'; i++) {
        const [api, page] = users[cur.chess.turn];
        const ms = await api.state(roomId);
        const all = []; for (const [f, ts] of Object.entries(ms.chess.legalMoves || {})) for (const t of ts) all.push([f, t]);
        const quiet = all.filter(([f, t]) => !givesCheck(ms.chess.board, cur.chess.turn, f, t));
        const pool = quiet.length ? quiet : all;
        const [f, t] = pool[Math.floor(Math.random() * pool.length)];
        if (!(await uiMove(page, api, roomId, f, t))) { await page.reload(); }
        cur = await u1.state(roomId);
        ctx.log(`resolve move ${f}-${t} inCheck=${cur.chess.inCheck} status=${cur.chess.status}`);
        if (!cur.chess.inCheck && cur.chess.status === 'active') { resolved = cur; break; }
      }
      if (!resolved) { ctx.check('2 解除将军后双方页面都不再显示“将军”', false, `未能得到 inCheck=false 的进行中局面 status=${cur.chess.status}`); return; }
      const ok2 = await waitFor(async () => {
        const a = await statusText(p1); const b = await statusText(p2);
        return a && b && !/将军/.test(a) && !/将军/.test(b);
      }, { timeout: 15000 });
      const t1 = await statusText(p1); const t2 = await statusText(p2);
      await ctx.shot(p1, 'cp2-red'); await ctx.shot(p2, 'cp2-black');
      ctx.check('2 解除将军后双方页面都不再显示“将军”', !!ok2, `api inCheck=false; 红方页面=「${t1}」 黑方页面=「${t2}」`);
    },
  },
  {
    id: 'TS-22', group: 'B', limitMinutes: 5,
    async run(ctx) {
      const results = [];
      const rd = async (p) => { const r = await readResult(p); results.push(r); return r; };
      // 1 AI draw
      const u1 = await ctx.reg('a');
      const r0 = (await u1.me()).rating;
      let room = await u1.aiGame();
      const p1 = await openPage(ctx, u1);
      await gotoRoom(p1, room.id);
      await p1.getByRole('button', { name: '提和' }).click();
      let r = await rd(p1);
      await ctx.shot(p1, 'cp1');
      let me = await u1.me();
      ctx.check('1 人机和棋：结果画面“和”、积分变化“0”、最新积分=对局前积分，有“再来一局”“回到大厅”',
        r.outcome === '和' && r.delta === '0' && r.latest === r0 && me.rating === r0 && r.btnAgain && r.btnLobby,
        `对局前积分=${r0} 接口积分=${me.rating} 结果画面=「${r.text}」`);
      // 2 AI resign
      room = await u1.aiGame();
      await gotoRoom(p1, room.id);
      await p1.getByRole('group', { name: '棋盘' }).waitFor();
      await p1.getByRole('button', { name: '认输' }).click();
      const confirm = p1.getByRole('dialog').getByRole('button', { name: /确认|认输/ });
      if (await confirm.isVisible().catch(() => false) && !(await resultDialog(p1).isVisible())) await confirm.first().click().catch(() => {});
      r = await rd(p1);
      await ctx.shot(p1, 'cp2');
      me = await u1.me();
      ctx.check('2 人机认输：“负”“-10”，最新积分=原积分-10，与接口一致',
        r.outcome === '负' && r.delta === '-10' && r.latest === r0 - 10 && me.rating === r0 - 10,
        `原积分=${r0} 接口积分=${me.rating} 结果画面=「${r.text}」`);
      // 3 online resign
      const u2 = await ctx.reg('b'); const u3 = await ctx.reg('c');
      const b2 = (await u2.me()).rating; const b3 = (await u3.me()).rating;
      const room3 = await u2.createRoom('chess'); await u3.join(room3.id);
      const p2 = await openPage(ctx, u2); const p3 = await openPage(ctx, u3);
      await gotoRoom(p2, room3.id); await gotoRoom(p3, room3.id);
      await p2.getByRole('group', { name: '棋盘' }).waitFor(); await p3.getByRole('group', { name: '棋盘' }).waitFor();
      await p2.getByRole('button', { name: '认输' }).click();
      const ra = await rd(p2); const rb = await rd(p3);
      await ctx.shot(p2, 'cp3-U2'); await ctx.shot(p3, 'cp3-U3');
      const m2 = await u2.me(); const m3 = await u3.me();
      ctx.check('3 联机认输：U2“负”“-10”、U3“胜”“+10”，最新积分为原积分-10/+10，与接口一致',
        ra.outcome === '负' && ra.delta === '-10' && ra.latest === b2 - 10 && m2.rating === b2 - 10
        && rb.outcome === '胜' && rb.delta === '+10' && rb.latest === b3 + 10 && m3.rating === b3 + 10,
        `U2 原=${b2} 接口=${m2.rating} 画面=「${ra.text}」; U3 原=${b3} 接口=${m3.rating} 画面=「${rb.text}」`);
      // 4 online draw accepted
      const u4 = await ctx.reg('d'); const u5 = await ctx.reg('e');
      const b4 = (await u4.me()).rating; const b5 = (await u5.me()).rating;
      const room4 = await u4.createRoom('chess'); await u5.join(room4.id);
      const p4 = await openPage(ctx, u4); const p5 = await openPage(ctx, u5);
      await gotoRoom(p4, room4.id); await gotoRoom(p5, room4.id);
      await p4.getByRole('group', { name: '棋盘' }).waitFor(); await p5.getByRole('group', { name: '棋盘' }).waitFor();
      await p4.getByRole('button', { name: '提和' }).click();
      await p5.getByRole('button', { name: '同意和棋' }).click({ timeout: 20000 });
      const rc = await rd(p4); const rdd = await rd(p5);
      await ctx.shot(p4, 'cp4-U4'); await ctx.shot(p5, 'cp4-U5');
      const m4 = await u4.me(); const m5 = await u5.me();
      ctx.check('4 联机同意和棋：双方“和”“0”，积分不变',
        rc.outcome === '和' && rc.delta === '0' && rc.latest === b4 && m4.rating === b4
        && rdd.outcome === '和' && rdd.delta === '0' && rdd.latest === b5 && m5.rating === b5,
        `U4 原=${b4} 接口=${m4.rating} 画面=「${rc.text}」; U5 原=${b5} 接口=${m5.rating} 画面=「${rdd.text}」`);
      // 5 draw declined
      const u6 = await ctx.reg('f'); const u7 = await ctx.reg('g');
      const room5 = await u6.createRoom('chess'); await u7.join(room5.id);
      const p6 = await openPage(ctx, u6); const p7 = await openPage(ctx, u7);
      await gotoRoom(p6, room5.id); await gotoRoom(p7, room5.id);
      await p6.getByRole('group', { name: '棋盘' }).waitFor(); await p7.getByRole('group', { name: '棋盘' }).waitFor();
      await p6.getByRole('button', { name: '提和' }).click();
      await p7.getByRole('button', { name: '拒绝和棋' }).click({ timeout: 20000 });
      await sleep(2000);
      const st5 = await u6.state(room5.id);
      const d6 = await resultDialog(p6).isVisible(); const d7 = await resultDialog(p7).isVisible();
      const s6 = await statusText(p6); const s7 = await statusText(p7);
      await ctx.shot(p6, 'cp5-U6'); await ctx.shot(p7, 'cp5-U7');
      ctx.check('5 拒绝提和：对局继续', st5.chess.status === 'active' && !st5.chess.drawOffer && !d6 && !d7 && /轮到/.test(s6) && /轮到/.test(s7),
        `接口 status=${st5.chess.status} drawOffer=${JSON.stringify(st5.chess.drawOffer)}; 结果画面 U6=${d6} U7=${d7}; U6「${s6}」 U7「${s7}」`);
      // 6 U3 back to lobby from result screen
      await resultDialog(p3).getByRole('button', { name: '回到大厅' }).click();
      await p3.getByRole('heading', { name: 'DeonGame' }).waitFor({ timeout: 20000 }).catch(() => {});
      await sleep(1500);
      const url = p3.url();
      const backBtn = await p3.getByRole('button', { name: '回到对局' }).count();
      const lr = await lobbyRating(p3);
      const m3b = await u3.me();
      const st3 = await u3.req('GET', `/api/rooms/${room3.id}/state`);
      const inRoom = st3.status === 200 && (st3.data?.room?.members || []).some((m) => (m.userId || m.id) === m3b.id);
      await ctx.shot(p3, 'cp6');
      ctx.check('6 U3 结果画面点“回到大厅”：显示大厅，无“回到对局”，顶部积分为最新积分，U3 不在该房间',
        /\/lobby/.test(url) && backBtn === 0 && lr === m3b.rating && m3b.currentRoomId !== room3.id && m3b.activeRoomId !== room3.id && !inRoom,
        `url=${url.replace(BASE, '')} 回到对局按钮=${backBtn} 顶部积分=${lr} 接口积分=${m3b.rating} currentRoomId=${m3b.currentRoomId} activeRoomId=${m3b.activeRoomId} 房间状态接口=${st3.status} 成员中=${inRoom}`);
      // 7 settling text (if shown) replaced by numbers without reload
      const settled = results.filter((x) => x.sawSettling);
      ctx.check('7 若短暂显示“积分结算中”，随后不需刷新即显示数值',
        results.every((x) => x.text),
        `结果画面 ${results.length} 个均${results.every((x) => x.text) ? '' : '未'}显示数值；其中曾显示“积分结算中”的 ${settled.length} 个`);
    },
  },
  {
    id: 'TS-23', group: 'B', limitMinutes: 5,
    async run(ctx) {
      // 1 AI rematch
      const u1 = await ctx.reg('a');
      const room1 = await u1.aiGame();
      const p1 = await openPage(ctx, u1);
      await gotoRoom(p1, room1.id);
      await p1.getByRole('button', { name: '认输' }).click();
      await resultDialog(p1).waitFor({ timeout: 30000 });
      await resultDialog(p1).getByRole('button', { name: '再来一局' }).click();
      const newId1 = await waitFor(async () => { const me = await u1.me(); return me.currentRoomId && me.currentRoomId !== room1.id ? me.currentRoomId : null; }, { timeout: 20000 });
      await waitFor(async () => newId1 && p1.url().includes(newId1), { timeout: 15000 });
      await p1.getByRole('group', { name: '棋盘' }).waitFor({ timeout: 15000 }).catch(() => {});
      await waitBoardIdle(p1, 30000);
      await sleep(1000);
      const st1 = newId1 ? await u1.state(newId1) : null;
      const s1 = await statusText(p1);
      const names = await cellNames(p1);
      const byPos = Object.fromEntries(names.map((n) => [n.split(' ')[0], n.split(' ').slice(1).join(' ')]));
      const bad = [];
      for (const [pos, v] of Object.entries(byPos)) {
        const exp = pos === 'e0' ? '红帅' : pos === 'e9' ? '黑将' : RED_START.includes(pos) ? '红暗子' : BLACK_START.includes(pos) ? '黑暗子' : '空';
        if (v !== exp) bad.push(`${pos}:${v}≠${exp}`);
      }
      const capItems = await p1.getByRole('region', { name: '被吃的棋子' }).getByRole('listitem').count();
      const dlgStill = await resultDialog(p1).isVisible();
      await ctx.shot(p1, 'cp1');
      ctx.check('1 U1 再来一局：直接进入新人机对局，执红，轮到红方，新开局且无上一局被吃棋子',
        !!newId1 && st1?.mode === 'ai' && st1.chess.status === 'active' && st1.chess.yourColor === 'red' && st1.chess.turn === 'red'
        && (st1.chess.captured?.red?.length || 0) + (st1.chess.captured?.black?.length || 0) === 0
        && /你执红/.test(s1) && /轮到红方/.test(s1) && names.length === 90 && bad.length === 0 && capItems === 0 && !dlgStill,
        `新房间=${newId1} mode=${st1?.mode} 接口 turn=${st1?.chess?.turn} captured=${JSON.stringify(st1?.chess?.captured)}; 页面「${s1}」 交叉点数=${names.length} 不符=${bad.slice(0, 10).join(',')} 被吃列表项=${capItems} 结果画面仍显示=${dlgStill}`);

      // online game U2 red vs U3 black; U3 resigns
      const u2 = await ctx.reg('b'); const u3 = await ctx.reg('c'); const v = await ctx.reg('v');
      const room2 = await u2.createRoom('chess'); await u3.join(room2.id);
      const p2 = await openPage(ctx, u2); const p3 = await openPage(ctx, u3); const pv = await openPage(ctx, v);
      await gotoRoom(p2, room2.id); await gotoRoom(p3, room2.id);
      await p3.getByRole('group', { name: '棋盘' }).waitFor();
      await p3.getByRole('button', { name: '认输' }).click();
      await resultDialog(p2).waitFor({ timeout: 30000 }); await resultDialog(p3).waitFor({ timeout: 30000 });
      await sleep(1000);
      const u3Before = (await resultDialog(p3).innerText()).replace(/\s+/g, ' ');
      const u3Url = p3.url();
      const dlgCount0 = await p3.getByRole('dialog').count();
      await gotoLobby(pv);
      // 2 U2 rematch
      await resultDialog(p2).getByRole('button', { name: '再来一局' }).click();
      const t0 = Date.now();
      const newId2 = await waitFor(async () => { const me = await u2.me(); return me.currentRoomId && me.currentRoomId !== room2.id ? me.currentRoomId : null; }, { timeout: 20000 });
      const waitOk = await waitFor(async () => /等待对手加入/.test(await statusText(p2)), { timeout: 15000 });
      const s2 = await statusText(p2);
      const st2 = newId2 ? await u2.state(newId2) : null;
      const row = pv.getByRole('table', { name: '房间列表' }).locator(`[data-room-id="${newId2}"]`);
      const rowOk = await waitFor(async () => { const t = await row.innerText(); return /1\/2/.test(t) && /等待中/.test(t) ? t : null; }, { timeout: 15000 });
      const rowText = await row.innerText({ timeout: 2000 }).catch(() => '(无此行)');
      await ctx.shot(p2, 'cp2-U2'); await ctx.shot(pv, 'cp2-V');
      ctx.check('2 U2 再来一局：进入新联机象棋房间，显示等待对手加入；V 大厅出现该房间“1/2”“等待中”',
        !!newId2 && st2?.game === 'chess' && st2?.mode !== 'ai' && st2?.status === 'waiting' && !!waitOk && !!rowOk,
        `新房间=${newId2} 接口 game=${st2?.game} mode=${st2?.mode} status=${st2?.status}; U2 页面「${s2}」; V 列表行「${String(rowText).replace(/\s+/g, ' ')}」`);
      // 3 U3 unchanged for 10 s
      const remain = 10000 - (Date.now() - t0);
      if (remain > 0) await sleep(remain);
      const u3After = (await resultDialog(p3).innerText().catch(() => '')).replace(/\s+/g, ' ');
      const dlgCount1 = await p3.getByRole('dialog').count();
      const body3 = await p3.locator('body').innerText();
      const me3 = await u3.me();
      await ctx.shot(p3, 'cp3-U3');
      ctx.check('3 U2 点击后 10 秒内 U3 页面无变化：仍为原结果画面，无邀请',
        u3After === u3Before && p3.url() === u3Url && dlgCount1 === dlgCount0 && !/邀请/.test(body3) && me3.currentRoomId !== newId2,
        `前「${u3Before}」 后「${u3After}」 url 未变=${p3.url() === u3Url} dialog 数 ${dlgCount0}->${dlgCount1} 含“邀请”=${/邀请/.test(body3)} U3 currentRoomId=${me3.currentRoomId}`);
      // 4 U3 back to lobby and join U2's new room
      await resultDialog(p3).getByRole('button', { name: '回到大厅' }).click();
      await p3.getByRole('heading', { name: 'DeonGame' }).waitFor({ timeout: 20000 });
      const row3 = p3.getByRole('table', { name: '房间列表' }).locator(`[data-room-id="${newId2}"]`);
      await row3.getByRole('button', { name: '加入' }).click({ timeout: 15000 });
      await p3.waitForURL(new RegExp(`/room/${newId2}`), { timeout: 15000 }).catch(() => {});
      await sleep(1500);
      const st4 = newId2 ? await u3.state(newId2) : null;
      const sa = await statusText(p2); const sb = await statusText(p3);
      await ctx.shot(p2, 'cp4-U2'); await ctx.shot(p3, 'cp4-U3');
      ctx.check('4 U3 回到大厅后加入 U2 新房间：加入成功，新对局开始，U2 执红、U3 执黑',
        p3.url().includes(newId2) && st4?.chess?.status === 'active' && st4.chess.players?.red?.userId === u2.user.id && st4.chess.players?.black?.userId === u3.user.id
        && /你执红/.test(sa) && /你执黑/.test(sb),
        `url=${p3.url().replace(BASE, '')} 接口 status=${st4?.chess?.status} red=${st4?.chess?.players?.red?.username} black=${st4?.chess?.players?.black?.username}; U2「${sa}」 U3「${sb}」`);
    },
  },
  {
    id: 'TS-40c', group: 'L2', limitMinutes: 7, timeoutNotReported: true,
    async run(ctx) {
      const LIMIT = Date.now() + 5 * 60_000;
      const u1 = await ctx.reg('a');
      let games = 0;
      while (Date.now() < LIMIT) {
        games++;
        const room = await u1.aiGame();
        let st = await u1.state(room.id);
        for (const from of ['a3', 'c3', 'g3', 'i3']) {
          if (Date.now() > LIMIT || st.chess.status !== 'active') break;
          // try crossing with any revealed red elephant first
          const done = await tryCross(st);
          if (done) return;
          const to = from[0] + '4';
          if ((st.chess.legalMoves?.[from] || []).includes(to)) {
            await u1.move(room.id, from, to);
            st = await waitMyTurn(u1, room.id, 60000);
            if (!st) ctx.notReported('电脑 1 分钟内未走棋');
          }
        }
        if (st.chess.status === 'active' && await tryCross(st)) return;
        await u1.resign(room.id);
        async function tryCross(s) {
          if (s.chess.status !== 'active' || s.chess.turn !== 'red' || s.chess.inCheck) return false;
          const king = findRed(s, 'king')[0];
          if (!king || king.pos !== 'e0') return false;
          for (const el of findRed(s, 'elephant')) {
            const [x, y] = xy(el.pos);
            if (y !== 4) continue;
            for (const dx of [-2, 2]) {
              const tx = x + dx; if (tx < 0 || tx > 8) continue;
              const to = ps(tx, 6); const eye = ps(x + dx / 2, 5);
              const tgt = occ(s, to);
              if (occ(s, eye) || (tgt && tgt.side === 'red')) continue;
              ctx.log(`game ${games}: revealed elephant at ${el.pos}, try ${el.pos}-${to}; legalMoves[${el.pos}]=${JSON.stringify(s.chess.legalMoves?.[el.pos])}`);
              const r = await u1.move(room.id, el.pos, to);
              const after = await u1.state(room.id);
              const page = await openPage(ctx, u1);
              await gotoRoom(page, room.id);
              await page.getByRole('group', { name: '棋盘' }).waitFor({ timeout: 20000 }).catch(() => {});
              await waitBoardIdle(page, 30000);
              const nameAt = (await cell(page, to).getAttribute('aria-label').catch(() => null)) || (await cell(page, to).innerText().catch(() => ''));
              const apiAt = (after.chess.board.find((b) => b.pos === to) || {});
              await ctx.shot(page, 'cross');
              ctx.check('翻开的相过河一步被接受，相到达对方一侧，页面与接口一致',
                r.status === 200 && apiAt.side === 'red' && apiAt.piece === 'elephant' && /红相/.test(nameAt),
                `第 ${games} 局 ${el.pos}→${to} 响应 ${r.status} ${r.code || ''}; 接口 ${to}=${apiAt.side}/${apiAt.piece}; 页面 ${to}「${nameAt}」; 走前 inCheck=false 帅在 e0`);
              return true;
            }
          }
          return false;
        }
      }
      ctx.notReported(`5 分钟内（${games} 局）未出现可过河的翻开的相`);
    },
  },
  {
    id: 'TS-40d', group: 'L2', limitMinutes: 7, timeoutNotReported: true,
    async run(ctx) {
      const LIMIT = Date.now() + 5 * 60_000;
      const u1 = await ctx.reg('a');
      let games = 0;
      while (Date.now() < LIMIT) {
        games++;
        const room = await u1.aiGame();
        let st = await u1.state(room.id);
        const r0 = await u1.move(room.id, 'c0', 'e2');
        if (r0.status !== 200) { ctx.log(`c0-e2 rejected ${r0.status}`); await u1.resign(room.id); continue; }
        st = await waitMyTurn(u1, room.id, 60000);
        if (!st) ctx.notReported('电脑 1 分钟内未走棋');
        const adv = st.chess.board.find((b) => b.pos === 'e2' && b.side === 'red' && b.piece === 'advisor');
        if (!adv || st.chess.status !== 'active') { await u1.resign(room.id); continue; }
        ctx.log(`game ${games}: advisor revealed at e2`);
        // three steps: row 3 (out of palace), row 4, row 5 (across river)
        let pos = 'e2'; const steps = []; let inconclusive = false;
        const labels = ['1 翻开的仕斜走一格到九宫之外被接受', '2 继续斜走一格到第 4 行被接受', '3 再斜走一格到第 5 行（过河）被接受，页面与接口一致'];
        for (let i = 0; i < 3; i++) {
          if (st.chess.status !== 'active' || st.chess.inCheck) { inconclusive = true; break; }
          const me = st.chess.board.find((b) => b.pos === pos);
          if (!me || me.side !== 'red' || me.piece !== 'advisor') { inconclusive = true; break; }
          const king = findRed(st, 'king')[0];
          if (!king || king.pos !== 'e0') { inconclusive = true; break; }
          const [x, y] = xy(pos);
          const cands = [-1, 1].map((dx) => [x + dx, y + 1]).filter(([cx]) => cx >= 0 && cx <= 8).map(([cx, cy]) => ps(cx, cy))
            .filter((t) => { const o = occ(st, t); return !o || o.side !== 'red'; })
            .filter((t) => i > 0 || !['d', 'e', 'f'].includes(t[0]) || Number(t[1]) > 2);
          if (!cands.length) { inconclusive = true; break; }
          const to = cands[Math.floor(Math.random() * cands.length)];
          const legal = st.chess.legalMoves?.[pos] || [];
          const r = await u1.move(room.id, pos, to);
          steps.push({ label: labels[i], from: pos, to, status: r.status, code: r.code, legal });
          if (r.status !== 200) break;
          pos = to;
          if (i < 2) {
            st = await waitMyTurn(u1, room.id, 60000);
            if (!st) ctx.notReported('电脑 1 分钟内未走棋');
          }
        }
        if (inconclusive && steps.every((s) => s.status === 200)) { ctx.log(`game ${games}: inconclusive after ${steps.length} steps`); await u1.resign(room.id); continue; }
        const after = await u1.state(room.id);
        const page = await openPage(ctx, u1);
        await gotoRoom(page, room.id);
        await page.getByRole('group', { name: '棋盘' }).waitFor({ timeout: 20000 }).catch(() => {});
        await waitBoardIdle(page, 30000);
        await ctx.shot(page, 'final');
        for (const [i, s] of steps.entries()) {
          let ok = s.status === 200; let extra = '';
          if (i === 2 && ok) {
            const nameAt = (await cell(page, s.to).getAttribute('aria-label').catch(() => null)) || '';
            const apiAt = after.chess.board.find((b) => b.pos === s.to) || {};
            ok = apiAt.side === 'red' && apiAt.piece === 'advisor' && /红仕/.test(nameAt);
            extra = `; 接口 ${s.to}=${apiAt.side}/${apiAt.piece}; 页面「${nameAt}」`;
          }
          ctx.check(s.label, ok, `第 ${games} 局 ${s.from}→${s.to} 响应 ${s.status} ${s.code || ''}; 走前 legalMoves[${s.from}]=${JSON.stringify(s.legal)}; 走前未被将军、帅在 e0${extra}`);
        }
        for (let i = steps.length; i < 3; i++) ctx.check(labels[i], false, '前一步被拒绝，未执行');
        return;
      }
      ctx.notReported(`5 分钟内（${games} 局）未出现可完成的翻开的仕`);
    },
  },
];
