// TS-07 .. TS-13: lobby cards / create dialog, room list, join rules, live updates, auth errors, visual style
import { BASE, Api, openPage, gotoLobby, gotoRoom, sleep, waitFor, browser, newUsername, newPassword, parseRgb } from '../lib.mjs';

const ROOMS_TABLE = '房间列表';
const hasCJK = (s) => /[\u4e00-\u9fa5]/.test(s || '');

// read cells of the room-list row for roomId (null if absent)
async function rowCells(page, roomId) {
  return page.evaluate((id) => {
    const t = [...document.querySelectorAll('table')].find((e) => e.getAttribute('aria-label') === '房间列表')
      || [...document.querySelectorAll('table')][0];
    if (!t) return null;
    const tr = t.querySelector(`[data-room-id="${id}"]`);
    if (!tr) return null;
    const cells = [...tr.querySelectorAll('td,th,[role="cell"]')].map((c) => c.innerText.trim());
    const btn = tr.querySelector('button');
    return { cells, btnDisabled: btn ? btn.disabled : null, btnText: btn ? btn.innerText.trim() : null, text: tr.innerText.replace(/\s+/g, ' ').trim() };
  }, roomId);
}
const rowLoc = (page, roomId) => page.getByRole('table', { name: ROOMS_TABLE }).locator(`[data-room-id="${roomId}"]`);
async function waitRow(page, roomId, pred, timeout = 15000) {
  return waitFor(async () => { const r = await rowCells(page, roomId); return pred(r) ? (r || { absent: true }) : null; }, { timeout, interval: 200 });
}
// time (ms) until pred holds on the row, polling every 200ms, up to limit; returns {ms, row} or {ms:null,row}
async function timeRow(page, roomId, pred, t0, limit = 5000) {
  let last = null;
  while (Date.now() - t0 <= limit) {
    last = await rowCells(page, roomId).catch(() => null);
    if (pred(last)) return { ms: Date.now() - t0, row: last };
    await sleep(200);
  }
  last = await rowCells(page, roomId).catch(() => null);
  return { ms: pred(last) ? Date.now() - t0 : null, row: last };
}
const cellsStr = (r) => (r ? JSON.stringify(r.cells) + ` btnDisabled=${r.btnDisabled}` : 'absent');

async function openCreateDialog(page, game) {
  await page.getByRole('button', { name: new RegExp(`^${game}`) }).click();
  const dlg = page.getByRole('dialog', { name: '开房间' });
  await dlg.waitFor({ timeout: 10000 });
  return dlg;
}
async function createViaDialog(page, game, opts = {}) {
  const dlg = await openCreateDialog(page, game);
  if (opts.mode) await dlg.getByRole('radio', { name: opts.mode }).check();
  if (opts.capacity) await dlg.getByRole('combobox', { name: '人数上限' }).selectOption(String(opts.capacity));
  await dlg.getByRole('button', { name: '确认' }).click();
  await page.waitForURL(/\/room\//, { timeout: 15000 });
  return page.url().split('/room/')[1].split(/[?#/]/)[0];
}
async function pokerRoomWith(host, capacity, others = []) {
  const room = await host.createRoom('poker', capacity);
  for (const o of others) await o.join(room.id);
  return room.id;
}

// ---------------- TS-07 ----------------
async function ts07(ctx) {
  const u1 = await ctx.reg('c1');
  const u2 = await ctx.reg('o2');
  const page = await openPage(ctx, u1);
  await gotoLobby(page);
  await sleep(1000);

  // 1 cards
  const cards = [];
  for (const t of ['中国象棋·盲棋', '德州扑克']) {
    const card = page.getByRole('button', { name: new RegExp(`^${t}`) });
    const n = await card.count();
    const img = card.first().getByRole('img');
    const imgBox = n ? await img.first().boundingBox().catch(() => null) : null;
    const imgVis = n ? await img.first().isVisible().catch(() => false) : false;
    const text = n ? (await card.first().innerText()).replace(/\s+/g, ' ').trim() : '';
    const intro = text.slice(text.indexOf(t) + t.length).trim();
    cards.push({ t, n, imgVis, imgBox, text, ok: n === 1 && imgVis && imgBox && imgBox.width > 0 && imgBox.height > 0 && text.includes(t) && intro.length >= 4 && hasCJK(intro) });
  }
  await ctx.shot(page, 'cp1-cards');
  ctx.check('1 两张游戏卡片（标题、图标、玩法介绍）', cards.every((c) => c.ok), JSON.stringify(cards));

  // 2 dialog contents
  let dlg = await openCreateDialog(page, '中国象棋·盲棋');
  const chessSel = await dlg.getByRole('radio', { name: '中国象棋·盲棋' }).isChecked().catch(() => false);
  const modeGroup = await dlg.getByRole('radiogroup', { name: '对战方式' }).isVisible().catch(() => false);
  const modeOnline = await dlg.getByRole('radio', { name: '联机对战' }).isVisible().catch(() => false);
  const modeAi = await dlg.getByRole('radio', { name: '和电脑对战' }).isVisible().catch(() => false);
  const okBtn = await dlg.getByRole('button', { name: '确认' }).isVisible().catch(() => false);
  const cancelBtn = await dlg.getByRole('button', { name: '取消' }).isVisible().catch(() => false);
  const textboxes = await dlg.getByRole('textbox').filter({ visible: true }).count();
  const combos = await dlg.getByRole('combobox').filter({ visible: true }).count();
  const radios = await dlg.getByRole('radio').filter({ visible: true }).count();
  await ctx.shot(page, 'cp2-chess-dialog');
  ctx.check('2a 象棋卡片打开弹窗：已选象棋，有联机对战/和电脑对战、确认/取消，无其他选项',
    chessSel && modeGroup && modeOnline && modeAi && okBtn && cancelBtn && textboxes === 0 && combos === 0 && radios === 4,
    `chessChecked=${chessSel} modeGroup=${modeGroup} online=${modeOnline} ai=${modeAi} ok=${okBtn} cancel=${cancelBtn} textboxes=${textboxes} combos=${combos} radios=${radios}`);
  await dlg.getByRole('button', { name: '取消' }).click();
  await dlg.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});

  dlg = await openCreateDialog(page, '德州扑克');
  const pokerSel = await dlg.getByRole('radio', { name: '德州扑克' }).isChecked().catch(() => false);
  const combo = dlg.getByRole('combobox', { name: '人数上限' });
  const comboVis = await combo.isVisible().catch(() => false);
  const opts = comboVis ? await combo.locator('option').evaluateAll((os) => os.map((o) => o.value || o.textContent.trim())) : [];
  const def = comboVis ? await combo.inputValue() : null;
  const pTextboxes = await dlg.getByRole('textbox').filter({ visible: true }).count();
  await ctx.shot(page, 'cp2-poker-dialog');
  ctx.check('2b 扑克卡片打开弹窗：已选扑克，人数上限可选正好 2～9，默认 9',
    pokerSel && comboVis && JSON.stringify(opts) === JSON.stringify(['2', '3', '4', '5', '6', '7', '8', '9']) && def === '9' && pTextboxes === 0,
    `pokerChecked=${pokerSel} combo=${comboVis} options=${JSON.stringify(opts)} default=${def} textboxes=${pTextboxes}`);

  // 3 cancel / close / outside
  const closed = [];
  await dlg.getByRole('button', { name: '取消' }).click();
  closed.push(await dlg.waitFor({ state: 'hidden', timeout: 5000 }).then(() => true).catch(() => false));
  dlg = await openCreateDialog(page, '德州扑克');
  await dlg.getByRole('button', { name: '关闭' }).click();
  closed.push(await dlg.waitFor({ state: 'hidden', timeout: 5000 }).then(() => true).catch(() => false));
  dlg = await openCreateDialog(page, '中国象棋·盲棋');
  const vp = page.viewportSize();
  await page.mouse.click(8, vp.height - 8);
  closed.push(await dlg.waitFor({ state: 'hidden', timeout: 5000 }).then(() => true).catch(() => false));
  await sleep(500);
  const me3 = await u1.me();
  const rooms3 = await u1.rooms();
  const mine3 = rooms3.filter((r) => r.hostUsername === u1.username);
  const url3 = page.url();
  await ctx.shot(page, 'cp3-after-cancel');
  ctx.check('3 取消/关闭/点弹窗外都关闭弹窗，仍在大厅，未开房',
    closed.every(Boolean) && /\/lobby/.test(url3) && !me3.currentRoomId && !me3.activeRoomId && mine3.length === 0,
    `closed(cancel,close,outside)=${closed} url=${url3.replace(BASE, '')} currentRoomId=${me3.currentRoomId} activeRoomId=${me3.activeRoomId} myListedRooms=${mine3.length}`);

  // 4 online chess
  const p2 = await openPage(ctx, u2);
  await gotoLobby(p2);
  const roomId4 = await createViaDialog(page, '中国象棋·盲棋', { mode: '联机对战' });
  const st4 = page.getByRole('status', { name: '对局状态' });
  const waitTxt = await waitFor(async () => { const t = await st4.innerText(); return /等待对手加入/.test(t) ? t : null; }, { timeout: 15000 });
  await ctx.shot(page, 'cp4-room-waiting');
  const row4 = await waitRow(p2, roomId4, (r) => r && r.cells.includes('1/2') && r.cells.includes('等待中'), 15000);
  await ctx.shot(p2, 'cp4-u2-lobby');
  ctx.check('4 联机象棋：进入房间显示等待对手；U2 大厅看到“1/2”“等待中”',
    !!waitTxt && !!row4, `status=${waitTxt || (await st4.innerText().catch(() => '?'))} u2row=${cellsStr(row4 || await rowCells(p2, roomId4))}`);

  // 5 ai chess
  const u5 = await ctx.reg('ai5');
  const p5 = await openPage(ctx, u5);
  await gotoLobby(p5);
  const roomId5 = await createViaDialog(p5, '中国象棋·盲棋', { mode: '和电脑对战' });
  const st5 = p5.getByRole('status', { name: '对局状态' });
  const t5 = await waitFor(async () => { const t = await st5.innerText(); return /你执红/.test(t) && /轮到红方/.test(t) ? t : null; }, { timeout: 15000 });
  const apiSt5 = await u5.state(roomId5);
  await ctx.shot(p5, 'cp5-ai-room');
  await p2.reload(); await p2.getByRole('table', { name: ROOMS_TABLE }).waitFor();
  await sleep(2500);
  const inList5 = await rowCells(p2, roomId5);
  const apiList5 = (await u2.rooms()).some((r) => r.id === roomId5);
  ctx.check('5 和电脑对战：直接进入对局，执红，轮到红方；不出现在他人列表',
    !!t5 && apiSt5.chess?.status === 'active' && apiSt5.chess?.yourColor === 'red' && apiSt5.chess?.turn === 'red' && !inList5 && !apiList5,
    `status=${t5 || (await st5.innerText().catch(() => '?'))} api=${apiSt5.chess?.status}/${apiSt5.chess?.yourColor}/${apiSt5.chess?.turn} inU2List=${!!inList5} inApiList=${apiList5}`);

  // 6 capacity bounds via dialog
  const caps = [];
  for (const cap of [2, 9, null]) {
    const h = await ctx.reg('h' + (cap || 'd'));
    const ph = await openPage(ctx, h);
    await gotoLobby(ph);
    const rid = await createViaDialog(ph, '德州扑克', cap ? { capacity: cap } : {});
    const want = `1/${cap || 9}`;
    const row = await waitRow(p2, rid, (r) => r && r.cells.includes(want), 15000);
    caps.push({ cap: cap || 'default', rid, want, row: cellsStr(row || await rowCells(p2, rid)), ok: !!row, h });
    await ph.context().close();
  }
  await ctx.shot(p2, 'cp6-capacities');
  const bad = [];
  for (const cap of [1, 10]) {
    const x = await ctx.reg('bad' + cap);
    const r = await x.req('POST', '/api/rooms', { game: 'poker', capacity: cap });
    const me = await x.me();
    bad.push({ cap, status: r.status, code: r.code, currentRoomId: me.currentRoomId, ok: r.status === 400 && !me.currentRoomId });
  }
  ctx.check('6 人数上限 2/9/默认 显示“1/2”“1/9”“1/9”；1 与 10 弹窗选不到、接口拒绝',
    caps.every((c) => c.ok) && bad.every((b) => b.ok) && !opts.includes('1') && !opts.includes('10'),
    JSON.stringify({ caps: caps.map(({ h, ...c }) => c), bad, dialogOptions: opts }));

  // 7 full room
  const cap2 = caps[0];
  const u3 = await ctx.reg('j3');
  await u3.join(cap2.rid);
  const u4 = await ctx.reg('j4');
  const p4 = await openPage(ctx, u4);
  await gotoLobby(p4);
  const row7 = await waitRow(p4, cap2.rid, (r) => r && r.cells.includes('2/2') && r.btnDisabled === true && /已满员/.test(r.text), 15000);
  await ctx.shot(p4, 'cp7-full');
  const j7 = await u4.req('POST', `/api/rooms/${cap2.rid}/join`, {});
  const h3 = await ctx.reg('h3');
  const rid3 = await pokerRoomWith(h3, 3);
  const b1 = await h3.addBot(rid3); const b2 = await h3.addBot(rid3);
  const ph3 = await openPage(ctx, h3);
  await gotoRoom(ph3, rid3);
  const addBtn = ph3.getByRole('button', { name: '添加电脑玩家' });
  await addBtn.waitFor({ timeout: 15000 }).catch(() => {});
  await sleep(1000);
  const addDisabled = await addBtn.isDisabled().catch(() => null);
  await ctx.shot(ph3, 'cp7-bots-full');
  const b3 = await h3.addBot(rid3);
  const row73 = await waitRow(p4, rid3, (r) => r && r.cells.includes('3/3'), 15000);
  ctx.check('7 达到上限：2/2 置灰“已满员”且接口加入被拒；3/3 时“添加电脑玩家”不可用且接口添加被拒',
    !!row7 && j7.status === 409 && b1.status < 300 && b2.status < 300 && !!row73 && addDisabled === true && b3.status === 409,
    `row2=${cellsStr(row7 || await rowCells(p4, cap2.rid))} apiJoin=${j7.status} ${j7.code} bots=${b1.status},${b2.status} row3=${cellsStr(row73 || await rowCells(p4, rid3))} addBotDisabled=${addDisabled} apiAddBot3=${b3.status} ${b3.code}`);
}

// ---------------- TS-08 ----------------
async function ts08(ctx) {
  const V = await ctx.reg('v'); const A = await ctx.reg('a'); const B = await ctx.reg('b'); const C = await ctx.reg('c');
  const D = await ctx.reg('d'); const E = await ctx.reg('e'); const F = await ctx.reg('f'); const G = await ctx.reg('g'); const H = await ctx.reg('h');
  const rA = (await A.createRoom('chess')).id;
  const rB = (await B.createRoom('chess')).id; await C.join(rB);
  const rD = await pokerRoomWith(D, 6); const bot = await D.addBot(rD);
  const rE = await pokerRoomWith(E, undefined, [F]); const ps = await E.pokerStart(rE);
  const rG = (await G.aiGame()).id;
  ctx.log(`setup bot=${bot.status} pokerStart=${ps.status}`);
  const page = await openPage(ctx, V);
  await gotoLobby(page);
  const headers = await page.getByRole('table', { name: ROOMS_TABLE }).getByRole('columnheader').allInnerTexts();
  const exp = [
    [rA, A, '中国象棋·盲棋', '1/2', '等待中'],
    [rB, B, '中国象棋·盲棋', '2/2', '对局中'],
    [rD, D, '德州扑克', '2/6', '等待中'],
    [rE, E, '德州扑克', '2/9', '对局中'],
  ];
  const res = [];
  for (const [rid, host, game, cnt, status] of exp) {
    const want = [`${host.username}的房间`, game, cnt, status];
    const row = await waitRow(page, rid, (r) => r && want.every((w, i) => r.cells[i] === w), 10000);
    res.push({ host: host.username.split('_')[2], want, got: (row || await rowCells(page, rid))?.cells, ok: !!row });
  }
  await ctx.shot(page, 'cp1-list');
  const hdrOk = ['房间名', '游戏类型', '人数', '状态'].every((x, i) => headers[i]?.trim() === x);
  ctx.check('1 列为房间名/游戏类型/人数/状态，各行房间名、类型、人数、状态正确（含电脑玩家计数）',
    hdrOk && res.every((r) => r.ok), JSON.stringify({ headers, rows: res }));
  await sleep(2500);
  const gRow = await rowCells(page, rG);
  const gApi = (await V.rooms()).some((r) => r.id === rG);
  ctx.check('2 人机房间不在列表中', !gRow && !gApi, `uiRow=${cellsStr(gRow)} api=${gApi}`);

  await H.join(rD);
  const pD = await openPage(ctx, D);
  await gotoRoom(pD, rD);
  await pD.getByRole('button', { name: '离开房间' }).click();
  const cdlg = pD.getByRole('dialog', { name: '确认离开房间' });
  await cdlg.getByRole('button', { name: '确认离开' }).click();
  await pD.waitForURL(/\/lobby/, { timeout: 15000 }).catch(() => {});
  const row3 = await waitRow(page, rD, (r) => r && r.cells[0] === `${H.username}的房间`, 15000);
  await ctx.shot(page, 'cp3-host-changed');
  ctx.check('3 房主离开后房间名变为“H的房间”', !!row3, `row=${cellsStr(row3 || await rowCells(page, rD))} expected=${H.username}的房间`);
}

// ---------------- TS-09 ----------------
async function ts09(ctx) {
  const V = await ctx.reg('v'); const W = await ctx.reg('w'); const W2 = await ctx.reg('w2');
  const rW = (await W.createRoom('chess')).id; await W2.join(rW);
  const P = []; for (let i = 1; i <= 8; i++) P.push(await ctx.reg('p' + i));
  const r1 = (await P[0].createRoom('chess')).id;
  const r2 = (await P[1].createRoom('chess')).id; await P[2].join(r2);
  const r3 = await pokerRoomWith(P[3]);
  const r4 = await pokerRoomWith(P[4], undefined, [P[5]]); const st = await P[4].pokerStart(r4);
  const r5 = await pokerRoomWith(P[6], 2, [P[7]]);
  ctx.log(`pokerStart r4=${st.status}`);
  const pv = await openPage(ctx, V);
  await gotoLobby(pv);
  const pw = await openPage(ctx, W);
  await gotoLobby(pw);
  const all = (r) => r && r.cells && r.cells.length >= 4;
  const rows = {};
  for (const [k, id] of Object.entries({ r1, r2, r3, r4, r5 })) rows[k] = await waitRow(pv, id, all, 15000);
  rows.r4 = await waitRow(pv, r4, (r) => r && r.cells.includes('对局中'), 10000) || rows.r4;
  const w1 = await waitRow(pw, r1, (r) => r && r.btnDisabled === true, 10000) || await rowCells(pw, r1);
  await ctx.shot(pv, 'v-lobby');
  await ctx.shot(pw, 'w-lobby');

  ctx.check('行2 象棋对局中 2/2（V）：置灰，原因“已满员”或“对局中”',
    rows.r2 && rows.r2.btnDisabled === true && /已满员|对局中/.test(rows.r2.cells[4] || rows.r2.text.replace(/^.*?(等待中|对局中)\s*/, '')), cellsStr(rows.r2));
  ctx.check('行5 扑克满员 2/2（V）：置灰，原因“已满员”',
    rows.r5 && rows.r5.btnDisabled === true && /已满员/.test(rows.r5.cells[4] || ''), cellsStr(rows.r5));
  ctx.check('行6 象棋等待中 1/2（W 有对局）：置灰，说明有进行中的对局',
    w1 && w1.btnDisabled === true && /进行中的对局/.test(w1.cells?.[4] || ''), cellsStr(w1));

  // forced clicks on disabled buttons
  const forced = [];
  for (const [pg, api, id, who] of [[pv, V, r2, 'V-r2'], [pv, V, r5, 'V-r5'], [pw, W, r1, 'W-r1']]) {
    const before = await api.me();
    const cntBefore = (await api.rooms()).find((r) => r.id === id)?.players;
    await rowLoc(pg, id).getByRole('button').click({ force: true, timeout: 5000 }).catch((e) => ctx.log('force click: ' + e.message.split('\n')[0]));
    await sleep(1500);
    const after = await api.me();
    const cntAfter = (await api.rooms()).find((r) => r.id === id)?.players;
    forced.push({ who, url: pg.url().replace(BASE, ''), before: before.currentRoomId, after: after.currentRoomId, cntBefore, cntAfter,
      ok: /\/lobby/.test(pg.url()) && before.currentRoomId === after.currentRoomId && cntBefore === cntAfter });
  }
  ctx.check('置灰按钮强制点击后仍在大厅，currentRoomId 不变，人数不增加', forced.every((x) => x.ok), JSON.stringify(forced));

  // enabled rows for V
  const enter = async (id) => {
    await gotoLobby(pv);
    const row = await waitRow(pv, id, (r) => r && r.btnDisabled === false, 10000);
    if (!row) return { row: await rowCells(pv, id), entered: false };
    await rowLoc(pv, id).getByRole('button', { name: '加入' }).click();
    const entered = await pv.waitForURL(new RegExp(`/room/${id}`), { timeout: 15000 }).then(() => true).catch(() => false);
    return { row, entered };
  };
  const e1 = await enter(r1);
  await ctx.shot(pv, 'row1-entered');
  ctx.check('行1 象棋等待中 1/2（V）：可用，点击后进入该房间', e1.entered, `${cellsStr(e1.row)} url=${pv.url().replace(BASE, '')}`);
  await V.leave(r1);
  const e3 = await enter(r3);
  await ctx.shot(pv, 'row3-entered');
  ctx.check('行3 扑克等待中有空座（V）：可用，点击后进入', e3.entered, `${cellsStr(e3.row)} url=${pv.url().replace(BASE, '')}`);
  await V.leave(r3);

  const listStatus4 = (await rowCells(pv, r4)) || rows.r4;
  const e4 = await enter(r4);
  let seatTxt = '';
  let s4 = null;
  if (e4.entered) {
    const mySeat = pv.locator('[data-me="true"]').first();
    seatTxt = await waitFor(async () => { const t = await mySeat.innerText(); return /等待下一手/.test(t) ? t : null; }, { timeout: 15000 }) || await mySeat.innerText().catch(() => '');
    s4 = await V.state(r4);
  }
  await ctx.shot(pv, 'row4-entered');
  const vSeat = s4?.poker?.you?.seat;
  const vSeatObj = s4?.poker?.seats?.find((s) => s && s.seat === vSeat) || s4?.poker?.seats?.[vSeat];
  const noHole = !!s4 && !(vSeatObj?.holeCards?.length);
  const hand1 = s4?.poker?.handNumber;
  // finish current hand: humans fold until hand ends
  let nextOk = false; let nextInfo = '';
  if (e4.entered) {
    await waitFor(async () => {
      const s = await P[4].state(r4);
      if (s.poker?.handNumber !== hand1 || s.poker?.stage === 'complete' || s.poker?.stage === 'idle') return true;
      for (const p of [P[4], P[5]]) { const ps2 = await p.state(r4); if (ps2.poker?.you?.legal) { await p.action(r4, ps2.poker.you.legal.check ? 'fold' : 'fold'); break; } }
      return false;
    }, { timeout: 30000, interval: 500 });
    const s = await waitFor(async () => {
      const x = await V.state(r4);
      return x.poker?.handNumber > hand1 && x.poker?.stage !== 'complete' ? x : null;
    }, { timeout: 60000, interval: 500 });
    if (s) {
      const me = s.poker.seats.find((x) => x && x.seat === s.poker.you.seat) || s.poker.seats[s.poker.you.seat];
      nextOk = (me?.holeCards?.length === 2);
      nextInfo = `hand=${s.poker.handNumber} myHole=${me?.holeCards?.length}`;
    } else nextInfo = 'next hand did not start within 1 min';
  }
  await ctx.shot(pv, 'row4-nexthand');
  ctx.check('行4 扑克一手进行中有空座（V）：列表“对局中”且可用；进入后“等待下一手”、本手无底牌；下一手参与',
    listStatus4 && listStatus4.cells.includes('对局中') && e4.entered && /等待下一手/.test(seatTxt) && noHole && nextOk,
    `list=${cellsStr(listStatus4)} entered=${e4.entered} seatText=${seatTxt.replace(/\s+/g, ' ')} noHoleThisHand=${noHole} next: ${nextInfo}`);
}

// ---------------- TS-10 ----------------
async function ts10(ctx) {
  const V = await ctx.reg('v'); const X1 = await ctx.reg('x1'); const X = await ctx.reg('x'); const Y = await ctx.reg('y');
  const R1 = (await X1.createRoom('chess')).id;
  const R2 = await pokerRoomWith(Y, 2);
  const page = await openPage(ctx, V);
  let frozen = null; let freeze = false;
  await page.route(/\/api\/rooms(\?.*)?$/, async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    if (freeze && frozen) return route.fulfill({ status: 200, contentType: 'application/json', body: frozen });
    const resp = await route.fetch();
    const body = await resp.text();
    frozen = body;
    return route.fulfill({ response: resp, body });
  });
  await gotoLobby(page);
  const ready = await waitRow(page, R1, (r) => r && r.btnDisabled === false, 15000) && await waitRow(page, R2, (r) => r && r.btnDisabled === false, 15000);
  freeze = true;
  ctx.log(`list ready=${!!ready}`);

  await X.join(R1);
  await sleep(300);
  const pre1 = await rowCells(page, R1);
  await rowLoc(page, R1).getByRole('button', { name: '加入' }).click({ timeout: 5000 }).catch((e) => ctx.log('click R1: ' + e.message.split('\n')[0]));
  const alert1 = await waitFor(async () => { const t = (await page.getByRole('alert').allInnerTexts()).join(' ').trim(); return t || null; }, { timeout: 8000 });
  const url1 = page.url();
  const me1 = await V.me();
  await ctx.shot(page, 'cp1-alert');
  freeze = false;
  const row1 = await waitRow(page, R1, (r) => !r || r.btnDisabled === true || r.cells.includes('对局中'), 15000);
  await ctx.shot(page, 'cp1-list');
  ctx.check('1 房间已满后加入：中文说明原因，仍在大厅，未进入 R1；列表随后显示最新状态',
    pre1 && pre1.btnDisabled === false && alert1 && hasCJK(alert1) && !/[A-Z]{3,}_[A-Z]+/.test(alert1) && /\/lobby/.test(url1) && me1.currentRoomId !== R1 && !!row1,
    `rowAtClick=${cellsStr(pre1)} alert=${alert1} url=${url1.replace(BASE, '')} currentRoomId=${me1.currentRoomId} rowAfter=${cellsStr(row1 || await rowCells(page, R1))}`);

  // 2 room closed
  await waitRow(page, R2, (r) => r && r.btnDisabled === false, 10000);
  freeze = true;
  await Y.leave(R2);
  await sleep(300);
  const alertsBefore = (await page.getByRole('alert').allInnerTexts()).join('|');
  const pre2 = await rowCells(page, R2);
  await rowLoc(page, R2).getByRole('button', { name: '加入' }).click({ timeout: 5000 }).catch((e) => ctx.log('click R2: ' + e.message.split('\n')[0]));
  const alert2 = await waitFor(async () => { const t = (await page.getByRole('alert').allInnerTexts()).join('|').trim(); return t && t !== alertsBefore ? t : null; }, { timeout: 8000 })
    || (await page.getByRole('alert').allInnerTexts()).join('|').trim();
  const url2 = page.url();
  const me2 = await V.me();
  await ctx.shot(page, 'cp2-alert');
  freeze = false;
  const gone = await waitRow(page, R2, (r) => !r, 15000);
  await ctx.shot(page, 'cp2-list');
  ctx.check('2 房间已关闭后加入：中文说明原因，仍在大厅，R2 从列表消失',
    pre2 && pre2.btnDisabled === false && alert2 && hasCJK(alert2) && !/[A-Z]{3,}_[A-Z]+/.test(alert2) && /\/lobby/.test(url2) && me2.currentRoomId !== R2 && !!gone,
    `rowAtClick=${cellsStr(pre2)} alert=${alert2} url=${url2.replace(BASE, '')} currentRoomId=${me2.currentRoomId} goneAfter=${!!gone}`);
}

// ---------------- TS-11 ----------------
async function ts11(ctx) {
  const V = await ctx.reg('v'); const A = await ctx.reg('a'); const B = await ctx.reg('b');
  const C = await ctx.reg('c'); const D = await ctx.reg('d'); const E = await ctx.reg('e');
  const page = await openPage(ctx, V);
  let navs = 0;
  await gotoLobby(page);
  page.on('framenavigated', (fr) => { if (fr === page.mainFrame()) navs += 1; });
  await page.evaluate(() => { window.__qaNoReload = 1; });
  await sleep(1000);
  // act() returns room id when it creates one; t0 = moment the operation completed
  const step = async (label, act, id, pred, shot) => {
    const rid = (await act()) || id;
    const t0 = Date.now();
    const r = await timeRow(page, rid, pred, t0, 5000);
    await ctx.shot(page, shot);
    ctx.check(label, r.ms !== null && r.ms <= 5000, `elapsedMs=${r.ms} row=${cellsStr(r.row)}`);
    return rid;
  };
  const rA = await step('1 A 开联机象棋房间，5 秒内出现“1/2”“等待中”', async () => (await A.createRoom('chess')).id, null,
    (x) => x && x.cells.includes('1/2') && x.cells.includes('等待中'), 'cp1');
  await step('2 B 加入后 5 秒内“2/2”“对局中”', async () => { await B.join(rA); }, rA, (x) => x && x.cells.includes('2/2') && x.cells.includes('对局中'), 'cp2');
  const rC = await pokerRoomWith(C);
  await step('3a D 加入扑克房间后 5 秒内“2/9”', async () => { await D.join(rC); }, rC, (x) => x && x.cells.includes('2/9'), 'cp3a');
  await step('3b D 离开后 5 秒内“1/9”', async () => { await D.leave(rC); }, rC, (x) => x && x.cells.includes('1/9'), 'cp3b');
  await E.join(rC);
  await step('4 开始牌局后 5 秒内“对局中”', async () => { const r = await C.pokerStart(rC); ctx.log('pokerStart ' + r.status); }, rC, (x) => x && x.cells.includes('对局中'), 'cp4');
  await step('5 象棋认输结束后 5 秒内从列表消失', async () => { const r = await A.resign(rA); ctx.log('resign ' + r.status); }, rA, (x) => !x, 'cp5');
  await step('6 扑克成员全部离开后 5 秒内从列表消失', async () => { await C.leave(rC); await E.leave(rC); }, rC, (x) => !x, 'cp6');
  const still = await page.evaluate(() => window.__qaNoReload === 1).catch(() => false);
  ctx.check('测试期间页面未被刷新', still && navs === 0, `markerKept=${still} mainFrameNavigations=${navs}`);
}

// ---------------- TS-12 ----------------
async function ts12(ctx) {
  const U1 = await ctx.reg('u1');
  const page = await openPage(ctx, null);
  const fill = async (kind, user, pw) => {
    await page.goto(BASE + '/' + kind);
    await page.getByRole('textbox', { name: '用户名' }).fill(user);
    await page.getByLabel('密码').fill(pw);
    await page.getByRole('button', { name: kind === 'login' ? '登录' : '注册', exact: true }).click();
    const t = await waitFor(async () => { const x = (await page.getByRole('alert').allInnerTexts()).join(' ').trim(); return x || null; }, { timeout: 8000 });
    await sleep(500);
    const url = page.url().replace(BASE, '');
    let meStatus = null;
    try { meStatus = await page.evaluate(async () => (await fetch('/api/me')).status); } catch { meStatus = 'offline'; }
    return { kind, alert: t || '', url, meStatus, stay: url.startsWith('/' + kind), notLogged: meStatus !== 200 };
  };
  const ok = (r) => r.alert && hasCJK(r.alert) && r.stay && r.notLogged;
  const fmt = (r) => `[${r.kind}] alert=${r.alert} url=${r.url} me=${r.meStatus}`;

  const r1 = await fill('register', U1.username, newPassword());
  await ctx.shot(page, 'cp1');
  ctx.check('1 用户名已被占用', ok(r1) && /占用|已存在|已被注册|已注册/.test(r1.alert), fmt(r1));

  const r2a = await fill('login', U1.username, newPassword() + 'x');
  await ctx.shot(page, 'cp2a');
  const r2b = await fill('login', newUsername('nx'), newPassword());
  ctx.check('2 用户名或密码错误（错误密码、不存在的用户名）',
    ok(r2a) && ok(r2b) && /用户名或密码/.test(r2a.alert) && /用户名或密码/.test(r2b.alert), fmt(r2a) + ' ; ' + fmt(r2b));

  const r3 = [];
  for (const kind of ['login', 'register']) {
    const u = await fill(kind, '   ', newPassword());
    const p = await fill(kind, newUsername('ep'), '');
    r3.push({ u, p });
  }
  await ctx.shot(page, 'cp3');
  ctx.check('3 用户名为空/密码为空：说明提到出错的那一项',
    r3.every(({ u, p }) => ok(u) && ok(p) && /用户名/.test(u.alert) && /密码/.test(p.alert) && !/用户名/.test(p.alert.replace(/用户名或密码/g, ''))),
    r3.map(({ u, p }) => fmt(u) + ' ; ' + fmt(p)).join(' || '));

  // 4 length bounds
  const base = newUsername('L');
  const u200 = (base + 'x'.repeat(200)).slice(0, 200);
  await page.goto(BASE + '/register');
  await page.getByRole('textbox', { name: '用户名' }).fill(u200);
  const pw200 = newPassword();
  await page.getByLabel('密码').fill(pw200);
  await page.getByRole('button', { name: '注册', exact: true }).click();
  const okReg = await page.waitForURL(/\/lobby/, { timeout: 15000 }).then(() => true).catch(() => false);
  const me200 = await page.evaluate(async () => { const r = await fetch('/api/me'); return r.status === 200 ? (await r.json()).user.username.length : r.status; });
  await ctx.shot(page, 'cp4-200');
  await page.evaluate(() => fetch('/api/auth/logout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }));
  await page.context().clearCookies();
  const u201 = (newUsername('L') + 'y'.repeat(201)).slice(0, 201);
  const r4u = await fill('register', u201, newPassword());
  const r4p = await fill('register', newUsername('lp'), 'p'.repeat(201));
  await ctx.shot(page, 'cp4-201');
  ctx.check('4 用户名 200 字符注册成功；用户名 201 被拒提到用户名；密码 201 被拒提到密码',
    okReg && me200 === 200 && ok(r4u) && /用户名/.test(r4u.alert) && ok(r4p) && /密码/.test(r4p.alert) && !/用户名/.test(r4p.alert),
    `reg200 url-lobby=${okReg} meUsernameLen=${me200} ; ${fmt(r4u)} ; ${fmt(r4p)}`);

  // 5 offline
  const r5 = [];
  for (const kind of ['login', 'register']) {
    await page.goto(BASE + '/' + kind);
    await page.getByRole('textbox', { name: '用户名' }).fill(newUsername('off'));
    await page.getByLabel('密码').fill(newPassword());
    await page.context().setOffline(true);
    await page.getByRole('button', { name: kind === 'login' ? '登录' : '注册', exact: true }).click();
    const t = await waitFor(async () => { const x = (await page.getByRole('alert').allInnerTexts()).join(' ').trim(); return x || null; }, { timeout: 15000 });
    await ctx.shot(page, 'cp5-' + kind);
    const url = page.url().replace(BASE, '');
    await page.context().setOffline(false);
    r5.push({ kind, alert: t || '', url, meStatus: 'n/a', stay: url.startsWith('/' + kind), notLogged: true });
  }
  ctx.check('5 离线提交登录与注册：说明网络连接失败', r5.every((r) => ok(r) && /网络/.test(r.alert)), r5.map(fmt).join(' ; '));

  const four = [r1.alert, r2a.alert, r3[0].u.alert, r5[0].alert];
  ctx.check('6 四类说明文字互不相同', four.every(Boolean) && new Set(four).size === 4, JSON.stringify(four));
}

// ---------------- TS-13 ----------------
function styleProbe([btnName, blockSel]) {
  // executed in page
  const cs = (e) => getComputedStyle(e);
  const opaque = (c) => c && !/rgba\(\s*0,\s*0,\s*0,\s*0\s*\)|transparent/.test(c);
  const root = document.getElementById('root') || document.body.firstElementChild;
  let pageBg = null; let pageBgImg = 'none';
  for (const e of [root, document.body, document.documentElement]) {
    if (!e) continue;
    const s = cs(e);
    if (s.backgroundImage && s.backgroundImage !== 'none' && pageBgImg === 'none') pageBgImg = s.backgroundImage.slice(0, 120);
    if (opaque(s.backgroundColor)) { pageBg = s.backgroundColor; break; }
  }
  const btn = [...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') || b.innerText).trim() === btnName);
  const b = btn ? cs(btn) : null;
  let block = null;
  for (const sel of blockSel) {
    const els = [...document.querySelectorAll(sel)];
    for (const el of els) {
      let e = el;
      for (let i = 0; i < 4 && e && e !== document.body; i++, e = e.parentElement) {
        const s = cs(e);
        const diff = opaque(s.backgroundColor) && s.backgroundColor !== pageBg;
        const shadow = s.boxShadow && s.boxShadow !== 'none';
        const img = s.backgroundImage && s.backgroundImage !== 'none';
        if (diff || shadow || img) { block = { sel, tag: e.tagName, cls: String(e.className).slice(0, 60), bg: s.backgroundColor, shadow: s.boxShadow.slice(0, 80), img: img ? s.backgroundImage.slice(0, 60) : 'none' }; break; }
      }
      if (block) break;
    }
    if (block) break;
  }
  return {
    pageBg, pageBgImg, bodyFont: cs(document.body).fontFamily,
    mainFont: cs(document.querySelector('main') || document.body).fontFamily,
    btn: b ? { name: btnName, font: b.fontFamily, radius: b.borderRadius, bg: b.backgroundColor, border: `${b.borderTopWidth} ${b.borderTopStyle} ${b.borderTopColor}`, bgImg: b.backgroundImage } : null,
    block,
  };
}
function hue(c) {
  const r = c.r / 255; const g = c.g / 255; const b = c.b / 255;
  const mx = Math.max(r, g, b); const mn = Math.min(r, g, b); const d = mx - mn;
  if (d === 0) return { h: null, s: 0 };
  let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  return { h, s: d / mx };
}
function sameMainColor(a, b) {
  if (a === b) return true;
  const ca = parseRgb(a); const cb = parseRgb(b);
  if (!ca || !cb) return false;
  const ha = hue(ca); const hb = hue(cb);
  if (ha.h === null || hb.h === null) return false;
  const dh = Math.min(Math.abs(ha.h - hb.h), 360 - Math.abs(ha.h - hb.h));
  return dh <= 20 && ha.s > 0.2 && hb.s > 0.2;
}
async function ts13(ctx) {
  const U = await ctx.reg('s1'); const P = await ctx.reg('s2');
  const aiRoom = (await U.aiGame()).id;
  const pokerRoom = (await P.createRoom('poker')).id;
  const anon = await openPage(ctx, null);
  const pages = [];
  await anon.goto(BASE + '/login'); await anon.getByRole('button', { name: '登录', exact: true }).waitFor();
  await sleep(500); await ctx.shot(anon, 'login');
  pages.push({ name: '登录页', ...(await anon.evaluate(styleProbe, ['登录', ['form']])) });
  await anon.goto(BASE + '/register'); await anon.getByRole('button', { name: '注册', exact: true }).waitFor();
  await sleep(500); await ctx.shot(anon, 'register');
  pages.push({ name: '注册页', ...(await anon.evaluate(styleProbe, ['注册', ['form']])) });
  const pl = await openPage(ctx, P);
  await gotoLobby(pl); await sleep(1000); await ctx.shot(pl, 'lobby');
  pages.push({ name: '大厅', ...(await pl.evaluate(styleProbe, ['退出登录', ['table', 'main button:has([role="img"]), main button:has(img), main button:has(svg)']])) });
  const pc = await openPage(ctx, U);
  await gotoRoom(pc, aiRoom); await pc.getByRole('group', { name: '棋盘' }).waitFor({ timeout: 15000 }); await sleep(1500); await ctx.shot(pc, 'chess');
  pages.push({ name: '象棋房间', ...(await pc.evaluate(styleProbe, ['回到大厅', ['[role="group"][aria-label="棋盘"]']])) });
  await gotoRoom(pl, pokerRoom); await pl.getByRole('region', { name: '牌桌' }).waitFor({ timeout: 15000 }); await sleep(1500); await ctx.shot(pl, 'poker');
  pages.push({ name: '扑克房间', ...(await pl.evaluate(styleProbe, ['回到大厅', ['[aria-label="牌桌"]']])) });
  // unstyled reference button
  const ref = await anon.context().newPage();
  await ref.setContent('<button>x</button>');
  const def = await ref.evaluate(() => { const s = getComputedStyle(document.querySelector('button')); return { bg: s.backgroundColor, border: `${s.borderTopWidth} ${s.borderTopStyle} ${s.borderTopColor}`, radius: s.borderRadius }; });
  await ref.close();
  ctx.saveJson('styles', { pages, defaultButton: def });

  const bgs = pages.map((p) => ({ n: p.name, bg: p.pageBg, img: p.pageBgImg }));
  ctx.check('1 五个页面背景不是纯白', pages.every((p) => (p.pageBg && p.pageBg !== 'rgb(255, 255, 255)') || (!p.pageBg && p.pageBgImg !== 'none')), JSON.stringify(bgs));
  const fonts = new Set(pages.map((p) => p.bodyFont));
  const btns = pages.map((p) => p.btn);
  const bFonts = new Set(btns.map((b) => b?.font)); const bRad = new Set(btns.map((b) => b?.radius));
  const colorOk = btns.every((b) => b && sameMainColor(b.bg, btns[0].bg));
  ctx.check('2 主体字体族相同；主要按钮字体族、圆角相同，背景同一主色',
    fonts.size === 1 && btns.every(Boolean) && bFonts.size === 1 && bRad.size === 1 && colorOk && bFonts.has([...fonts][0]),
    JSON.stringify({ bodyFonts: [...fonts], buttons: btns }));
  ctx.check('3 按钮不是浏览器默认样式', btns.every((b) => b && (b.bg !== def.bg || b.border !== def.border || b.radius !== def.radius)), JSON.stringify({ def, buttons: btns }));
  ctx.check('4 每页至少一个内容区块与页面背景有可见差异', pages.every((p) => p.block), JSON.stringify(pages.map((p) => ({ n: p.name, pageBg: p.pageBg, block: p.block }))));
}

export const scenarios = [
  { id: 'TS-07', group: 'A', limitMinutes: 5, run: ts07 },
  { id: 'TS-08', group: 'A', limitMinutes: 5, run: ts08 },
  { id: 'TS-09', group: 'A', limitMinutes: 5, run: ts09 },
  { id: 'TS-10', group: 'A', limitMinutes: 5, run: ts10 },
  { id: 'TS-11', group: 'A', limitMinutes: 5, run: ts11 },
  { id: 'TS-12', group: 'A', limitMinutes: 5, run: ts12 },
  { id: 'TS-13', group: 'A', limitMinutes: 5, run: ts13 },
];
