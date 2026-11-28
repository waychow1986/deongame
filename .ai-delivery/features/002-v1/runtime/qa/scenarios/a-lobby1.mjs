// TS-02 .. TS-06: reopen/refresh, back-to-game entry, back-to-lobby vs leave, lobby header & logout
import { BASE, openPage, gotoLobby, isRed, parseRgb, sleep, onlineChess, waitFor, waitBoardIdle, cell, apiChessMoveAny } from '../lib.mjs';

const PIECE_CHARS = {
  king: '帅将', general: '帅将', advisor: '仕士', guard: '仕士', elephant: '相象', bishop: '相象',
  horse: '马馬', knight: '马馬', rook: '车車', chariot: '车車', cannon: '炮砲', pawn: '兵卒', soldier: '兵卒',
};
const SIDE = { red: '红', black: '黑' };

const isMember = (st, uid) => (st.members || []).some((m) => (typeof m === 'string' ? m : (m.userId || m.id)) === uid);

async function onLobby(page, timeout = 15000) {
  await page.getByRole('heading', { name: 'DeonGame' }).waitFor({ timeout }).catch(() => {});
  await page.getByRole('table', { name: '房间列表' }).waitFor({ timeout: 5000 }).catch(() => {});
  const url = page.url();
  const heading = await page.getByRole('heading', { name: 'DeonGame' }).isVisible().catch(() => false);
  const info = await page.getByRole('region', { name: '我的信息' }).isVisible().catch(() => false);
  const table = await page.getByRole('table', { name: '房间列表' }).isVisible().catch(() => false);
  return { ok: /\/lobby/.test(url) && heading && info && table, desc: `url=${url.replace(BASE, '')} heading=${heading} info=${info} table=${table}` };
}

// whether 回到对局 is shown on lobby (after letting the lobby settle)
async function backBtnShown(page, expectShown) {
  const btn = page.getByRole('button', { name: '回到对局' });
  if (expectShown) { await btn.waitFor({ timeout: 8000 }).catch(() => {}); } else { await sleep(3000); }
  return btn.isVisible().catch(() => false);
}

// compare chess board on page vs API state
async function chessMatches(page, api, roomId) {
  const st0 = await api.state(roomId);
  if (st0.chess.status === 'waiting') {
    // game not started yet: the room page must say it is waiting; a board, if drawn, must match the API
    await page.getByRole('status', { name: '对局状态' }).waitFor({ timeout: 15000 }).catch(() => {});
    await sleep(1500);
    const hasBoard = await page.getByRole('group', { name: '棋盘' }).isVisible().catch(() => false);
    if (!hasBoard) {
      const t = (await page.getByRole('status', { name: '对局状态' }).textContent().catch(() => '')) || '';
      return { ok: t.includes('等待'), desc: `waiting room, no board drawn; status="${t}" api.status=waiting` };
    }
  }
  await page.getByRole('group', { name: '棋盘' }).waitFor({ timeout: 15000 });
  await waitBoardIdle(page, 30000);
  await sleep(500);
  const st = await api.state(roomId);
  const labels = await page.getByRole('group', { name: '棋盘' }).getByRole('button').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') || e.textContent));
  const map = {};
  for (const l of labels) { const [pos, ...rest] = (l || '').trim().split(' '); map[pos] = rest.join(' '); }
  const occ = {};
  for (const b of st.chess.board) occ[b.pos] = b;
  const diffs = [];
  for (let c = 0; c < 9; c++) for (let r = 0; r < 10; r++) {
    const pos = String.fromCharCode(97 + c) + r;
    const shown = map[pos];
    const b = occ[pos];
    let ok;
    if (!b) ok = shown === '空';
    else if (b.piece === 'hidden') ok = shown === `${SIDE[b.side]}暗子`;
    else ok = !!shown && shown.length === 2 && shown[0] === SIDE[b.side] && (PIECE_CHARS[b.piece] || '').includes(shown[1]);
    if (!ok) diffs.push(`${pos}:page=${shown} api=${b ? b.side + '/' + b.piece : 'empty'}`);
  }
  const statusText = (await page.getByRole('status', { name: '对局状态' }).textContent().catch(() => '')) || '';
  let turnOk = true;
  if (st.chess.status === 'active') turnOk = statusText.includes(st.chess.turn === 'red' ? '轮到红方' : '轮到黑方');
  else if (st.chess.status === 'waiting') turnOk = statusText.includes('等待');
  return { ok: diffs.length === 0 && turnOk, desc: `diffs=${diffs.slice(0, 6).join(',')}(${diffs.length}) status="${statusText}" api.status=${st.chess.status} api.turn=${st.chess.turn}` };
}

// compare poker page vs API state: own seat, chips, pot, community count
async function pokerMatches(page, api, roomId) {
  await page.getByRole('region', { name: '牌桌' }).waitFor({ timeout: 15000 });
  await sleep(1500);
  const st = await api.state(roomId);
  const pk = st.poker;
  const mySeat = pk.you?.seat;
  const seat = (pk.seats || []).find((s) => s && s.seat === mySeat);
  const parts = []; let ok = true;
  if (!seat) return { ok: false, desc: `api has no seat for you: ${JSON.stringify(pk.you)}` };
  const reg = page.getByRole('region', { name: `座位 ${mySeat + 1}：${seat.name}` });
  const vis = await reg.isVisible().catch(() => false);
  const me = await reg.getAttribute('data-me').catch(() => null);
  const txt = vis ? (await reg.textContent()) : '';
  const chipsOk = new RegExp(`筹码\\s*${seat.chips}(?!\\d)`).test(txt);
  ok = ok && vis && me === 'true' && chipsOk;
  parts.push(`seat${mySeat + 1} visible=${vis} data-me=${me} text="${txt}" api.chips=${seat.chips}`);
  const potTxt = (await page.getByRole('status', { name: '底池' }).textContent().catch(() => '')) || '';
  const potOk = new RegExp(`(?<!\\d)${pk.pot}(?!\\d)`).test(potTxt);
  const comm = await page.getByRole('region', { name: '公共牌' }).getByRole('img').count().catch(() => -1);
  const boardLen = (pk.board || []).length;
  ok = ok && potOk && comm === boardLen;
  parts.push(`pot page="${potTxt}" api=${pk.pot}; community page=${comm} api=${boardLen}`);
  return { ok, desc: parts.join(' | ') };
}

// FR-007: game cards and other rooms' join buttons disabled with reason; clicking does nothing
async function checkBlockedLobby(ctx, page, api, label, otherRoomId, doClick) {
  const cards = [page.getByRole('button', { name: /^中国象棋·盲棋/ }), page.getByRole('button', { name: /^德州扑克/ })];
  const obs = [];
  let ok = true;
  for (const c of cards) {
    const dis = await c.isDisabled().catch(() => null);
    const t = (await c.textContent().catch(() => '')) || '';
    const reason = /进行中的对局/.test(t);
    ok = ok && dis === true && reason;
    obs.push(`card disabled=${dis} reason=${reason}`);
  }
  let joinBtn = null;
  if (otherRoomId) {
    const row = page.locator(`[data-room-id="${otherRoomId}"]`);
    await row.waitFor({ timeout: 8000 }).catch(() => {});
    joinBtn = row.getByRole('button', { name: '加入' });
    const dis = await joinBtn.isDisabled().catch(() => null);
    const t = (await row.textContent().catch(() => '')) || '';
    const reason = /进行中的对局/.test(t);
    ok = ok && dis === true && reason;
    obs.push(`otherRoom join disabled=${dis} reasonText=${reason} rowText="${t}"`);
  }
  if (doClick) {
    const before = (await api.me()).currentRoomId;
    for (const c of cards) await c.click({ force: true, timeout: 3000 }).catch(() => {});
    if (joinBtn) await joinBtn.click({ force: true, timeout: 3000 }).catch(() => {});
    await sleep(1500);
    const dlg = await page.getByRole('dialog', { name: '开房间' }).isVisible().catch(() => false);
    if (dlg) await page.getByRole('dialog', { name: '开房间' }).getByRole('button', { name: '取消' }).click().catch(() => {});
    const after = (await api.me()).currentRoomId;
    ok = ok && before === after;
    obs.push(`click: currentRoomId before=${before} after=${after} openDialog=${dlg}`);
  }
  return ctx.check(`${label} 卡片与其他房间“加入”不可用并说明原因${doClick ? '，点击不开房不加入' : ''}`, ok, obs.join(' | '));
}

const headerNums = async (page) => {
  const t = (await page.getByRole('region', { name: '我的信息' }).textContent().catch(() => '')) || '';
  const r = /象棋积分\s*(-?\d+)/.exec(t); const c = /扑克筹码\s*(-?\d+)/.exec(t);
  return { text: t, rating: r ? +r[1] : null, chips: c ? +c[1] : null };
};

async function waitLobbyAfterClick(page) {
  await page.waitForURL(/\/lobby/, { timeout: 15000 }).catch(() => {});
  return onLobby(page);
}

export const scenarios = [
  {
    id: 'TS-02', group: 'A', limitMinutes: 5,
    async run(ctx) {
      const { u1, u2, roomId } = await onlineChess();
      ctx.track(u1); ctx.track(u2);
      // one move by red, one by black, so it's red's turn after at least 2 moves
      await apiChessMoveAny(u1, roomId);
      await apiChessMoveAny(u2, roomId);
      let page = await openPage(ctx, u1);
      await page.goto(BASE + '/');
      const l1 = await onLobby(page);
      const b1 = await backBtnShown(page, true);
      await ctx.shot(page, 'cp1');
      ctx.check('1 重新打开网站根地址显示大厅并有“回到对局”入口', l1.ok && b1, `${l1.desc} backBtn=${b1}`);
      const context = page.context();
      await page.close();
      page = await context.newPage();
      await page.goto(BASE + '/lobby');
      const l2 = await onLobby(page);
      const b2 = await backBtnShown(page, true);
      await ctx.shot(page, 'cp2');
      ctx.check('2 打开大厅地址显示大厅并有“回到对局”入口', l2.ok && b2, `${l2.desc} backBtn=${b2}`);
      await page.goto(BASE + '/room/' + roomId);
      await page.getByRole('group', { name: '棋盘' }).waitFor({ timeout: 15000 }).catch(() => {});
      await page.reload();
      await sleep(1500);
      const url3 = page.url();
      const m = await chessMatches(page, u1, roomId).catch((e) => ({ ok: false, desc: 'err ' + e.message }));
      await ctx.shot(page, 'cp3');
      ctx.check('3 房间页刷新后仍在该房间，局面与轮次与接口一致', url3.includes('/room/' + roomId) && m.ok, `url=${url3.replace(BASE, '')} ${m.desc}`);
    },
  },
  {
    id: 'TS-03', group: 'A', limitMinutes: 5,
    async run(ctx) {
      // helper room listed by someone else (for FR-007 join-button checks)
      const other = await ctx.reg('o');
      const otherRoom = await other.createRoom('chess');

      // row: never in a room
      const n = await ctx.reg('n');
      const pn = await openPage(ctx, n);
      await gotoLobby(pn);
      const shownN = await backBtnShown(pn, false);
      ctx.check('判定表 从未开房、不在房间：不显示入口', !shownN, `backBtn=${shownN}`);
      await pn.context().close();

      const showRow = async (label, api, roomId, kind, doClick, tag) => {
        const p = await openPage(ctx, api);
        await gotoLobby(p);
        const shown = await backBtnShown(p, true);
        await ctx.shot(p, `${tag}-lobby`);
        ctx.check(`判定表 ${label}：显示入口`, shown, `backBtn=${shown} activeRoomId=${(await api.me()).activeRoomId}`);
        await checkBlockedLobby(ctx, p, api, `FR-007 ${label}`, otherRoom.id, doClick);
        if (shown) {
          await p.getByRole('button', { name: '回到对局' }).click();
          await p.waitForURL(/\/room\//, { timeout: 15000 }).catch(() => {});
          const url = p.url();
          const m = kind === 'chess' ? await chessMatches(p, api, roomId).catch((e) => ({ ok: false, desc: 'err ' + e.message }))
            : await pokerMatches(p, api, roomId).catch((e) => ({ ok: false, desc: 'err ' + e.message }));
          await ctx.shot(p, `${tag}-room`);
          ctx.check(`${label} 点“回到对局”进入该房间且局面与接口一致`, url.includes('/room/' + roomId) && m.ok, `url=${url.replace(BASE, '')} ${m.desc}`);
        }
        await p.context().close();
      };

      // row: online chess waiting
      const w = await ctx.reg('w');
      const wr = await w.createRoom('chess');
      await showRow('联机象棋等待对手', w, wr.id, 'chess', true, 'chess-waiting');

      // row: online chess active
      const oc = await onlineChess(); ctx.track(oc.u1); ctx.track(oc.u2);
      await apiChessMoveAny(oc.u1, oc.roomId);
      await showRow('联机象棋对局进行中', oc.u1, oc.roomId, 'chess', false, 'chess-online');

      // row: AI chess active
      const ai = await ctx.reg('a');
      const ar = await ai.aiGame();
      await showRow('与电脑的象棋对局进行中', ai, ar.id, 'chess', false, 'chess-ai');

      // row: poker seat, no hand
      const ps = await ctx.reg('ps');
      const pr = await ps.createRoom('poker');
      await showRow('扑克有座位且无进行中的一手', ps, pr.id, 'poker', false, 'poker-idle');

      // row: poker hand in progress
      const ph = await ctx.reg('ph'); const ph2 = await ctx.reg('pj');
      const phr = await ph.createRoom('poker');
      await ph2.join(phr.id);
      await ph.pokerStart(phr.id);
      await showRow('扑克有座位且一手进行中', ph, phr.id, 'poker', false, 'poker-hand');

      // row: left via 离开房间 confirm
      const lv = await ctx.reg('lv');
      const lr = await lv.createRoom('chess');
      const pl = await openPage(ctx, lv);
      await pl.goto(BASE + '/room/' + lr.id);
      await pl.getByRole('button', { name: '离开房间' }).click();
      await pl.getByRole('dialog', { name: '确认离开房间' }).getByRole('button', { name: '确认离开' }).click();
      const ll = await waitLobbyAfterClick(pl);
      const shownL = await backBtnShown(pl, false);
      await ctx.shot(pl, 'left-lobby');
      ctx.check('判定表 通过“离开房间”确认离开后：不显示入口', ll.ok && !shownL, `${ll.desc} backBtn=${shownL}`);

      // A-16: open closed room URL
      await pl.goto(BASE + '/room/' + lr.id);
      await sleep(3000);
      const urlC = pl.url();
      const lc = await onLobby(pl);
      const msgs = await pl.locator('[role="alert"],[role="status"]').evaluateAll((els) => els.map((e) => (e.textContent || '').trim()).filter(Boolean));
      const hasZh = msgs.some((t) => /[\u4e00-\u9fff]/.test(t) && /房间|关闭|不存在/.test(t));
      await ctx.shot(pl, 'closed-room');
      ctx.check('补充 打开已关闭房间地址：显示大厅并有中文说明', lc.ok && hasZh, `url=${urlC.replace(BASE, '')} ${lc.desc} msgs=${JSON.stringify(msgs)}`);
      await pl.context().close();

      // row: result screen -> 回到大厅
      const rs = await ctx.reg('rs');
      const rr = await rs.aiGame();
      const pr2 = await openPage(ctx, rs);
      await pr2.goto(BASE + '/room/' + rr.id);
      await pr2.getByRole('group', { name: '棋盘' }).waitFor({ timeout: 15000 }).catch(() => {});
      // resign through the page (API pushes only to other members)
      await pr2.getByRole('button', { name: '认输', exact: true }).click();
      const cf = pr2.getByRole('dialog').getByRole('button', { name: /确认/ });
      if (await cf.isVisible({ timeout: 2000 }).catch(() => false)) await cf.click();
      const dlg = pr2.getByRole('dialog', { name: '对局结果' });
      if (!(await dlg.waitFor({ timeout: 10000 }).then(() => true).catch(() => false))) { await rs.resign(rr.id); await pr2.reload(); }
      await dlg.waitFor({ timeout: 20000 }).catch(() => {});
      await ctx.shot(pr2, 'result-dialog');
      await dlg.getByRole('button', { name: '回到大厅' }).click();
      const lr2 = await waitLobbyAfterClick(pr2);
      const shownR = await backBtnShown(pr2, false);
      await ctx.shot(pr2, 'result-lobby');
      ctx.check('判定表 在结果画面点“回到大厅”后：不显示入口', lr2.ok && !shownR, `${lr2.desc} backBtn=${shownR}`);
      await pr2.context().close();

      // row: opponent resigns while user away from room page (user is winner)
      const g = await onlineChess(); ctx.track(g.u1); ctx.track(g.u2);
      const r1 = (await g.u1.me()).rating; const r2 = (await g.u2.me()).rating;
      const pg = await openPage(ctx, g.u1);
      await gotoLobby(pg);
      await backBtnShown(pg, true);
      await g.u2.resign(g.roomId);
      await sleep(1000);
      await gotoLobby(pg);
      const shownG = await backBtnShown(pg, false);
      await ctx.shot(pg, 'opp-resigned');
      ctx.check('判定表 不在房间页面期间对手认输：不显示入口', !shownG, `backBtn=${shownG}`);
      const me1 = await g.u1.me(); const me2 = await g.u2.me();
      const hn = await headerNums(pg);
      ctx.check('对手认输行 大厅顶部积分为结算后值（+10，与接口一致），认输方 −10',
        me1.rating === r1 + 10 && hn.rating === me1.rating && me2.rating === r2 - 10,
        `u1 before=${r1} api=${me1.rating} header=${hn.rating}; u2 before=${r2} api=${me2.rating}`);
      const chessCard = pg.getByRole('button', { name: /^中国象棋·盲棋/ });
      const cardEnabled = await chessCard.isEnabled().catch(() => false);
      const cr = await g.u1.req('POST', '/api/rooms', { game: 'chess' });
      ctx.check('对手认输行 该用户可以开新房间', cardEnabled && cr.status === 201, `chessCard enabled=${cardEnabled} createRoom=${cr.status} ${cr.code || ''}`);
    },
  },
  {
    id: 'TS-04', group: 'A', limitMinutes: 5,
    async run(ctx) {
      const { u1, u2, roomId } = await onlineChess();
      ctx.track(u1); ctx.track(u2);
      const rating0 = (await u1.me()).rating;
      const p1 = await openPage(ctx, u1);
      const p2 = await openPage(ctx, u2);
      await p1.goto(BASE + '/room/' + roomId);
      await p2.goto(BASE + '/room/' + roomId);
      await p1.getByRole('group', { name: '棋盘' }).waitFor({ timeout: 15000 });
      const backBtn = p1.getByRole('button', { name: '回到大厅', exact: true });
      const leaveBtn = p1.getByRole('button', { name: '离开房间', exact: true });
      const both = (await backBtn.isVisible()) && (await leaveBtn.isVisible());
      const bb = await backBtn.boundingBox(); const lb = await leaveBtn.boundingBox();
      const separate = both && bb && lb && !(bb.x < lb.x + lb.width && lb.x < bb.x + bb.width && bb.y < lb.y + lb.height && lb.y < bb.y + bb.height);
      await backBtn.click();
      const l1 = await waitLobbyAfterClick(p1);
      const sh1 = await backBtnShown(p1, true);
      const st1 = await u1.state(roomId);
      const me1 = await u1.me();
      const resDlg = await p2.getByRole('dialog', { name: '对局结果' }).isVisible().catch(() => false);
      await ctx.shot(p1, 'cp1-lobby'); await ctx.shot(p2, 'cp1-u2');
      ctx.check('1 有“回到大厅”且与“离开房间”分开；点后显示大厅有入口；对局仍进行、U1仍是成员、轮到U1、积分未变；U2无结果画面',
        separate && l1.ok && sh1 && st1.chess.status === 'active' && isMember(st1, u1.user.id) && st1.chess.turn === 'red' && me1.rating === rating0 && !resDlg,
        `separate=${separate} ${l1.desc} backToGame=${sh1} status=${st1.chess.status} member=${isMember(st1, u1.user.id)} turn=${st1.chess.turn} rating ${rating0}->${me1.rating} u2ResultDialog=${resDlg}`);

      await sleep(30000);
      const s2 = (await p2.getByRole('status', { name: '对局状态' }).textContent().catch(() => '')) || '';
      const st2 = await u2.state(roomId);
      const resDlg2 = await p2.getByRole('dialog', { name: '对局结果' }).isVisible().catch(() => false);
      await ctx.shot(p2, 'cp2-u2');
      ctx.check('2 U1在大厅停留30秒后，U2页面仍为轮到红方，对局未结束', s2.includes('轮到红方') && st2.chess.status === 'active' && !resDlg2, `u2 status="${s2}" api.status=${st2.chess.status} resultDialog=${resDlg2}`);

      await p1.getByRole('button', { name: '回到对局' }).click();
      await p1.waitForURL(/\/room\//, { timeout: 15000 }).catch(() => {});
      await p1.getByRole('group', { name: '棋盘' }).waitFor({ timeout: 15000 });
      await waitBoardIdle(p1, 30000);
      const st3 = await u1.state(roomId);
      const lm = st3.chess.legalMoves || {};
      const from = Object.keys(lm)[0]; const to = from && lm[from][0];
      let moved = false; let obs3 = `legal from=${from} to=${to}`;
      if (from) {
        await cell(p1, from).click();
        await cell(p1, to).click();
        const after = await waitFor(async () => { const s = await u1.state(roomId); return s.chess.turn === 'black' && s.chess.lastMove ? s : null; }, { timeout: 15000 });
        moved = !!after && after.chess.status === 'active';
        obs3 += ` after.turn=${after?.chess.turn} status=${after?.chess.status} lastMove=${JSON.stringify(after?.chess.lastMove || null).slice(0, 120)}`;
      }
      await ctx.shot(p1, 'cp3');
      ctx.check('3 回到对局后走一步合法棋成功，对局继续', moved, obs3);

      // poker: U4 host (dealer/SB acts first heads-up), U3 joins (BB, not to act)
      const u3 = await ctx.reg('p3'); const u4 = await ctx.reg('p4');
      const pr = await u4.createRoom('poker');
      await u3.join(pr.id);
      const startR = await u4.pokerStart(pr.id);
      const s0 = await u3.state(pr.id);
      const seat3 = s0.poker.you.seat;
      const pp = await openPage(ctx, u3);
      await pp.goto(BASE + '/room/' + pr.id);
      await pp.getByRole('region', { name: '牌桌' }).waitFor({ timeout: 15000 });
      const notMyTurn = s0.poker.toActSeat !== seat3;
      await pp.getByRole('button', { name: '回到大厅', exact: true }).click();
      const l4 = await waitLobbyAfterClick(pp);
      const sh4 = await backBtnShown(pp, true);
      const st4 = await u3.state(pr.id);
      const myS = st4.poker.seats.find((s) => s && s.seat === seat3);
      await ctx.shot(pp, 'cp4-lobby');
      ctx.check('4 扑克 U3轮到前点“回到大厅”：显示大厅有入口；仍占原座位，未被判弃牌',
        notMyTurn && l4.ok && sh4 && myS && myS.userId === u3.user.id && !myS.folded && st4.poker.you.seat === seat3,
        `start=${startR.status} notMyTurnBefore=${notMyTurn} ${l4.desc} backToGame=${sh4} seat=${seat3} apiSeat=${JSON.stringify(myS ? { userId: myS.userId === u3.user.id, folded: myS.folded, inHand: myS.inHand } : null)} stage=${st4.poker.stage}`);

      await pp.getByRole('button', { name: '回到对局' }).click();
      await pp.waitForURL(/\/room\//, { timeout: 15000 }).catch(() => {});
      await pp.getByRole('region', { name: '牌桌' }).waitFor({ timeout: 15000 });
      // U4 (to act) calls so that it becomes U3's turn
      const s5 = await u4.state(pr.id);
      if (s5.poker.toActSeat === s5.poker.you.seat) await u4.action(pr.id, s5.poker.you.legal.call ? 'call' : 'check');
      const myTurn = await waitFor(async () => { const s = await u3.state(pr.id); return s.poker.toActSeat === seat3 && s.poker.you.legal ? s : null; }, { timeout: 15000 });
      await sleep(1500);
      const seatName = myTurn?.poker.seats.find((s) => s && s.seat === seat3)?.name || u3.username;
      const seatReg = pp.getByRole('region', { name: `座位 ${seat3 + 1}：${seatName}` });
      const seatMe = await seatReg.getAttribute('data-me').catch(() => null);
      const area = pp.getByRole('region', { name: '操作区' });
      const active = await area.getAttribute('data-active').catch(() => null);
      const enabledBtns = await area.getByRole('button').evaluateAll((els) => els.filter((e) => !e.disabled).map((e) => e.textContent.trim()));
      await ctx.shot(pp, 'cp5');
      ctx.check('5 经“回到对局”回到扑克房间：仍在原座位，轮到U3时操作区可用',
        !!myTurn && seatMe === 'true' && active === 'true' && enabledBtns.length > 0,
        `myTurn=${!!myTurn} seat${seat3 + 1} data-me=${seatMe} 操作区 data-active=${active} enabled=${JSON.stringify(enabledBtns)}`);
    },
  },
  {
    id: 'TS-05', group: 'A', limitMinutes: 5,
    async run(ctx) {
      const { u1, u2, roomId } = await onlineChess();
      ctx.track(u1); ctx.track(u2);
      const r1 = (await u1.me()).rating; const r2 = (await u2.me()).rating;
      const p1 = await openPage(ctx, u1);
      const p2 = await openPage(ctx, u2);
      await p1.goto(BASE + '/room/' + roomId);
      await p2.goto(BASE + '/room/' + roomId);
      await p1.getByRole('group', { name: '棋盘' }).waitFor({ timeout: 15000 });
      const stA = await u1.state(roomId);
      await p1.getByRole('button', { name: '离开房间', exact: true }).click();
      const dlg = p1.getByRole('dialog', { name: '确认离开房间' });
      const dlgVis = await dlg.waitFor({ timeout: 5000 }).then(() => true).catch(() => false);
      await sleep(1000);
      const stB = await u1.state(roomId).catch(() => null);
      await ctx.shot(p1, 'cp1');
      ctx.check('1 点“离开房间”出现确认，没有立即离开', dlgVis && p1.url().includes('/room/') && stB && isMember(stB, u1.user.id) && stB.chess.status === 'active',
        `dialog=${dlgVis} url=${p1.url().replace(BASE, '')} member=${stB && isMember(stB, u1.user.id)} status=${stB?.chess.status}`);
      await dlg.getByRole('button', { name: '取消' }).click();
      await sleep(1500);
      const stC = await u1.state(roomId);
      const m1 = await u1.me(); const m2 = await u2.me();
      const dlgGone = !(await dlg.isVisible().catch(() => false));
      await ctx.shot(p1, 'cp2');
      ctx.check('2 点“取消”后仍在房间页，对局状态、轮次、积分不变',
        dlgGone && p1.url().includes('/room/' + roomId) && stC.chess.status === stA.chess.status && stC.chess.turn === stA.chess.turn && m1.rating === r1 && m2.rating === r2 && isMember(stC, u1.user.id),
        `dialogGone=${dlgGone} url=${p1.url().replace(BASE, '')} status ${stA.chess.status}->${stC.chess.status} turn ${stA.chess.turn}->${stC.chess.turn} ratings u1 ${r1}->${m1.rating} u2 ${r2}->${m2.rating}`);

      await p1.getByRole('button', { name: '离开房间', exact: true }).click();
      await dlg.getByRole('button', { name: '确认离开' }).click();
      const l3 = await waitLobbyAfterClick(p1);
      const sh3 = await backBtnShown(p1, false);
      const n1 = await u1.me(); const n2 = await u2.me();
      const hn = await headerNums(p1);
      const res = p2.getByRole('dialog', { name: '对局结果' });
      await res.waitFor({ timeout: 15000 }).catch(() => {});
      const resTxt = (await res.textContent().catch(() => '')) || '';
      await ctx.shot(p1, 'cp3-u1'); await ctx.shot(p2, 'cp3-u2');
      ctx.check('3 确认离开后显示大厅无入口；U1积分−10、U2积分+10（接口与大厅顶部）；U2出现结果画面显示“胜”',
        l3.ok && !sh3 && n1.rating === r1 - 10 && n2.rating === r2 + 10 && hn.rating === n1.rating && resTxt.includes('胜'),
        `${l3.desc} backBtn=${sh3} u1 ${r1}->${n1.rating} header=${hn.rating} u2 ${r2}->${n2.rating} u2Result="${resTxt.slice(0, 120)}"`);

      // poker: U3 host = dealer/SB (5 committed), U4 BB
      const u3 = await ctx.reg('p3'); const u4 = await ctx.reg('p4');
      const pr = await u3.createRoom('poker');
      await u4.join(pr.id);
      await u3.pokerStart(pr.id);
      const bal0 = (await u3.me()).chips;
      const s0 = await u3.state(pr.id);
      const seat3 = s0.poker.you.seat;
      const committed = s0.poker.seats.find((s) => s.seat === seat3).committedThisHand;
      const seatName = s0.poker.seats.find((s) => s.seat === seat3).name;
      const p3 = await openPage(ctx, u3); const p4 = await openPage(ctx, u4);
      await p3.goto(BASE + '/room/' + pr.id); await p4.goto(BASE + '/room/' + pr.id);
      await p3.getByRole('region', { name: '牌桌' }).waitFor({ timeout: 15000 });
      await p4.getByRole('region', { name: `座位 ${seat3 + 1}：${seatName}` }).waitFor({ timeout: 15000 }).catch(() => {});
      await p3.getByRole('button', { name: '离开房间', exact: true }).click();
      await p3.getByRole('dialog', { name: '确认离开房间' }).getByRole('button', { name: '确认离开' }).click();
      const l4 = await waitLobbyAfterClick(p3);
      const s4 = await u4.state(pr.id);
      const stillSeated = (s4.poker.seats || []).some((s) => s && s.userId === u3.user.id);
      const u3Act = (s4.poker.actions || []).filter((a) => a.seat === seat3).map((a) => a.type);
      const bal1 = await waitFor(async () => { const c = (await u3.me()).chips; return c === bal0 - committed ? { c } : null; }, { timeout: 15000 });
      const balNow = (await u3.me()).chips;
      const seatOnPage = await waitFor(async () => !(await p4.getByRole('region', { name: `座位 ${seat3 + 1}：${seatName}` }).isVisible()), { timeout: 10000 });
      await ctx.shot(p3, 'cp4-u3'); await ctx.shot(p4, 'cp4-u4');
      ctx.saveJson('cp4-state', { seats: s4.poker.seats, actions: s4.poker.actions, stage: s4.poker.stage, winners: s4.poker.winners });
      ctx.check('4 扑克 U3确认离开：显示大厅；不在座位上，按弃牌处理，已投入筹码不退回；U4页面该座位空出',
        l4.ok && !stillSeated && !!bal1 && !!seatOnPage,
        `${l4.desc} u3StillSeated=${stillSeated} u3Actions=${JSON.stringify(u3Act)} balance before=${bal0} committed=${committed} now=${balNow} expected=${bal0 - committed} u4SeatGone=${!!seatOnPage}`);

      // waiting chess room: host leaves -> disappears from others' list
      const h = await ctx.reg('h'); const o = await ctx.reg('o');
      const wr = await h.createRoom('chess');
      const ph = await openPage(ctx, h); const po = await openPage(ctx, o);
      await gotoLobby(po);
      const row = po.locator(`[data-room-id="${wr.id}"]`);
      const rowBefore = await row.waitFor({ timeout: 8000 }).then(() => true).catch(() => false);
      await ph.goto(BASE + '/room/' + wr.id);
      await ph.getByRole('button', { name: '离开房间', exact: true }).click();
      await ph.getByRole('dialog', { name: '确认离开房间' }).getByRole('button', { name: '确认离开' }).click();
      const t0 = Date.now();
      const l5 = await waitLobbyAfterClick(ph);
      const gone = await waitFor(async () => (await row.count()) === 0, { timeout: 5000, interval: 200 });
      const dt = Date.now() - t0;
      await ctx.shot(po, 'cp5-other');
      ctx.check('5 等待中的象棋房间房主确认离开：显示大厅，房间从其他用户的大厅列表消失',
        l5.ok && rowBefore && !!gone, `${l5.desc} rowListedBefore=${rowBefore} goneWithin5s=${!!gone} elapsedMs=${dt}`);
    },
  },
  {
    id: 'TS-06', group: 'A', limitMinutes: 5,
    async run(ctx) {
      const u = await ctx.reg('m');
      const page = await openPage(ctx, u);
      await gotoLobby(page);
      await sleep(1500);
      const me = await u.me();
      const banner = page.getByRole('banner');
      const h = await banner.getByRole('heading', { name: 'DeonGame' }).isVisible().catch(() => false);
      const hn = await headerNums(page);
      const logoutBtn = await page.getByRole('button', { name: '退出登录' }).isVisible().catch(() => false);
      await ctx.shot(page, 'cp1');
      ctx.check('1 顶部显示DeonGame、用户名、象棋积分、扑克筹码、退出登录，数值与接口一致',
        h && hn.text.includes(u.username) && hn.rating === me.rating && hn.chips === me.chips && logoutBtn,
        `heading=${h} text="${hn.text}" api rating=${me.rating} chips=${me.chips} logout=${logoutBtn}`);
      const chipEl = page.getByRole('region', { name: '我的信息' }).locator('[data-negative]').first();
      let color = null; let neg = null;
      if (await chipEl.count()) {
        color = await chipEl.evaluate((e) => getComputedStyle(e).color);
        neg = await chipEl.getAttribute('data-negative');
      } else {
        color = await page.getByRole('region', { name: '我的信息' }).getByText(/扑克筹码/).first().evaluate((e) => getComputedStyle(e).color).catch(() => null);
      }
      ctx.check('2 筹码非负不是红色', me.chips >= 0 && color && !isRed(parseRgb(color)), `chips=${me.chips} color=${color} data-negative=${neg}`);

      const r0 = me.rating;
      const room = await u.aiGame();
      await page.goto(BASE + '/room/' + room.id);
      await page.getByRole('group', { name: '棋盘' }).waitFor({ timeout: 15000 });
      await page.getByRole('button', { name: '认输', exact: true }).click();
      const confirm = page.getByRole('dialog').getByRole('button', { name: /确认/ });
      if (await confirm.isVisible({ timeout: 2000 }).catch(() => false)) await confirm.click();
      const res = page.getByRole('dialog', { name: '对局结果' });
      if (!(await res.waitFor({ timeout: 10000 }).then(() => true).catch(() => false))) await u.resign(room.id);
      await res.waitFor({ timeout: 10000 }).catch(() => {});
      await res.getByRole('button', { name: '回到大厅' }).click().catch(() => gotoLobby(page));
      await waitLobbyAfterClick(page);
      await sleep(1500);
      const me3 = await u.me();
      const hn3 = await headerNums(page);
      await ctx.shot(page, 'cp3');
      ctx.check('3 输掉与电脑的象棋后回到大厅，顶部积分为结算后值（少10）', hn3.rating === r0 - 10 && me3.rating === r0 - 10, `before=${r0} header=${hn3.rating} api=${me3.rating}`);

      await page.getByRole('button', { name: '退出登录' }).click();
      await page.waitForURL(/\/login/, { timeout: 10000 }).catch(() => {});
      const isLogin = async () => /\/login/.test(page.url()) && await page.getByRole('textbox', { name: '用户名' }).isVisible().catch(() => false) && await page.getByRole('button', { name: '登录', exact: true }).isVisible().catch(() => false);
      const lg4 = await isLogin();
      await ctx.shot(page, 'cp4');
      ctx.check('4 点“退出登录”显示登录页', lg4, `url=${page.url().replace(BASE, '')}`);
      await page.goto(BASE + '/lobby');
      await sleep(2500);
      const lgA = await isLogin(); const uA = page.url();
      await page.goto(BASE + '/room/' + room.id);
      await sleep(2500);
      const lgB = await isLogin(); const uB = page.url();
      await ctx.shot(page, 'cp5');
      ctx.check('5 退出后直接访问大厅地址与房间地址都显示登录页', lgA && lgB, `lobby->${uA.replace(BASE, '')} login=${lgA}; room->${uB.replace(BASE, '')} login=${lgB}`);
      await u.login();
    },
  },
];
