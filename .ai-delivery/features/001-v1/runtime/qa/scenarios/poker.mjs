// Texas hold'em scenarios TS-31..TS-35, TS-37..TS-44, TS-47.
import * as L from '../lib.mjs';
import * as P from '../poker.mjs';

const { BASE } = L;
export const pk = async (u, id) => { const s = await u.state(id); return s && s.poker; };
export const seatOf = (p, u) => p.seats.find((s) => s.userId === u.user.id);
const seatNo = (p, n) => p.seats.find((s) => s.seat === n);
const OVER = ['complete', 'showdown'];
const active = (p) => p.seats.filter((s) => s.inHand && !s.folded);

export async function table(role, nHumans, nBots) {
  const us = [];
  for (let i = 0; i < nHumans; i++) us.push(await L.newUser(`${role}${i + 1}`));
  const r = await us[0].createRoom('poker');
  const id = r.body.room.roomId;
  for (const u of us.slice(1)) await u.join(id);
  for (let i = 0; i < nBots; i++) await us[0].addBot(id);
  return { us, id };
}

// Participants (dealt into this hand) ordered clockwise starting after `fromSeat`.
export function clockwiseAfter(p, fromSeat, filter = (s) => s.inHand) {
  const ps = p.seats.filter(filter).map((s) => s.seat).sort((a, b) => a - b);
  return ps.filter((s) => s > fromSeat).concat(ps.filter((s) => s <= fromSeat));
}
const dealerOf = (p) => p.seats.find((s) => s.isDealer);

export function whoActs(p, us) {
  if (p.toActSeat === null || p.toActSeat === undefined) return null;
  const s = seatNo(p, p.toActSeat);
  if (!s) return null;
  return s.kind === 'human' ? us.find((u) => u.user.id === s.userId) || 'other' : 'bot';
}
export const passive = (p) => (p.you.legal.check ? ['check'] : ['call']);

// Drive the current hand until it is over. chooser(u, p) -> [type, amount] | null (null = stop driving).
// onStep({actor, pre, post, res}) is called for each human action.
export async function playHand(us, id, chooser, { onStep, onPoll } = {}) {
  let p = await pk(us[0], id);
  const handId = p.handId;
  let last = p;
  let lastChange = Date.now();
  let lastVersion = null;
  for (;;) {
    const st = await us[0].state(id);
    p = st.poker;
    if (onPoll) onPoll(p);
    if (p.handId !== handId) return { final: last, missed: true, next: p };
    if (OVER.includes(p.stage)) return { final: p };
    if (st.version !== lastVersion) { lastVersion = st.version; lastChange = Date.now(); }
    last = p;
    const who = whoActs(p, us);
    if (who && who !== 'bot' && who !== 'other') {
      const mine = await pk(who, id);
      if (mine.handId !== handId || OVER.includes(mine.stage) || mine.toActSeat !== mine.you.seat) continue;
      const ch = chooser(who, mine);
      if (!ch) return { final: mine, stopped: true };
      const res = await who.act(id, ch[0], ch[1]);
      const post = res.body && res.body.room && res.body.room.poker;
      if (onStep) await onStep({ actor: who, pre: mine, post, res, choice: ch });
      if (res.status !== 200) throw new Error(`action ${ch} rejected: ${res.status} ${res.code} ${res.message}`);
      if (post && OVER.includes(post.stage)) return { final: post };
      if (post) last = post;
      lastChange = Date.now();
      continue;
    }
    if (Date.now() - lastChange > L.WAIT_MS) throw new L.Unreportable('computer player did not act within limit');
    await L.sleep(250);
  }
}

export async function waitNextHand(u, id, prevHandId) {
  return L.mustWait(async () => {
    const p = await pk(u, id);
    return p && p.handId && p.handId !== prevHandId && p.stage === 'preflop' ? p : null;
  }, 'next hand', L.NEXT_HAND_WAIT_MS);
}

const sig = (p) => JSON.stringify({ pot: p.pot, toAct: p.toActSeat, stage: p.stage, cb: p.currentBet, seats: p.seats.map((s) => [s.seat, s.chips, s.committedThisHand, s.committedThisRound, s.folded]) });
export async function expectRejected(ctx, label, u, id, type, amount, reader = u) {
  const before = await pk(reader, id);
  const r = await u.act(id, type, amount);
  const after = await pk(reader, id);
  const ok = r.status >= 400 && r.status < 500 && !!r.message && sig(before) === sig(after);
  ctx.cp(label, ok, { status: r.status, code: r.code, message: r.message, unchanged: sig(before) === sig(after) });
  return ok;
}
export async function expectAccepted(ctx, label, u, id, type, amount) {
  const r = await u.act(id, type, amount);
  ctx.cp(label, r.status === 200, { status: r.status, code: r.code, message: r.message });
  return r.status === 200 ? r.body.room.poker : null;
}

const part1 = [
  {
    id: 'TS-31',
    async fn(ctx) {
      const A = await table('bl', 2, 1);
      const B = await table('hu', 2, 0);
      const [u1, u2] = A.us, [u3, u4] = B.us;
      const pre = await pk(u1, A.id), preB = await pk(u3, B.id);
      await u1.pokerStart(A.id); await u3.pokerStart(B.id);
      const p = await pk(u1, A.id), q = await pk(u2, A.id);
      const d = dealerOf(p);
      const order = clockwiseAfter(p, d.seat);
      const sb = seatNo(p, order[0]), bb = seatNo(p, order[1]);
      const before = (s) => seatNo(pre, s.seat).chips;
      ctx.cp('1 3 人桌：庄家为房主 U1', d.userId === u1.user.id, { dealer: d.seat, u1: seatOf(p, u1).seat });
      ctx.cp('1 庄家左手第一位扣小盲 5、第二位扣大盲 10，余额相应减少，底池 15',
        sb.isSmallBlind && bb.isBigBlind && sb.committedThisHand === 5 && bb.committedThisHand === 10 && sb.chips === before(sb) - 5 && bb.chips === before(bb) - 10 && p.pot === 15 && d.committedThisHand === 0,
        { sb: [sb.seat, sb.committedThisHand, before(sb), sb.chips], bb: [bb.seat, bb.committedThisHand, before(bb), bb.chips], pot: p.pot });
      const h = await pk(u3, B.id);
      const d3 = seatOf(h, u3), d4 = seatOf(h, u4);
      ctx.cp('2 2 人桌：庄家 U3 小盲 5，U4 大盲 10，底池 15',
        d3.isDealer && d3.committedThisHand === 5 && d4.committedThisHand === 10 && d3.chips === seatOf(preB, u3).chips - 5 && d4.chips === seatOf(preB, u4).chips - 10 && h.pot === 15,
        { u3: [d3.isDealer, d3.committedThisHand, d3.chips], u4: [d4.committedThisHand, d4.chips], pot: h.pot });
      const own1 = seatOf(p, u1).holeCards, own2 = seatOf(q, u2).holeCards;
      const others1 = p.seats.filter((s) => s.userId !== u1.user.id && s.holeCards);
      const others2 = q.seats.filter((s) => s.userId !== u2.user.id && s.holeCards);
      const raw1 = JSON.stringify(await u1.state(A.id));
      const leak = (own2 || []).filter((c) => raw1.includes(`"${c}"`));
      ctx.cp('3 U1、U2 各有 2 张底牌且只看到自己的，状态中没有他人底牌', Array.isArray(own1) && own1.length === 2 && Array.isArray(own2) && own2.length === 2 && others1.length === 0 && others2.length === 0 && leak.length === 0 && p.seats.filter((s) => s.inHand).length === 3,
        { own1, others1: others1.map((s) => s.seat), others2: others2.map((s) => s.seat), leak });
      const vis = [...own1, ...own2];
      ctx.cp('3 可见的牌之间没有重复', new Set(vis).size === vis.length, vis);
      const firstA = clockwiseAfter(p, bb.seat)[0];
      ctx.cp('4 翻牌前没有公共牌；3 人桌首先行动的是大盲左手第一位，2 人桌为庄家/小盲',
        p.board.length === 0 && h.board.length === 0 && p.toActSeat === firstA && h.toActSeat === d3.seat,
        { boardA: p.board, toActA: p.toActSeat, expectA: firstA, toActB: h.toActSeat, expectB: d3.seat });
    },
  },
  {
    id: 'TS-32',
    budgetMs: 180000,
    async fn(ctx) {
      const { us, id } = await table('rd', 2, 1);
      const [u1, u2] = us;
      await u1.pokerStart(id);
      const p0 = await pk(u1, id);
      const dealer = dealerOf(p0).seat;
      const own1 = seatOf(p0, u1).holeCards || [];
      const own2 = seatOf(await pk(u2, id), u2).holeCards || [];
      const firstSeen = {};
      const transitions = [];
      const prematures = [];
      const accounting = [];
      const betRounds = new Set();
      let betThisRound = null;
      const res = await playHand(us, id, (u, p) => {
        const L2 = p.you.legal;
        if (['flop', 'river'].includes(p.stage) && L2.bet && betThisRound !== p.stage) { betThisRound = p.stage; return ['bet', 20]; }
        return passive(p);
      }, {
        onPoll: (p) => { if (!firstSeen[p.stage]) firstSeen[p.stage] = p.board.length; },
        onStep: async ({ actor, pre, post, choice }) => {
          if (!post) return;
          if (!firstSeen[post.stage]) firstSeen[post.stage] = post.board.length;
          const a0 = seatOf(pre, actor), a1 = seatOf(post, actor);
          const put = a1.committedThisHand - a0.committedThisHand;
          if (choice[0] !== 'check') {
            // An action that ends the hand already includes the payout in the balance; add it back per the server's settlement.
            let won = 0;
            if (OVER.includes(post.stage)) {
              let settled = post;
              if (!Array.isArray(settled.winners)) settled = await pk(actor, id);
              won = (settled.winners || []).filter((w) => w.seat === a1.seat).reduce((a, w) => a + w.amount, 0);
            }
            accounting.push({ type: choice[0], put, chips: a0.chips - a1.chips + won, won, pot: post.pot - pre.pot });
          }
          if (choice[0] === 'bet') betRounds.add(pre.stage);
          if (post.stage !== pre.stage) {
            const newBet = choice[0] === 'call' ? pre.currentBet : a1.committedThisRound;
            const unmatched = active(pre).filter((s) => s.seat !== a0.seat && !s.atCap && s.committedThisRound !== newBet);
            if (choice[0] === 'bet' || unmatched.length) prematures.push({ from: pre.stage, to: post.stage, choice, unmatched: unmatched.map((s) => s.seat) });
            if (OVER.includes(post.stage)) return;
            const expectFirst = clockwiseAfter(post, dealer, (s) => s.inHand && !s.folded && !s.atCap)[0];
            transitions.push({ stage: post.stage, toAct: post.toActSeat, expect: expectFirst, board: post.board.length });
          }
        },
      });
      const f = res.final;
      const okCounts = (firstSeen.flop === undefined || firstSeen.flop === 3) && (firstSeen.turn === undefined || firstSeen.turn === 4) && (firstSeen.river === undefined || firstSeen.river === 5)
        && transitions.every((t) => t.board === { flop: 3, turn: 4, river: 5 }[t.stage]);
      const all = [...f.board, ...own1, ...own2];
      ctx.cp('1 翻牌 3 张、转牌后 4 张、河牌后 5 张；公共牌与底牌不重复', f.board.length === 5 && okCounts && own1.length === 2 && own2.length === 2 && new Set(all).size === 9,
        { firstSeen, transitions, board: f.board, all });
      ctx.cp('2 有人下注后，其他仍在牌局中的玩家跟齐前本轮不结束、不发公共牌', betRounds.size > 0 && prematures.length === 0, { betRounds: [...betRounds], prematures });
      ctx.cp('3 翻牌后各轮首先行动的是庄家左手第一位仍在牌局中的玩家', transitions.length > 0 && transitions.every((t) => t.toAct === t.expect), transitions);
      ctx.cp('4 每次跟注、下注后行动者余额减少等于本次投入，底池增加同样数额', accounting.length > 0 && accounting.every((a) => a.put > 0 && a.chips === a.put && a.pot === a.put), accounting);
    },
  },
  {
    id: 'TS-33',
    async fn(ctx) {
      const { us, id } = await table('lg', 2, 0);
      const [u1, u2] = us;
      await u1.pokerStart(id);
      let p = await pk(u1, id);
      const first = whoActs(p, us);
      const second = first === u1 ? u2 : u1;
      for (const t of ['fold', 'call', 'bet']) await expectRejected(ctx, `1 不轮到的玩家${t}被拒绝`, second, id, t, t === 'bet' ? 20 : undefined, first);
      await expectRejected(ctx, '2 需要跟注时过牌被拒绝', first, id, 'check');
      await expectAccepted(ctx, '2 同一玩家随后跟注被接受', first, id, 'call');
      await expectAccepted(ctx, '2 大盲过牌进入翻牌', second, id, 'check');
      p = await pk(u1, id);
      if (p.stage !== 'flop') throw new L.Unreportable(`expected flop, got ${p.stage}`);
      const f1 = whoActs(p, us), f2 = f1 === u1 ? u2 : u1;
      await expectRejected(ctx, '3 翻牌后无人下注时下注 9 被拒绝', f1, id, 'bet', 9);
      await expectAccepted(ctx, '3 下注 10 被接受', f1, id, 'bet', 10);
      await expectRejected(ctx, '4 对方下注 10 后加注到 19 被拒绝', f2, id, 'raise', 19);
      await expectAccepted(ctx, '4 加注到 20 被接受', f2, id, 'raise', 20);
      await expectAccepted(ctx, '5 再加注到 50 被接受', f1, id, 'raise', 50);
      await expectRejected(ctx, '5 加注到 79（增量 29）被拒绝', f2, id, 'raise', 79);
      await expectAccepted(ctx, '5 加注到 80（增量 30）被接受', f2, id, 'raise', 80);
      await expectAccepted(ctx, '5 跟注 80 结束翻牌圈', f1, id, 'call');
      p = await pk(u1, id);
      const t1 = whoActs(p, us), t2 = t1 === u1 ? u2 : u1;
      await expectAccepted(ctx, '6 无需跟注时过牌被接受', t1, id, 'check');
      await expectAccepted(ctx, '7 前置：另一方下注 10', t2, id, 'bet', 10);
      const b = await pk(t1, id);
      const chips0 = seatOf(b, t1).chips, calls0 = b.actions.filter((a) => a.type === 'call').length;
      const rs = await Promise.all([t1.act(id, 'call'), t1.act(id, 'call')]);
      const a = await pk(t1, id);
      const calls1 = a.actions.filter((x) => x.type === 'call').length;
      ctx.cp('7 同一次跟注并发提交两次：只生效一次，余额只扣一次，之后轮到下一位', rs.filter((r) => r.status === 200).length === 1 && seatOf(a, t1).chips === chips0 - 10 && calls1 === calls0 + 1 && a.stage === 'river' && a.toActSeat !== null && a.toActSeat !== undefined,
        { statuses: rs.map((r) => [r.status, r.code]), chips0, chips1: seatOf(a, t1).chips, calls: [calls0, calls1], stage: a.stage, toAct: a.toActSeat });
    },
  },
  {
    id: 'TS-35',
    budgetMs: 120000,
    async fn(ctx) {
      const { us, id } = await table('fo', 2, 1);
      const [u1, u2] = us;
      await u1.pokerStart(id);
      const start = await pk(u1, id);
      const startChips = Object.fromEntries(start.seats.map((s) => [s.seat, s.chips + s.committedThisHand]));
      let foldedOnce = false;
      let preLast = null;
      const res = await playHand(us, id, (u, p) => {
        if (u === u1 || foldedOnce) { foldedOnce = foldedOnce || u === u1; preLast = p; return ['fold']; }
        return passive(p);
      });
      const f = res.final;
      const left = f.seats.filter((s) => s.inHand && !s.folded);
      const w = f.winners || [];
      ctx.cp('最后一人弃牌后该手立即结束，剩下的玩家赢得整个底池', f.stage === 'complete' && left.length === 1 && w.length === 1 && w[0].seat === left[0].seat && w[0].amount === f.pot, { stage: f.stage, left: left.map((s) => s.seat), winners: w, pot: f.pot });
      ctx.cp('不再发后续公共牌', preLast && f.board.length === preLast.board.length, { before: preLast && preLast.board, after: f.board });
      const v1 = await pk(u1, id), v2 = await pk(u2, id);
      const shown = (v, me) => v.handId === f.handId && v.seats.some((s) => s.userId !== me.user.id && s.holeCards);
      ctx.cp('没有任何人的底牌被公开（读取的状态）', !(f.showdown && f.showdown.length) && !shown(v1, u1) && !shown(v2, u2), { showdown: f.showdown });
      const ws = seatNo(f, left[0].seat);
      if (ws.kind === 'human') {
        const wu = us.find((u) => u.user.id === ws.userId);
        const chips = (await wu.me()).chips;
        const exp = startChips[ws.seat] - ws.committedThisHand + f.pot;
        ctx.cp('赢家余额增加底池数额（余额 = 开局余额 − 本手投入 + 底池）', chips === exp, { chips, exp, start: startChips[ws.seat], committed: ws.committedThisHand, pot: f.pot });
      } else {
        ctx.cp('赢家（电脑）余额 = 开局余额 − 本手投入 + 底池', ws.chips === startChips[ws.seat] - ws.committedThisHand + f.pot, { chips: ws.chips, start: startChips[ws.seat], committed: ws.committedThisHand, pot: f.pot });
      }
    },
  },
  {
    id: 'TS-47',
    budgetMs: 200000,
    async fn(ctx) {
      const { us, id } = await table('nx', 2, 1);
      const [u1] = us;
      await u1.pokerStart(id);
      let p = await pk(u1, id);
      const obs = [];
      for (let k = 0; k < 3; k++) {
        const prevDealer = dealerOf(p).seat;
        const r = await playHand(us, id, () => ['fold']);
        const nx = r.next || await waitNextHand(u1, id, p.handId);
        const d = dealerOf(nx);
        const order = clockwiseAfter(nx, d.seat);
        const expDealer = clockwiseAfter(nx, prevDealer)[0];
        const sb = seatNo(nx, order[0]), bb = seatNo(nx, order[1]);
        obs.push({ hand: nx.handNumber, prevDealer, dealer: d.seat, expDealer, sb: [sb.seat, sb.isSmallBlind, sb.committedThisHand], bb: [bb.seat, bb.isBigBlind, bb.committedThisHand], auto: true });
        p = nx;
      }
      ctx.cp('下一手无需房主操作自动开始（连续 3 手）', obs.length === 3, obs.map((o) => o.hand));
      ctx.cp('每手庄家按座位顺时针轮转一位，小盲、大盲随之轮转并自动扣除', obs.every((o) => o.dealer === o.expDealer && o.sb[1] && o.sb[2] === 5 && o.bb[1] && o.bb[2] === 10), obs);
    },
  },
];

const hasNum = (txt, label, n) => new RegExp(`${label}\\s*${n < 0 ? '[-−]' + Math.abs(n) : n}(?!\\d)`).test(txt);
const startChipsOf = (p) => Object.fromEntries(p.seats.map((s) => [s.seat, s.chips + s.committedThisHand]));

// Independent showdown check (single pot): returns {ok, detail}.
function judgeShowdown(f) {
  const sd = (f.showdown || []).filter((s) => s.holeCards && s.holeCards.length === 2);
  const scores = sd.map((s) => ({ seat: s.seat, score: P.best([...s.holeCards, ...f.board]) }));
  const top = scores.reduce((m, x) => (!m || P.cmp(x.score, m) > 0 ? x.score : m), null);
  const expW = scores.filter((x) => P.cmp(x.score, top) === 0).map((x) => x.seat).sort();
  const gotW = (f.winners || []).map((w) => w.seat).sort();
  const sum = (f.winners || []).reduce((a, w) => a + w.amount, 0);
  let split = true;
  if (expW.length > 1) {
    const share = Math.floor(f.pot / expW.length), rem = f.pot - share * expW.length;
    const firstLeft = clockwiseAfter(f, dealerOf(f).seat, (s) => expW.includes(s.seat))[0];
    split = (f.winners || []).every((w) => w.amount === share + (w.seat === firstLeft ? rem : 0));
  }
  return { ok: JSON.stringify(expW) === JSON.stringify(gotW) && sum === f.pot && split, detail: { board: f.board, scores, expW, gotW, winners: f.winners, pot: f.pot } };
}

const part2 = [
  {
    id: 'TS-34',
    budgetMs: 400000,
    async fn(ctx) {
      const { us, id } = await table('sd', 2, 1);
      const [u1, u2] = us;
      await u1.pokerStart(id);
      const rec = [];
      let p = await pk(u1, id);
      for (let i = 0; i < 14 && rec.length < 5; i++) {
        const start = startChipsOf(p);
        const r = await playHand(us, id, (u, q) => passive(q));
        const f = r.final;
        if (!r.missed && f.stage === 'showdown' || (f.showdown && f.showdown.length)) {
          const v1 = await pk(u1, id), v2 = await pk(u2, id);
          const sdSeats = (f.showdown || []).map((s) => s.seat);
          const visible = (v) => v.handId === f.handId && sdSeats.every((n) => { const s = seatNo(v, n); return s && s.holeCards && s.holeCards.length === 2; });
          const atCap = f.seats.some((s) => s.atCap);
          const j = judgeShowdown(f);
          const chipsOk = [];
          for (const u of us) {
            const s = seatOf(f, u);
            const won = (f.winners || []).filter((w) => w.seat === s.seat).reduce((a, w) => a + w.amount, 0);
            const now = (await u.me()).chips;
            chipsOk.push({ u: u.label, start: start[s.seat], won, committed: s.committedThisHand, now, ok: now === start[s.seat] + won - s.committedThisHand });
          }
          rec.push({ hand: f.handNumber, visible: visible(v1) && visible(v2), atCap, judge: j, chipsOk });
        }
        p = r.next || await waitNextHand(u1, id, f.handId);
      }
      if (rec.length < 5) throw new L.Unreportable(`only ${rec.length} showdowns in 14 hands`);
      L.writeEvidence('TS-34-showdowns.json', rec);
      ctx.cp('1 进入摊牌的玩家底牌对 U1、U2 都公开', rec.every((x) => x.visible), rec.map((x) => [x.hand, x.visible]));
      ctx.cp('2 判定的赢家与独立计算一致（平分时零头给庄家左手起第一位赢家）', rec.every((x) => x.atCap || x.judge.ok), rec.map((x) => x.judge.detail));
      ctx.cp('3 各赢家分得之和等于底池；余额变化 = 分得 − 本手投入', rec.every((x) => x.judge.detail.winners.reduce((a, w) => a + w.amount, 0) === x.judge.detail.pot && x.chipsOk.every((c) => c.ok)), rec.map((x) => x.chipsOk));
    },
  },
  {
    id: 'TS-37',
    budgetMs: 150000,
    async fn(ctx) {
      const { us, id } = await table('mj', 2, 0);
      const [u1, u2] = us;
      const u3 = await L.newUser('mj3');
      await u1.pokerStart(id);
      let bet = false;
      await playHand(us, id, (u, p) => {
        if (p.stage === 'preflop') return passive(p);
        if (!bet && p.you.legal.bet) { bet = true; return ['bet', 20]; }
        return null;
      });
      const before = (await u3.me()).chips;
      const j = await u3.join(id);
      const v = await pk(u3, id), h = await pk(u1, id);
      const s3 = seatOf(v, u3);
      ctx.cp('U3 加入时看到当前公共牌、底池与各玩家的行动', j.status === 200 && v.handId === h.handId && JSON.stringify(v.board) === JSON.stringify(h.board) && v.board.length >= 3 && v.pot === h.pot && v.actions.length === h.actions.length && v.actions.some((a) => a.type === 'bet'), { board: v.board, pot: v.pot, actions: v.actions.length });
      ctx.cp('U3 看不到 U1、U2 的底牌；本手 U3 没有底牌', v.seats.every((s) => !s.holeCards), v.seats.map((s) => [s.seat, !!s.holeCards]));
      let u3Turn = false;
      const r = await playHand([u1, u2, u3], id, (u, p) => (u === u3 ? (u3Turn = true, null) : passive(p)), { onPoll: (p) => { if (s3 && p.toActSeat === s3.seat) u3Turn = true; } });
      const after = (await u3.me()).chips;
      ctx.cp('本手 U3 不会轮到行动、不在本手中，余额不变', s3 && !s3.inHand && !u3Turn && after === before, { seat: s3, u3Turn, before, after });
      const nx = r.next || await waitNextHand(u1, id, r.final.handId);
      const m = await pk(u3, id);
      const t3 = seatOf(m, u3);
      ctx.cp('下一手 U3 被发 2 张底牌并参与', m.handId === nx.handId && t3.inHand && t3.holeCards && t3.holeCards.length === 2, { inHand: t3.inHand, cards: t3.holeCards && t3.holeCards.length });
    },
  },
  {
    id: 'TS-38',
    budgetMs: 120000,
    async fn(ctx) {
      const { us, id } = await table('lf', 3, 0);
      const [u1, u2, u3] = us;
      const c2 = (await u2.me()).chips;
      await u1.pokerStart(id);
      await playHand(us, id, (u, p) => {
        if (p.stage !== 'preflop') return null;
        if (p.currentBet < 20 && p.you.legal.raise) return ['raise', 20];
        return passive(p);
      });
      const p = await pk(u1, id);
      const s2 = seatOf(p, u2);
      if (!s2 || s2.committedThisHand !== 20 || p.stage !== 'flop') throw new L.Unreportable(`setup: ${p.stage} ${s2 && s2.committedThisHand}`);
      const l = await u2.leave(id);
      const q = await pk(u1, id);
      const st = await u1.state(id);
      const lf = q.actions.find((a) => a.type === 'leave_fold' || a.type === 'fold');
      ctx.cp('U2 视为弃牌，座位释放，房间人数减 1', l.status === 200 && !seatOf(q, u2) && st.members.length === 2 && !!lf, { members: st.members.length, action: lf });
      ctx.cp('U2 已投入的 20 不退回（余额 = 开局余额 − 20）', (await u2.me()).chips === c2 - 20, { before: c2, after: (await u2.me()).chips });
      const u3Seat = seatOf(q, u3).seat, u1Seat = seatOf(q, u1).seat;
      ctx.cp('该手在 U1、U3 之间继续', q.handId === p.handId && q.stage === 'flop' && [u1Seat, u3Seat].includes(q.toActSeat), { stage: q.stage, toAct: q.toActSeat });
      let u2Turn = false;
      const r = await playHand([u1, u3], id, (u, x) => passive(x), { onPoll: (x) => { if (x.toActSeat === s2.seat) u2Turn = true; } });
      ctx.cp('U2 之后不再轮到行动，该手正常结束', !u2Turn && OVER.includes(r.final.stage), { stage: r.final.stage, winners: r.final.winners });
    },
  },
  {
    id: 'TS-39',
    budgetMs: 150000,
    async fn(ctx) {
      ctx.useDb();
      // Host is dealer; join order U2 (small blind), U1 (big blind).
      const u3 = await L.newUser('ng3'), u2 = await L.newUser('ng2'), u1 = await L.newUser('ng1');
      await L.setUserValues(u1, { chips: 3 }); await L.setUserValues(u2, { chips: 0 }); await L.setUserValues(u3, { chips: -500 });
      const id = (await u3.createRoom('poker')).body.room.roomId;
      await u2.join(id); await u1.join(id);
      const pg = await L.newPage(u2);
      await pg.goto(`${BASE}/room/${id}`);
      await u3.pokerStart(id);
      const p = await pk(u1, id);
      const s1 = seatOf(p, u1);
      ctx.cp('1 余额 3 的 U1 被扣大盲后余额为 −7，盲注进入底池', s1.isBigBlind && s1.committedThisHand === 10 && s1.chips === -7 && p.pot === 15, { s1: [s1.isBigBlind, s1.committedThisHand, s1.chips], pot: p.pot });
      const region = pg.getByRole('region', { name: new RegExp(`：${u1.user.username}$`) });
      const txt = await L.waitFor(async () => { const t = await region.innerText().catch(() => ''); return hasNum(t, '筹码：', -7) ? t : null; });
      ctx.cp('3 房间中 U1 余额带负号显示 −7', !!txt, txt || await region.innerText().catch((e) => String(e)));
      const steps = [];
      let flopBet = false;
      const r = await playHand([u1, u2, u3], id, (u, q) => {
        if (q.stage === 'flop' && u === u2 && !flopBet && q.you.legal.bet) { flopBet = true; return ['bet', 10]; }
        return passive(q);
      }, { onStep: ({ actor, pre, post, res, choice }) => { if (actor !== u1 && choice[0] !== 'check') steps.push({ who: actor.label, type: choice[0], status: res.status, chips: [seatOf(pre, actor).chips, post && seatOf(post, actor).chips], put: post && seatOf(post, actor).committedThisHand - seatOf(pre, actor).committedThisHand }); } });
      ctx.cp('2 余额 0 的 U2 与余额为负的 U3 的跟注、下注被接受，余额按投入扣减', steps.some((s) => s.who.startsWith('ng2')) && steps.some((s) => s.who.startsWith('ng3')) && steps.every((s) => s.status === 200 && s.chips[0] - s.chips[1] === s.put && s.put > 0), steps);
      const nx = r.next || await waitNextHand(u1, id, r.final.handId);
      ctx.cp('4 本手结束后三人（含负余额者）都被自动发入下一手', [u1, u2, u3].every((u) => { const s = seatOf(nx, u); return s && s.inHand; }), nx.seats.map((s) => [s.seat, s.inHand]));
      const bal = [];
      for (const u of [u1, u2, u3]) bal.push([u, (await u.me()).chips]);
      const neg = bal.find(([, c]) => c < 0);
      await neg[0].leave(id);
      const c = (await neg[0].me()).chips;
      const t = await L.lobbyInfoText(neg[0]);
      ctx.cp('3 大厅中负数余额带负号显示', c < 0 && hasNum(t, '筹码：', c), { chips: c, lobby: t });
    },
  },
  {
    id: 'TS-40',
    budgetMs: 150000,
    async fn(ctx) {
      ctx.useDb();
      const u3 = await L.newUser('dn3'), u4 = await L.newUser('dn4');
      await L.setUserValues(u3, { chips: -1500 });
      const id = (await u3.createRoom('poker')).body.room.roomId;
      await u4.join(id);
      await u3.pokerStart(id);
      const obs = [];
      let p = await pk(u3, id);
      for (let k = 0; k < 3; k++) {
        const before = (await u3.me()).chips;
        const r = await playHand([u3, u4], id, (u, q) => (u === u3 && q.stage !== 'preflop' ? ['fold'] : (u === u4 && q.stage !== 'preflop' && q.you.legal.bet ? ['bet', 10] : passive(q))));
        const s = seatOf(r.final, u3);
        const after = (await u3.me()).chips;
        const won = (r.final.winners || []).filter((w) => w.seat === s.seat).reduce((a, w) => a + w.amount, 0);
        const nx = r.next || await waitNextHand(u3, id, r.final.handId);
        obs.push({ before, after, committed: s.committedThisHand, won, nextInHand: seatOf(nx, u3).inHand });
        p = nx;
      }
      ctx.cp('每手 U3 余额都按本手投入继续减少，不在某个数值处停住', obs.every((o) => o.committed > 0 && o.won === 0 && o.after === o.before - o.committed), obs);
      ctx.cp('每手都被自动发入下一手', obs.every((o) => o.nextInHand), obs.map((o) => o.nextInHand));
    },
  },
  {
    id: 'TS-41',
    budgetMs: 120000,
    async fn(ctx) {
      ctx.useDb();
      const u1 = await L.newUser('cp1'), u2 = await L.newUser('cp2'), u3 = await L.newUser('cp3');
      await L.setUserValues(u1, { chips: 1500 }); await L.setUserValues(u2, { chips: 0 }); await L.setUserValues(u3, { chips: -200 });
      const id = (await u1.createRoom('poker')).body.room.roomId;
      await u2.join(id); await u3.join(id);
      await u1.pokerStart(id);
      const p = await pk(u1, id);
      if (whoActs(p, [u1, u2, u3]) !== u1) throw new L.Unreportable('U1 not first to act');
      const capMsg = async (label, u, to) => {
        const before = await pk(u, id);
        const r = await u.act(id, 'raise', to);
        const after = await pk(u, id);
        ctx.cp(label, r.status >= 400 && r.status < 500 && /上限/.test(r.message || '') && sig(before) === sig(after), { status: r.status, code: r.code, message: r.message });
      };
      await capMsg('3 余额 1500 的 U1 加注到本手投入 1001 被拒绝，提示超出上限', u1, 1001);
      await expectAccepted(ctx, '2 U1 加注到本手投入 999 被接受（对照取值）', u1, id, 'raise', 999);
      const q = await pk(u2, id);
      const s2 = seatOf(q, u2);
      await capMsg('1 U2 本手投入将成为 1001 的加注被拒绝，提示超出上限', u2, s2.committedThisRound + (1001 - s2.committedThisHand));
      const a2 = await expectAccepted(ctx, '2 同一手中 U2 把本手投入加到恰好 1000 被接受', u2, id, 'raise', s2.committedThisRound + (1000 - s2.committedThisHand));
      const a3 = await expectAccepted(ctx, '4 U3 跟注到 1000 被接受', u3, id, 'call');
      const x2 = a3 && seatOf(a3, u2), x3 = a3 && seatOf(a3, u3);
      ctx.cp('4 U2 跟到 1000 后余额 −1000，U3 余额 −1200', x2 && x2.chips === -1000 && x2.committedThisHand === 1000 && x3.chips === -1200 && x3.committedThisHand === 1000, { u2: x2 && [x2.chips, x2.committedThisHand], u3: x3 && [x3.chips, x3.committedThisHand] });
      const m1 = await pk(u1, id);
      const leg = m1.you.legal || {};
      ctx.cp('3 U1 的可加注上限不使本手投入超过 1000', !leg.raise || leg.maxRaiseTo - seatOf(m1, u1).committedThisRound + seatOf(m1, u1).committedThisHand <= 1000, leg);
      const c1 = await u1.act(id, 'call');
      const done = await L.mustWait(async () => { const v = await pk(u1, id); return v && v.handId === p.handId && OVER.includes(v.stage) ? v : null; }, 'run-out to showdown');
      const sd = (done.showdown || []).map((s) => s.seat).sort();
      ctx.cp('5 投入达到 1000 的玩家不再行动但仍在该手：公共牌发完，摊牌时底牌参与比较', c1.status === 200 && done.board.length === 5 && sd.length === 3 && done.seats.every((s) => s.atCap && !s.folded), { board: done.board, showdown: sd });
      const j = judgeShowdown(done);
      const ch = [];
      for (const [u, s0] of [[u1, 1500], [u2, 0], [u3, -200]]) {
        const s = seatOf(done, u);
        const won = (done.winners || []).filter((w) => w.seat === s.seat).reduce((a, w) => a + w.amount, 0);
        ch.push({ u: u.label, s0, won, now: (await u.me()).chips });
      }
      ctx.cp('5 按全下规则分配底池；余额变化 = 分得 − 本手投入（1000）', j.ok && ch.every((c) => c.now === c.s0 + c.won - 1000), { judge: j.detail, ch });
    },
  },
  {
    id: 'TS-42',
    budgetMs: 120000,
    async fn(ctx) {
      const { us, id } = await table('kp', 2, 0);
      const [u1, u2] = us;
      await u1.pokerStart(id);
      const r = await playHand(us, id, (u, p) => (u === u1 ? ['fold'] : passive(p)));
      await u1.leave(id);
      const me = await u1.me();
      const B = me.chips;
      ctx.cp('1 打完一手 U1 余额 B ≠ 1000，积分仍为 1000', B !== 1000 && me.rating === 1000 && r.final.stage === 'complete', { B, rating: me.rating });
      const t = await L.lobbyInfoText(u1);
      ctx.cp('2 U1 离开 R1：大厅显示筹码 B', hasNum(t, '筹码：', B), t);
      const u3 = await L.newUser('kp3');
      const r2 = (await u3.createRoom('poker')).body.room.roomId;
      await u1.join(r2);
      ctx.cp('3 U1 加入 R2：房间中余额为 B', seatOf(await pk(u1, r2), u1).chips === B, seatOf(await pk(u1, r2), u1).chips);
      await u1.leave(r2);
      const again = new L.Client('kp1-relogin');
      const lg = await again.login(u1.user.username, u1.password);
      const t2 = await L.lobbyInfoText(again);
      ctx.cp('4 重新登录：大厅显示筹码 B', lg.status === 200 && hasNum(t2, '筹码：', B), { status: lg.status, lobby: t2 });
      const ai = (await u1.createAi()).body.room.roomId;
      await u1.resign(ai); await u1.leave(ai);
      const m = await u1.me();
      ctx.cp('5 人机象棋认输：积分 990，筹码仍为 B', m.rating === 990 && m.chips === B, { rating: m.rating, chips: m.chips });
    },
  },
  {
    id: 'TS-43',
    async fn(ctx) {
      const u1 = await L.newUser('bt1'), u2 = await L.newUser('bt2'), u3 = await L.newUser('bt3');
      const id = (await u1.createRoom('poker')).body.room.roomId;
      const s0 = await u1.pokerStart(id);
      ctx.cp('1 只有 U1 一人时开始牌局被拒绝', s0.status >= 400 && s0.status < 500, [s0.status, s0.code, s0.message]);
      const b = await u1.addBot(id);
      const p = await pk(u1, id);
      const bots = p.seats.filter((s) => s.kind === 'bot');
      const row = (await u2.rooms()).find((x) => x.id === id);
      ctx.cp('2 添加电脑玩家：出现可区分的电脑玩家，余额 1000，大厅显示 2/9', b.status === 201 && bots.length === 1 && bots[0].chips === 1000 && !bots[0].userId && row && row.players === 2 && row.capacity === 9, { bot: bots[0], row });
      const st = await u1.pokerStart(id);
      const q = await pk(u1, id);
      ctx.cp('3 开始牌局被接受，U1 与电脑玩家各被发牌', st.status === 200 && q.seats.filter((s) => s.inHand).length === 2 && seatOf(q, u1).holeCards.length === 2, q.seats.map((s) => [s.kind, s.inHand]));
      const r2 = (await u3.createRoom('poker')).body.room.roomId;
      await u2.join(r2);
      const nb = await u2.addBot(r2);
      const ns = await u2.pokerStart(r2);
      const x = await pk(u3, r2);
      ctx.cp('4 非房主 U2 添加电脑玩家、开始第一手都被拒绝，人数不变', nb.status >= 400 && nb.status < 500 && ns.status >= 400 && ns.status < 500 && x.seats.length === 2 && x.stage === 'idle', { addBot: [nb.status, nb.code], start: [ns.status, ns.code], seats: x.seats.length, stage: x.stage });
      const mb = await u1.addBot(id);
      ctx.cp('5 手牌进行中 U1 添加电脑玩家被拒绝', mb.status >= 400 && mb.status < 500 && (await pk(u1, id)).seats.length === 2, [mb.status, mb.code]);
      await u1.leave(id);
      const rating0 = (await u1.me()).rating;
      const id2 = (await u1.createRoom('poker')).body.room.roomId;
      await u1.addBot(id2);
      const n = await pk(u1, id2);
      const nbot = n.seats.find((s) => s.kind === 'bot');
      await u1.pokerStart(id2);
      await playHand([u1], id2, () => ['fold']);
      ctx.cp('6 新房间的电脑玩家余额 1000，不沿用上一房间；电脑输赢后 U1 积分不变', nbot && nbot.chips === 1000 && (await u1.me()).rating === rating0 && rating0 === 1000, { botChips: nbot && nbot.chips, rating: (await u1.me()).rating });
    },
  },
  {
    id: 'TS-44',
    budgetMs: 400000,
    async fn(ctx) {
      const { us, id } = await table('ai', 1, 2);
      const [u1] = us;
      await u1.pokerStart(id);
      const bad = [];
      let checked = 0, multi = 0, blindsOk = 0;
      let prev = null;
      let hands = 0;
      const seen = new Set();
      const lastInc = new Map();
      while (hands < 5) {
        const r = await playHand(us, id, (u, q) => passive(q), {
          onPoll: (p) => {
            if (!seen.has(p.handId)) {
              seen.add(p.handId);
              const order = clockwiseAfter(p, dealerOf(p).seat);
              const sb = seatNo(p, order[0]), bb = seatNo(p, order[1]);
              for (const [s, amt] of [[sb, 5], [bb, 10]]) if (s.kind === 'bot') { if (s.committedThisHand >= amt && p.actions.some((a) => a.seat === s.seat && a.type === (amt === 5 ? 'small_blind' : 'big_blind') && a.amount === amt)) blindsOk += 1; else bad.push({ blind: s.seat, amt }); }
              prev = p; return;
            }
            if (prev && prev.handId === p.handId && p.actions.length > prev.actions.length) {
              const fresh = p.actions.slice(prev.actions.length);
              const a = fresh[0];
              const s0 = seatNo(prev, a.seat);
              if (s0 && s0.kind === 'bot') {
                if (fresh.length > 1) multi += 1;
                checked += 1;
                const need = prev.currentBet - s0.committedThisRound;
                const newRound = s0.committedThisRound + (a.amount || 0);
                const err = [];
                if (prev.toActSeat !== a.seat) err.push('not its turn');
                if (a.type === 'check' && need > 0) err.push('check when call needed');
                if (a.type === 'bet' && (a.amount < 10 && s0.committedThisHand + a.amount < 1000)) err.push('bet < 10');
                if (a.type === 'raise') {
                  const inc = newRound - prev.currentBet;
                  const li = lastInc.get(prev.handId + prev.stage) || 10;
                  if (inc < li && s0.committedThisHand + a.amount < 1000) err.push(`raise increment ${inc} < ${li}`);
                }
                if (s0.committedThisHand + (a.amount || 0) > 1000) err.push('over cap');
                if (err.length) bad.push({ action: a, err, prev: { toAct: prev.toActSeat, currentBet: prev.currentBet, seat: s0 } });
              }
            }
            if (prev && prev.handId === p.handId && prev.stage === p.stage && p.currentBet > prev.currentBet && prev.currentBet > 0) {
              const k = p.handId + p.stage;
              lastInc.set(k, Math.max(lastInc.get(k) || 10, p.currentBet - prev.currentBet));
            }
            prev = p;
          },
        });
        hands += 1;
        if (!r.next) await waitNextHand(u1, id, r.final.handId);
        prev = null;
      }
      ctx.cp(`电脑玩家自动行动且合规（核对 ${checked} 次行动，盲注位自动扣盲 ${blindsOk} 次）`, checked >= 5 && bad.length === 0, { checked, multi, blindsOk, bad: bad.slice(0, 5) });
    },
  },
];

export const scenarios = [...part1, ...part2];
