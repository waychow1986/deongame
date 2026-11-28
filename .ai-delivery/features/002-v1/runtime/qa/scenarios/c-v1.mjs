// TS-40, TS-40a, TS-40b: v1 regression (auth guard, fixed v1 capabilities, blind-chess opening & rules, AI obeys rules)
import { Api, BASE, openPage, gotoLobby, sleep, waitFor, waitBoardIdle, onlineChess } from '../lib.mjs';

// ---------------- blind-chess rule model (per system-current.md "揭棋") ----------------
const OPEN_RED = { a0: 'rook', i0: 'rook', b0: 'horse', h0: 'horse', c0: 'elephant', g0: 'elephant', d0: 'advisor', f0: 'advisor', e0: 'king', b2: 'cannon', h2: 'cannon', a3: 'pawn', c3: 'pawn', e3: 'pawn', g3: 'pawn', i3: 'pawn' };
const OPEN = {};
for (const [p, t] of Object.entries(OPEN_RED)) { OPEN[p] = { side: 'red', t }; OPEN[p[0] + (9 - Number(p[1]))] = { side: 'black', t }; }
const HIDDEN_POS = Object.keys(OPEN).filter((p) => p !== 'e0' && p !== 'e9');
const P = (c, r) => String.fromCharCode(97 + c) + r;
const CR = (pos) => [pos.charCodeAt(0) - 97, Number(pos[1])];
const inB = (c, r) => c >= 0 && c <= 8 && r >= 0 && r <= 9;
const inPalace = (side, c, r) => c >= 3 && c <= 5 && (side === 'red' ? r <= 2 : r >= 7);
const ownHalf = (side, r) => (side === 'red' ? r <= 4 : r >= 5);
const toMap = (boardArr) => { const m = {}; for (const b of boardArr) m[b.pos] = { side: b.side, piece: b.piece }; return m; };
function pseudo(m, from) {
  const pc = m[from]; if (!pc) return [];
  const hidden = pc.piece === 'hidden';
  const t = hidden ? OPEN[from]?.t : pc.piece;
  const side = pc.side; const [c, r] = CR(from); const out = [];
  const add = (cc, rr) => { if (!inB(cc, rr)) return; const o = m[P(cc, rr)]; if (o && o.side === side) return; out.push(P(cc, rr)); };
  const fwd = side === 'red' ? 1 : -1;
  if (t === 'rook' || t === 'cannon') {
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      let cc = c + dc, rr = r + dr, jumped = false;
      while (inB(cc, rr)) {
        const o = m[P(cc, rr)];
        if (t === 'rook') { if (o) { if (o.side !== side) out.push(P(cc, rr)); break; } out.push(P(cc, rr)); }
        else if (!jumped) { if (o) jumped = true; else out.push(P(cc, rr)); }
        else if (o) { if (o.side !== side) out.push(P(cc, rr)); break; }
        cc += dc; rr += dr;
      }
    }
  } else if (t === 'horse') {
    for (const [dc, dr, lc, lr] of [[1, 2, 0, 1], [-1, 2, 0, 1], [1, -2, 0, -1], [-1, -2, 0, -1], [2, 1, 1, 0], [2, -1, 1, 0], [-2, 1, -1, 0], [-2, -1, -1, 0]]) {
      if (inB(c + lc, r + lr) && !m[P(c + lc, r + lr)]) add(c + dc, r + dr);
    }
  } else if (t === 'elephant') {
    for (const [dc, dr] of [[2, 2], [2, -2], [-2, 2], [-2, -2]]) {
      const cc = c + dc, rr = r + dr;
      if (!inB(cc, rr) || m[P(c + dc / 2, r + dr / 2)]) continue;
      if (hidden && !ownHalf(side, rr)) continue;
      add(cc, rr);
    }
  } else if (t === 'advisor') {
    for (const [dc, dr] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      if (hidden && !inPalace(side, c + dc, r + dr)) continue;
      add(c + dc, r + dr);
    }
  } else if (t === 'king') {
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (inPalace(side, c + dc, r + dr)) add(c + dc, r + dr);
  } else if (t === 'pawn') {
    add(c, r + fwd);
    if (!hidden && !ownHalf(side, r)) { add(c + 1, r); add(c - 1, r); }
  }
  return out;
}
function kingPos(m, side) { return Object.keys(m).find((p) => m[p].side === side && m[p].piece === 'king'); }
function inCheckOrFacing(m, side) {
  const k = kingPos(m, side); if (!k) return true;
  const other = side === 'red' ? 'black' : 'red';
  for (const p of Object.keys(m)) if (m[p].side === other && pseudo(m, p).includes(k)) return true;
  const ok = kingPos(m, other);
  if (ok && ok[0] === k[0]) {
    const [c, r1] = CR(k); const r2 = Number(ok[1]);
    let blocked = false;
    for (let r = Math.min(r1, r2) + 1; r < Math.max(r1, r2); r++) if (m[P(c, r)]) blocked = true;
    if (!blocked) return true;
  }
  return false;
}
function isLegal(m, side, from, to) {
  if (!m[from] || m[from].side !== side) return { ok: false, why: '起点不是己方棋子' };
  if (!pseudo(m, from).includes(to)) return { ok: false, why: `不符合${m[from].piece === 'hidden' ? '开局位置类型 ' + OPEN[from]?.t : '实际身份 ' + m[from].piece}的走法` };
  const n = { ...m }; n[to] = { ...n[from], piece: n[from].piece }; delete n[from];
  if (inCheckOrFacing(n, side)) return { ok: false, why: '走后被将军或将帅照面' };
  return { ok: true };
}
const ZH = { rook: '车', horse: '马', elephant: '象', advisor: '士', king: '将', cannon: '炮', pawn: '兵', hidden: '暗子' };

async function cellsOnPage(page) {
  const btns = page.getByRole('group', { name: '棋盘' }).getByRole('button');
  return btns.evaluateAll((els) => els.map((e) => ({ name: e.getAttribute('aria-label') || e.textContent.trim(), face: e.getAttribute('data-face'), marks: e.getAttribute('data-marks') || '' })));
}
const cellsByPos = (cells) => { const o = {}; for (const c of cells) o[c.name.split(' ')[0]] = c; return o; };
const boardSig = (st) => JSON.stringify(st.chess.board);

// V-6a check of one game: API + page
async function checkOpening(ctx, api, roomId, label) {
  const st = await api.state(roomId);
  const b = st.chess.board;
  const m = toMap(b);
  const kingsOk = m.e0?.side === 'red' && m.e0?.piece === 'king' && m.e9?.side === 'black' && m.e9?.piece === 'king';
  const others = b.filter((x) => x.pos !== 'e0' && x.pos !== 'e9');
  const allHidden = others.every((x) => x.piece === 'hidden');
  const posOk = others.length === 30 && HIDDEN_POS.every((p) => m[p] && m[p].side === OPEN[p].side);
  const page = await openPage(ctx, api);
  await page.goto(BASE + '/room/' + roomId);
  await page.getByRole('group', { name: '棋盘' }).waitFor({ timeout: 20000 });
  await waitBoardIdle(page, 10000);
  const cells = cellsByPos(await cellsOnPage(page));
  const up = Object.entries(cells).filter(([, c]) => c.face === 'up').map(([p]) => p).sort();
  const down = Object.entries(cells).filter(([, c]) => c.face === 'down').map(([p]) => p).sort();
  const pageOk = up.join() === 'e0,e9' && down.length === 30 && HIDDEN_POS.every((p) => cells[p]?.face === 'down' && cells[p].name.includes(OPEN[p].side === 'red' ? '红暗子' : '黑暗子'));
  await ctx.shot(page, `v6a-${label}`);
  await page.context().close();
  return { ok: b.length === 32 && kingsOk && allHidden && posOk && pageOk, obs: `${label}: api棋子数=${b.length} 将帅翻开=${kingsOk} 其余全暗=${allHidden} 位置=${posOk}; 页面翻开=[${up}] 暗子数=${down.length} 页面一致=${pageOk}` };
}

export const scenarios = [
  // ---------------------------------------------------------------- TS-40
  {
    id: 'TS-40', group: 'A', limitMinutes: 8,
    async run(ctx) {
      const anon = new Api('anon', '');
      // V-3 step 1
      const { u1, u2, roomId: chessId } = await onlineChess();
      ctx.track(u1); ctx.track(u2);
      const u3 = await ctx.reg('p3');
      const pr = await u3.createRoom('poker');
      const pokerId = pr.id;
      await u3.addBot(pokerId);
      const ps = await u3.pokerStart(pokerId);
      const c0 = await u1.state(chessId); const p0 = await u3.state(pokerId);
      const snap = (s) => JSON.stringify({ m: s.members, cap: s.capacity, v: s.version, c: s.chess && { b: s.chess.board, t: s.chess.turn, st: s.chess.status, d: s.chess.drawOffer }, p: s.poker && { h: s.poker.handId, st: s.poker.stage, to: s.poker.toActSeat, seats: s.poker.seats.map((x) => [x.seat, x.chips, x.committedThisHand, x.folded]) } });
      const c0s = snap(c0), p0s = snap(p0);
      ctx.log(`V-3 准备: chess status=${c0.chess.status} turn=${c0.chess.turn} v=${c0.version}; poker start=${ps.status} stage=${p0.poker?.stage} v=${p0.version}`);
      const roomsBefore = new Set((await u1.rooms()).map((r) => r.id));
      // shared env: other testers' rooms may appear; a room opened by the anonymous / logged-out context would have no host or U4 as host
      const suspectRooms = async (who) => (await u1.rooms()).filter((r) => !roomsBefore.has(r.id) && (!r.hostUsername || r.hostUsername === who)).map((r) => `${r.id}:${r.hostUsername}`);
      // step 2
      const ap = await openPage(ctx, null);
      const seen = [];
      for (const u of ['/lobby', '/room/' + chessId, '/room/' + pokerId]) {
        await ap.goto(BASE + u);
        await ap.waitForURL(/\/login/, { timeout: 10000 }).catch(() => {});
        await sleep(800);
        const url = ap.url().replace(BASE, '');
        const loginForm = await ap.getByRole('button', { name: '登录', exact: true }).isVisible().catch(() => false);
        const lobbyVis = await ap.getByRole('table', { name: '房间列表' }).isVisible().catch(() => false);
        const boardVis = await ap.getByRole('group', { name: '棋盘' }).isVisible().catch(() => false);
        const tableVis = await ap.getByRole('region', { name: '牌桌' }).isVisible().catch(() => false);
        seen.push({ u, url, ok: /\/login/.test(url) && loginForm && !lobbyVis && !boardVis && !tableVis });
      }
      await ctx.shot(ap, 'v3-2-anon');
      ctx.check('V-3 2 未登录打开大厅与房间地址都显示登录页面', seen.every((s) => s.ok), JSON.stringify(seen));
      // step 3
      async function createAttempts(who) {
        const r = [await who.req('POST', '/api/rooms', { game: 'chess' }), await who.req('POST', '/api/rooms', { game: 'poker' }), await who.req('POST', '/api/chess/ai-games', {})];
        return r.map((x) => x.status);
      }
      const cr = await createAttempts(anon);
      const extra3 = await suspectRooms(null);
      ctx.check('V-3 3 未登录开象棋房/扑克房/人机对局都被拒绝(401)且大厅不多房间', cr.every((s) => s === 401) && !extra3.length, `status=${cr} 新增无主房间=[${extra3}]`);
      // step 4
      const j = [(await anon.req('POST', `/api/rooms/${chessId}/join`, {})).status, (await anon.req('POST', `/api/rooms/${pokerId}/join`, {})).status];
      const c1 = await u1.state(chessId); const p1 = await u3.state(pokerId);
      ctx.check('V-3 4 未登录加入两房间被拒绝(401)且成员人数不变', j.every((s) => s === 401) && JSON.stringify(c1.members) === JSON.stringify(c0.members) && JSON.stringify(p1.members) === JSON.stringify(p0.members), `status=${j}`);
      // step 5
      const lm = c0.chess.legalMoves || {}; const f0 = Object.keys(lm)[0]; const t0 = f0 && lm[f0][0];
      const act = [
        (await anon.req('POST', `/api/rooms/${chessId}/chess/move`, { from: f0 || 'a3', to: t0 || 'a4' })).status,
        (await anon.req('POST', `/api/rooms/${chessId}/chess/resign`, {})).status,
        (await anon.req('POST', `/api/rooms/${chessId}/chess/draw-offer`, {})).status,
        (await anon.req('POST', `/api/rooms/${pokerId}/poker/action`, { type: 'fold' })).status,
      ];
      const c2 = await u1.state(chessId); const p2 = await u3.state(pokerId);
      // poker bot may act on its own; compare only when nothing changed by others — bot acts only on its turn, so compare against fresh snapshot equality
      const chessSame = snap(c2) === c0s; const pokerSame = snap(p2) === p0s;
      ctx.check('V-3 5 未登录走棋/认输/提和/扑克弃牌都被拒绝(401)且局面轮次version不变', act.every((s) => s === 401) && chessSame && pokerSame, `status=${act} 象棋不变=${chessSame} 扑克不变=${pokerSame} (v ${c0.version}->${c2.version}, ${p0.version}->${p2.version})`);
      // step 6
      const u4 = await ctx.reg('l4');
      const p4 = await openPage(ctx, u4);
      await gotoLobby(p4);
      await p4.getByRole('button', { name: '退出登录' }).click();
      await p4.waitForURL(/\/login/, { timeout: 10000 }).catch(() => {});
      await ctx.shot(p4, 'v3-6-loggedout');
      const req6 = (method, p, body) => p4.evaluate(async ([method, p, body]) => { const r = await fetch(p, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return r.status; }, [method, p, body]);
      const s6 = [await req6('POST', '/api/rooms', { game: 'chess' }), await req6('POST', `/api/rooms/${chessId}/join`, {}), await req6('POST', `/api/rooms/${chessId}/chess/move`, { from: f0 || 'a3', to: t0 || 'a4' })];
      const c3 = await u1.state(chessId);
      const extra6 = await suspectRooms(u4.username);
      const me4 = await u4.req('GET', '/api/me');
      ctx.check('V-3 6 页面退出登录后开房/加入/走棋都被拒绝且状态不变', s6.every((s) => s === 401) && snap(c3) === c0s && !extra6.length, `status=${s6} 象棋不变=${snap(c3) === c0s} 新增U4/无主房间=[${extra6}] (旧会话/api/me=${me4.status})`);
      await u4.login().catch(() => {});

      // F-2 initial values (lobby top vs /api/me)
      const u5 = await ctx.reg('f2');
      const me5 = await u5.me();
      const pg5 = await openPage(ctx, u5);
      await gotoLobby(pg5);
      const info = await pg5.getByRole('region', { name: '我的信息' }).innerText().catch(() => '');
      await ctx.shot(pg5, 'f2-lobby');
      ctx.check('F-2 新用户积分1000筹码1000，大厅顶部与接口一致', me5.rating === 1000 && me5.chips === 1000 && /象棋积分\s*1000/.test(info) && /扑克筹码\s*1000/.test(info), `api rating=${me5.rating} chips=${me5.chips}; 页面="${info.replace(/\s+/g, ' ')}"`);
      // F-3 one user one room
      const w = await ctx.reg('f3'); const wroom = await w.createRoom('chess');
      const f3 = [await w.req('POST', '/api/rooms', { game: 'poker' }), await w.req('POST', `/api/rooms/${pokerId}/join`, {}), await w.req('POST', '/api/chess/ai-games', {})];
      const wme = await w.me();
      ctx.check('F-3 已在等待中房间的用户开房/加入/人机都被拒绝ALREADY_IN_ROOM且currentRoomId不变', f3.every((r) => r.status === 409 && r.code === 'ALREADY_IN_ROOM') && wme.currentRoomId === wroom.id, `${f3.map((r) => r.status + ' ' + r.code)} current=${wme.currentRoomId === wroom.id}`);
      // F-4 online chess: host red first; not-your-turn rejected
      const s4 = await u2.state(chessId);
      const blackMove = await u2.move(chessId, 'a6', 'a5');
      const s4b = await u2.state(chessId);
      ctx.check('F-4 联机开局房主执红先走，不轮到时走棋被拒绝且局面不变', c0.chess.status === 'active' && c0.chess.players.red.userId === u1.user.id && c0.chess.turn === 'red' && blackMove.status === 409 && blackMove.code === 'NOT_YOUR_TURN' && boardSig(s4b) === boardSig(s4), `red=${c0.chess.players.red.username === u1.username} turn=${c0.chess.turn} 黑方抢走=${blackMove.status} ${blackMove.code}`);
      // F-5 hidden piece move reveals, consistent with API
      const mv = await u1.move(chessId, 'a3', 'a4');
      const lmv = mv.data?.room?.chess?.lastMove;
      const at = mv.data?.room?.chess?.board?.find((x) => x.pos === 'a4');
      ctx.check('F-5 开局帅将翻开其余暗子；暗子按开局位置走一步后翻开为实际身份', mv.status === 200 && lmv?.revealed && at?.piece === lmv.revealed, `move=${mv.status} revealed=${lmv?.revealed} a4=${at?.piece}`);
      // F-6 AI game: computer moves; not listed
      const a6 = await ctx.reg('f6'); const ai = await a6.aiGame();
      const listed = (await a6.rooms()).some((r) => r.id === ai.id);
      const r6 = await a6.move(ai.id, 'a3', 'a4');
      const aiMoved = await waitFor(async () => { const s = await a6.state(ai.id); return s.chess.lastMove?.side === 'black' ? s : null; }, { timeout: 60000 });
      if (aiMoved) ctx.check('F-6 人机对局用户执红，电脑在用户走后走一步，不在大厅列表', ai.chess.yourColor === 'red' && ai.chess.players.black.computer === true && r6.status === 200 && !listed, `lastMove=${JSON.stringify(aiMoved.chess.lastMove)} listed=${listed}`);
      else ctx.log('F-6 不报告：1 分钟内电脑未走棋');
      // F-7 / F-8 draw in AI immediately; resign settlement
      const d7 = await a6.req('POST', `/api/rooms/${ai.id}/chess/draw-offer`, {});
      const me6 = await a6.me();
      ctx.check('F-7 人机对局提和立即判和；F-8 和棋积分0', d7.status === 200 && d7.data.room.chess.status === 'finished' && d7.data.room.chess.result?.outcome && /draw/.test(JSON.stringify(d7.data.room.chess.result)) && me6.rating === 1000, `draw=${d7.status} result=${JSON.stringify(d7.data?.room?.chess?.result)} rating=${me6.rating}`);
      const rs = await u2.req('POST', `/api/rooms/${chessId}/chess/resign`, {});
      await sleep(1000);
      const m1 = await u1.me(), m2 = await u2.me();
      ctx.check('F-7 认输结束对局；F-8 联机双方结算胜+10负-10', rs.status === 200 && rs.data.room.chess.status === 'finished' && m1.rating === 1010 && m2.rating === 990, `resign=${rs.status} u1=${m1.rating} u2=${m2.rating}`);
      // F-9 poker start rules
      const h1 = await ctx.reg('h1'); const h2 = await ctx.reg('h2');
      const room9 = await h1.createRoom('poker');
      const lone = await h1.pokerStart(room9.id);
      await h2.join(room9.id);
      const nonHost = await h2.pokerStart(room9.id);
      const st9 = await h1.state(room9.id);
      const pgH1 = await openPage(ctx, h1);
      await pgH1.goto(BASE + '/room/' + room9.id);
      await pgH1.getByRole('region', { name: '牌桌' }).waitFor({ timeout: 20000 });
      // host starts via the page button (the requester's own page gets the snapshot from its own request)
      const startResp = pgH1.waitForResponse((r) => r.url().includes(`/api/rooms/${room9.id}/poker/start`), { timeout: 15000 }).catch(() => null);
      await pgH1.getByRole('button', { name: '开始牌局' }).click();
      const okResp = await startResp;
      const ok9 = { status: okResp ? okResp.status() : 0, data: okResp ? await okResp.json().catch(() => null) : null };
      ctx.check('F-9 一人时开始被拒绝；非房主开始被拒绝且不开局；两人时房主开始成功', lone.status === 409 && lone.code === 'NOT_ENOUGH_PLAYERS' && nonHost.status === 403 && st9.status !== 'playing' && ok9.status === 200, `lone=${lone.status} ${lone.code} nonHost=${nonHost.status} ${nonHost.code} status=${st9.status} start=${ok9.status}`);
      // F-10 blinds heads-up
      await waitFor(async () => (await h1.state(room9.id)).poker?.handNumber === 1, { timeout: 10000 });
      await sleep(1500);
      const P10 = (await h1.state(room9.id)).poker;
      const sa = P10?.seats.find((s) => s.userId === h1.user.id), sb = P10?.seats.find((s) => s.userId === h2.user.id);
      await sleep(1500);
      const seatTxt = async (name) => pgH1.getByRole('region', { name: new RegExp(`^座位 \\d+：${name}`) }).innerText().catch(() => '');
      const t1 = await seatTxt(h1.username), t2 = await seatTxt(h2.username);
      const imgs = async (name) => pgH1.getByRole('region', { name: new RegExp(`^座位 \\d+：${name}`) }).getByRole('img').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') || e.getAttribute('alt') || ''));
      const i1 = await imgs(h1.username), i2 = await imgs(h2.username);
      await ctx.shot(pgH1, 'f10-blinds');
      const apiOk = P10?.blinds.small === 5 && P10.blinds.big === 10 && sa?.committedThisRound === 5 && sb?.committedThisRound === 10 && sa.chips === 995 && sb.chips === 990 && sa.isDealer;
      const pageOk = /本轮下注\s*5\b/.test(t1) && /本轮下注\s*10\b/.test(t2) && /筹码\s*995/.test(t1) && /筹码\s*990/.test(t2) && i1.includes('小盲') && i2.includes('大盲');
      ctx.check('F-10 两人桌庄家房主下小盲5、对方大盲10自动扣除，页面与接口一致', apiOk && pageOk, `api sb=${sa?.committedThisRound}/${sa?.chips} bb=${sb?.committedThisRound}/${sb?.chips}; 页面 U1="${t1.replace(/\s+/g, ' ')}" [${i1}] U2="${t2.replace(/\s+/g, ' ')}" [${i2}]`);
      // F-11: fold -> other wins; next hand auto; rotation (F-10 second hand)
      const before1 = await h1.me(), before2 = await h2.me();
      const fo = await h1.action(room9.id, 'fold');
      const done = fo.data?.room?.poker;
      await sleep(800);
      const after1 = await h1.me(), after2 = await h2.me();
      const winOk = fo.status === 200 && after1.chips === before1.chips - 5 && after2.chips === before2.chips + 5;
      // F-12: other human's page (H2) shows update — use H1 page refresh-free: wait for the next hand to show
      const next = await waitFor(async () => { const s = await h1.state(room9.id); return s.poker?.handNumber === 2 && s.poker.stage !== 'complete' ? s : null; }, { timeout: 60000 });
      if (next) {
        const na = next.poker.seats.find((s) => s.userId === h1.user.id), nb = next.poker.seats.find((s) => s.userId === h2.user.id);
        ctx.check('F-11 除一人外全部弃牌时剩下的人赢得底池，余额按净输赢变化，一手结束后自动开始下一手', winOk, `fold=${fo.status} stage=${done?.stage} u1 ${before1.chips}->${after1.chips} u2 ${before2.chips}->${after2.chips} hand2=${next.poker.handNumber}`);
        ctx.check('F-10 下一手庄家轮转到U2，U2下小盲5、U1下大盲10', nb?.isDealer && nb.committedThisRound === 5 && na?.committedThisRound === 10, `u2 dealer=${nb?.isDealer} sb=${nb?.committedThisRound} u1 bb=${na?.committedThisRound}`);
        const shown = await waitFor(async () => { const t = await seatTxt(h2.username); const im = await imgs(h2.username); return im.includes('小盲') && /本轮下注\s*5\b/.test(t) ? t : null; }, { timeout: 60000 });
        await ctx.shot(pgH1, 'f12-next-hand');
        if (shown) ctx.check('F-12 一手结束与新一手开始后，另一真人玩家页面不刷新显示新状态与接口一致', true, `U2座位="${shown.replace(/\s+/g, ' ')}"`);
        else ctx.log('F-12 不报告：1 分钟内页面未显示新一手');
      } else {
        ctx.check('F-11 除一人外全部弃牌时剩下的人赢得底池，余额按净输赢变化', winOk, `u1 ${before1.chips}->${after1.chips} u2 ${before2.chips}->${after2.chips}`);
        ctx.log('F-11 自动下一手不报告：1 分钟内未开始');
      }
      // F-11 add bot only between hands; bot name
      const botMid = await h1.addBot(room9.id);
      ctx.check('F-11 手牌进行中房主添加电脑玩家被拒绝', botMid.status === 409 && botMid.code === 'HAND_IN_PROGRESS', `${botMid.status} ${botMid.code}`);
      const pk = (await u3.state(pokerId)).poker;
      const bot = pk.seats.find((s) => s.kind === 'bot');
      ctx.check('F-11 电脑玩家名称为“电脑 N”且计入人数', bot && /^电脑 \d+$/.test(bot.name) && pk.seats.filter(Boolean).length === 2, `bot=${bot?.name} seats=${pk.seats.length}`);
      // F-10 three-handed
      const t3 = [await ctx.reg('t1'), await ctx.reg('t2'), await ctx.reg('t3')];
      const r3 = await t3[0].createRoom('poker'); await t3[1].join(r3.id); await t3[2].join(r3.id);
      const s3 = (await t3[0].pokerStart(r3.id)).data?.room?.poker;
      const bySeat = (s3?.seats || []).slice().sort((a, b) => a.seat - b.seat);
      const di = bySeat.findIndex((s) => s.isDealer);
      const sbS = bySeat[(di + 1) % bySeat.length], bbS = bySeat[(di + 2) % bySeat.length];
      ctx.check('F-10 三人桌庄家下家小盲5、再下家大盲10', di >= 0 && sbS?.isSmallBlind && sbS.committedThisRound === 5 && bbS?.isBigBlind && bbS.committedThisRound === 10, `dealer=${bySeat[di]?.seat} sb=${sbS?.seat}/${sbS?.committedThisRound} bb=${bbS?.seat}/${bbS?.committedThisRound}`);
    },
  },
  // ---------------------------------------------------------------- TS-40a
  {
    id: 'TS-40a', group: 'B', limitMinutes: 8,
    async run(ctx) {
      const u1 = await ctx.reg('a1'); const u2 = await ctx.reg('a2');
      // V-6a
      const ai = await u1.aiGame();
      const o1 = await checkOpening(ctx, u1, ai.id, 'ai');
      await u1.resign(ai.id); await u1.leave(ai.id);
      const on = await u1.createRoom('chess'); await u2.join(on.id);
      const o2 = await checkOpening(ctx, u1, on.id, 'online');
      ctx.check('V-6a 开局32枚、帅将翻开在e0/e9、其余30枚为暗子在开局位置（人机与联机）', o1.ok && o2.ok, `${o1.obs} | ${o2.obs}`);
      // V-8c on the online game
      const r1 = await u1.move(on.id, 'a3', 'a4');
      const b0 = await u2.state(on.id);
      const x1 = await u2.move(on.id, 'b9', 'b8'); const x2 = await u2.move(on.id, 'h7', 'g5');
      const b1 = await u2.state(on.id);
      const y = await u2.move(on.id, 'a6', 'a5');
      const ya = y.data?.room?.chess;
      const v8c = r1.status === 200 && x1.code === 'ILLEGAL_MOVE' && x2.code === 'ILLEGAL_MOVE' && boardSig(b1) === boardSig(b0) && b1.version === b0.version && b1.chess.turn === 'black' && y.status === 200 && ya?.lastMove?.revealed && ya.board.find((p) => p.pos === 'a5')?.piece === ya.lastMove.revealed;
      ctx.check('V-8c 黑方 b9→b8、h7→g5 被拒绝且局面不变；a6→a5 被接受并翻开', v8c, `a3a4=${r1.status} b9b8=${x1.status} ${x1.code} h7g5=${x2.status} ${x2.code} 不变=${boardSig(b1) === boardSig(b0)} a6a5=${y.status} revealed=${ya?.lastMove?.revealed}`);
      await u1.resign(on.id); await u1.leave(on.id); await u2.leave(on.id);
      // V-8a
      const g = await u1.aiGame();
      const st0 = await u1.state(g.id);
      const bad = [['a0', 'b1'], ['b0', 'b1'], ['b0', 'd1'], ['c0', 'c1'], ['d0', 'd1'], ['d0', 'c1'], ['b2', 'c4'], ['b2', 'b7'], ['a3', 'b3'], ['a3', 'a2'], ['a3', 'a5']];
      const res = [];
      for (const [f, t] of bad) {
        const r = await u1.move(g.id, f, t);
        const s = await u1.state(g.id);
        res.push({ m: `${f}→${t}`, st: r.status, code: r.code, same: boardSig(s) === boardSig(st0) && s.version === st0.version && s.chess.turn === 'red' });
      }
      const pg = await openPage(ctx, u1);
      await pg.goto(BASE + '/room/' + g.id);
      await pg.getByRole('group', { name: '棋盘' }).waitFor({ timeout: 20000 });
      await waitBoardIdle(pg, 10000);
      const cells = cellsByPos(await cellsOnPage(pg));
      const pageSame = HIDDEN_POS.every((p) => cells[p]?.face === 'down') && ['b1', 'd1', 'c1', 'c4', 'b3', 'a2', 'a5'].every((p) => !cells[p]?.face);
      await ctx.shot(pg, 'v8a');
      await pg.context().close();
      for (const r of res) ctx.check(`V-8a ${r.m} 被拒绝且棋盘/version/轮次不变`, r.st === 409 && r.code === 'ILLEGAL_MOVE' && r.same, `${r.st} ${r.code} 不变=${r.same}`);
      ctx.check('V-8a 拒绝后页面上棋子留在原位', pageSame, `pageSame=${pageSame}`);
      await u1.resign(g.id); await u1.leave(g.id);
      // V-8b
      for (const [f, t] of [['a0', 'a2'], ['b0', 'c2'], ['c0', 'e2'], ['d0', 'e1'], ['b2', 'b4'], ['a3', 'a4']]) {
        const gg = await u1.aiGame();
        const r = await u1.move(gg.id, f, t);
        const c = r.data?.room?.chess;
        const pc = c?.board.find((p) => p.pos === t);
        const apiOk = r.status === 200 && c.lastMove?.from === f && c.lastMove?.to === t && c.lastMove.revealed && pc?.side === 'red' && pc.piece === c.lastMove.revealed;
        const p = await openPage(ctx, u1);
        await p.goto(BASE + '/room/' + gg.id);
        await p.getByRole('group', { name: '棋盘' }).waitFor({ timeout: 20000 });
        await sleep(500); await waitBoardIdle(p, 10000);
        const s = await u1.state(gg.id);
        const cl = cellsByPos(await cellsOnPage(p));
        const lmv = s.chess.lastMove;
        const marksOk = lmv && cl[lmv.from]?.marks.includes('last-from') && cl[lmv.to]?.marks.includes('last-to');
        const tgt = s.chess.board.find((x) => x.pos === t);
        const tgtOk = tgt && (tgt.side === 'red' ? cl[t]?.face === 'up' && cl[t].name.includes(ZH[c?.lastMove?.revealed] || '?') === true || (c?.lastMove?.revealed === 'elephant' && /相/.test(cl[t]?.name)) || (c?.lastMove?.revealed === 'advisor' && /仕/.test(cl[t]?.name)) || (c?.lastMove?.revealed === 'pawn' && /兵/.test(cl[t]?.name)) || (c?.lastMove?.revealed === 'cannon' && /炮/.test(cl[t]?.name)) : true);
        await ctx.shot(p, `v8b-${f}${t}`);
        await p.context().close();
        ctx.check(`V-8b ${f}→${t} 被接受，到达目标并翻开显示实际身份，接口上一步与页面一致`, apiOk && marksOk && tgtOk, `move=${r.status} revealed=${c?.lastMove?.revealed} 页面${t}="${cl[t]?.name}" face=${cl[t]?.face} api上一步=${lmv?.from}→${lmv?.to} 页面标记一致=${marksOk}`);
        await u1.resign(gg.id); await u1.leave(gg.id);
      }
      // V-6b
      const ids = []; const extra = [];
      for (let i = 0; i < 10; i++) {
        const gg = await u1.aiGame();
        const r = await u1.move(gg.id, 'a3', 'a4');
        ids.push(r.data?.room?.chess?.lastMove?.revealed);
        if (i < 2) {
          const s = await waitFor(async () => { const x = await u1.state(gg.id); return x.chess.turn === 'red' || x.chess.status !== 'active' ? x : null; }, { timeout: 30000 });
          if (s?.chess.legalMoves?.i3?.includes('i4')) { const r2 = await u1.move(gg.id, 'i3', 'i4'); extra.push(r2.data?.room?.chess?.lastMove?.revealed); }
        }
        await u1.resign(gg.id); await u1.leave(gg.id);
        if (i >= 2 && new Set(ids).size >= 2) break;
      }
      ctx.saveJson('v6b', { a3: ids, i3: extra });
      ctx.check('V-6b 同一账号多局 a3→a4 翻开身份至少两种（随机打乱）', new Set(ids.filter(Boolean)).size >= 2, `a3身份=${ids.join(',')}; 补充 i3=${extra.join(',')}`);
    },
  },
  // ---------------------------------------------------------------- TS-40b
  {
    id: 'TS-40b', group: 'B', limitMinutes: 8,
    async run(ctx) {
      const u1 = await ctx.reg('c1');
      const page = await openPage(ctx, u1);
      await gotoLobby(page);
      const g = await u1.aiGame();
      await page.goto(BASE + '/room/' + g.id);
      const board = page.getByRole('group', { name: '棋盘' });
      await board.waitFor({ timeout: 20000 });
      const status = await page.getByRole('status', { name: '对局状态' }).innerText().catch(() => '');
      await ctx.shot(page, 'cp1');
      ctx.check('1 人机对局开始，页面显示棋盘，用户执红先走', (await board.isVisible()) && /你执红/.test(status) && /轮到红方/.test(status) && g.chess.yourColor === 'red' && g.chess.turn === 'red' && g.chess.status === 'active', `状态="${status}"`);
      const aiMoves = []; let autoOk = true; let pageOk = true; let ruleOk = true; const notes = [];
      let st = await u1.state(g.id);
      for (let step = 0; step < 10 && st.chess.status === 'active'; step++) {
        const lm = st.chess.legalMoves || {};
        const m = toMap(st.chess.board);
        const opts = []; for (const [f, ts] of Object.entries(lm)) for (const t of ts) opts.push([f, t]);
        if (!opts.length) break;
        const hid = opts.filter(([f]) => m[f]?.piece === 'hidden');
        const pool = hid.length ? hid : opts;
        const [f, t] = pool[Math.floor(Math.random() * pool.length)];
        const r = await u1.move(g.id, f, t);
        if (r.status !== 200) { notes.push(`红走 ${f}→${t} 失败 ${r.status} ${r.code}`); st = await u1.state(g.id); continue; }
        const after = r.data.room;
        if (after.chess.status !== 'active') break;
        const before = toMap(after.chess.board);
        const t0 = Date.now();
        const s2 = await waitFor(async () => { const x = await u1.state(g.id); return x.version > after.version && (x.chess.lastMove?.side === 'black' || x.chess.status !== 'active') ? x : null; }, { timeout: 60000, interval: 200 });
        if (!s2) ctx.notReported('1 分钟内电脑未走棋');
        const lmv = s2.chess.lastMove;
        if (lmv?.side !== 'black') { notes.push(`第${step + 1}步后对局结束 ${s2.chess.status}`); st = s2; break; }
        const v = isLegal(before, 'black', lmv.from, lmv.to);
        const wasHidden = before[lmv.from]?.piece === 'hidden';
        aiMoves.push({ step: step + 1, red: `${f}→${t}`, ai: `${lmv.from}→${lmv.to}`, piece: wasHidden ? `暗子(${OPEN[lmv.from]?.t})→${lmv.revealed}` : before[lmv.from]?.piece, captured: lmv.captured, ok: v.ok, why: v.why, ms: Date.now() - t0 });
        if (!v.ok) ruleOk = false;
        if (wasHidden && !lmv.revealed) { ruleOk = false; notes.push(`电脑走暗子 ${lmv.from} 未翻开`); }
        // page shows the AI move without reload
        const seen = await waitFor(async () => {
          if (!(await waitBoardIdle(page, 5000))) return null;
          const cl = cellsByPos(await cellsOnPage(page));
          return cl[lmv.from]?.marks.includes('last-from') && cl[lmv.to]?.marks.includes('last-to') && !cl[lmv.from]?.face && cl[lmv.to]?.face === 'up' && /黑/.test(cl[lmv.to]?.name) ? cl : null;
        }, { timeout: 60000 });
        if (!seen) { pageOk = false; notes.push(`第${step + 1}步页面未显示电脑走棋 ${lmv.from}→${lmv.to}`); }
        st = s2;
        if (step === 0) await ctx.shot(page, 'cp2-first-ai-move');
      }
      await ctx.shot(page, 'cp3-end');
      ctx.saveJson('ai-moves', { aiMoves, notes });
      ctx.check('2 用户每走一步后电脑自动走一步，页面不刷新即显示，与接口一致', autoOk && pageOk && aiMoves.length > 0, `电脑走了${aiMoves.length}步 ${notes.join('; ')}`);
      ctx.check('3 电脑每一步都遵守盲棋规则（暗子按开局位置类型/明子按实际身份、马腿象眼炮架、不吃己方、不送将）', ruleOk && aiMoves.length > 0, aiMoves.map((a) => `${a.step}:${a.ai}[${a.piece}]${a.ok ? '' : ' 违规:' + a.why}`).join(' '));
    },
  },
];
