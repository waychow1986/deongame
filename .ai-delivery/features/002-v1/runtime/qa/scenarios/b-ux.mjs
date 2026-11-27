// TS-35 .. TS-39: sounds, mute, mobile hint, mobile portrait layout, loading/waiting/reconnect hints
import {
  BASE, openPage, gotoLobby, gotoRoom, sleep, waitFor, onlineChess, cell, waitBoardIdle, boardGeom, posCenter, sounds,
} from '../lib.mjs';

const MOBILE_HINT = '听不到声音？请关闭手机静音模式';

async function unlock(page, mobile = false) {
  const h = page.getByRole('heading', { level: 1 }).first();
  if (mobile) await h.tap(); else await h.click();
  await sleep(200);
}
const evSince = async (page, t0) => (await sounds(page)).filter((e) => e.t >= t0);
const hasEv = (evs, name, played = true) => evs.some((e) => e.name === name && e.played === played);
const fmtEv = (evs) => evs.map((e) => `${e.name}:${e.played}`).join(',') || '(无)';
async function waitEv(page, t0, name, played = true, timeout = 8000) {
  return !!(await waitFor(async () => hasEv(await evSince(page, t0), name, played), { timeout, interval: 200 }));
}
async function browserNow(page) { return page.evaluate(() => Date.now()); }

// UI chess move on page (click/tap from then target)
async function uiMove(page, from, to, mobile = false) {
  await waitBoardIdle(page, 60000);
  if (mobile) await cell(page, from).tap(); else await cell(page, from).click();
  await sleep(250);
  if (mobile) await cell(page, to).tap(); else await cell(page, to).click();
}
// pick a legal move from API state; pref: 'plain' (revealed piece to empty), 'hidden' (hidden piece), 'capture'
function pickMove(st, pref) {
  const lm = st.chess?.legalMoves || {};
  const at = Object.fromEntries((st.chess?.board || []).map((b) => [b.pos, b]));
  const all = [];
  for (const [f, tos] of Object.entries(lm)) for (const t of tos) all.push([f, t]);
  const ok = all.filter(([f, t]) => {
    if (pref === 'plain') return at[f] && at[f].piece !== 'hidden' && !at[t];
    if (pref === 'hidden') return at[f] && at[f].piece === 'hidden' && !at[t];
    if (pref === 'capture') return !!at[t];
    return true;
  });
  const list = ok.length ? ok : all;
  return list.length ? list[Math.floor(Math.random() * list.length)] : null;
}
async function waitVersionChange(api, roomId, prevKey, timeout = 15000) {
  return waitFor(async () => {
    const st = await api.state(roomId);
    return JSON.stringify(st.chess?.lastMove) !== prevKey || st.chess?.status !== 'active' ? st : null;
  }, { timeout });
}
// U (page user) makes UI move when it's their turn; returns [from,to] or null
async function myUiMove(api, roomId, page, pref, mobile = false) {
  const st = await api.state(roomId);
  if (st.chess?.status !== 'active' || st.chess.turn !== st.chess.yourColor) return null;
  const mv = pickMove(st, pref);
  if (!mv) return null;
  const prev = JSON.stringify(st.chess.lastMove);
  await uiMove(page, mv[0], mv[1], mobile);
  const st2 = await waitVersionChange(api, roomId, prev);
  return st2 ? mv : null;
}
async function apiMove(api, roomId, pref) {
  const st = await api.state(roomId);
  if (st.chess?.status !== 'active' || st.chess.turn !== st.chess.yourColor) return null;
  const mv = pickMove(st, pref);
  if (!mv) return null;
  const r = await api.move(roomId, mv[0], mv[1]);
  return r.status === 200 ? mv : null;
}
async function uiResign(page) {
  await page.getByRole('button', { name: '认输' }).click();
  await sleep(400);
  const dlg = page.getByRole('dialog');
  if (await dlg.count()) {
    const btn = dlg.getByRole('button', { name: /确认|认输/ });
    if (await btn.count()) await btn.last().click();
  }
}
const muteBtn = (page) => page.getByRole('button', { name: '静音' });
const pressed = async (page) => muteBtn(page).getAttribute('aria-pressed');

// poker: click action button for type on page
async function uiPoker(page, type, mobile = false) {
  const area = page.getByRole('region', { name: '操作区' });
  const names = { fold: /^弃牌$/, check: /^过牌$/, call: /^跟注/, bet: /^(下注|加注)/, raise: /^加注/ };
  const b = area.getByRole('button', { name: names[type] }).first();
  await b.waitFor({ timeout: 15000 });
  await waitFor(async () => b.isEnabled(), { timeout: 10000, interval: 200 });
  if (mobile) await b.tap(); else await b.click();
}
async function myLegal(api, roomId) {
  const st = await api.state(roomId);
  return st.poker?.you?.legal ? st : null;
}

export const scenarios = [
  {
    id: 'TS-35', group: 'B', limitMinutes: 6,
    async run(ctx) {
      // ---- chess online ----
      const { u1, u2, roomId } = await onlineChess();
      ctx.track(u1); ctx.track(u2);
      const p1 = await openPage(ctx, u1); const p2 = await openPage(ctx, u2);
      await gotoRoom(p1, roomId); await gotoRoom(p2, roomId);
      await cell(p1, 'e0').waitFor({ timeout: 20000 }); await cell(p2, 'e0').waitFor({ timeout: 20000 });
      await unlock(p1); await unlock(p2);
      // U1: capture with hidden cannon-position piece (b2->b9 / h2->h9), also flips
      let t0 = await browserNow(p1);
      let st = await u1.state(roomId);
      const lm = st.chess.legalMoves || {};
      let mv = (lm.b2 || []).includes('b9') ? ['b2', 'b9'] : (lm.h2 || []).includes('h9') ? ['h2', 'h9'] : pickMove(st, 'capture');
      await uiMove(p1, mv[0], mv[1]);
      await waitVersionChange(u1, roomId, JSON.stringify(st.chess.lastMove));
      await waitEv(p1, t0, 'chess-capture'); await waitEv(p2, t0, 'chess-capture');
      await sleep(800);
      const e1a = await evSince(p1, t0); const e2a = await evSince(p2, t0);
      ctx.log(`U1 move ${mv} p1=${fmtEv(e1a)} p2=${fmtEv(e2a)}`);
      // U2 plain move by UI
      await waitBoardIdle(p2);
      t0 = await browserNow(p1);
      const mv2 = await myUiMove(u2, roomId, p2, 'plain');
      await waitEv(p1, t0, 'chess-move'); await sleep(800);
      const e1b = await evSince(p1, t0); const e2b = await evSince(p2, t0);
      ctx.log(`U2 move ${mv2} p1=${fmtEv(e1b)} p2=${fmtEv(e2b)}`);
      // U1 plain move by UI
      await waitBoardIdle(p1);
      t0 = await browserNow(p1);
      const mv3 = await myUiMove(u1, roomId, p1, 'plain');
      await waitEv(p2, t0, 'chess-move'); await sleep(800);
      const e1c = await evSince(p1, t0); const e2c = await evSince(p2, t0);
      ctx.log(`U1 move2 ${mv3} p1=${fmtEv(e1c)} p2=${fmtEv(e2c)}`);
      // U2 hidden piece move (flip) by UI
      await waitBoardIdle(p2);
      t0 = await browserNow(p1);
      const mv4 = await myUiMove(u2, roomId, p2, 'hidden');
      await waitEv(p1, t0, 'chess-flip'); await sleep(800);
      const e1d = await evSince(p1, t0); const e2d = await evSince(p2, t0);
      ctx.log(`U2 move2 ${mv4} p1=${fmtEv(e1d)} p2=${fmtEv(e2d)}`);
      // U2 resigns via UI
      await waitBoardIdle(p2);
      t0 = await browserNow(p1);
      await uiResign(p2);
      await waitEv(p1, t0, 'chess-end'); await waitEv(p2, t0, 'chess-end');
      const e1e = await evSince(p1, t0); const e2e = await evSince(p2, t0);
      await ctx.shot(p1, 'chess-end-u1'); await ctx.shot(p2, 'chess-end-u2');
      const stEnd = await u1.state(roomId);
      ctx.check('1 落子 chess-move：U1 走棋后 U1、U2 两个页面都收到且 played=true', !!mv3 && hasEv(e1c, 'chess-move') && hasEv(e2c, 'chess-move'), `U1走${mv3} U1页=${fmtEv(e1c)} U2页=${fmtEv(e2c)}`);
      ctx.check('1 暗子翻开 chess-flip：两个页面都收到且 played=true', (hasEv(e1a, 'chess-flip') && hasEv(e2a, 'chess-flip')) || (hasEv(e1d, 'chess-flip') && hasEv(e2d, 'chess-flip')), `U1翻吃${mv}: U1页=${fmtEv(e1a)} U2页=${fmtEv(e2a)}; U2翻${mv4}: U1页=${fmtEv(e1d)} U2页=${fmtEv(e2d)}`);
      ctx.check('1 吃子 chess-capture：两个页面都收到且 played=true', hasEv(e1a, 'chess-capture') && hasEv(e2a, 'chess-capture'), `U1吃子${mv}: U1页=${fmtEv(e1a)} U2页=${fmtEv(e2a)}`);
      ctx.check('1 对局结束 chess-end：U2 认输后双方页面都收到且 played=true', stEnd.chess?.status !== 'active' && hasEv(e1e, 'chess-end') && hasEv(e2e, 'chess-end'), `status=${stEnd.chess?.status} U1页=${fmtEv(e1e)} U2页=${fmtEv(e2e)}`);
      ctx.check('2 由对手触发：U2 走棋时 U1 页面收到 chess-move', !!mv2 && hasEv(e1b, 'chess-move'), `U2走${mv2} U1页=${fmtEv(e1b)} U2页=${fmtEv(e2b)}`);

      // ---- AI game ----
      const u3 = await ctx.reg('ai');
      const ai = await u3.aiGame();
      const p3 = await openPage(ctx, u3);
      await gotoRoom(p3, ai.id); await cell(p3, 'e0').waitFor({ timeout: 20000 });
      await unlock(p3);
      let aiOk = false; let aiObs = '';
      for (let i = 0; i < 4 && !aiOk; i++) {
        await waitBoardIdle(p3);
        const s0 = await u3.state(ai.id);
        if (s0.chess.status !== 'active') break;
        const um = pickMove(s0, 'plain');
        const tA = await browserNow(p3);
        await uiMove(p3, um[0], um[1]);
        await waitEv(p3, tA, 'chess-move', true, 5000);
        const tB = await browserNow(p3);
        const n0 = (await evSince(p3, tA)).filter((e) => e.name === 'chess-move' && e.played).length;
        const sAi = await waitFor(async () => { const s = await u3.state(ai.id); return s.chess.status !== 'active' || (s.chess.turn === 'red' && s.chess.lastMove && s.chess.lastMove.from !== um[0]) ? s : null; }, { timeout: 60000 });
        if (!sAi) ctx.notReported('电脑对手 1 分钟内未走棋');
        await waitBoardIdle(p3); await sleep(1000);
        const evs = await evSince(p3, tA);
        const nMove = evs.filter((e) => e.name === 'chess-move' && e.played).length;
        aiObs += `[第${i + 1}轮 用户${um} 电脑${JSON.stringify(sAi.chess.lastMove)} 事件=${fmtEv(evs)} tB=${tB - tA}ms n0=${n0}] `;
        const aiPlain = sAi.chess.lastMove && !sAi.chess.lastMove.revealed;
        if (aiPlain || i === 3) { aiOk = nMove >= 2; break; }
        if (nMove >= 2) { aiOk = true; break; }
      }
      await ctx.shot(p3, 'ai');
      ctx.check('2 人机对局中电脑走棋时用户页面收到 chess-move', aiOk, aiObs);

      // ---- poker ----
      const u4 = await ctx.reg('ph'); const u5 = await ctx.reg('pj');
      const pr = await u4.createRoom('poker');
      await u5.join(pr.id);
      const rb = await u4.addBot(pr.id);
      ctx.log(`addBot ${rb.status}`);
      const p4 = await openPage(ctx, u4); const p5 = await openPage(ctx, u5);
      await gotoRoom(p4, pr.id); await gotoRoom(p5, pr.id);
      await p4.getByRole('region', { name: '牌桌' }).waitFor({ timeout: 20000 });
      await p5.getByRole('region', { name: '牌桌' }).waitFor({ timeout: 20000 });
      await unlock(p4); await unlock(p5);
      const tStart = await browserNow(p4);
      await p4.getByRole('button', { name: '开始牌局' }).click();
      await waitEv(p4, tStart, 'poker-deal'); await waitEv(p5, tStart, 'poker-deal');
      const eDeal4 = await evSince(p4, tStart); const eDeal5 = await evSince(p5, tStart);
      ctx.check('3 发牌 poker-deal：两个真人页面都收到且 played=true', hasEv(eDeal4, 'poker-deal') && hasEv(eDeal5, 'poker-deal'), `U1页=${fmtEv(eDeal4)} U2页=${fmtEv(eDeal5)}`);
      const need = new Set(['raise', 'bet', 'call', 'fold']);
      const human = []; const botActs = []; let wins = [];
      let seenActs = 0; let lastHand = null;
      const deadline = Date.now() + 180000;
      const humans = [[u4, p4], [u5, p5]];
      while (Date.now() < deadline && (need.size || !wins.length || !botActs.length)) {
        const sh = await u4.state(pr.id);
        const pk = sh.poker;
        if (pk.handId !== lastHand) { lastHand = pk.handId; seenActs = 0; }
        for (const a of pk.actions.slice(seenActs)) {
          const seat = pk.seats.find((s) => s.seat === a.seat);
          if (seat?.kind === 'bot' && ['call', 'fold', 'raise', 'bet'].includes(a.type)) botActs.push({ ...a, at: await browserNow(p4) - 1500 });
        }
        seenActs = pk.actions.length;
        if ((pk.stage === 'complete' || pk.stage === 'showdown' || (pk.winners && pk.winners.length)) && !wins.some((w) => w.hand === pk.handId)) {
          wins.push({ hand: pk.handId, at: await browserNow(p4) - 3000, winners: pk.winners });
        }
        let acted = false;
        for (const [api, page] of humans) {
          const s = await myLegal(api, pr.id);
          if (!s) continue;
          const L = s.poker.you.legal;
          let type;
          if (need.has('raise') && L.raise && s.poker.currentBet > 0) type = 'raise';
          else if (need.has('bet') && L.bet) type = 'bet';
          else if (need.has('call') && L.call) type = 'call';
          else if (need.has('fold') && L.fold && !need.has('raise') && !need.has('bet') && !need.has('call')) type = 'fold';
          else type = L.check ? 'check' : 'call';
          await waitFor(async () => (await page.getByRole('region', { name: '操作区' }).getAttribute('data-active')) === 'true', { timeout: 10000 });
          const at = await browserNow(page);
          const nActs = s.poker.actions.length;
          await uiPoker(page, type);
          const done = await waitFor(async () => { const x = await api.state(pr.id); return x.poker.handId !== s.poker.handId || x.poker.actions.length > nActs ? x : null; }, { timeout: 10000 });
          if (done && need.has(type)) {
            const evName = type === 'fold' ? 'poker-fold' : 'poker-bet';
            await waitEv(p4, at, evName, true, 5000); await waitEv(p5, at, evName, true, 5000);
            human.push({ type, who: api.username, a: await evSince(p4, at), b: await evSince(p5, at), evName });
            need.delete(type);
          }
          acted = true;
          break;
        }
        if (!acted) await sleep(300);
      }
      await sleep(1500);
      const all4 = await sounds(p4); const all5 = await sounds(p5);
      for (const h of human) {
        const ok = hasEv(h.a, h.evName) && hasEv(h.b, h.evName);
        const label = { call: '跟注', bet: '下注', raise: '加注', fold: '弃牌' }[h.type];
        ctx.check(`3 ${label} ${h.evName}：两个真人页面都收到且 played=true`, ok, `U1页=${fmtEv(h.a)} U2页=${fmtEv(h.b)}`);
      }
      for (const t of need) ctx.check(`3 ${{ call: '跟注', bet: '下注', raise: '加注', fold: '弃牌' }[t]}（3 分钟内未能完成该行动）`, false, '未出现该行动机会');
      const winOk = wins.length && hasEv(all4.filter((e) => e.t >= wins[0].at - 5000), 'poker-win') && hasEv(all5.filter((e) => e.t >= wins[0].at - 5000), 'poker-win');
      ctx.check('3 赢得底池 poker-win：两个真人页面都收到且 played=true', winOk, `结束手数=${wins.length} 首手赢家=${JSON.stringify(wins[0]?.winners)} U1全部=${fmtEv(all4).slice(0, 300)} U2全部=${fmtEv(all5).slice(0, 300)}`);
      const bot = botActs.find((b) => b.type === 'call' || b.type === 'fold') || botActs[0];
      if (!bot) ctx.notReported('3 分钟内电脑玩家没有跟注或弃牌');
      const bEv = bot.type === 'fold' ? 'poker-fold' : 'poker-bet';
      const botOk = hasEv(all4.filter((e) => e.t >= bot.at - 3000), bEv) && hasEv(all5.filter((e) => e.t >= bot.at - 3000), bEv);
      ctx.check('3 电脑玩家的跟注或弃牌在真人页面上也收到对应事件', botOk, `电脑行动=${bot.type} 期望=${bEv} 全部电脑行动=${botActs.map((b) => b.type).join(',')}`);
      await ctx.shot(p4, 'poker-u1'); await ctx.shot(p5, 'poker-u2');
    },
  },
  {
    id: 'TS-36', group: 'B', limitMinutes: 6,
    async run(ctx) {
      const { u1, u2, roomId } = await onlineChess();
      ctx.track(u1); ctx.track(u2);
      const p1 = await openPage(ctx, u1);
      await gotoRoom(p1, roomId); await cell(p1, 'e0').waitFor({ timeout: 20000 });
      const chessHas = await muteBtn(p1).count();
      // poker room
      const u3 = await ctx.reg('pk');
      const pr = await u3.createRoom('poker'); await u3.addBot(pr.id);
      const p3 = await openPage(ctx, u3);
      await gotoRoom(p3, pr.id); await p3.getByRole('region', { name: '牌桌' }).waitFor({ timeout: 20000 });
      const pokerHas = await muteBtn(p3).count();
      // lobby, login, register
      const u4 = await ctx.reg('lb');
      const pl = await openPage(ctx, u4); await gotoLobby(pl); await sleep(1000);
      const lobbyHas = await muteBtn(pl).count();
      const pa = await openPage(ctx, null);
      await pa.goto(BASE + '/login'); await pa.getByRole('textbox', { name: '用户名' }).waitFor();
      const loginHas = await muteBtn(pa).count();
      await pa.goto(BASE + '/register'); await pa.getByRole('textbox', { name: '用户名' }).waitFor();
      const regHas = await muteBtn(pa).count();
      ctx.check('1 象棋房间与扑克房间有“静音”按钮；大厅、登录、注册页面没有', chessHas === 1 && pokerHas === 1 && lobbyHas === 0 && loginHas === 0 && regHas === 0, `象棋=${chessHas} 扑克=${pokerHas} 大厅=${lobbyHas} 登录=${loginHas} 注册=${regHas}`);

      // a round: U1 UI move then U2 API move; return events since t0 on p1
      const round = async (pref1) => {
        await waitBoardIdle(p1);
        const t0 = await browserNow(p1);
        const m1 = await myUiMove(u1, roomId, p1, pref1);
        await waitFor(async () => { const s = await u2.state(roomId); return s.chess.turn === s.chess.yourColor; }, { timeout: 10000 });
        const m2 = await apiMove(u2, roomId, 'plain');
        await waitFor(async () => (await evSince(p1, t0)).length >= 2, { timeout: 8000 });
        await waitBoardIdle(p1); await sleep(800);
        return { m1, m2, evs: await evSince(p1, t0) };
      };
      await unlock(p1);
      await muteBtn(p1).click(); await sleep(300);
      const pr2 = await pressed(p1);
      const rA = await round('hidden');
      const rA2 = await round('plain');
      const evA = [...rA.evs, ...rA2.evs];
      const namesA = new Set(evA.map((e) => e.name));
      const kinds = ['chess-move', 'flip|capture', 'chess-end'].filter((k) => (k === 'flip|capture' ? namesA.has('chess-flip') || namesA.has('chess-capture') : namesA.has(k))).length;
      // poker muted
      await unlock(p3);
      await muteBtn(p3).click(); await sleep(300);
      const pp = await pressed(p3);
      const tP = await browserNow(p3);
      await p3.getByRole('button', { name: '开始牌局' }).click();
      const sP = await waitFor(() => myLegal(u3, pr.id), { timeout: 60000 });
      if (sP) {
        const L = sP.poker.you.legal;
        await uiPoker(p3, L.raise ? 'raise' : 'bet');
        await waitFor(async () => (await u3.state(pr.id)).poker.actions.length > sP.poker.actions.length, { timeout: 10000 });
      }
      const sP2 = await waitFor(async () => { const s = await myLegal(u3, pr.id); return s && s.poker.handId === sP?.poker.handId ? s : null; }, { timeout: 60000 });
      if (sP2) await uiPoker(p3, 'fold');
      await sleep(2500);
      const evP = await evSince(p3, tP);
      await ctx.shot(p3, 'poker-muted');
      ctx.check('2 点“静音”后按钮 aria-pressed=true，之后音效事件 played 全为 false（象棋至少两类，扑克下注与弃牌）',
        pr2 === 'true' && pp === 'true' && evA.length > 0 && evA.every((e) => e.played === false) && kinds >= 2
        && evP.every((e) => e.played === false) && hasEv(evP, 'poker-bet', false) && hasEv(evP, 'poker-fold', false),
        `象棋pressed=${pr2} 象棋事件=${fmtEv(evA)}（类数${kinds}）；扑克pressed=${pp} 扑克事件=${fmtEv(evP)} 扑克已弃牌=${!!sP2}`);
      await ctx.shot(p1, 'muted');

      await muteBtn(p1).click(); await sleep(300);
      const pr3 = await pressed(p1);
      const rB = await round('plain');
      ctx.check('3 再点一次：按钮未静音（aria-pressed=false），之后事件 played=true', pr3 === 'false' && rB.evs.length > 0 && rB.evs.every((e) => e.played === true), `pressed=${pr3} 走法=${rB.m1},${rB.m2} 事件=${fmtEv(rB.evs)}`);

      await muteBtn(p1).click(); await sleep(300);
      const pr4a = await pressed(p1);
      await p1.reload(); await cell(p1, 'e0').waitFor({ timeout: 20000 }); await sleep(800);
      const pr4 = await pressed(p1);
      await unlock(p1);
      const rC = await round('plain');
      ctx.check('4 静音后刷新页面：按钮为未静音，事件 played=true', pr4a === 'true' && pr4 === 'false' && rC.evs.length > 0 && rC.evs.every((e) => e.played === true), `刷新前pressed=${pr4a} 刷新后pressed=${pr4} 事件=${fmtEv(rC.evs)}`);

      await muteBtn(p1).click(); await sleep(300);
      const pr5a = await pressed(p1);
      await p1.getByRole('button', { name: '回到大厅' }).click();
      await p1.getByRole('button', { name: '回到对局' }).click({ timeout: 20000 });
      await p1.waitForURL(/\/room\//, { timeout: 15000 }); await cell(p1, 'e0').waitFor({ timeout: 20000 }); await sleep(500);
      const pr5 = await pressed(p1);
      const rD = await round('plain');
      await ctx.shot(p1, 'back-muted');
      ctx.check('5 静音后经“回到大厅”“回到对局”回到房间：按钮仍为已静音，之后事件 played=false', pr5a === 'true' && pr5 === 'true' && rD.evs.length > 0 && rD.evs.every((e) => e.played === false), `离开前pressed=${pr5a} 回来后pressed=${pr5} 事件=${fmtEv(rD.evs)} url=${p1.url().replace(BASE, '')}`);
    },
  },
  {
    id: 'TS-37', group: 'B', limitMinutes: 6,
    async run(ctx) {
      const { u1, u2, roomId } = await onlineChess();
      ctx.track(u1); ctx.track(u2);
      const runRoom = async (rid, kind, trigger) => {
        const m = await openPage(ctx, u1, { device: 'Pixel 7' });
        const d = await openPage(ctx, u2);
        await gotoRoom(m, rid); await gotoRoom(d, rid);
        await muteBtn(m).waitFor({ timeout: 20000 }); await muteBtn(d).waitFor({ timeout: 20000 });
        await sleep(800);
        const hint = () => m.getByText(MOBILE_HINT).isVisible().catch(() => false);
        const h1 = await hint();
        await ctx.shot(m, `${kind}-mobile`);
        ctx.check(`1 [${kind}] 手机页面未静音时显示“${MOBILE_HINT}”`, h1, `可见=${h1}`);
        await unlock(m, true);
        await muteBtn(m).tap(); await sleep(400);
        const h2 = await hint(); const pA = await pressed(m);
        await muteBtn(m).tap(); await sleep(400);
        const h3 = await hint(); const pB = await pressed(m);
        ctx.check(`2 [${kind}] 点静音后提示不显示；取消静音后再次显示`, !h2 && h3 && pA === 'true' && pB === 'false', `静音后可见=${h2}(pressed=${pA}) 取消后可见=${h3}(pressed=${pB})`);
        const hd = await d.getByText(MOBILE_HINT).count();
        await ctx.shot(d, `${kind}-desktop`);
        ctx.check(`3 [${kind}] 桌面页面不显示该提示`, hd === 0 || !(await d.getByText(MOBILE_HINT).first().isVisible()), `桌面匹配数=${hd}`);
        const t0 = await browserNow(m);
        const expect = await trigger(m, d);
        await waitEv(m, t0, expect, true, 10000); await sleep(800);
        const evs = await evSince(m, t0);
        ctx.check(`4 [${kind}] 手机页面第一次点按之后音效事件 played=true`, evs.length > 0 && hasEv(evs, expect) && evs.every((e) => e.played === true), `事件=${fmtEv(evs)}`);
      };
      await runRoom(roomId, '象棋', async () => {
        await apiMove(u1, roomId, 'plain');
        await waitFor(async () => { const s = await u2.state(roomId); return s.chess.turn === s.chess.yourColor; }, { timeout: 10000 });
        await apiMove(u2, roomId, 'plain');
        return 'chess-move';
      });
      for (const c of ctx.contexts.splice(0)) await c.close().catch(() => {});
      await u1.leave(roomId); await u2.leave(roomId);
      const pr = await u1.createRoom('poker'); await u2.join(pr.id);
      await runRoom(pr.id, '扑克', async (m) => {
        await m.getByRole('button', { name: '开始牌局' }).tap();
        return 'poker-deal';
      });
    },
  },
  {
    id: 'TS-38', group: 'B', limitMinutes: 6,
    async run(ctx) {
      const { u1, u2, roomId } = await onlineChess();
      ctx.track(u1); ctx.track(u2);
      const u3 = await ctx.reg('pk');
      const pr = await u3.createRoom('poker'); await u3.addBot(pr.id); await u3.pokerStart(pr.id);
      const u4 = await ctx.reg('lb');
      const measure = async (page, mains) => page.evaluate(({ mains }) => {
        const vw = window.innerWidth;
        const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
        const board = [...document.querySelectorAll('[role="group"]')].find((e) => e.getAttribute('aria-label') === '棋盘');
        const sel = (q) => {
          if (q.startsWith('aria:')) { const [, role, name] = q.split(':'); return [...document.querySelectorAll(`[role="${role}"],${role === 'region' ? 'section' : role === 'table' ? 'table' : role}`)].filter((e) => (e.getAttribute('aria-label') || '') === name); }
          return [...document.querySelectorAll(q)];
        };
        const mainRes = [];
        for (const q of mains) {
          const els = sel(q).filter(vis);
          if (!els.length) { mainRes.push({ q, missing: true }); continue; }
          for (const e of els) { const r = e.getBoundingClientRect(); mainRes.push({ q, l: Math.round(r.left * 10) / 10, r: Math.round(r.right * 10) / 10, in: r.left >= -0.5 && r.right <= vw + 0.5 }); }
        }
        const btns = [...document.querySelectorAll('button,[role="button"]')].filter((b) => vis(b) && !(board && board.contains(b)))
          .map((b) => { const r = b.getBoundingClientRect(); return { n: (b.getAttribute('aria-label') || b.textContent || '').trim().slice(0, 20), w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10, l: r.left, r: r.right }; });
        return { vw, sw: document.documentElement.scrollWidth, mainRes, btns };
      }, { mains });
      const widths = [360, 390, 430];
      let p360c = null; let p360p = null;
      for (const w of widths) {
        const res = {};
        const pa = await openPage(ctx, null, { device: 'Pixel 7', viewport: { width: w, height: 880 } });
        await pa.goto(BASE + '/login'); await pa.getByRole('textbox', { name: '用户名' }).waitFor(); await sleep(500);
        res['登录'] = await measure(pa, ['form', 'input', 'button']);
        await ctx.shot(pa, `${w}-login`);
        await pa.goto(BASE + '/register'); await pa.getByRole('textbox', { name: '用户名' }).waitFor(); await sleep(500);
        res['注册'] = await measure(pa, ['form', 'input', 'button']);
        await ctx.shot(pa, `${w}-register`);
        const pl = await openPage(ctx, u4, { device: 'Pixel 7', viewport: { width: w, height: 880 } });
        await gotoLobby(pl); await pl.getByRole('table', { name: '房间列表' }).waitFor(); await sleep(1000);
        res['大厅'] = await measure(pl, ['aria:table:房间列表', 'button']);
        await ctx.shot(pl, `${w}-lobby`);
        const pc = await openPage(ctx, u1, { device: 'Pixel 7', viewport: { width: w, height: 880 } });
        await gotoRoom(pc, roomId); await cell(pc, 'e0').waitFor({ timeout: 20000 }); await waitBoardIdle(pc); await sleep(500);
        res['象棋房间'] = await measure(pc, ['aria:group:棋盘', 'button']);
        await ctx.shot(pc, `${w}-chess`);
        const pp = await openPage(ctx, u3, { device: 'Pixel 7', viewport: { width: w, height: 880 } });
        await gotoRoom(pp, pr.id); await pp.getByRole('region', { name: '操作区' }).waitFor({ timeout: 20000 }); await sleep(800);
        res['扑克房间'] = await measure(pp, ['aria:region:牌桌', 'aria:region:操作区', 'button']);
        await ctx.shot(pp, `${w}-poker`);
        ctx.saveJson(`${w}-measure`, res);
        const pages = Object.keys(res);
        const cp1 = pages.map((k) => `${k}:sw=${res[k].sw}/vw=${res[k].vw}`);
        ctx.check(`1 [${w}] 各页面无横向滚动（scrollWidth ≤ 视口宽度）`, pages.every((k) => res[k].sw <= res[k].vw), cp1.join(' '));
        const bad2 = pages.flatMap((k) => res[k].mainRes.filter((m) => m.missing || !m.in).map((m) => `${k}:${m.q}${m.missing ? '缺失' : `[${m.l},${m.r}]`}`));
        ctx.check(`2 [${w}] 主要元素（表单、游戏卡片、房间列表、棋盘、牌桌、操作区按钮）水平完整在视口内`, bad2.length === 0, bad2.length ? bad2.slice(0, 12).join('; ') : `全部在 [0,${w}] 内`);
        const bad3 = pages.flatMap((k) => res[k].btns.filter((b) => b.w < 44 || b.h < 44).map((b) => `${k}:“${b.n}”${b.w}×${b.h}`));
        const nBtn = pages.reduce((a, k) => a + res[k].btns.length, 0);
        ctx.check(`3 [${w}] 按钮与游戏卡片（除交叉点）宽高都 ≥ 44px`, bad3.length === 0, bad3.length ? bad3.slice(0, 12).join('; ') : `共 ${nBtn} 个按钮均 ≥44`);
        // cp4 board intersections
        const g = await boardGeom(pc);
        const cells = await pc.evaluate(() => {
          const b = [...document.querySelectorAll('[role="group"]')].find((e) => e.getAttribute('aria-label') === '棋盘');
          return [...b.querySelectorAll('button,[role="button"]')].map((x) => { const r = x.getBoundingClientRect(); return { n: x.getAttribute('aria-label') || x.textContent, x: r.x, y: r.y, w: r.width, h: r.height }; });
        });
        const step = g.box.width / 9; const stepY = g.box.height / 10;
        const bad4 = [];
        for (const c of cells) {
          const pos = /^([a-i]\d)\s/.exec(c.n || '')?.[1];
          if (!pos) { bad4.push(`无名${c.n}`); continue; }
          const pc0 = posCenter(pos, g);
          const cx = c.x + c.w / 2; const cy = c.y + c.h / 2;
          if (Math.abs(cx - pc0.x) > 1 || Math.abs(cy - pc0.y) > 1 || Math.abs(c.w - step) > 1 || Math.abs(c.h - stepY) > 1) bad4.push(`${pos}:中心(${cx.toFixed(1)},${cy.toFixed(1)})期望(${pc0.x.toFixed(1)},${pc0.y.toFixed(1)}) ${c.w.toFixed(1)}×${c.h.toFixed(1)}`);
        }
        ctx.check(`4 [${w}] 棋盘交叉点点按区域以交叉点为中心、边长等于间距（±1px）`, cells.length === 90 && bad4.length === 0, `交叉点数=${cells.length} 棋盘=${g.box.width.toFixed(1)}×${g.box.height.toFixed(1)} 间距=${step.toFixed(1)}/${stepY.toFixed(1)} ${bad4.slice(0, 6).join('; ')}`);
        if (w === 360) { p360c = pc; p360p = pp; }
      }
      // cp5 at 360: tap a chess move and a poker action
      const st = await u1.state(roomId);
      const mv = pickMove(st, 'any');
      await uiMove(p360c, mv[0], mv[1], true);
      const st2 = await waitVersionChange(u1, roomId, JSON.stringify(st.chess.lastMove), 10000);
      const chessOk = !!st2 && st2.chess.lastMove?.from === mv[0] && st2.chess.lastMove?.to === mv[1];
      await ctx.shot(p360c, '360-chess-tapped');
      const sp = await waitFor(() => myLegal(u3, pr.id), { timeout: 60000 });
      let pokerOk = false; let pObs = '';
      if (sp) {
        const L = sp.poker.you.legal;
        const type = L.check ? 'check' : 'call';
        const n = sp.poker.actions.length;
        await uiPoker(p360p, type, true);
        const sp2 = await waitFor(async () => { const x = await u3.state(pr.id); return x.poker.actions.length > n || x.poker.handId !== sp.poker.handId ? x : null; }, { timeout: 10000 });
        const a = sp2?.poker.actions[n];
        pokerOk = !!a && a.seat === sp.poker.you.seat && a.type === type;
        pObs = `点按${type} 接口新行动=${JSON.stringify(a)}`;
        await ctx.shot(p360p, '360-poker-tapped');
      }
      ctx.check('5 [360] 点按完成一步象棋走棋（选子、点小圆点）与一次扑克行动（跟注或过牌），接口核对已生效', chessOk && pokerOk, `象棋点按${mv} 接口lastMove=${JSON.stringify(st2?.chess.lastMove)}；扑克 ${pObs || '未轮到'}`);
    },
  },
  {
    id: 'TS-39', group: 'B', limitMinutes: 6,
    async run(ctx) {
      const { u1, u2, roomId } = await onlineChess();
      ctx.track(u1); ctx.track(u2);
      const connStatus = (page) => page.getByRole('status', { name: '连接状态' });
      // cp1: delayed state request
      const p0 = await openPage(ctx, u1);
      await p0.route(/\/api\/rooms\/[^/]+\/state/, async (route) => { await sleep(3000); await route.continue(); });
      const tGo = Date.now();
      await p0.goto(BASE + '/room/' + roomId);
      const samples = [];
      while (Date.now() - tGo < 2800) {
        const s = await p0.evaluate(() => {
          const st = [...document.querySelectorAll('[role="status"]')].find((e) => e.getAttribute('aria-label') === '连接状态');
          const b = [...document.querySelectorAll('[role="group"]')].find((e) => e.getAttribute('aria-label') === '棋盘');
          return { state: st?.getAttribute('data-state'), text: (st?.innerText || '').trim(), body: document.body.innerText.includes('加载中'), board: !!b };
        }).catch(() => null);
        if (s) samples.push({ ms: Date.now() - tGo, ...s });
        await sleep(250);
      }
      await ctx.shot(p0, 'loading');
      const loadingSeen = samples.some((s) => s.body && !s.board);
      await cell(p0, 'e0').waitFor({ timeout: 20000 }).catch(() => {});
      await sleep(500);
      const afterBody = await p0.evaluate(() => document.body.innerText.includes('加载中'));
      const boardVis = await p0.getByRole('group', { name: '棋盘' }).isVisible();
      await ctx.shot(p0, 'loaded');
      ctx.check('1 延迟房间状态请求 3 秒：延迟期间有加载中文字提示；数据到达后提示消失并显示棋盘', loadingSeen && !afterBody && boardVis, `采样=${JSON.stringify(samples.slice(0, 8))} 之后仍有加载中=${afterBody} 棋盘可见=${boardVis}`);
      await p0.context().close(); ctx.contexts.splice(ctx.contexts.indexOf(p0.context()), 1);

      // cp2: waiting for opponent
      const u4 = await ctx.reg('w');
      const r4 = await u4.createRoom('chess');
      const p4 = await openPage(ctx, u4);
      await gotoRoom(p4, r4.id);
      const waitTxt = await waitFor(async () => { const t = await p4.getByRole('status', { name: '对局状态' }).innerText(); return t.includes('等待对手加入') ? t : null; }, { timeout: 15000 });
      await ctx.shot(p4, 'waiting');
      ctx.check('2 开联机象棋房间后页面显示等待对手加入的文字提示', !!waitTxt, `对局状态=${waitTxt || await p4.getByRole('status', { name: '对局状态' }).innerText().catch(() => '?')}`);

      // offline helper (setOffline + close live websockets so the disconnect is effective)
      const offCtl = async (page) => {
        const s = { off: false, wss: [] };
        await page.routeWebSocket(/socket\.io/, (ws) => {
          if (s.off) { ws.close().catch?.(() => {}); return; }
          ws.connectToServer(); s.wss.push(ws);
        });
        s.set = async (off) => {
          s.off = off;
          await page.context().setOffline(off);
          if (off) { for (const ws of s.wss.splice(0)) await Promise.resolve(ws.close()).catch(() => {}); }
        };
        return s;
      };
      const reconnectShown = async (page) => {
        const c = connStatus(page);
        const st = await c.getAttribute('data-state').catch(() => null);
        const txt = (await c.innerText().catch(() => '')).trim();
        const vis = await c.isVisible().catch(() => false);
        return vis && /重连|断开/.test(txt) ? { st, txt } : null;
      };
      // cp3: chess room offline
      const p1 = await openPage(ctx, u1);
      const o1 = await offCtl(p1);
      await gotoRoom(p1, roomId); await cell(p1, 'e0').waitFor({ timeout: 20000 }); await sleep(1000);
      await o1.set(true);
      const rc = await waitFor(() => reconnectShown(p1), { timeout: 60000, interval: 300 });
      await ctx.shot(p1, 'offline-chess');
      if (!rc) ctx.notReported('1 分钟内未显示重连提示（象棋房间）');
      // U2 moves while U1 offline (U1 red moves first if needed)
      let s = await u1.state(roomId);
      if (s.chess.turn === 'red') { await apiMove(u1, roomId, 'any'); }
      const mv2 = await apiMove(u2, roomId, 'any');
      const truth = await u2.state(roomId);
      await o1.set(false);
      const rec = await waitFor(async () => {
        if (await reconnectShown(p1)) return null;
        const to = await cell(p1, mv2[1]).getAttribute('aria-label').catch(() => null) || await cell(p1, mv2[1]).innerText().catch(() => '');
        const from = await cell(p1, mv2[0]).getAttribute('aria-label').catch(() => null);
        const marks = await cell(p1, mv2[1]).getAttribute('data-marks').catch(() => '');
        return (marks || '').includes('last-to') && from && / 空$/.test(from) ? { to, from, marks } : null;
      }, { timeout: 60000, interval: 500 });
      await waitBoardIdle(p1, 10000); await sleep(500);
      await ctx.shot(p1, 'recovered-chess');
      if (!rec) {
        const still = await reconnectShown(p1);
        if (still) ctx.notReported('恢复联网 1 分钟内重连提示仍未消失');
      }
      // compare whole board occupancy with API
      const occ = await p1.evaluate(() => {
        const b = [...document.querySelectorAll('[role="group"]')].find((e) => e.getAttribute('aria-label') === '棋盘');
        return [...b.querySelectorAll('button,[role="button"]')].map((x) => x.getAttribute('aria-label') || '').filter((n) => !/ 空$/.test(n)).map((n) => n.split(' ')[0]).sort();
      });
      const apiOcc = truth.chess.board.map((b) => b.pos).sort();
      ctx.check('3 离线时显示连接中断/正在重连提示；恢复后提示消失，局面包含 U2 刚走的一步并与接口一致',
        !!rc && !!rec && JSON.stringify(occ) === JSON.stringify(apiOcc),
        `重连提示=${JSON.stringify(rc)} U2走${mv2} 恢复后=${JSON.stringify(rec)} 页面占位${occ.length}格 接口${apiOcc.length}格 一致=${JSON.stringify(occ) === JSON.stringify(apiOcc)}`);

      // cp4: lobby
      const u3 = await ctx.reg('lb');
      const p3 = await openPage(ctx, u3);
      const o3 = await offCtl(p3);
      await gotoLobby(p3); await p3.getByRole('table', { name: '房间列表' }).waitFor(); await sleep(1000);
      await o3.set(true);
      const rl = await waitFor(() => reconnectShown(p3), { timeout: 60000, interval: 300 });
      await ctx.shot(p3, 'offline-lobby');
      if (!rl) ctx.notReported('1 分钟内未显示重连提示（大厅）');
      const u5 = await ctx.reg('nr');
      const nr = await u5.createRoom('chess');
      await o3.set(false);
      const recL = await waitFor(async () => {
        if (await reconnectShown(p3)) return null;
        return (await p3.locator(`[data-room-id="${nr.id}"]`).count()) > 0;
      }, { timeout: 60000, interval: 500 });
      await ctx.shot(p3, 'recovered-lobby');
      if (!recL && await reconnectShown(p3)) ctx.notReported('大厅恢复联网 1 分钟内重连提示仍未消失');
      ctx.check('4 大厅离线后显示重连提示；恢复后提示消失，列表中出现离线期间新开的房间', !!rl && !!recL, `重连提示=${JSON.stringify(rl)} 恢复后新房间出现=${!!recL}`);
    },
  },
];
