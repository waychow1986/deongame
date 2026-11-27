// Browser scenarios: TS-24, TS-25 (chess realtime / reconnect), TS-36 (poker realtime), TS-45, TS-46 (mobile).
import * as L from '../lib.mjs';
import * as X from '../xiangqi.mjs';
import { startOnline, clickMove } from './chess.mjs';
import { pk, table } from './poker.mjs';

const { BASE } = L;
const NAMES = {
  red: { king: '帅', advisor: '仕', elephant: '相', horse: '马', rook: '车', cannon: '炮', pawn: '兵' },
  black: { king: '将', advisor: '士', elephant: '象', horse: '马', rook: '车', cannon: '炮', pawn: '卒' },
};
const sideCn = (s) => (s === 'red' ? '红' : '黑');
const pieceLabel = (c) => (c.piece === 'hidden' ? `${sideCn(c.side)}暗子` : `${sideCn(c.side)}${NAMES[c.side][c.piece]}`);
const SUITS = { h: '红桃', d: '方块', c: '梅花', s: '黑桃' };
export const cardName = (c) => `${SUITS[c[1]]}${c[0] === 'T' ? '10' : c[0]}`;
const ACT = { fold: '弃牌', check: '过牌', call: '跟注', bet: '下注', raise: '加注', small_blind: '小盲', big_blind: '大盲', leave_fold: '弃牌' };
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const board = (page) => page.getByRole('group', { name: '棋盘' });
async function cellName(page, pos) {
  return page.evaluate((p) => {
    const g = [...document.querySelectorAll('[role=group]')].find((e) => (e.getAttribute('aria-label') || '').includes('棋盘'));
    const all = g ? [...g.querySelectorAll('button')] : [];
    const el = all.find((e) => (e.getAttribute('aria-label') || e.textContent || '').trim().startsWith(p + ' '));
    return el ? (el.getAttribute('aria-label') || el.textContent).trim() : '';
  }, pos);
}
const statusText = async (page) => (await page.getByRole('status').allInnerTexts().catch(() => [])).join(' | ');
// Waits (no reload) until fn() reports ok; per the plan, something that never shows up within the limit makes the scenario unreportable.
async function see(fn, what) {
  let last;
  const r = await L.waitFor(async () => { last = await fn(); return last && last.ok ? last : null; }, L.WAIT_MS, 300);
  if (!r) throw new L.Unreportable(`${what} not shown within limit: ${JSON.stringify(last).slice(0, 300)}`);
  return r;
}
async function cellIs(page, pos, label) {
  const n = await cellName(page, pos).catch(() => '');
  return { ok: n === `${pos} ${label}`, n };
}
async function press(loc, tap) { await (tap ? loc.tap() : loc.click()); }
async function resign(page, tap) {
  await press(page.getByRole('button', { name: '认输', exact: true }), tap);
  const confirm = page.getByRole('button', { name: /^(确认|确定)(认输)?$/ });
  if (await confirm.waitFor({ timeout: 1500 }).then(() => true).catch(() => false)) await press(confirm, tap);
}
const turnIs = (u, id, side) => L.mustWait(async () => { const s = await u.state(id); return s.chess.turn === side ? s : null; }, `turn ${side}`);

const chessPart = [
  {
    id: 'TS-24',
    async fn(ctx) {
      const { u1, u2, id } = await startOnline('rt');
      const p1 = await L.newPage(u1), p2 = await L.newPage(u2);
      await Promise.all([p1.goto(`${BASE}/room/${id}`), p2.goto(`${BASE}/room/${id}`)]);
      await Promise.all([board(p1).waitFor({ timeout: L.WAIT_MS }), board(p2).waitFor({ timeout: L.WAIT_MS })]);

      await clickMove(p1, 'a3', 'a4');
      const s1 = await turnIs(u1, id, 'black');
      const a4 = X.boardFromSnapshot(s1.chess).get('a4');
      const r1 = await see(async () => {
        const c = await cellIs(p2, 'a4', pieceLabel(a4)); const e = await cellIs(p2, 'a3', '空'); const st = await statusText(p2);
        return { ok: c.ok && e.ok && /轮到你走棋/.test(st), a4: c.n, a3: e.n, st };
      }, 'U2 sees a3-a4');
      ctx.cp('1 U1 点选 a3→a4 后，U2 页面无需刷新显示该步、a4 实际身份、轮到 U2', a4 && a4.piece !== 'hidden', { revealed: a4, ...r1 });

      await clickMove(p2, 'a6', 'a5');
      const s2 = await turnIs(u1, id, 'red');
      const a5 = X.boardFromSnapshot(s2.chess).get('a5');
      const r2 = await see(async () => {
        const c = await cellIs(p1, 'a5', pieceLabel(a5)); const e = await cellIs(p1, 'a6', '空'); const st = await statusText(p1);
        return { ok: c.ok && e.ok && /轮到你走棋/.test(st), a5: c.n, a6: e.n, st };
      }, 'U1 sees a6-a5');
      ctx.cp('2 U2 走 a6→a5 后，U1 页面无需刷新显示该步', a5 && a5.piece !== 'hidden', r2);

      const bd = X.boardFromSnapshot(s2.chess);
      const capHidden = (t) => { const c = bd.get(t); return c && c.side === 'black' && c.piece === 'hidden'; };
      let mv = X.isLegal(bd, 'red', 'b2', 'b9') && capHidden('b9') ? ['b2', 'b9'] : null;
      if (!mv) mv = X.legalMoves(bd, 'red').find(([, t]) => capHidden(t));
      if (!mv) throw new L.Unreportable('no capture of a hidden piece available');
      const nCap = (s2.chess.captured || []).length;
      await clickMove(p1, mv[0], mv[1]);
      const s3 = await turnIs(u1, id, 'black');
      const cap = (s3.chess.captured || [])[nCap] || {};
      const capName = `黑${NAMES.black[cap.piece] || '?'}`;
      const mover = X.boardFromSnapshot(s3.chess).get(mv[1]);
      const r3 = await see(async () => {
        const c = await cellIs(p2, mv[1], pieceLabel(mover));
        const items = await p2.getByRole('region', { name: '被吃的棋子' }).getByRole('listitem').allInnerTexts().catch(() => []);
        return { ok: c.ok && items.some((t) => t.trim() === capName), cell: c.n, items };
      }, 'U2 sees capture');
      ctx.cp(`3 U1 ${mv[0]}→${mv[1]} 吃盖棋：U2 页面显示被吃及其实际身份`, !!cap.piece && cap.piece !== 'hidden', { move: mv, captured: cap, ...r3 });

      const bm = X.legalMoves(X.boardFromSnapshot(s3.chess), 'black')[0];
      await see(async () => ({ ok: /轮到你走棋/.test(await statusText(p2)) }), 'U2 turn');
      await clickMove(p2, bm[0], bm[1]);
      await turnIs(u1, id, 'red');
      await p2.getByRole('button', { name: '提和', exact: true }).click();
      const r4a = await see(async () => {
        const v = await p1.getByRole('button', { name: '拒绝和棋' }).isVisible().catch(() => false);
        const w = await p1.getByRole('button', { name: '同意和棋' }).isVisible().catch(() => false);
        return { ok: v && w, reject: v, accept: w };
      }, 'U1 sees draw offer');
      await p1.getByRole('button', { name: '拒绝和棋' }).click();
      const r4b = await see(async () => { const st = await statusText(p2); return { ok: /对方拒绝了提和/.test(st), st }; }, 'U2 sees rejection');
      const s4 = await u1.state(id);
      ctx.cp('4 U2 提和：U1 页面无需刷新显示提和请求；U1 拒绝后 U2 页面显示对方已拒绝，对局继续', s4.chess.status === 'active' && !s4.chess.drawOffer,
        { r4a, r4b, status: s4.chess.status, drawOffer: s4.chess.drawOffer });

      const before = (await u2.me()).rating;
      await resign(p1, false);
      const r5 = await see(async () => {
        const d = p2.getByRole('dialog', { name: '对局结果' });
        const t = (await d.isVisible().catch(() => false)) ? await d.innerText() : '';
        return { ok: /你赢了/.test(t) && /认输/.test(t), t };
      }, 'U2 sees result');
      const after = (await u2.me()).rating;
      ctx.cp('5 U1 认输：U2 页面无需刷新显示 U2 胜、积分 +10 与最新积分',
        after === before + 10 && /积分变化：\s*\+10(?!\d)/.test(r5.t) && new RegExp(`当前积分：\\s*${after}(?!\\d)`).test(r5.t), { before, after, dialog: r5.t });
    },
  },
  {
    id: 'TS-25',
    async fn(ctx) {
      const { u1, u2, id } = await startOnline('rc');
      const p2 = await L.newPage(u2);
      await p2.goto(`${BASE}/room/${id}`);
      await board(p2).waitFor({ timeout: L.WAIT_MS });
      await p2.context().close();
      await L.sleep(1500);
      const mv = await u1.move(id, 'a3', 'a4');
      if (mv.status !== 200) throw new L.Unreportable(`U1 move rejected ${mv.status}`);
      await L.sleep(1500);
      const s = await u1.state(id);
      ctx.cp('U2 掉线期间房间仍为 2/2、对局未结束', s.members.length === 2 && s.chess.status === 'active' && s.chess.turn === 'black',
        { members: s.members.length, status: s.chess.status, turn: s.chess.turn });

      const a4 = X.boardFromSnapshot(s.chess).get('a4');
      const page = await L.newPage(null);
      await page.goto(BASE + '/login');
      await page.getByRole('textbox', { name: '用户名' }).fill(u2.user.username);
      await page.getByLabel('密码').fill(u2.password);
      await page.getByRole('button', { name: '登录' }).click();
      await page.waitForURL((url) => !/\/login/.test(url.pathname), { timeout: L.WAIT_MS }).catch(() => {});
      const auto = await page.waitForURL(new RegExp(`/room/${id}`), { timeout: 5000 }).then(() => true).catch(() => false);
      const landed = page.url();
      if (!auto) await page.goto(`${BASE}/room/${id}`);
      await board(page).waitFor({ timeout: L.WAIT_MS }).catch(() => {});
      await page.waitForTimeout(500);
      const me = await u2.me();
      const c = await cellIs(page, 'a4', pieceLabel(a4));
      const st = await statusText(page);
      ctx.cp('U2 重新登录后回到原对局，看到 U1 刚走的一步与轮到自己', me.currentRoomId === id && c.ok && /轮到你走棋/.test(st),
        { currentRoomId: me.currentRoomId, landed, autoToRoom: auto, a4: c.n, st });

      await clickMove(page, 'a6', 'a5');
      const ok = await L.waitFor(async () => { const t = await u1.state(id); return t.chess.turn === 'red' && t.chess.lastMove && t.chess.lastMove.from === 'a6' ? t : null; });
      ctx.cp('U2 能继续走棋且被接受', !!ok, ok ? ok.chess.lastMove : 'not applied');
    },
  },
];
const seatRegion = (page, s) => page.getByRole('region', { name: new RegExp(`^座位 \\d+：${esc(s.name)}$`) });
const seatText = async (page, s) => (await seatRegion(page, s).innerText().catch(() => '')) || '';
const bodyText = async (page) => (await page.locator('body').innerText().catch(() => '')) || '';
const imgNames = async (loc) => loc.getByRole('img').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') || e.getAttribute('alt') || '')).catch(() => []);
const seatName = (s) => s.name;
const potShown = async (page) => (await page.getByRole('status', { name: '底池' }).innerText().catch(() => '')) || '';
const hasN = (txt, label, n) => new RegExp(`${label}\\s*${n < 0 ? '[-−]' + Math.abs(n) : n}(?!\\d)`).test(txt);
// A visible line mentioning the player, the action word and (when given) the amount.
const actionShown = (txt, name, type, amount) => txt.split('\n').some((l) => l.includes(name) && l.includes(ACT[type]) && (amount == null || new RegExp(`(?<!\\d)${amount}(?!\\d)`).test(l)));
const near = (txt, name, amount) => new RegExp(`${esc(name)}[\\s\\S]{0,40}(?<!\\d)${amount}(?!\\d)`).test(txt);

// Resolves true once the page has received a room state push over its realtime connection (any transport).
function socketReady(page) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    page.on('websocket', (ws) => ws.on('framereceived', (f) => { if (String(f.payload).includes('"room:state"')) finish(true); }));
    page.on('response', async (r) => {
      if (!r.url().includes('/socket.io/')) return;
      const t = await r.text().catch(() => '');
      if (t.includes('"room:state"')) finish(true);
    });
    setTimeout(() => finish(false), L.WAIT_MS);
  });
}

async function pokerPagesShowHandStart(pages, p) {
  const sb = p.seats.find((s) => s.isSmallBlind), bb = p.seats.find((s) => s.isBigBlind), act = p.seats.find((s) => s.seat === p.toActSeat);
  const out = [];
  for (const pg of pages) {
    out.push(await see(async () => {
      const tsb = await seatText(pg, sb), tbb = await seatText(pg, bb), tact = await seatText(pg, act), pot = await potShown(pg);
      return { ok: /小盲/.test(tsb) && hasN(tsb, '本手投入：', sb.committedThisHand) && /大盲/.test(tbb) && hasN(tbb, '本手投入：', bb.committedThisHand)
        && hasN(pot, '底池：', p.pot) && /行动中/.test(tact), tsb, tbb, tact, pot };
    }, 'hand start on page'));
  }
  return out;
}

const pokerPart = [
  {
    id: 'TS-36',
    async fn(ctx) {
      const { us, id } = await table('rp', 2, 1);
      const [u1, u2] = us;
      const p1 = await L.newPage(u1), p2 = await L.newPage(u2);
      const live = [socketReady(p1), socketReady(p2)];
      await Promise.all([p1.goto(`${BASE}/room/${id}`), p2.goto(`${BASE}/room/${id}`)]);
      await Promise.all([p1.getByRole('region', { name: '牌桌' }).waitFor({ timeout: L.WAIT_MS }), p2.getByRole('region', { name: '牌桌' }).waitFor({ timeout: L.WAIT_MS })]);
      // Both pages are in the room with their realtime connection settled before the hand starts.
      const conn = await Promise.all(live);
      if (!conn.every(Boolean)) throw new L.Unreportable('page realtime connection not established within limit');
      await L.sleep(1000);
      // Real users act from their own page: the host taps 开始牌局, and each human acts on their own page below.
      await p1.getByRole('button', { name: '开始牌局' }).click({ timeout: L.WAIT_MS }).catch(() => { throw new L.Unreportable('start button not available on host page'); });
      let p = await L.mustWait(async () => { const q = await pk(u1, id); return q && q.handId && q.stage !== 'idle' ? q : null; }, 'hand started');
      // Checkpoint 1 is judged on this hand; the hand is driven on regardless so the later checkpoints are observed too.
      let r1 = null, start1 = null;
      try { r1 = await pokerPagesShowHandStart([p1, p2], p); } catch (e) { if (!(e instanceof L.Unreportable)) throw e; start1 = e.message; }
      if (r1) ctx.cp('1 开始一手：两人页面都显示被扣的盲注、底池、轮到谁', p.pot > 0, r1);

      // Hands until a showdown is observed (max 5); step 2/3 are checked on the first hand.
      let checked2 = false, sawShowdown = false;
      const boards = new Set();
      for (let hand = 0; hand < 5 && !sawShowdown; hand++) {
        if (hand > 0) p = await L.mustWait(async () => { const q = await pk(u1, id); return q.handId !== p.handId && q.stage === 'preflop' ? q : null; }, 'next hand', L.NEXT_HAND_WAIT_MS);
        const handId = p.handId;
        let lastBoard = 0, botSeen = 0;
        const bot = p.seats.find((s) => s.kind === 'bot');
        for (let guard = 0; guard < 400; guard++) {
          const q = await pk(u1, id);
          if (q.handId !== handId) break;
          if (q.board.length > lastBoard) {
            const want = q.board.map(cardName);
            const seen = [];
            for (const pg of [p1, p2]) seen.push(await see(async () => { const n = await imgNames(pg.getByRole('region', { name: '公共牌' })); return { ok: want.every((w) => n.includes(w)), n }; }, 'board on page'));
            if (!checked2 || hand === 0) boards.add(JSON.stringify({ n: q.board.length, want, seen: seen.map((x) => x.n) }));
            lastBoard = q.board.length;
          }
          if (q.stage === 'showdown' || q.stage === 'complete') {
            if (q.showdown && q.showdown.length >= 2) {
              const res = [];
              for (const pg of [p1, p2]) {
                const me = pg === p1 ? u1 : u2;
                res.push(await see(async () => {
                  const t = await bodyText(pg);
                  const imgs = await imgNames(pg.locator('body'));
                  const others = q.showdown.filter((s) => s.seat !== (q.seats.find((x) => x.userId === me.user.id) || {}).seat);
                  const cardsOk = others.every((s) => s.holeCards.every((c) => imgs.includes(cardName(c))));
                  const winOk = q.winners.every((w) => near(t, w.name, w.amount));
                  return { ok: cardsOk && winOk, cardsOk, winOk };
                }, 'showdown on page'));
              }
              ctx.cp('4 摊牌时两人页面都显示公开的底牌、赢家与分得金额', true, { winners: q.winners, showdown: q.showdown.map((s) => s.holeCards), res });
              sawShowdown = true;
            }
            break;
          }
          if (q.actions.length > botSeen) {
            const newBot = q.actions.slice(botSeen).filter((a) => a.seat === bot.seat && !['small_blind', 'big_blind'].includes(a.type));
            botSeen = q.actions.length;
            if (newBot.length && hand === 0 && checked2 === 'pending') {
              const a = newBot[0];
              const r = [];
              for (const pg of [p1, p2]) r.push(await see(async () => { const t = await bodyText(pg); return { ok: actionShown(t, a.name, a.type, null) }; }, 'bot action on page'));
              ctx.cp('2b 电脑玩家行动后两人页面都显示其行动', true, { action: a });
              checked2 = true;
            }
          }
          const who = q.seats.find((s) => s.seat === q.toActSeat);
          if (who && who.kind === 'human') {
            const u = who.userId === u1.user.id ? u1 : u2;
            const mine = await pk(u, id);
            if (mine.toActSeat !== mine.you.seat || mine.handId !== handId) continue;
            if (hand === 0 && checked2 === false && u === u1) {
              const L2 = mine.you.legal;
              const type = L2.raise ? 'raise' : 'bet';
              const amt = L2.minRaiseTo;
              await pageAct(p1, u1, id, mine, type, amt);
              const a = await pk(u1, id);
              const s1 = a.seats.find((s) => s.userId === u1.user.id);
              const nxt = a.seats.find((s) => s.seat === a.toActSeat);
              const r2 = await see(async () => {
                const t = await bodyText(p2), ts = await seatText(p2, s1), pot = await potShown(p2);
                const tn = nxt ? await seatText(p2, nxt) : '';
                return { ok: actionShown(t, s1.name, type, amt) && hasN(pot, '底池：', a.pot) && hasN(ts, '筹码：', s1.chips) && (!nxt || /行动中/.test(tn)), pot, ts, tn };
              }, 'U1 action on U2 page');
              ctx.cp('2a U1 下注/加注后 U2 页面显示其行动与金额、底池变化、U1 余额变化、轮到谁', a.pot === p.pot + (amt - (p.seats.find((s) => s.userId === u1.user.id).committedThisRound || 0)) || a.pot > p.pot, { type, amt, pot: a.pot, chips: s1.chips, r2 });
              checked2 = 'pending';
              botSeen = Math.min(botSeen, a.actions.length);
              continue;
            }
            await pageAct(u === u1 ? p1 : p2, u, id, mine, mine.you.legal.check ? 'check' : 'call');
            continue;
          }
          await L.sleep(250);
        }
      }
      if (checked2 !== true) throw new L.Unreportable('bot action after U1 bet not observed');
      ctx.cp('3 新发的翻牌、转牌、河牌在两人页面都出现', boards.size >= 3, [...boards]);
      if (!sawShowdown) ctx.note && ctx.note('no showdown within 5 hands; checkpoint 4 not reported');
      if (start1) {
        L.writeEvidence('TS-36-checkpoint1.txt', start1);
        if (!ctx.failed) throw new L.Unreportable(`checkpoint 1: ${start1}`);
      }
    },
  },
];

// Acts through the player's own page once it shows that it is their turn; resolves after the server records the action.
async function pageAct(page, u, id, mine, type, amount = null) {
  const fold = page.getByRole('button', { name: '弃牌' });
  const ready = await L.waitFor(async () => (await fold.isEnabled().catch(() => false)) || null, L.WAIT_MS).catch(() => null);
  if (!ready) throw new L.Unreportable(`own turn not shown on page (${u.user.username})`);
  const n0 = mine.actions.length;
  if (type === 'check') await page.getByRole('button', { name: '过牌', exact: true }).click();
  else if (type === 'call') await page.getByRole('button', { name: /^跟注/ }).click();
  else {
    await page.getByRole('spinbutton', { name: '金额' }).fill(String(amount));
    await page.getByRole('button', { name: ACT[type], exact: true }).click();
  }
  const acc = await L.waitFor(async () => {
    const q = await pk(u, id);
    return q.handId !== mine.handId || q.actions.slice(n0).some((x) => x.seat === mine.you.seat && x.type === type) ? q : null;
  }, L.WAIT_MS).catch(() => null);
  if (!acc) throw new L.Unreportable(`${type} on page not recorded`);
}

async function tapFill(page, loc, value) { await loc.tap(); await loc.fill(value); }
const infoOf = async (page) => {
  const r = page.getByRole('region', { name: '我的信息' });
  await r.waitFor({ timeout: L.WAIT_MS }).catch(() => {});
  await page.waitForTimeout(300);
  return (await r.innerText().catch(() => '')) || '';
};
const inView = async (page, loc) => {
  const b = await loc.boundingBox().catch(() => null);
  const w = page.viewportSize().width;
  return { ok: !!b && b.x >= -1 && b.x + b.width <= w + 1, box: b, w };
};

const mobilePart = [
  {
    id: 'TS-45',
    async fn(ctx) {
      const name = L.uname('m1'), pw = 'Pw-' + L.RUN;
      const page = await L.newPage(null, { mobile: true, width: 360 });
      await page.goto(BASE + '/register');
      const sc0 = await L.noHorizontalScroll(page);
      await tapFill(page, page.getByRole('textbox', { name: '用户名' }), name);
      await tapFill(page, page.getByLabel('密码'), pw);
      await page.getByRole('button', { name: '注册' }).tap();
      await page.waitForURL(/\/lobby/, { timeout: L.WAIT_MS }).catch(() => {});
      const info = /\/lobby/.test(page.url()) ? await infoOf(page) : '';
      const sc1 = await L.noHorizontalScroll(page);
      ctx.cp('轻触注册：进入大厅，显示用户名、积分 1000、筹码 1000；注册页与大厅无需横向滚动',
        info.includes(`用户名：${name}`) && hasN(info, '积分：', 1000) && hasN(info, '筹码：', 1000) && sc0.ok && sc1.ok, { url: page.url(), info, sc0, sc1 });

      // Log out: use the page's logout control when present, otherwise a fresh browser (no session).
      const out = page.getByRole('button', { name: /退出/ }).or(page.getByRole('link', { name: /退出/ }));
      let lp = page;
      if (await out.first().isVisible().catch(() => false)) {
        await out.first().tap();
        await page.waitForURL(/\/login/, { timeout: L.WAIT_MS }).catch(() => {});
        if (!/\/login/.test(page.url())) await page.goto(BASE + '/login');
      } else {
        lp = await L.newPage(null, { mobile: true, width: 360 });
        await lp.goto(BASE + '/login');
      }
      const sc2 = await L.noHorizontalScroll(lp);
      await tapFill(lp, lp.getByRole('textbox', { name: '用户名' }), name);
      await tapFill(lp, lp.getByLabel('密码'), pw);
      await lp.getByRole('button', { name: '登录' }).tap();
      await lp.waitForURL(/\/lobby/, { timeout: L.WAIT_MS }).catch(() => {});
      const info2 = /\/lobby/.test(lp.url()) ? await infoOf(lp) : '';
      ctx.cp('退出后轻触登录：进入大厅，显示本人用户名、积分、筹码；登录页无需横向滚动',
        info2.includes(`用户名：${name}`) && /积分：\s*-?\d+/.test(info2) && /筹码：\s*-?\d+/.test(info2) && sc2.ok, { url: lp.url(), info2, sc2 });

      await lp.getByRole('button', { name: '开德州扑克房间' }).tap();
      await lp.waitForURL(/\/room\//, { timeout: L.WAIT_MS }).catch(() => {});
      const id = (lp.url().match(/\/room\/([^/?#]+)/) || [])[1];
      const head = await lp.getByRole('heading', { name: '德州扑克房间' }).waitFor({ timeout: L.WAIT_MS }).then(() => true).catch(() => false);
      const sc3 = await L.noHorizontalScroll(lp);
      const u2 = await L.newUser('m2');
      const rooms = await u2.rooms();
      const listed = JSON.stringify(rooms.body || rooms).includes(id || '#none#');
      ctx.cp('轻触开扑克房间：进入房间，列表出现该房间；房间页无需横向滚动', !!id && head && listed && sc3.ok, { url: lp.url(), head, listed, sc3 });

      const q = await L.newPage(u2, { mobile: true, width: 390 });
      await q.goto(BASE + '/lobby');
      await q.getByRole('button', { name: '刷新房间列表' }).tap().catch(() => {});
      const row = q.getByRole('table', { name: '房间列表' }).getByRole('row').filter({ hasText: name });
      await row.getByRole('button', { name: '加入' }).tap({ timeout: L.WAIT_MS }).catch(() => {});
      await q.waitForURL(new RegExp(`/room/${id}`), { timeout: L.WAIT_MS }).catch(() => {});
      const sc4 = await L.noHorizontalScroll(q);
      const s = id ? await u2.state(id) : null;
      ctx.cp('另一手机用户轻触加入：进入该房间，人数 2；大厅与房间页无需横向滚动',
        !!s && s.members && s.members.length === 2 && new RegExp(`/room/${id}`).test(q.url()) && sc4.ok, { url: q.url(), members: s && s.members && s.members.length, sc4 });

      await lp.getByRole('button', { name: '离开房间' }).tap();
      await lp.waitForURL(/\/lobby/, { timeout: L.WAIT_MS }).catch(() => {});
      const sc5 = await L.noHorizontalScroll(lp);
      const s2 = await u2.state(id);
      const me1 = await L.waitFor(async () => { const r = await u2.rooms(); return r; });
      ctx.cp('轻触离开房间：回到大厅，房间人数减 1；大厅无需横向滚动',
        /\/lobby/.test(lp.url()) && s2.members.length === 1 && sc5.ok, { url: lp.url(), members: s2.members.length, sc5, rooms: !!me1 });
    },
  },
  {
    id: 'TS-46',
    async fn(ctx) {
      const u = await L.newUser('m3');
      const r = await u.createAi();
      const id = r.body && r.body.room && r.body.room.roomId;
      if (!id) throw new L.Unreportable(`AI game not created ${r.status}`);
      const page = await L.newPage(u, { mobile: true, width: 390 });
      await page.goto(`${BASE}/room/${id}`);
      await board(page).waitFor({ timeout: L.WAIT_MS });
      const bv = await inView(page, board(page));
      const sc = await L.noHorizontalScroll(page);
      const s0 = await u.state(id);
      await board(page).getByRole('button', { name: /^a3 / }).tap();
      await board(page).getByRole('button', { name: /^a4 / }).tap();
      const s1 = await L.waitFor(async () => { const s = await u.state(id); return s.version > s0.version && s.chess.lastMove && s.chess.lastMove.from === 'a3' ? s : null; });
      ctx.cp('1a 人机象棋：完整棋盘无需横向滚动可见；轻触 a3 再轻触 a4，走棋被接受', bv.ok && sc.ok && !!s1, { bv, sc, lastMove: s1 && s1.chess.lastMove });
      await L.mustWait(async () => { const s = await u.state(id); return s.chess.turn === 'red' || s.chess.status !== 'active' ? s : null; }, 'computer move');
      const before = (await u.me()).rating;
      await resign(page, true);
      const d = page.getByRole('dialog', { name: '对局结果' });
      const ok = await d.waitFor({ timeout: L.WAIT_MS }).then(() => true).catch(() => false);
      const t = ok ? await d.innerText() : '';
      const after = (await u.me()).rating;
      ctx.cp('1b 轻触认输：对局结束并看到结果', /你输了/.test(t) && /认输/.test(t) && after === before - 10 && new RegExp(`当前积分：\\s*${after}(?!\\d)`).test(t), { before, after, dialog: t });

      const h = await L.newUser('m4');
      const pg = await L.newPage(h, { mobile: true, width: 390 });
      await pg.goto(BASE + '/lobby');
      await pg.getByRole('button', { name: '开德州扑克房间' }).tap();
      await pg.waitForURL(/\/room\//, { timeout: L.WAIT_MS }).catch(() => {});
      const pid = (pg.url().match(/\/room\/([^/?#]+)/) || [])[1];
      if (!pid) throw new L.Unreportable('poker room not opened');
      await pg.getByRole('button', { name: '添加电脑玩家' }).tap();
      const withBot = await L.waitFor(async () => { const p = await pk(h, pid); return p && p.seats.some((s) => s.kind === 'bot') ? p : null; });
      await pg.getByRole('button', { name: '开始牌局' }).tap();
      const started = await L.waitFor(async () => { const p = await pk(h, pid); return p && p.handId ? p : null; });
      await pg.reload();
      const tv = await inView(pg, pg.getByRole('region', { name: '牌桌' }));
      const sc2 = await L.noHorizontalScroll(pg);
      ctx.cp('2a 扑克：轻触添加电脑玩家并开始牌局；完整牌桌无需横向滚动可见', !!withBot && !!started && tv.ok && sc2.ok, { tv, sc2 });

      const plan = ['passive', 'raise', 'fold'];
      const done = [];
      let handId = started && started.handId;
      for (const step of plan) {
        const mine = await L.mustWait(async () => {
          const p = await pk(h, pid);
          if (!p || !p.handId) return null;
          return p.toActSeat === p.you.seat && !['showdown', 'complete'].includes(p.stage) ? p : null;
        }, 'my turn', L.NEXT_HAND_WAIT_MS);
        if (mine.handId !== handId) { await pg.reload(); handId = mine.handId; }
        await pg.getByRole('region', { name: '牌桌' }).waitFor({ timeout: L.WAIT_MS });
        await L.waitFor(async () => (await pg.getByRole('button', { name: '弃牌' }).isEnabled().catch(() => false)) || null, 5000).catch(() => {});
        const n0 = mine.actions.length;
        let type, amount = null;
        if (step === 'passive') {
          type = mine.you.legal.check ? 'check' : 'call';
          await pg.getByRole('button', { name: type === 'check' ? '过牌' : /^跟注/ }).tap();
        } else if (step === 'raise') {
          type = mine.you.legal.raise ? 'raise' : 'bet';
          amount = mine.you.legal.minRaiseTo;
          await tapFill(pg, pg.getByRole('spinbutton', { name: '金额' }), String(amount));
          await pg.getByRole('button', { name: ACT[type], exact: true }).tap();
        } else {
          type = 'fold';
          await pg.getByRole('button', { name: '弃牌' }).tap();
        }
        const acc = await L.waitFor(async () => {
          const p = await pk(h, pid);
          const a = p.handId === mine.handId ? p.actions.slice(n0) : [];
          return a.find((x) => x.seat === mine.you.seat && x.type === type && (amount == null || x.amount === amount)) || null;
        }, 5000);
        done.push({ step, type, amount, accepted: acc });
        await pg.reload();
      }
      ctx.cp('2b 轻触完成过牌或跟注、输入金额加注、弃牌，各行动被接受', done.every((d) => d.accepted), done);
    },
  },
];

export const scenarios = [...chessPart, ...pokerPart, ...mobilePart];
