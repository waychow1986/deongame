// TS-24..TS-29: poker table layout, seat states, negative chips, card faces, animations, action area
import { BASE, openPage, gotoRoom, sleep, waitFor, waitTableIdle, isRed, parseRgb } from '../lib.mjs';

const SUIT = { h: '红桃', d: '方块', s: '黑桃', c: '梅花' };
const rankText = (c) => (c[0] === 'T' ? '10' : c[0]);
const cardLabel = (c) => SUIT[c[1]] + rankText(c);
const isDark = (c) => c && c.r <= 80 && c.g <= 80 && c.b <= 80;
const num = (s) => { const m = /-?\d+/.exec(s || ''); return m ? Number(m[0]) : null; };

const table = (page) => page.getByRole('region', { name: '牌桌' });
const actArea = (page) => page.getByRole('region', { name: '操作区' });
const actBtn = (page, name) => actArea(page).getByRole('button', name === '跟注' ? { name: /^跟注/ } : { name, exact: true });

// Snapshot of the table as rendered on the page (geometry relative to viewport).
async function tableInfo(page) {
  return page.evaluate(() => {
    const t = document.querySelector('section[aria-label="牌桌"]');
    const c = (e) => { const r = e.getBoundingClientRect(); return { cx: r.x + r.width / 2, cy: r.y + r.height / 2, x: r.x, y: r.y, w: r.width, h: r.height }; };
    const tb = c(t);
    const seats = [...t.querySelectorAll('section[aria-label^="座位 "]')].map((s) => {
      const label = s.getAttribute('aria-label');
      const n = Number(/^座位 (\d+)/.exec(label)[1]) - 1;
      const chips = s.querySelector('[data-negative]');
      return {
        label, n, ...c(s), me: s.getAttribute('data-me') === 'true', acting: s.getAttribute('data-acting') === 'true',
        text: s.innerText.replace(/\s+/g, ' '),
        cards: [...s.querySelectorAll('[role="img"]')].map((e) => e.getAttribute('aria-label')).filter((l) => !['庄家', '小盲', '大盲'].includes(l)),
        chipsText: chips?.textContent || null, chipsNeg: chips?.getAttribute('data-negative'), chipsColor: chips ? getComputedStyle(chips).color : null,
      };
    });
    const markers = {};
    for (const m of ['庄家', '小盲', '大盲']) markers[m] = [...t.querySelectorAll(`[role="img"][aria-label="${m}"]`)].map(c);
    const potEl = t.querySelector('[role="status"][aria-label="底池"]');
    const boardEl = t.querySelector('[aria-label="公共牌"]');
    return {
      anim: t.getAttribute('data-anim'), table: tb, seats, markers,
      pot: potEl ? { ...c(potEl), text: potEl.textContent } : null,
      board: boardEl ? { ...c(boardEl), cards: [...boardEl.querySelectorAll('[role="img"]')].map((e) => e.getAttribute('aria-label')) } : null,
    };
  });
}

// Wait until the page shows the same pot / acting seat as the API snapshot (and table idle).
async function waitSync(page, api, roomId, timeout = 15000) {
  let st = null;
  const ok = await waitFor(async () => {
    st = await api.state(roomId);
    const p = st.poker;
    const ti = await tableInfo(page);
    if (ti.anim !== 'idle') return false;
    if (num(ti.pot?.text) !== p.pot) return false;
    const acting = ti.seats.filter((s) => s.acting).map((s) => s.n);
    const exp = p.toActSeat == null ? [] : [p.toActSeat];
    if (JSON.stringify(acting) !== JSON.stringify(exp)) return false;
    const st2 = await api.state(roomId);
    return st2.version === st.version;
  }, { timeout, interval: 400 });
  return { ok: !!ok, st };
}

async function startViaUi(page) {
  const b = page.getByRole('button', { name: '开始牌局' });
  await b.waitFor();
  await waitFor(() => b.isEnabled(), { timeout: 10000 });
  await b.click();
}

async function waitTurn(api, roomId, seat, timeout = 60000) {
  return waitFor(async () => { const st = await api.state(roomId); return st.poker && st.poker.toActSeat === seat && st.poker.stage !== 'complete' ? st : null; }, { timeout, interval: 300 });
}

// click on an action button once it reflects that it is our turn
async function uiAct(page, name) {
  await waitFor(async () => (await actArea(page).getAttribute('data-active')) === 'true' && await actBtn(page, name).isEnabled(), { timeout: 15000 });
  await waitTableIdle(page, 15000);
  await actBtn(page, name).click();
}

function expectedStatus(p, s) {
  if (s.waitingNextHand) return '等待下一手';
  if (s.folded) return '弃牌';
  if (s.atCap) return '全下';
  if (p.toActSeat === s.seat && p.stage !== 'complete') return '行动中';
  return '';
}
const STATUS_WORDS = ['弃牌', '全下', '等待下一手', '行动中'];

// Capture a PNG of an element and sample pixels in the page with a canvas.
async function samplePixels(page, locator, points) {
  const buf = await locator.screenshot();
  const b64 = buf.toString('base64');
  return page.evaluate(async ({ b64, points }) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
    const g = cv.getContext('2d'); g.drawImage(img, 0, 0);
    return points.map(([fx, fy, dx = 0, dy = 0]) => {
      const x = Math.min(img.width - 1, Math.max(0, Math.round(fx * img.width + dx)));
      const y = Math.min(img.height - 1, Math.max(0, Math.round(fy * img.height + dy)));
      const d = g.getImageData(x, y, 1, 1).data; return { r: d[0], g: d[1], b: d[2], a: d[3], x, y };
    });
  }, { b64, points });
}
const cdist = (a, b) => Math.max(Math.abs(a.r - b.r), Math.abs(a.g - b.g), Math.abs(a.b - b.b));

function nearestSeat(pt, seats) {
  let best = null; let bd = Infinity;
  for (const s of seats) { const d = Math.hypot(s.cx - pt.cx, s.cy - pt.cy); if (d < bd) { bd = d; best = s; } }
  return best;
}

// TS-24 cp4: compare each seat text with API
function seatMismatches(ti, p) {
  const bad = [];
  for (const s of p.seats) {
    const ui = ti.seats.find((x) => x.n === s.seat);
    if (!ui) { bad.push(`seat${s.seat} missing`); continue; }
    const t = ui.text;
    const est = expectedStatus(p, s);
    const errs = [];
    if (!t.includes(s.name)) errs.push('name');
    if (num((/筹码\s*(-?\d+)/.exec(t) || [])[1]) !== s.chips) errs.push(`chips ui=${(/筹码\s*(-?\d+)/.exec(t) || [])[1]} api=${s.chips}`);
    if (num((/本轮下注\s*(-?\d+)/.exec(t) || [])[1]) !== s.committedThisRound) errs.push(`bet api=${s.committedThisRound}`);
    for (const w of STATUS_WORDS) if ((w === est) !== t.includes(w)) errs.push(`status exp=${est || '无'}`);
    if (s.kind === 'bot' && !/电脑\s*\d*\s*电脑|电脑/.test(t.replace(s.name, ''))) errs.push('bot tag');
    if (errs.length) bad.push(`seat${s.seat}: ${[...new Set(errs)].join(',')} | ${t}`);
  }
  return bad;
}

// card face checks for a page: returns per-card observation
async function cardFaces(page) {
  return page.evaluate(() => {
    const t = document.querySelector('section[aria-label="牌桌"]');
    return [...t.querySelectorAll('[role="img"]')].filter((e) => !['庄家', '小盲', '大盲', '牌背'].includes(e.getAttribute('aria-label'))).map((e) => {
      const r = e.getBoundingClientRect();
      const seat = e.closest('section[aria-label^="座位 "]');
      const rankEl = [...e.querySelectorAll('*')].find((x) => x.children.length === 0 && x.textContent.trim() && x.tagName !== 'path');
      const graphic = [...e.querySelectorAll('svg,img,canvas')].filter((g) => { const gr = g.getBoundingClientRect(); return gr.width > 2 && gr.height > 2 && getComputedStyle(g).visibility !== 'hidden'; });
      const gEl = graphic[graphic.length - 1];
      const gPath = gEl?.querySelector('path');
      return {
        label: e.getAttribute('aria-label'), where: seat ? (seat.getAttribute('data-me') === 'true' ? 'me' : 'other') : 'board',
        w: r.width, h: r.height, text: e.innerText.trim(), rankText: rankEl?.textContent.trim() || null,
        rankColor: rankEl ? getComputedStyle(rankEl).color : null, rankVisible: rankEl ? rankEl.getBoundingClientRect().width > 0 : false,
        graphics: graphic.length, suitColor: gEl ? (gPath && getComputedStyle(gPath).fill && !/none|currentcolor/i.test(getComputedStyle(gPath).fill) ? getComputedStyle(gPath).fill : getComputedStyle(gEl).color) : null,
      };
    });
  });
}

function judgeCard(cf, apiLabels) {
  const errs = [];
  if (!apiLabels.includes(cf.label)) errs.push('label not in api');
  if (!(cf.graphics >= 1)) errs.push('no graphic');
  if (!cf.rankVisible || !cf.rankText) errs.push('no rank');
  const suitName = cf.label.slice(0, 2); const rank = cf.label.slice(2);
  if (cf.rankText !== rank) errs.push(`rank text ${cf.rankText}≠${rank}`);
  const red = suitName === '红桃' || suitName === '方块';
  const rc = parseRgb(cf.rankColor); const sc = parseRgb(cf.suitColor);
  if (red ? !isRed(rc) : !isDark(rc)) errs.push(`rank color ${cf.rankColor}`);
  if (red ? !isRed(sc) : !isDark(sc)) errs.push(`suit color ${cf.suitColor}`);
  return errs;
}

// rAF recorder for TS-28
async function installRecorder(page) {
  await page.evaluate(() => {
    window.__fr = [];
    const t = document.querySelector('section[aria-label="牌桌"]');
    const c = (e) => { const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; };
    const snap = () => {
      const tb = t.getBoundingClientRect();
      const rel = (p) => [p[0] - tb.x, p[1] - tb.y];
      const seats = [...t.querySelectorAll('section[aria-label^="座位 "]')].map((s) => ({ l: s.getAttribute('aria-label'), c: rel(c(s)), cards: [...s.querySelectorAll('[role="img"]')].filter((e) => !['庄家', '小盲', '大盲'].includes(e.getAttribute('aria-label'))).map((e) => rel(c(e))) }));
      const pot = t.querySelector('[role="status"][aria-label="底池"]');
      const board = [...(t.querySelector('[aria-label="公共牌"]')?.querySelectorAll('[role="img"]') || [])].map((e) => { const cs = getComputedStyle(e); return { l: e.getAttribute('aria-label'), c: rel(c(e)), tf: cs.transform, op: cs.opacity }; });
      const chips = [...t.querySelectorAll('[class*="chip"]')].map((e) => ({ c: rel(c(e)), inBet: !!e.closest('[data-bet-anchor]'), cls: String(e.className) }));
      return { a: t.getAttribute('data-anim'), tc: [tb.width / 2, tb.height / 2], pot: pot ? rel(c(pot)) : null, seats, board, chips };
    };
    window.__snap = snap;
    const loop = () => { const a = t.getAttribute('data-anim'); if (a !== 'idle' && window.__fr.length < 3000) window.__fr.push(snap()); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  });
}
const between = (p, a, b, tol = 30) => {
  const vx = b[0] - a[0]; const vy = b[1] - a[1]; const L2 = vx * vx + vy * vy; if (L2 < 1) return false;
  const t = ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / L2;
  const perp = Math.abs((p[0] - a[0]) * vy - (p[1] - a[1]) * vx) / Math.sqrt(L2);
  return t > 0.05 && t < 0.95 && perp < tol;
};

export const scenarios = [
  {
    id: 'TS-24', group: 'B', limitMinutes: 5,
    async run(ctx) {
      const u1 = await ctx.reg('h'); const u2 = await ctx.reg('p'); const u3 = await ctx.reg('q');
      const room = await u1.createRoom('poker', 6); const rid = room.id;
      await u2.join(rid); await u3.join(rid);
      const rb = await u1.addBot(rid); ctx.log(`addBot ${rb.status}`);
      const users = [u1, u2, u3];
      const pages = [];
      for (const u of users) { const p = await openPage(ctx, u); await gotoRoom(p, rid); await table(p).waitFor(); pages.push(p); }
      await startViaUi(pages[0]);
      await waitFor(async () => (await u1.state(rid)).poker?.handNumber >= 1, { timeout: 15000 });
      // wait until bot has acted if it is first, so that it's a human's turn and all pages are synced
      await waitFor(async () => { const p = (await u1.state(rid)).poker; return p.seats[p.toActSeat]?.kind === 'human'; }, { timeout: 60000 });
      const syncs = [];
      for (let i = 0; i < 3; i++) syncs.push(await waitSync(pages[i], users[i], rid));
      const infos = [];
      for (let i = 0; i < 3; i++) { infos.push(await tableInfo(pages[i])); await ctx.shot(pages[i], `u${i + 1}`); }
      const st = await u1.state(rid); const P = st.poker;
      ctx.saveJson('state', { poker: { ...P, seats: P.seats.map(({ holeCards, ...s }) => s) }, infos });

      // cp1 oval green
      const pts = [[0, 0, 3, 3], [1, 0, -4, 3], [0, 1, 3, -4], [1, 1, -4, -4], [0.3, 0.5], [0.7, 0.5], [0.5, 0.62], [0.38, 0.4], [0.62, 0.4], [0.5, 0.7]];
      const px = await samplePixels(pages[0], table(pages[0]), pts);
      const mids = px.slice(4);
      const greenMids = mids.filter((c) => c.g > c.r && c.g > c.b);
      const ref = greenMids[0] || mids[0];
      const cornersOk = px.slice(0, 4).every((c) => cdist(c, ref) > 40);
      const ti = infos[0]; const T = ti.table;
      const ell = ti.seats.map((s) => Math.hypot((s.cx - T.cx) / (T.w / 2), (s.cy - T.cy) / (T.h / 2)));
      const angs = ti.seats.map((s) => Math.atan2(s.cy - T.cy, s.cx - T.cx) * 180 / Math.PI).sort((a, b) => a - b);
      let maxGap = 0; for (let i = 0; i < angs.length; i++) { const g = (i + 1 < angs.length ? angs[i + 1] : angs[0] + 360) - angs[i]; maxGap = Math.max(maxGap, g); }
      const around = ell.every((e) => e > 0.6 && e < 1.6) && maxGap <= 190;
      ctx.check('1 牌桌为椭圆形绿色，座位围绕牌桌排列', greenMids.length >= 4 && cornersOk && around,
        `corners=${JSON.stringify(px.slice(0, 4).map(({ r, g, b }) => [r, g, b]))} mids=${JSON.stringify(mids.map(({ r, g, b }) => [r, g, b]))} greenMids=${greenMids.length}/6 ellipseR=${ell.map((e) => e.toFixed(2))} maxAngGap=${maxGap.toFixed(0)}`);

      // cp2 my seat bottom middle
      const cp2 = infos.map((inf, i) => {
        const me = inf.seats.filter((s) => s.me); const t = inf.table;
        const ok = me.length === 1 && me[0].cy > t.cy && Math.abs(me[0].cx - t.cx) <= 0.15 * t.w && me[0].n === P.seats.find((s) => s.userId === users[i].user.id)?.seat;
        return { ok, obs: `u${i + 1}: me=${me.map((s) => `${s.n}@(${s.cx.toFixed(0)},${s.cy.toFixed(0)})`)} table c=(${t.cx.toFixed(0)},${t.cy.toFixed(0)}) w=${t.w.toFixed(0)}` };
      });
      ctx.check('2 三人的页面上自己的座位都位于牌桌下方中间', cp2.every((x) => x.ok), cp2.map((x) => x.obs).join('; '));

      // cp3 relative order
      const occ = P.seats.map((s) => s.seat).sort((a, b) => a - b);
      const dirs = infos.map((inf, i) => {
        const t = inf.table; const mySeat = P.seats.find((s) => s.userId === users[i].user.id).seat;
        const withA = inf.seats.map((s) => ({ n: s.n, a: Math.atan2(s.cy - t.cy, s.cx - t.cx) }));
        const me = withA.find((s) => s.n === mySeat);
        const norm = (x) => ((x - me.a) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
        const cw = withA.filter((s) => s.n !== mySeat).sort((a, b) => norm(a.a) - norm(b.a)).map((s) => s.n);
        const k = occ.indexOf(mySeat); const expCw = [...occ.slice(k + 1), ...occ.slice(0, k)];
        const dir = JSON.stringify(cw) === JSON.stringify(expCw) ? 'cw' : JSON.stringify([...cw].reverse()) === JSON.stringify(expCw) ? 'ccw' : 'none';
        return { dir, obs: `u${i + 1} seen=${cw} expected=${expCw} dir=${dir}` };
      });
      ctx.check('3 每人画面中其他座位的相对顺序与座位号顺序一致（整体旋转）', dirs.every((d) => d.dir !== 'none' && d.dir === dirs[0].dir), dirs.map((d) => d.obs).join('; '));

      // cp4 seat contents
      const mm = [];
      for (let i = 0; i < 3; i++) { const s = await waitSync(pages[i], users[i], rid); const bad = seatMismatches(await tableInfo(pages[i]), s.st.poker); if (bad.length) mm.push(`u${i + 1}: ${bad.join(' / ')}`); }
      ctx.check('4 每个座位的用户名、筹码、本轮下注、状态与接口一致，电脑玩家带“电脑”标识', mm.length === 0 && syncs.every((s) => s.ok), mm.join(' ; ') || 'all match');

      // cp5 markers
      const want = { 庄家: P.seats.find((s) => s.isDealer)?.seat, 小盲: P.seats.find((s) => s.isSmallBlind)?.seat, 大盲: P.seats.find((s) => s.isBigBlind)?.seat };
      const cp5 = [];
      infos.forEach((inf, i) => {
        for (const [m, seat] of Object.entries(want)) {
          const arr = inf.markers[m];
          const near = arr.length === 1 ? nearestSeat(arr[0], inf.seats) : null;
          cp5.push({ ok: arr.length === 1 && near?.n === seat, obs: `u${i + 1} ${m}: count=${arr.length} nearest=${near?.n} api=${seat}` });
        }
      });
      ctx.check('5 庄家、小盲、大盲标记各出现一次，分别离接口所示座位最近', cp5.every((x) => x.ok), cp5.map((x) => x.obs).join('; '));

      // cp6 pot center & value; re-check after each bet
      const potObs = [];
      const potCheck = async (tag) => {
        let all = true;
        for (let i = 0; i < 3; i++) {
          const s = await waitSync(pages[i], users[i], rid);
          const inf = await tableInfo(pages[i]); const t = inf.table;
          const d = inf.pot ? Math.hypot(inf.pot.cx - t.cx, inf.pot.cy - t.cy) : Infinity;
          const ok = s.ok && d < Math.min(t.w, t.h) / 4 && num(inf.pot?.text) === s.st.poker.pot;
          all = all && ok;
          potObs.push(`${tag} u${i + 1}: pot ui=${inf.pot?.text} api=${s.st.poker.pot} dist=${d.toFixed(0)} lim=${(Math.min(t.w, t.h) / 4).toFixed(0)}`);
        }
        return all;
      };
      let potOk = await potCheck('initial');
      for (let k = 0; k < 3; k++) {
        const p = (await u1.state(rid)).poker;
        if (p.stage !== 'preflop') break;
        const who = users.findIndex((u) => p.seats[p.toActSeat]?.userId === u.user.id);
        if (who < 0) { await sleep(1000); continue; }
        const sv = await users[who].state(rid);
        await uiAct(pages[who], sv.poker.you.legal.call ? '跟注' : '过牌');
        await sleep(500);
        await waitFor(async () => { const q = (await u1.state(rid)).poker; return q.seats[q.toActSeat]?.kind !== 'bot'; }, { timeout: 60000 });
        potOk = (await potCheck(`after bet ${k + 1}`)) && potOk;
      }
      await ctx.shot(pages[0], 'cp6');
      ctx.check('6 底池金额在牌桌中央显示，数值与接口一致（每次下注后再核对）', potOk, potObs.join('; '));
    },
  },
  {
    id: 'TS-25', group: 'B', limitMinutes: 5,
    async run(ctx) {
      const u1 = await ctx.reg('h'); const u2 = await ctx.reg('p'); const u3 = await ctx.reg('q');
      const room = await u1.createRoom('poker'); const rid = room.id;
      await u2.join(rid); await u3.join(rid);
      const users = [u1, u2, u3]; const pages = [];
      for (const u of users) { const p = await openPage(ctx, u); await gotoRoom(p, rid); await table(p).waitFor(); pages.push(p); }
      await startViaUi(pages[0]);
      await waitFor(async () => (await u1.state(rid)).poker?.handNumber >= 1, { timeout: 15000 });
      const seatOf = async (u) => (await u.state(rid)).poker.you.seat;
      const s1 = await seatOf(u1); const s3 = await seatOf(u3);
      const hand1 = (await u1.state(rid)).poker.handId;
      // play preflop until U3's turn, then U3 folds
      for (let k = 0; k < 4; k++) {
        const p = (await u1.state(rid)).poker;
        if (p.toActSeat === s3) break;
        const who = users.findIndex((u) => p.seats[p.toActSeat]?.userId === u.user.id);
        const lg = (await users[who].state(rid)).poker.you.legal;
        await uiAct(pages[who], lg.call ? '跟注' : '过牌');
        await sleep(500);
      }
      await uiAct(pages[2], '弃牌');
      await sleep(500);
      const obs1 = [];
      let ok1 = true;
      for (let i = 0; i < 3; i++) {
        await waitSync(pages[i], users[i], rid);
        const inf = await tableInfo(pages[i]);
        const s = inf.seats.find((x) => x.n === s3);
        const ok = !!s && /弃牌/.test(s.text);
        ok1 = ok1 && ok; obs1.push(`u${i + 1}: ${s?.text}`);
        await ctx.shot(pages[i], `cp1-u${i + 1}`);
      }
      ctx.check('1 U3 弃牌后所有人页面上 U3 座位状态显示“弃牌”', ok1 && (await u1.state(rid)).poker.seats[s3].folded, obs1.join('; '));

      // cp2: U4 joins mid-hand
      const u4 = await ctx.reg('w');
      await u4.join(rid);
      const p4 = await openPage(ctx, u4); await gotoRoom(p4, rid); await table(p4).waitFor();
      pages.push(p4); users.push(u4);
      const s4 = await seatOf(u4);
      const st4 = (await u4.state(rid)).poker;
      const obs2 = [`api seat4=${s4} waiting=${st4.seats.find((s) => s.seat === s4)?.waitingNextHand} hole=${JSON.stringify(st4.seats.find((s) => s.seat === s4)?.holeCards || null)} toAct=${st4.toActSeat} hand=${st4.handId === hand1}`];
      let ok2a = st4.handId === hand1 && !(st4.seats.find((s) => s.seat === s4)?.holeCards?.length) && st4.toActSeat !== s4;
      for (let i = 0; i < 4; i++) {
        await waitFor(async () => (await tableInfo(pages[i])).seats.some((x) => x.n === s4), { timeout: 10000 });
        const s = (await tableInfo(pages[i])).seats.find((x) => x.n === s4);
        const ok = !!s && /等待下一手/.test(s.text) && s.cards.length === 0;
        ok2a = ok2a && ok; obs2.push(`u${i + 1}: ${s?.text} cards=${s?.cards}`);
      }
      await ctx.shot(p4, 'cp2-u4-waiting');

      // cp3: continue to U1's turn; U1 raises to max
      const seen = { u1Turns: 0, u4Turn: false, overCap: [] };
      let rStep = 0;
      while (rStep++ < 8) {
        const p = (await u1.state(rid)).poker;
        if (p.handId !== hand1 || p.stage === 'complete') break;
        if (p.toActSeat === s4) seen.u4Turn = true;
        if (p.toActSeat === s1) break;
        const who = users.findIndex((u) => p.seats[p.toActSeat]?.userId === u.user.id);
        const lg = (await users[who].state(rid)).poker.you.legal;
        await uiAct(pages[who], lg.check ? '过牌' : '跟注');
        await sleep(500);
      }
      const before = (await u1.state(rid)).poker;
      const lg1 = before.you.legal;
      ctx.log(`U1 legal before max: ${JSON.stringify(lg1)} stage=${before.stage}`);
      await waitFor(async () => (await actArea(pages[0]).getAttribute('data-active')) === 'true', { timeout: 15000 });
      await waitTableIdle(pages[0]);
      await actBtn(pages[0], '最大').click();
      await sleep(300);
      const amt = await actArea(pages[0]).getByRole('spinbutton', { name: '金额' }).inputValue().catch(() => '');
      await actBtn(pages[0], '加注').click();
      await sleep(800);
      const after = (await u2.state(rid)).poker;
      const me1 = after.seats.find((s) => s.seat === s1);
      // let the hand run: others call/check; record whether U1 is ever asked to act again
      const stAll = [];
      for (let k = 0; k < 10; k++) {
        const p = (await u2.state(rid)).poker;
        stAll.push(p);
        for (const s of p.seats) if (s.committedThisHand > 1000) seen.overCap.push(`${s.seat}:${s.committedThisHand}`);
        if (p.handId !== hand1 || p.stage === 'complete') break;
        if (p.toActSeat === s1) seen.u1Turns++;
        if (p.toActSeat === s4) seen.u4Turn = true;
        if (k === 0) {
          // check UI before others act
          const obs = [];
          let okUi = true;
          for (let i = 0; i < 4; i++) {
            if (i > 0) await waitSync(pages[i], users[i], rid);
            const s = (await tableInfo(pages[i])).seats.find((x) => x.n === s1);
            okUi = okUi && /全下/.test(s?.text || ''); obs.push(`u${i + 1}: ${s?.text}`);
          }
          seen.allInUi = okUi; seen.allInObs = obs.join('; ');
          await ctx.shot(pages[1], 'cp3-allin');
        }
        const who = users.findIndex((u) => p.seats[p.toActSeat]?.userId === u.user.id);
        if (who < 0) { await sleep(500); continue; }
        const lg = (await users[who].state(rid)).poker.you.legal;
        if (!lg) { await sleep(300); continue; }
        if (who === 0) { await u1.action(rid, lg.check ? 'check' : 'call'); continue; }
        await uiAct(pages[who], lg.call ? '跟注' : '过牌');
        await sleep(500);
      }
      ctx.check('3 U1 以最大金额加注后本手投入达到 1000，座位显示“全下”，之后不再轮到 U1，任何人投入不超过 1000',
        me1?.committedThisHand === 1000 && me1?.atCap && seen.allInUi && seen.u1Turns === 0 && seen.overCap.length === 0,
        `maxRaiseTo=${lg1?.maxRaiseTo} inputAmount=${amt} U1 committedThisHand=${me1?.committedThisHand} atCap=${me1?.atCap}; UI: ${seen.allInObs}; laterU1Turns=${seen.u1Turns}; overCap=${seen.overCap}`);

      // next hand: U4 participates
      const nh = await waitFor(async () => { const p = (await u4.state(rid)).poker; return p.handId && p.handId !== hand1 ? p : null; }, { timeout: 60000 });
      let ok2b = false; let obs2b = 'next hand did not start within 1 min';
      if (nh) {
        const s = nh.seats.find((x) => x.seat === s4);
        await sleep(1500); await waitTableIdle(p4);
        const ui = (await tableInfo(p4)).seats.find((x) => x.n === s4);
        ok2b = s && s.inHand && !s.waitingNextHand && s.holeCards?.length === 2 && ui && !/等待下一手/.test(ui.text) && ui.cards.length === 2 && !ui.cards.includes('牌背');
        obs2b = `next hand api: inHand=${s?.inHand} waiting=${s?.waitingNextHand} hole=${s?.holeCards?.length}; ui: ${ui?.text} cards=${ui?.cards}`;
        await ctx.shot(p4, 'cp2-u4-nexthand');
      } else ctx.log(obs2b);
      ctx.check('2 本手中加入的 U4 显示“等待下一手”、无底牌、不轮到行动；下一手开始后参与', ok2a && !seen.u4Turn && ok2b, `${obs2.join('; ')}; u4TurnInHand1=${seen.u4Turn}; ${obs2b}`);
    },
  },
  {
    id: 'TS-26', group: 'L1', limitMinutes: 9, timeoutNotReported: true,
    async run(ctx) {
      const u1 = await ctx.reg('h'); const u2 = await ctx.reg('p');
      const room = await u1.createRoom('poker'); const rid = room.id;
      await u2.join(rid);
      const r = await u1.pokerStart(rid); ctx.log(`start ${r.status}`);
      const deadline = Date.now() + 5 * 60000;
      let neg = null;
      const seatU1 = (await u1.state(rid)).poker.you.seat;
      while (Date.now() < deadline) {
        const [m1, m2] = [await u1.me(), await u2.me()];
        if (m1.chips < 0 || m2.chips < 0) { neg = m1.chips < 0 ? 0 : 1; break; }
        const p = (await u1.state(rid)).poker;
        if (!p || p.stage === 'complete' || p.toActSeat == null) { await sleep(400); continue; }
        if (p.toActSeat === seatU1) {
          const lg = p.you.legal;
          if (lg.raise) await u1.action(rid, 'raise', lg.maxRaiseTo);
          else if (lg.bet) await u1.action(rid, 'bet', lg.maxRaiseTo);
          else if (lg.call) await u1.action(rid, 'call');
          else await u1.action(rid, 'check');
        } else {
          const lg = (await u2.state(rid)).poker.you.legal;
          if (lg) await u2.action(rid, lg.call ? 'call' : 'check');
        }
        await sleep(200);
      }
      if (neg === null) ctx.notReported('5 分钟内没有人的筹码余额变为负数');
      const users = [u1, u2]; const nu = users[neg]; const pu = users[1 - neg];
      const meN = await nu.me(); const meP = await pu.me();
      ctx.log(`negative user u${neg + 1} chips=${meN.chips}; other=${meP.chips}`);
      const curHand = (await u1.state(rid)).poker.handId;
      // cp3: next hand includes the negative user
      const nh = await waitFor(async () => { const p = (await nu.state(rid)).poker; return p.handId !== curHand && p.stage !== 'complete' ? p : null; }, { timeout: 60000 });
      const ns = nh?.seats.find((s) => s.seat === nh.you.seat);
      const pages = [];
      for (const u of [nu, pu]) { const p = await openPage(ctx, u); await gotoRoom(p, rid); await table(p).waitFor(); pages.push(p); }
      const res = [];
      for (let i = 0; i < 2; i++) {
        const u = i === 0 ? nu : pu;
        const s = await waitSync(pages[i], u, rid);
        const inf = await tableInfo(pages[i]);
        const mySeat = s.st.poker.you.seat;
        const ui = inf.seats.find((x) => x.n === mySeat);
        res.push({ ui, api: s.st.poker.seats.find((x) => x.seat === mySeat).chips, synced: s.ok });
      }
      await ctx.shot(pages[0], 'neg-table'); await ctx.shot(pages[1], 'pos-table');
      const lobby = [];
      for (let i = 0; i < 2; i++) {
        await pages[i].getByRole('button', { name: '回到大厅' }).click();
        await pages[i].getByRole('heading', { name: 'DeonGame' }).waitFor({ timeout: 20000 });
        const info = pages[i].getByRole('region', { name: '我的信息' });
        await info.waitFor();
        const el = info.locator('[data-negative]').first();
        await sleep(500);
        lobby.push({ text: await info.innerText(), num: await el.textContent(), color: await el.evaluate((e) => getComputedStyle(e).color), me: await (i === 0 ? nu : pu).me() });
        await ctx.shot(pages[i], i === 0 ? 'neg-lobby' : 'pos-lobby');
      }
      const tn = res[0]; const lc = lobby[0];
      const lobbyNum = num((/扑克筹码\s*(-?\d+)/.exec(lc.text) || [])[1]);
      ctx.check('1 余额为负的用户：座位筹码与大厅顶部筹码显示为负数且为红色，数值与接口一致',
        num(tn.ui?.chipsText) === tn.api && tn.api < 0 && isRed(parseRgb(tn.ui?.chipsColor)) && lobbyNum === lc.me.chips && lobbyNum < 0 && isRed(parseRgb(lc.color)),
        `seat: ui=${tn.ui?.chipsText} api=${tn.api} color=${tn.ui?.chipsColor} synced=${tn.synced}; lobby: "${lc.text.replace(/\s+/g, ' ')}" api=${lc.me.chips} color=${lc.color}`);
      const tp = res[1]; const lp = lobby[1];
      ctx.check('2 余额为零或正数的另一用户：座位筹码与大厅顶部筹码都不是红色',
        !isRed(parseRgb(tp.ui?.chipsColor)) && !isRed(parseRgb(lp.color)) && lp.me.chips >= 0,
        `seat: ui=${tp.ui?.chipsText} api=${tp.api} color=${tp.ui?.chipsColor}; lobby: "${lp.text.replace(/\s+/g, ' ')}" balance=${lp.me.chips} color=${lp.color}`);
      ctx.check('3 负数余额的用户仍能继续参与下一手', !!ns && ns.inHand && !ns.waitingNextHand && ns.holeCards?.length === 2,
        nh ? `next hand ${nh.handNumber}: inHand=${ns?.inHand} waiting=${ns?.waitingNextHand} hole=${ns?.holeCards?.length}` : 'next hand not started in 1 min');
    },
  },
  {
    id: 'TS-27', group: 'L1', limitMinutes: 7,
    async run(ctx) {
      const u1 = await ctx.reg('h'); const u2 = await ctx.reg('p');
      const room = await u1.createRoom('poker'); const rid = room.id;
      await u2.join(rid);
      const page = await openPage(ctx, u1); await gotoRoom(page, rid); await table(page).waitFor();
      await startViaUi(page);
      await waitFor(async () => (await u1.state(rid)).poker?.handNumber >= 1, { timeout: 15000 });
      const s1 = (await u1.state(rid)).poker.you.seat;
      const s2 = (await u2.state(rid)).poker.you.seat;
      const suits = {}; const cardErrs = []; const cardObs = []; let checked = 0;
      let cp3 = null;
      const deadline = Date.now() + 3 * 60000;
      while (Date.now() < deadline && Object.keys(suits).length < 4) {
        const p = (await u1.state(rid)).poker;
        if (!p || p.stage === 'complete' || p.toActSeat == null) { await sleep(400); continue; }
        if (p.toActSeat === s1) {
          const s = await waitSync(page, u1, rid);
          const P = s.st.poker;
          const mine = P.seats.find((x) => x.seat === s1).holeCards || [];
          const apiLabels = [...mine, ...P.board].map(cardLabel);
          const faces = await cardFaces(page);
          for (const f of faces) {
            if (f.where === 'other') continue;
            const e = judgeCard(f, apiLabels);
            checked++;
            suits[f.label.slice(0, 2)] = (suits[f.label.slice(0, 2)] || 0) + 1;
            if (e.length) cardErrs.push(`${f.label}: ${e.join(',')}`);
            if (cardObs.length < 30) cardObs.push(`${f.label}[${f.where}] rank=${f.rankText} rc=${f.rankColor} sc=${f.suitColor}`);
          }
          const myUi = faces.filter((f) => f.where === 'me').map((f) => f.label).sort();
          if (!cp3 && P.stage === 'preflop') {
            const inf = await tableInfo(page);
            const other = inf.seats.find((x) => x.n === s2);
            const t = inf.table; const bd = inf.board ? Math.hypot(inf.board.cx - t.cx, inf.board.cy - t.cy) : Infinity;
            cp3 = {
              ok: JSON.stringify(myUi) === JSON.stringify(mine.map(cardLabel).sort()) && other?.cards.length === 2 && other.cards.every((c) => c === '牌背') && bd < Math.min(t.w, t.h) / 4,
              obs: `mine ui=${myUi} api=${mine.map(cardLabel)}; U2 seat cards=${other?.cards}; board dist=${bd.toFixed(0)} lim=${(Math.min(t.w, t.h) / 4).toFixed(0)}`,
            };
            await ctx.shot(page, 'cp3-preflop');
          }
          if (P.board.length >= 3 && checked < 12) await ctx.shot(page, `board-${P.handNumber}-${P.board.length}`);
          await uiAct(page, P.you.legal.check ? '过牌' : '跟注');
        } else if (p.toActSeat === s2) {
          const lg = (await u2.state(rid)).poker.you.legal;
          if (lg) await u2.action(rid, lg.check ? 'check' : 'call');
        }
        await sleep(300);
      }
      ctx.check('1 每张牌以图形显示，名称与接口给出的花色、点数一致', checked > 0 && cardErrs.filter((e) => /label|graphic|no rank/.test(e)).length === 0, `checked=${checked}; errs=${cardErrs.join(' ; ')}; ${cardObs.slice(0, 12).join(' ; ')}`);
      ctx.check('2 红桃、方块为红色，黑桃、梅花为深色，点数 10 显示为“10”', checked > 0 && cardErrs.length === 0, `errs=${cardErrs.join(' ; ') || 'none'}; ${cardObs.join(' ; ')}`);
      ctx.check('3 摊牌前 U1 看到自己的底牌为正面、U2 的底牌为牌背，公共牌在牌桌中央', !!cp3?.ok, cp3?.obs || 'no preflop observation');
      if (Object.keys(suits).length >= 4) ctx.check('4 多手牌中累计看到的牌覆盖四种花色且都满足检查点 1、2', cardErrs.length === 0, `suits=${JSON.stringify(suits)}`);
      else ctx.log(`cp4 NOT REPORTED: suits within 3 min = ${JSON.stringify(suits)}`);

      // cp5: U2 folds
      const ft = await waitFor(async () => { const p = (await u2.state(rid)).poker; return p.toActSeat === s2 && p.stage !== 'complete' && p.you.legal ? p : null; }, { timeout: 60000, interval: 300 });
      if (!ft) {
        // make it U2's turn by U1 acting via UI
        const p = (await u1.state(rid)).poker;
        if (p.toActSeat === s1) await uiAct(page, p.you.legal.check ? '过牌' : '跟注');
      }
      const ft2 = ft || await waitFor(async () => { const p = (await u2.state(rid)).poker; return p.toActSeat === s2 && p.you.legal ? p : null; }, { timeout: 60000 });
      const fr = await u2.action(rid, 'fold');
      const hid = ft2?.handId;
      await sleep(300);
      let after = null;
      await waitFor(async () => { const inf = await tableInfo(page); after = inf; return inf.anim === 'idle' && /弃牌/.test(inf.seats.find((x) => x.n === s2)?.text || ''); }, { timeout: 10000 });
      const still = (await u1.state(rid)).poker.handId === hid;
      await ctx.shot(page, 'cp5-fold');
      const os = after?.seats.find((x) => x.n === s2);
      ctx.check('5 U2 弃牌后 U1 页面上 U2 座位不再显示底牌', fr.status === 200 && !!os && os.cards.length === 0, `fold=${fr.status} sameHandStill=${still} U2 seat: ${os?.text} cards=${JSON.stringify(os?.cards)}`);
    },
  },
  {
    id: 'TS-28', group: 'B', limitMinutes: 5,
    async run(ctx) {
      const u1 = await ctx.reg('h'); const u2 = await ctx.reg('p');
      const room = await u1.createRoom('poker'); const rid = room.id;
      await u2.join(rid);
      const page = await openPage(ctx, u1); await gotoRoom(page, rid); await table(page).waitFor();
      await sleep(1000);
      await installRecorder(page);
      await startViaUi(page);
      await waitFor(async () => (await u1.state(rid)).poker?.handNumber >= 1, { timeout: 15000 });
      await waitFor(async () => (await page.evaluate(() => window.__fr.length)) > 0, { timeout: 10000 });
      await waitTableIdle(page); await sleep(300);
      const finalDeal = await page.evaluate(() => window.__snap());
      const dealFrames = await page.evaluate(() => window.__fr.splice(0));
      const s1 = (await u1.state(rid)).poker.you.seat;
      // finish preflop round: U1 (SB/dealer) calls via UI; U2 checks via API
      const p0 = (await u1.state(rid)).poker;
      if (p0.toActSeat === s1) await uiAct(page, p0.you.legal.check ? '过牌' : '跟注');
      await waitFor(async () => (await u2.state(rid)).poker.toActSeat !== s1, { timeout: 10000 });
      await sleep(1000);
      const lg2 = (await u2.state(rid)).poker.you.legal;
      await u2.action(rid, lg2?.check ? 'check' : 'call');
      await waitFor(async () => (await page.evaluate(() => window.__fr.length)) > 0, { timeout: 10000 });
      await sleep(300); await waitTableIdle(page); await sleep(300);
      const finalFlop = await page.evaluate(() => window.__snap());
      const flopFrames = await page.evaluate(() => window.__fr.splice(0));
      ctx.saveJson('frames', { dealAnims: [...new Set(dealFrames.map((f) => f.a))], flopAnims: [...new Set(flopFrames.map((f) => f.a))], dealSample: dealFrames.slice(0, 3), flopSample: flopFrames.filter((_, i) => i % 5 === 0).slice(0, 12), finalDeal, finalFlop });
      await ctx.shot(page, 'after-flop');

      // cp1 dealing: some hole card between table center and its final seat position
      const dealing = dealFrames.filter((f) => f.a === 'dealing');
      let mid1 = null;
      for (const f of dealing) {
        for (const s of f.seats) {
          const fs = finalDeal.seats.find((x) => x.l === s.l); if (!fs) continue;
          s.cards.forEach((c, i) => {
            const fc = fs.cards[i]; if (!fc || mid1) return;
            if (Math.hypot(c[0] - fc[0], c[1] - fc[1]) > 4 && between(c, f.tc, fc, 40)) mid1 = `${s.l} card${i} at ${c.map(Math.round)} final ${fc.map(Math.round)} center ${f.tc.map(Math.round)}`;
          });
        }
      }
      ctx.check('1 开始一手：出现 dealing，期间采到底牌位于牌桌中心与座位之间的一帧', dealing.length > 0 && !!mid1, `dealingFrames=${dealing.length} anims=${[...new Set(dealFrames.map((f) => f.a))]} mid=${mid1}`);

      // cp2 collecting: a chip between a seat and the pot
      const coll = flopFrames.filter((f) => f.a === 'collecting');
      let mid2 = null;
      for (const f of coll) {
        if (mid2 || !f.pot) continue;
        for (const ch of f.chips) {
          if (ch.inBet) continue;
          for (const s of f.seats) if (!mid2 && between(ch.c, s.c, f.pot, 60) && Math.hypot(ch.c[0] - f.pot[0], ch.c[1] - f.pot[1]) > 8) mid2 = `chip(${ch.cls}) at ${ch.c.map(Math.round)} seat ${s.l} ${s.c.map(Math.round)} pot ${f.pot.map(Math.round)}`;
        }
      }
      ctx.check('2 一轮下注结束：出现 collecting，期间采到筹码在座位与底池之间的一帧', coll.length > 0 && !!mid2, `collectingFrames=${coll.length} anims=${[...new Set(flopFrames.map((f) => f.a))]} mid=${mid2}`);

      // cp3 revealing: a board card mid-flip (transform/opacity) or not at final position
      const rev = flopFrames.filter((f) => f.a === 'revealing');
      let mid3 = null;
      for (const f of rev) {
        for (const b of f.board) {
          const fb = finalFlop.board.find((x) => x.l === b.l);
          const off = fb ? Math.hypot(b.c[0] - fb.c[0], b.c[1] - fb.c[1]) : 0;
          if (!mid3 && ((b.tf && b.tf !== 'none' && b.tf !== 'matrix(1, 0, 0, 1, 0, 0)') || Number(b.op) < 1 || off > 2)) mid3 = `${b.l} tf=${b.tf} op=${b.op} off=${off.toFixed(1)}`;
        }
      }
      ctx.check('3 翻开公共牌：出现 revealing，期间采到公共牌处于翻面过程中的一帧', rev.length > 0 && !!mid3 && finalFlop.board.length === 3, `revealingFrames=${rev.length} mid=${mid3} finalBoard=${finalFlop.board.map((b) => b.l)}`);
    },
  },
  {
    id: 'TS-29', group: 'B', limitMinutes: 5,
    async run(ctx) {
      const u1 = await ctx.reg('h'); const u2 = await ctx.reg('p');
      const room = await u1.createRoom('poker'); const rid = room.id;
      await u2.join(rid);
      const page = await openPage(ctx, u1); await gotoRoom(page, rid); await table(page).waitFor();
      await startViaUi(page);
      await waitFor(async () => (await u1.state(rid)).poker?.handNumber >= 1, { timeout: 15000 });
      const s1 = (await u1.state(rid)).poker.you.seat;
      const s2 = (await u2.state(rid)).poker.you.seat;
      const area = async () => {
        const a = actArea(page);
        const r = { active: await a.getAttribute('data-active') };
        for (const n of ['弃牌', '过牌', '跟注', '加注']) { const b = actBtn(page, n); r[n] = { en: await b.isEnabled(), text: (await b.textContent()).trim() }; }
        return r;
      };
      const fmt = (r) => `active=${r.active} ${['弃牌', '过牌', '跟注', '加注'].map((n) => `${r[n].text}:${r[n].en ? '可用' : '不可用'}`).join(' ')}`;

      // Row 2: U1 to act preflop facing big blind
      const st2 = await waitTurn(u1, rid, s1, 30000);
      await waitSync(page, u1, rid);
      const a2 = await area(); const L2 = st2.poker.you.legal;
      await ctx.shot(page, 'row2');
      ctx.check('判定表第 2 行：轮到 U1 需要跟注时操作区高亮，弃牌、跟注（显示需跟金额）、加注可用，过牌不可用，与接口一致',
        a2.active === 'true' && a2.弃牌.en && !a2.过牌.en && a2.跟注.en && num(a2.跟注.text) === L2.callAmount && a2.加注.en
        && a2.弃牌.en === L2.fold && a2.过牌.en === L2.check && a2.跟注.en === L2.call && a2.加注.en === (L2.raise || L2.bet),
        `${fmt(a2)}; legal=${JSON.stringify(L2)}`);

      // Row 1: after U1 calls, U2's turn
      await uiAct(page, '跟注');
      await waitTurn(u2, rid, s2, 15000);
      const sync1 = await waitSync(page, u1, rid);
      const a1 = await area();
      await ctx.shot(page, 'row1');
      ctx.check('判定表第 1 行：不是 U1 的回合时操作区不高亮，四个按钮都不可用',
        sync1.ok && a1.active === 'false' && !a1.弃牌.en && !a1.过牌.en && !a1.跟注.en && !a1.加注.en && !sync1.st.poker.you.legal,
        `${fmt(a1)}; api toAct=${sync1.st.poker.toActSeat} legal=${JSON.stringify(sync1.st.poker.you.legal)}`);
      const v0 = (await u1.state(rid)).version;
      for (const n of ['弃牌', '过牌', '跟注', '加注']) await actBtn(page, n).click({ force: true, timeout: 3000 }).catch((e) => ctx.log(`force click ${n}: ${e.message.split('\n')[0]}`));
      await sleep(1500);
      const v1 = (await u1.state(rid)).version;
      ctx.check('不可用按钮：强制点击后牌桌状态版本没有变化', v0 === v1, `version before=${v0} after=${v1}`);

      // Row 3: flop, no bet, U1 to act
      const lgU2 = (await u2.state(rid)).poker.you.legal;
      await u2.action(rid, lgU2.check ? 'check' : 'call');
      let st3 = await waitFor(async () => { const s = await u1.state(rid); return s.poker.stage === 'flop' ? s : null; }, { timeout: 15000 });
      if (st3 && st3.poker.toActSeat === s2) { await sleep(1500); await u2.action(rid, 'check'); }
      st3 = await waitFor(async () => { const s = await u1.state(rid); return s.poker.stage === 'flop' && s.poker.toActSeat === s1 ? s : null; }, { timeout: 15000 });
      await waitSync(page, u1, rid);
      const a3 = await area(); const L3 = st3?.poker.you.legal;
      await ctx.shot(page, 'row3');
      ctx.check('判定表第 3 行：轮到 U1 且无人下注时操作区高亮，过牌、加注可用，跟注不可用，弃牌按接口',
        !!L3 && a3.active === 'true' && a3.过牌.en && !a3.跟注.en && a3.加注.en && a3.弃牌.en === L3.fold && a3.过牌.en === L3.check && a3.跟注.en === L3.call && a3.加注.en === (L3.raise || L3.bet),
        `${fmt(a3)}; legal=${JSON.stringify(L3)}`);

      // Submission not accepted: U1 checks, U2 bets, U1 clicks call (held), U1 folds on another page, release.
      await uiAct(page, '过牌');
      await waitTurn(u2, rid, s2, 15000); await sleep(800);
      const br = await u2.action(rid, 'bet', 10); ctx.log(`u2 bet ${br.status}`);
      await waitTurn(u1, rid, s1, 15000);
      await waitSync(page, u1, rid);
      let held = null; let release; const relP = new Promise((r) => { release = r; });
      await page.route('**/poker/action', async (route) => { held = route.request().postData(); await relP; await route.continue(); });
      const respP = page.waitForResponse((r) => r.url().includes('/poker/action'), { timeout: 30000 }).catch(() => null);
      await actBtn(page, '跟注').click();
      await waitFor(() => held, { timeout: 5000 });
      const pageB = await openPage(ctx, u1); await gotoRoom(pageB, rid); await table(pageB).waitFor();
      await uiAct(pageB, '弃牌');
      await waitFor(async () => (await u1.state(rid)).poker.seats.find((s) => s.seat === s1).folded || (await u1.state(rid)).poker.handNumber > st3.poker.handNumber, { timeout: 10000 });
      const handAfterFold = (await u1.state(rid)).poker;
      release();
      const resp = await respP;
      ctx.log(`held body=${held} resp=${resp?.status()}`);
      await sleep(700);
      const msgs = await page.evaluate(() => [...document.querySelectorAll('[role="alert"],[role="status"][aria-label="操作提示"]')].map((e) => e.textContent.trim()).filter(Boolean));
      await ctx.shot(page, 'rejected');
      const stNow = (await u1.state(rid)).poker;
      const inf = await tableInfo(page);
      const myUi = inf.seats.find((x) => x.n === s1);
      const sameHand = stNow.handId === handAfterFold.handId;
      const apiFolded = stNow.seats.find((s) => s.seat === s1)?.folded;
      const uiConsistent = sameHand ? (apiFolded && /弃牌/.test(myUi?.text || '') && num(inf.pot?.text) === stNow.pot) : (num(inf.pot?.text) === stNow.pot);
      ctx.check('提交未被接受：第一个页面用中文显示原因，并显示最新牌桌状态（U1 已弃牌），与接口一致',
        resp && resp.status() >= 400 && msgs.some((m) => /[\u4e00-\u9fff]/.test(m)) && handAfterFold.seats.find((s) => s.seat === s1).folded && uiConsistent,
        `resp=${resp?.status()} msgs=${JSON.stringify(msgs)} apiFolded=${apiFolded} sameHand=${sameHand} uiSeat=${myUi?.text} uiPot=${inf.pot?.text} apiPot=${stNow.pot}`);
    },
  },
];
