// TS-30..TS-34, TS-40e, TS-40f: raise amounts, acting highlight, showdown, split pot, fold win, full hands, negative chips
import { BASE, openPage, gotoRoom, gotoLobby, sleep, waitFor, waitTableIdle } from '../lib.mjs';

// ---------- helpers ----------
const RANKS = '23456789TJQKA';
function eval5(cs) {
  const r = cs.map((c) => RANKS.indexOf(c[0])).sort((a, b) => b - a);
  const fl = cs.every((c) => c[1] === cs[0][1]);
  const uniq = new Set(r).size === 5;
  let st = -1;
  if (uniq) { if (r[0] - r[4] === 4) st = r[0]; else if (r.join() === '12,3,2,1,0') st = 3; }
  const cnt = {};
  r.forEach((x) => { cnt[x] = (cnt[x] || 0) + 1; });
  const g = Object.entries(cnt).map(([k, v]) => [v, +k]).sort((a, b) => b[0] - a[0] || b[1] - a[1]);
  const ks = g.map((x) => x[1]);
  if (st >= 0 && fl) return [8, st];
  if (g[0][0] === 4) return [7, ...ks];
  if (g[0][0] === 3 && g[1][0] === 2) return [6, ...ks];
  if (fl) return [5, ...r];
  if (st >= 0) return [4, st];
  if (g[0][0] === 3) return [3, ...ks];
  if (g[0][0] === 2 && g[1][0] === 2) return [2, ...ks];
  if (g[0][0] === 2) return [1, ...ks];
  return [0, ...r];
}
const cmp = (a, b) => { for (let i = 0; i < Math.max(a.length, b.length); i++) { const d = (a[i] ?? -1) - (b[i] ?? -1); if (d) return d; } return 0; };
function best7(cards) {
  let best = null;
  for (let a = 0; a < 7; a++) for (let b = a + 1; b < 7; b++) {
    const five = cards.filter((_, i) => i !== a && i !== b);
    const v = eval5(five);
    if (!best || cmp(v, best) > 0) best = v;
  }
  return best;
}
const sameSet = (a, b) => a.length === b.length && [...a].sort().join() === [...b].sort().join();

async function setup(ctx, { humans = 2, capacity = 2, bots = 0, pages = true } = {}) {
  const users = [];
  for (let i = 0; i < humans; i++) users.push(await ctx.reg('p' + (i + 1)));
  const room = await users[0].createRoom('poker', capacity);
  for (const u of users.slice(1)) await u.join(room.id);
  for (let i = 0; i < bots; i++) { const r = await users[0].addBot(room.id); if (r.status >= 300) throw new Error('addBot ' + r.status); }
  const pgs = [];
  if (pages) {
    for (const u of users) {
      const p = await openPage(ctx, u);
      await gotoRoom(p, room.id);
      await p.getByRole('region', { name: '牌桌' }).waitFor({ timeout: 20000 });
      pgs.push(p);
    }
  }
  return { users, roomId: room.id, pages: pgs };
}
const seatOf = (st, u) => st.poker.seats.find((s) => s.userId === u.user.id)?.seat;
const opArea = (page) => page.locator('section[aria-label="操作区"]');
async function waitActive(page, timeout = 60000) {
  try { await page.locator('section[aria-label="操作区"][data-active="true"]').waitFor({ timeout }); return true; } catch { return false; }
}
async function startOnPage(page, api, roomId) {
  await page.getByRole('button', { name: '开始牌局' }).click();
  return waitFor(async () => { const s = await api.state(roomId); return s.poker?.handNumber >= 1 && s.poker.stage !== 'idle' ? s : null; }, { timeout: 20000 });
}
// act on own page with check/call/fold; waits until API version moves
async function pageAct(page, api, roomId, type) {
  const before = await api.state(roomId);
  if (!(await waitActive(page))) throw new Error('操作区未变为可用');
  await waitTableIdle(page, 60000);
  if (type === 'check') await page.getByRole('button', { name: '过牌', exact: true }).click();
  else if (type === 'call') await page.getByRole('button', { name: /^跟注/ }).click();
  else if (type === 'fold') await page.getByRole('button', { name: '弃牌', exact: true }).click();
  return waitFor(async () => { const s = await api.state(roomId); return s.version !== before.version ? s : null; }, { timeout: 15000 });
}
async function pageRaise(page, api, roomId, amount) {
  const before = await api.state(roomId);
  if (!(await waitActive(page))) throw new Error('操作区未变为可用');
  if (amount !== undefined) await page.getByRole('spinbutton', { name: '金额' }).fill(String(amount));
  await page.getByRole('button', { name: '加注', exact: true }).click();
  return waitFor(async () => { const s = await api.state(roomId); return s.version !== before.version ? s : null; }, { timeout: 8000 });
}
// submit attempt with an out-of-range amount: click 加注 if enabled, else press Enter in the amount box
async function trySubmit(page, amount) {
  const sp = page.getByRole('spinbutton', { name: '金额' });
  await sp.fill(String(amount));
  await sp.blur().catch(() => {});
  await sleep(200);
  const btn = page.getByRole('button', { name: '加注', exact: true });
  const enabled = await btn.isEnabled();
  if (enabled) await btn.click(); else { await sp.focus(); await sp.press('Enter'); }
  return enabled ? '加注按钮可点并已点击' : '加注按钮不可用，在金额框按回车';
}
// who must act now -> {api, idx, st(viewer st)}
async function actor(users, roomId) {
  const st = await users[0].state(roomId);
  const p = st.poker;
  if (!p || p.toActSeat === null || p.toActSeat === undefined) return { st };
  const idx = users.findIndex((u) => seatOf(st, u) === p.toActSeat);
  if (idx < 0) return { st, bot: true };
  const own = await users[idx].state(roomId);
  return { st, idx, own, legal: own.poker.you.legal };
}
const ended = (p) => p.stage === 'showdown' || p.stage === 'complete';
async function snap(page) {
  return page.evaluate(() => {
    const markers = ['庄家', '小盲', '大盲'];
    const cardsIn = (el) => [...el.querySelectorAll('[role="img"]')].filter((e) => !markers.includes(e.getAttribute('aria-label')))
      .map((e) => (e.getAttribute('aria-label') === '牌背' ? 'back' : (e.getAttribute('data-card') || e.getAttribute('aria-label'))));
    const seats = [...document.querySelectorAll('section[aria-label^="座位 "]')].map((e) => ({
      seat: Number(e.getAttribute('data-seat')), label: e.getAttribute('aria-label'), acting: e.getAttribute('data-acting'),
      me: e.getAttribute('data-me'), cards: cardsIn(e), text: e.textContent,
      chipsText: e.querySelector('[data-negative]')?.textContent || '', negative: e.querySelector('[data-negative]')?.getAttribute('data-negative'),
    }));
    const boardEl = document.querySelector('section[aria-label="公共牌"]');
    const board = boardEl ? cardsIn(boardEl) : [];
    const highlights = [...document.querySelectorAll('[data-highlight="true"]')].map((e) => e.getAttribute('data-card') || e.getAttribute('aria-label'));
    const res = [...document.querySelectorAll('[role="status"]')].find((e) => e.getAttribute('aria-label') === '本手结果');
    const pot = [...document.querySelectorAll('[role="status"]')].find((e) => e.getAttribute('aria-label') === '底池')?.textContent || '';
    const op = document.querySelector('section[aria-label="操作区"]');
    return { seats, board, highlights, result: res ? res.textContent.trim() : null, pot, active: op?.getAttribute('data-active') };
  });
}
const potNum = (t) => { const m = /(-?\d+)/.exec(t || ''); return m ? +m[1] : null; };
async function waitResult(page, timeout = 15000) {
  try {
    await page.waitForFunction(() => { const e = [...document.querySelectorAll('[role="status"]')].find((x) => x.getAttribute('aria-label') === '本手结果'); return e && e.textContent.trim().length > 0; }, null, { timeout });
    return true;
  } catch { return false; }
}
// hold check: poll every second while API hand unchanged; returns {ok, obs}
async function resultHeld(pages, api, roomId, hand) {
  const obs = [];
  let ok = true;
  const end = Date.now() + 70000;
  let next = null;
  while (Date.now() < end) {
    const s = await api.state(roomId);
    if (s.poker.handNumber > hand) { next = s; break; }
    const rs = await Promise.all(pages.map((p) => snap(p).then((x) => x.result)));
    obs.push(rs.map((r) => (r ? 'Y' : 'N')).join(''));
    if (rs.some((r) => !r)) {
      const s2 = await api.state(roomId);
      if (s2.poker.handNumber === hand) ok = false;
    }
    await sleep(1000);
  }
  if (!next) return { ok: false, obs: `下一手1分钟内未开始 polls=${obs.join(',')}`, started: false };
  const gone = await waitFor(async () => { const rs = await Promise.all(pages.map((p) => snap(p).then((x) => x.result))); return rs.every((r) => !r) ? true : null; }, { timeout: 10000 });
  return { ok: ok && !!gone && obs.length > 0, obs: `polls=${obs.join(',')} 下一手开始后结果消失=${!!gone}`, started: true };
}

// ---------- TS-30 ----------
async function ts30(ctx) {
  const { users, roomId, pages } = await setup(ctx);
  const [u1, u2] = users; const p1 = pages[0];
  await startOnPage(p1, u1, roomId);
  await waitActive(p1); await waitTableIdle(p1);
  let st = await u1.state(roomId);
  let lg = st.poker.you.legal;
  const mySeat = () => st.poker.seats.find((s) => s.userId === u1.user.id);
  const sl = p1.getByRole('slider', { name: '加注金额' });
  const sp = p1.getByRole('spinbutton', { name: '金额' });
  const smin = await sl.getAttribute('min'); const smax = await sl.getAttribute('max');
  await ctx.shot(p1, 'cp1');
  ctx.check('1 滑块最小、最大值等于接口最小值、最大值', Number(smin) === lg.minRaiseTo && Number(smax) === lg.maxRaiseTo, `slider min=${smin} max=${smax} api min=${lg.minRaiseTo} max=${lg.maxRaiseTo}`);

  // quick amounts preflop
  const quick = async (btn, ratio, label, submit) => {
    st = await u1.state(roomId); lg = st.poker.you.legal;
    const s = await snap(p1);
    const uiPot = potNum(s.pot);
    const bet = mySeat().committedThisRound; const call = lg.callAmount || 0;
    let exp = bet + call + Math.round(ratio * (uiPot + call));
    const raw = exp;
    exp = Math.max(lg.minRaiseTo, Math.min(lg.maxRaiseTo, exp));
    await p1.getByRole('button', { name: btn, exact: true }).click();
    await sleep(300);
    const v1 = Number(await sp.inputValue()); const v2 = Number(await sl.inputValue());
    let obs = `${label}: 本轮已下注=${bet} 跟注额=${call} 界面底池=${uiPot} 接口底池=${st.poker.pot} 公式=${raw} 区间=${lg.minRaiseTo}~${lg.maxRaiseTo} 预期=${exp} 输入框=${v1} 滑块=${v2}`;
    let ok = uiPot === st.poker.pot && v1 === exp && v2 === exp;
    if (submit) {
      const s2 = await pageRaise(p1, u1, roomId);
      const me2 = s2 && s2.poker.seats.find((x) => x.userId === u1.user.id);
      obs += ` 提交后本轮下注=${me2?.committedThisRound}`;
      ok = ok && me2?.committedThisRound === exp;
    }
    await ctx.shot(p1, 'cp5-' + label);
    ctx.check(`5 快捷金额（${label}）`, ok, obs);
  };
  await quick('半个底池', 0.5, '翻牌前半个底池-取最小值', false);
  await quick('一个底池', 1, '翻牌前一个底池', false);

  // cp2 out of range
  st = await u1.state(roomId); lg = st.poker.you.legal;
  for (const [amt, lab] of [[lg.minRaiseTo - 1, '最小值−1'], [lg.maxRaiseTo + 1, '最大值+1']]) {
    const before = await u1.state(roomId);
    const how = await trySubmit(p1, amt);
    await sleep(1500);
    const after = await u1.state(roomId);
    const alerts = (await p1.getByRole('alert').allTextContents()).join(' | ');
    const unchanged = after.version === before.version && after.poker.actions.length === before.poker.actions.length;
    await ctx.shot(p1, 'cp2-' + amt);
    ctx.check(`2 输入${lab}（${amt}）被拒绝，说明范围且未提交`, alerts.includes(String(lg.minRaiseTo)) && alerts.includes(String(lg.maxRaiseTo)) && unchanged,
      `${how}; alert="${alerts}" version ${before.version}->${after.version} 状态不变=${unchanged}`);
  }
  // cp3 min submit
  st = await u1.state(roomId); lg = st.poker.you.legal;
  const min = lg.minRaiseTo;
  st = await pageRaise(p1, u1, roomId, min);
  ctx.check('3 输入最小值提交成功，本轮下注等于最小值', st && mySeat().committedThisRound === min, `最小值=${min} 本轮下注=${st && mySeat().committedThisRound}`);
  // u2 calls
  let a = await actor(users, roomId);
  if (a.idx === 1) await u2.action(roomId, 'call');
  // flop: u2 checks first (non-dealer), then u1 no bet
  a = await actor(users, roomId);
  if (a.idx === 1) await u2.action(roomId, 'check');
  await waitActive(p1); await waitTableIdle(p1);
  st = await u1.state(roomId); lg = st.poker.you.legal;
  {
    const before = await u1.state(roomId);
    const how = await trySubmit(p1, st.poker.blinds.big - 1);
    await sleep(1500);
    const after = await u1.state(roomId);
    const alerts = (await p1.getByRole('alert').allTextContents()).join(' | ');
    const rejected = after.version === before.version && alerts.length > 0;
    const s2 = await pageRaise(p1, u1, roomId, st.poker.blinds.big);
    const me2 = s2?.poker.seats.find((x) => x.userId === u1.user.id);
    await ctx.shot(p1, 'cp4');
    ctx.check('4 无人下注时最小值等于大盲，大盲−1被拒绝、大盲被接受', lg && lg.minRaiseTo === st.poker.blinds.big && rejected && me2?.committedThisRound === st.poker.blinds.big,
      `stage=${st.poker.stage} currentBet=${st.poker.currentBet} minRaiseTo=${lg?.minRaiseTo} big=${st.poker.blinds.big} 大盲−1: ${how} alert="${alerts}" 未提交=${after.version === before.version}; 提交大盲后本轮下注=${me2?.committedThisRound}`);
  }
  a = await actor(users, roomId); if (a.idx === 1) await u2.action(roomId, 'call');
  // turn: u2 checks, u1 half pot in range submit
  a = await actor(users, roomId); if (a.idx === 1) await u2.action(roomId, 'check');
  await waitActive(p1); await waitTableIdle(p1);
  await quick('半个底池', 0.5, '转牌半个底池-区间内', true);
  a = await actor(users, roomId); if (a.idx === 1) await u2.action(roomId, 'call');
  a = await actor(users, roomId); if (a.idx === 1) await u2.action(roomId, 'check');
  await waitActive(p1); await waitTableIdle(p1);
  await quick('一个底池', 1, '河牌一个底池-区间内', true);
  a = await actor(users, roomId); if (a.idx === 1) await u2.action(roomId, 'fold');
  // hand 2: u2 SB acts first and calls; u1 raises to 400; u2 calls; flop u1 one pot -> max
  const h1 = st.poker.handNumber;
  const s2 = await waitFor(async () => { const s = await u1.state(roomId); return s.poker.handNumber > h1 && !ended(s.poker) ? s : null; }, { timeout: 60000 });
  if (!s2) { ctx.check('5 快捷金额（取最大值）', false, '下一手1分钟内未开始'); return; }
  a = await actor(users, roomId); if (a.idx === 1) await u2.action(roomId, a.legal.check ? 'check' : 'call');
  await waitActive(p1); await waitTableIdle(p1);
  st = await pageRaise(p1, u1, roomId, 400);
  a = await actor(users, roomId); if (a.idx === 1) await u2.action(roomId, 'call');
  a = await actor(users, roomId);
  if (a.idx === 1) { await u2.action(roomId, 'check'); }
  await waitActive(p1); await waitTableIdle(p1);
  await quick('半个底池', 0.5, '本手投入400后半个底池', false);
  await quick('一个底池', 1, '本手投入接近上限一个底池-取最大值', false);
  st = await u1.state(roomId); lg = st.poker.you.legal;
  const max = lg.maxRaiseTo;
  st = await pageRaise(p1, u1, roomId, max);
  ctx.check('3 另一手输入最大值提交成功，本手投入不超过1000', st && mySeat().committedThisRound === max && mySeat().committedThisHand <= 1000,
    `最大值=${max} 本轮下注=${st && mySeat().committedThisRound} 本手投入=${st && mySeat().committedThisHand}`);
}

// ---------- TS-31 ----------
async function ts31(ctx) {
  const { users, roomId, pages } = await setup(ctx, { humans: 3, capacity: 4, bots: 1 });
  await startOnPage(pages[0], users[0], roomId);
  let lastKey = null; let n = 0; let botSeen = 0; let allOk = true; const obsAll = [];
  const end = Date.now() + 4 * 60000;
  while (n < 10 && Date.now() < end) {
    const st = await users[0].state(roomId);
    const p = st.poker;
    if (ended(p) || p.toActSeat == null) { await sleep(300); continue; }
    const key = `${p.handNumber}:${p.actions.length}:${p.toActSeat}`;
    if (key === lastKey) { await sleep(200); continue; }
    lastKey = key;
    const seatInfo = p.seats.find((s) => s.seat === p.toActSeat);
    const isBot = seatInfo.kind !== 'human';
    // wait pages to show it
    let snaps = null;
    const okp = await waitFor(async () => {
      snaps = await Promise.all(pages.map((pg) => snap(pg)));
      return snaps.every((s) => { const ac = s.seats.filter((x) => x.acting === 'true'); return ac.length === 1 && ac[0].seat === p.toActSeat; }) ? true : null;
    }, { timeout: isBot ? 8000 : 15000, interval: 100 });
    const st2 = await users[0].state(roomId);
    const key2 = `${st2.poker.handNumber}:${st2.poker.actions.length}:${st2.poker.toActSeat}`;
    const desc = snaps.map((s) => s.seats.filter((x) => x.acting === 'true').map((x) => x.seat).join('/')).join(' | ');
    if (!okp && key2 !== key && isBot) { obsAll.push(`${key} 电脑玩家已在页面高亮前行动(页面:${desc})`); continue; }
    n++;
    if (isBot) botSeen++;
    if (n <= 2 || isBot) await ctx.shot(pages[0], `seq${n}${isBot ? '-bot' : ''}`);
    const ok = !!okp;
    allOk = allOk && ok;
    obsAll.push(`${key}${isBot ? '(电脑)' : ''} 三页高亮=${desc} ${ok ? 'OK' : 'NG'}`);
    ctx.check(`第${n}次轮换：三个页面只有一个座位高亮且为接口轮到的座位${n > 1 ? '（高亮移到新座位）' : ''}${isBot ? '（电脑玩家）' : ''}`, ok, `接口 toActSeat=${p.toActSeat} 页面高亮座位=${desc}`);
    if (!isBot) {
      const idx = users.findIndex((u) => u.user.id === seatInfo.userId);
      const own = await users[idx].state(roomId);
      const lg = own.poker.you.legal;
      if (lg) await pageAct(pages[idx], users[idx], roomId, lg.check ? 'check' : 'call');
    }
  }
  ctx.saveJson('sequence', obsAll);
  ctx.check('至少覆盖一次轮到电脑玩家', botSeen > 0, obsAll.join('; '));
}

// ---------- showdown helpers ----------
// play current hand: via API except river actions via pages (keeps pages current). allPage=true -> all via pages
async function playHand(users, pages, roomId, { allPage = false } = {}) {
  for (let i = 0; i < 30; i++) {
    const a = await actor(users, roomId);
    if (ended(a.st.poker)) return a.st;
    if (a.idx === undefined) { await sleep(200); continue; }
    const type = a.legal.check ? 'check' : 'call';
    if (allPage || a.st.poker.stage === 'river') await pageAct(pages[a.idx], users[a.idx], roomId, type);
    else await users[a.idx].action(roomId, type);
  }
  return (await users[0].state(roomId));
}
function judgeShowdown(ctx, prefix, st, snaps, users) {
  const p = st.poker;
  const sd = p.showdown;
  const names = users.map((u) => u.username);
  // cp1 hole cards face on both pages
  const holeOk = snaps.every((s) => sd.every((x) => { const se = s.seats.find((y) => y.seat === x.seat); return se && sameSet(se.cards, x.holeCards); }));
  ctx.check(`${prefix}1 摊牌时双方页面两人底牌都翻开且与接口一致`, holeOk && sd.length === 2,
    `接口=${JSON.stringify(sd.map((x) => [x.seat, x.holeCards]))} 页面=${JSON.stringify(snaps.map((s) => s.seats.map((y) => [y.seat, y.cards])))}`);
  const winSeats = p.winners.map((w) => w.seat);
  const expHl = [...new Set(sd.filter((x) => winSeats.includes(x.seat)).flatMap((x) => x.bestCards))];
  const hlOk = snaps.every((s) => sameSet([...new Set(s.highlights)], expHl) && s.highlights.length === new Set(s.highlights).size);
  ctx.check(`${prefix}2 高亮的牌正好是赢家的最佳5张，与接口bestCards一致`, hlOk, `接口赢家bestCards=${expHl.join(',')} 页面高亮=${snaps.map((s) => s.highlights.join(',')).join(' | ')}`);
  const lines = p.winners.map((w) => { const x = sd.find((y) => y.seat === w.seat); return `${w.name} ${x?.handLabel} 赢得 ${w.amount}`; });
  const resOk = snaps.every((s) => s.result && lines.every((l) => s.result.includes(l)));
  ctx.check(`${prefix}3 页面显示赢家名、牌型、赢得筹码数，与接口一致`, resOk, `预期含=${lines.join(' / ')} 页面=${snaps.map((s) => s.result).join(' | ')}`);
  return names;
}

// ---------- TS-32 ----------
async function ts32(ctx) {
  const { users, roomId, pages } = await setup(ctx);
  await startOnPage(pages[0], users[0], roomId);
  for (let h = 0; h < 4; h++) {
    const st = await playHand(users, pages, roomId, { allPage: true });
    if (st.poker.stage !== 'showdown') throw new Error('未到摊牌 stage=' + st.poker.stage);
    if (st.poker.winners.length !== 1) {
      ctx.log(`hand ${st.poker.handNumber} split, retry`);
      await waitFor(async () => { const s = await users[0].state(roomId); return s.poker.handNumber > st.poker.handNumber ? s : null; }, { timeout: 60000 });
      continue;
    }
    await Promise.all(pages.map((p) => waitResult(p)));
    await Promise.all(pages.map((p) => waitTableIdle(p, 5000)));
    const snaps = await Promise.all(pages.map((p) => snap(p)));
    await Promise.all(pages.map((p, i) => ctx.shot(p, 'showdown-u' + (i + 1))));
    ctx.saveJson('showdown', { api: st.poker, snaps });
    judgeShowdown(ctx, '', st, snaps, users);
    const held = await resultHeld(pages, users[0], roomId, st.poker.handNumber);
    ctx.check('4 结果保持显示直到下一手开始，下一手开始后消失', held.ok, held.obs);
    return;
  }
  ctx.check('单个赢家的摊牌', false, '连续4手都是平分，未得到单个赢家的摊牌');
}

// ---------- TS-33 ----------
async function ts33(ctx) {
  const { users, roomId, pages } = await setup(ctx);
  await startOnPage(pages[0], users[0], roomId);
  const deadline = Date.now() + 5 * 60000;
  let hands = 0;
  while (Date.now() < deadline) {
    const st = await playHand(users, pages, roomId);
    hands++;
    if (st.poker.stage === 'showdown' && st.poker.winners.length > 1) {
      await Promise.all(pages.map((p) => waitResult(p)));
      await Promise.all(pages.map((p) => waitTableIdle(p, 5000)));
      const snaps = await Promise.all(pages.map((p) => snap(p)));
      await Promise.all(pages.map((p, i) => ctx.shot(p, 'split-u' + (i + 1))));
      ctx.saveJson('split', { api: st.poker, snaps, hands });
      const sd = st.poker.showdown;
      const expHl = [...new Set(sd.filter((x) => st.poker.winners.some((w) => w.seat === x.seat)).flatMap((x) => x.bestCards))];
      const hlOk = snaps.every((s) => sameSet([...new Set(s.highlights)], expHl));
      const lines = st.poker.winners.map((w) => `${w.name} ${sd.find((y) => y.seat === w.seat)?.handLabel} 赢得 ${w.amount}`);
      const resOk = snaps.every((s) => s.result && lines.every((l) => s.result.includes(l)));
      ctx.check('平分底池：每位赢家的5张牌都高亮（与各自bestCards一致）', hlOk, `第${hands}手 接口=${JSON.stringify(sd.map((x) => [x.seat, x.bestCards]))} 页面高亮=${snaps.map((s) => s.highlights.join(',')).join(' | ')}`);
      ctx.check('平分底池：页面分别显示每位赢家赢得的筹码数，与接口一致', resOk, `预期含=${lines.join(' / ')} 页面=${snaps.map((s) => s.result).join(' | ')}`);
      return;
    }
    const hn = st.poker.handNumber;
    const nx = await waitFor(async () => { const s = await users[0].state(roomId); return s.poker.handNumber > hn ? s : null; }, { timeout: Math.max(1000, Math.min(60000, deadline - Date.now())) });
    if (!nx) break;
  }
  ctx.notReported(`5分钟内（${hands}手）未出现平分底池`);
}

// ---------- TS-34 ----------
async function ts34(ctx) {
  const { users, roomId, pages } = await setup(ctx);
  const [u1, u2] = users; const [p1, p2] = pages;
  await startOnPage(p1, u1, roomId);
  // U1 (SB) acts first preflop: raise to minimum so U2 faces a bet, then U2 folds on its page
  let a = await actor(users, roomId);
  if (a.idx === 0) await pageRaise(p1, u1, roomId);
  a = await actor(users, roomId);
  if (a.idx !== 1) throw new Error('未轮到U2');
  const st = await pageAct(p2, u2, roomId, 'fold');
  const p = st.poker;
  await Promise.all(pages.map((pg) => waitResult(pg)));
  await Promise.all(pages.map((pg) => waitTableIdle(pg, 5000)));
  const snaps = await Promise.all(pages.map((pg) => snap(pg)));
  await ctx.shot(p1, 'u1'); await ctx.shot(p2, 'u2');
  ctx.saveJson('fold-win', { api: p, snaps });
  const w = p.winners[0];
  const line = w ? `${w.name} 赢得底池 ${w.amount}` : '?';
  ctx.check('1 U2弃牌后不摊牌，双方页面显示U1赢得底池及筹码数，与接口一致',
    p.stage === 'complete' && p.showdown.length === 0 && p.winners.length === 1 && w.name === u1.username && snaps.every((s) => s.result && s.result.includes(line)),
    `stage=${p.stage} showdown=${p.showdown.length} winners=${JSON.stringify(p.winners)} 页面=${snaps.map((s) => s.result).join(' | ')}`);
  const s1 = seatOf(st, u1); const s2 = seatOf(st, u2);
  const u1onP2 = snaps[1].seats.find((x) => x.seat === s1)?.cards || [];
  const u2onP1 = snaps[0].seats.find((x) => x.seat === s2)?.cards || [];
  ctx.check('2 U2页面看不到U1底牌正面，U1页面看不到U2底牌', u1onP2.every((c) => c === 'back') && u2onP1.every((c) => c === 'back'),
    `U2页面上U1座位的牌=${u1onP2.join(',')} U1页面上U2座位的牌=${u2onP1.join(',')}`);
  const held = await resultHeld(pages, u1, roomId, p.handNumber);
  ctx.check('3 结果保持显示直到下一手开始', held.ok, held.obs);
}

// ---------- TS-40e ----------
async function ts40e(ctx) {
  const { users, roomId, pages } = await setup(ctx);
  const [u1, u2] = users;
  await startOnPage(pages[0], u1, roomId);
  let bal = [1000, 1000];
  for (let h = 1; h <= 3; h++) {
    if (h > 1) {
      const ok = await waitFor(async () => { const s = await u1.state(roomId); return s.poker.handNumber >= h && !ended(s.poker) ? s : null; }, { timeout: 60000 });
      if (!ok) { ctx.log(`第${h}手1分钟内未开始，只判定已完成的各手`); break; }
    }
    await Promise.all(pages.map((p) => waitTableIdle(p, 60000)));
    // cp1
    const sts = await Promise.all(users.map((u) => u.state(roomId)));
    const snaps0 = await Promise.all(pages.map((p) => snap(p)));
    const c1 = users.map((u, i) => {
      const me = sts[i].poker.seats.find((s) => s.userId === u.user.id);
      const opp = sts[i].poker.seats.find((s) => s.userId !== u.user.id);
      const ms = snaps0[i].seats.find((x) => x.seat === me.seat); const os = snaps0[i].seats.find((x) => x.seat === opp.seat);
      return { ok: me.holeCards?.length === 2 && sameSet(ms?.cards || [], me.holeCards) && os?.cards.length === 2 && os.cards.every((c) => c === 'back'), o: `U${i + 1} 接口底牌=${me.holeCards} 页面自己=${ms?.cards} 对方=${os?.cards}` };
    });
    await ctx.shot(pages[0], `h${h}-preflop`);
    ctx.check(`第${h}手 1 每位玩家看到自己2张底牌正面、对方2张背面，接口自己底牌2张`, c1.every((x) => x.ok), c1.map((x) => x.o).join('; '));
    // cp2: walk stages
    const exp = { preflop: 0, flop: 3, turn: 4, river: 5 };
    const seenStages = []; let boardPrev = []; let c2ok = true; const c2obs = [];
    let st = sts[0];
    for (let i = 0; i < 30 && !ended(st.poker); i++) {
      const a = await actor(users, roomId);
      st = a.st;
      if (ended(st.poker)) break;
      if (a.idx === undefined) { await sleep(200); continue; }
      const stage = st.poker.stage; const board = st.poker.board;
      if (!seenStages.includes(stage)) {
        seenStages.push(stage);
        const active = await waitActive(pages[a.idx], 15000);
        await waitTableIdle(pages[a.idx], 60000);
        let pageBoard = [];
        await waitFor(async () => { pageBoard = (await snap(pages[a.idx])).board; return sameSet(pageBoard, board) ? true : null; }, { timeout: 10000, interval: 200 });
        const ok = board.length === exp[stage] && boardPrev.every((c, j) => board[j] === c) && !!a.legal && active && sameSet(pageBoard, board);
        c2ok = c2ok && ok;
        c2obs.push(`${stage}:公共牌${board.length}张[${board}] 页面[${pageBoard}] 可用操作=${!!a.legal} 操作区可用=${active}`);
        boardPrev = board.slice();
      }
      st = await pageAct(pages[a.idx], users[a.idx], roomId, a.legal.check ? 'check' : 'call');
    }
    st = await u1.state(roomId);
    const allStages = ['preflop', 'flop', 'turn', 'river'].every((s) => seenStages.includes(s));
    ctx.check(`第${h}手 2 公共牌依次0/3/4/5张且不变，四个阶段都轮到玩家行动`, c2ok && allStages, c2obs.join('; '));
    const p = st.poker;
    if (p.stage !== 'showdown') { ctx.check(`第${h}手 3 摊牌`, false, `stage=${p.stage}`); break; }
    await Promise.all(pages.map((pg) => waitResult(pg)));
    await Promise.all(pages.map((pg) => waitTableIdle(pg, 5000)));
    const snaps = await Promise.all(pages.map((pg) => snap(pg)));
    await ctx.shot(pages[0], `h${h}-showdown`);
    const sd = p.showdown;
    const shown = snaps.every((s) => sd.length === 2 && sd.every((x) => sameSet(s.seats.find((y) => y.seat === x.seat)?.cards || [], x.holeCards)));
    const vals = sd.map((x) => ({ seat: x.seat, v: best7([...x.holeCards, ...p.board]) }));
    const c = cmp(vals[0].v, vals[1].v);
    const myWin = c === 0 ? vals.map((x) => x.seat) : [c > 0 ? vals[0].seat : vals[1].seat];
    ctx.check(`第${h}手 3 河牌后双方底牌亮出（测试判定赢家）`, shown, `接口亮牌=${JSON.stringify(sd.map((x) => [x.seat, x.holeCards]))} 公共牌=${p.board} 测试判定赢家座位=${myWin} 页面=${JSON.stringify(snaps.map((s) => s.seats.map((y) => y.cards)))}`);
    await sleep(500);
    const me = await Promise.all(users.map((u) => u.me()));
    const seatU = users.map((u) => seatOf(st, u));
    const apiWin = p.winners.map((w) => w.seat);
    const expBal = users.map((_, i) => bal[i] + (myWin.length === 2 ? 0 : (myWin[0] === seatU[i] ? 10 : -10)));
    const winNames = myWin.map((s) => p.seats.find((x) => x.seat === s).name);
    const resOk = snaps.every((s) => s.result && winNames.every((n) => s.result.includes(n)) && (myWin.length === 2 || !s.result.includes(p.seats.find((x) => x.seat !== myWin[0]).name)));
    const ok4 = p.pot === 20 && sameSet(apiWin.map(String), myWin.map(String)) && resOk && me.every((m, i) => m.chips === expBal[i]);
    ctx.check(`第${h}手 4 底池20，页面结果、接口赢家与测试判定一致，余额${myWin.length === 2 ? '不变' : '赢家+10输家−10'}`, ok4,
      `pot=${p.pot} 接口赢家=${apiWin} 测试=${myWin} 页面结果=${snaps.map((s) => s.result).join(' | ')} 余额 前=${bal} 后=${me.map((m) => m.chips)} 预期=${expBal}`);
    bal = me.map((m) => m.chips);
  }
}

// ---------- TS-40f ----------
async function ts40f(ctx) {
  const { users, roomId } = await setup(ctx, { pages: false });
  const [u1, u2] = users;
  const p1 = await openPage(ctx, u1);
  await gotoRoom(p1, roomId);
  await p1.getByRole('region', { name: '牌桌' }).waitFor({ timeout: 20000 });
  const lobby = await openPage(ctx, u1);
  const expU1 = [500, 0, -500, -1000]; const expU2 = [1500, 2000, 2500, 3000];
  await startOnPage(p1, u1, roomId);
  const checkSeatAlive = async (label, h) => {
    const st = await waitFor(async () => { const s = await u1.state(roomId); return s.poker.handNumber >= h && !ended(s.poker) ? s : null; }, { timeout: 60000 });
    if (!st) { ctx.check(`2 ${label} U1仍可参加下一手`, false, '下一手1分钟内未开始'); return null; }
    const me = st.poker.seats.find((s) => s.userId === u1.user.id);
    await waitTableIdle(p1, 30000);
    const s = await snap(p1);
    const ms = s.seats.find((x) => x.seat === me?.seat);
    const blind = me?.isSmallBlind ? st.poker.blinds.small : me?.isBigBlind ? st.poker.blinds.big : 0;
    // wait until U1's turn (U2 calls/checks if first)
    let a = await actor(users, roomId);
    if (a.idx === 1) { await u2.action(roomId, a.legal.check ? 'check' : 'call'); a = await actor(users, roomId); }
    const canAct = a.idx === 0 && !!a.legal && await waitActive(p1, 15000);
    await ctx.shot(p1, `alive-h${h}`);
    ctx.check(`2 ${label} U1仍入座、无"等待下一手"、发到2张底牌、轮到时可行动、盲注照常扣除`,
      me && me.inHand && !me.waitingNextHand && me.holeCards?.length === 2 && ms && !ms.text.includes('等待下一手') && ms.cards.length === 2 && ms.cards.every((c) => c !== 'back') && canAct && blind > 0 && me.committedThisHand === blind,
      `seat=${me?.seat} inHand=${me?.inHand} waitingNextHand=${me?.waitingNextHand} 底牌=${me?.holeCards} 页面牌=${ms?.cards} 页面文字="${ms?.text}" 可行动=${canAct} 盲注=${blind} 本手投入=${me?.committedThisHand}`);
    return st;
  };
  const checkNeg = async (exp, h) => {
    const st = await u1.state(roomId);
    const me = st.poker.seats.find((s) => s.userId === u1.user.id);
    await sleep(800);
    const s = await snap(p1);
    const ms = s.seats.find((x) => x.seat === me.seat);
    const seatNum = potNum(ms?.chipsText);
    await gotoLobby(lobby);
    await sleep(1500);
    const info = await lobby.getByRole('region', { name: '我的信息' }).textContent();
    const m = /扑克筹码\s*(-?−?\d+)/.exec(info || '');
    const apiMe = await u1.me();
    await ctx.shot(p1, `neg${exp}-table`); await ctx.shot(lobby, `neg${exp}-lobby`);
    ctx.check(`3 U1余额${exp}时牌桌座位与大厅顶部显示带负号的数，与接口一致`,
      apiMe.chips === exp && seatNum === me.chips && /-|−/.test(ms?.chipsText || '') && seatNum < 0 && m && /^[-−]/.test(m[1]) && Number(m[1].replace('−', '-')) === exp,
      `接口余额=${apiMe.chips} 接口座位筹码=${me.chips} 座位文字="${ms?.chipsText}" 大厅="${info}"`);
  };
  for (let h = 1; h <= 4; h++) {
    let st;
    if (h === 1) {
      st = await u1.state(roomId);
    } else if (h >= 3) {
      st = await checkSeatAlive(`第${h}手开始时（余额${expU1[h - 2]}）`, h);
      if (!st) break;
    } else {
      st = await waitFor(async () => { const s = await u1.state(roomId); return s.poker.handNumber >= h && !ended(s.poker) ? s : null; }, { timeout: 60000 });
      if (!st) { ctx.log(`第${h}手未开始`); break; }
    }
    let a = await actor(users, roomId);
    if (a.idx === 1) { await u2.action(roomId, a.legal.check ? 'check' : 'call'); a = await actor(users, roomId); }
    await waitActive(p1); await waitTableIdle(p1);
    await pageRaise(p1, u1, roomId, 500);
    a = await actor(users, roomId);
    if (a.idx === 1) await u2.action(roomId, 'raise', a.legal.minRaiseTo);
    a = await actor(users, roomId);
    if (a.idx === 0) await pageAct(p1, u1, roomId, 'fold');
    await sleep(800);
    const [m1, m2] = await Promise.all([u1.me(), u2.me()]);
    ctx.check(`1 第${h}手后U1余额${expU1[h - 1]}、U2余额${expU2[h - 1]}`, m1.chips === expU1[h - 1] && m2.chips === expU2[h - 1], `U1=${m1.chips} U2=${m2.chips}`);
    if (h >= 3) await checkNeg(expU1[h - 1], h);
  }
  await checkSeatAlive('第4手后（余额−1000，第5手）', 5);
}

export const scenarios = [
  { id: 'TS-30', group: 'B', limitMinutes: 5, run: ts30 },
  { id: 'TS-31', group: 'B', limitMinutes: 5, run: ts31 },
  { id: 'TS-32', group: 'B', limitMinutes: 5, run: ts32 },
  { id: 'TS-33', group: 'L1', limitMinutes: 7, timeoutNotReported: true, run: ts33 },
  { id: 'TS-34', group: 'B', limitMinutes: 5, run: ts34 },
  { id: 'TS-40e', group: 'B', limitMinutes: 8, run: ts40e },
  { id: 'TS-40f', group: 'B', limitMinutes: 8, run: ts40f },
];
