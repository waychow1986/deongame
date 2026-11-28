import { expect, test, type Page } from '@playwright/test';
import type { PokerView } from '../src/shared/protocol.js';
import { actionArea, close, pokerRoom, pokerState, table } from './support/poker.js';
import { newUser } from './support/users.js';

type Box = { x: number; y: number; width: number; height: number };
const center = (b: Box) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

async function startHand(page: Page): Promise<void> {
  await page.getByRole('button', { name: '开始牌局' }).click();
  await expect(page.getByRole('status', { name: '底池' })).toHaveText('底池：15');
}

test('牌桌：椭圆绿色牌桌、自己在下方、标记靠近对应座位、底池在中央、牌为图形', async ({ browser }) => {
  const { players, roomId } = await pokerRoom(browser, ['tb1', 'tb2', 'tb3'], 6);
  const [u1, u2, u3] = players as [(typeof players)[0], (typeof players)[0], (typeof players)[0]];
  await u1.page.getByRole('button', { name: '添加电脑玩家' }).click();
  await u1.page.getByRole('button', { name: '开始牌局' }).click();
  // The computer player (first to act) may already have acted; after it the turn is U1's, so the table settles.
  await expect.poll(async () => (await pokerState(u1.page, roomId)).toActSeat).toBe(0);
  const pot = (await pokerState(u1.page, roomId)).pot;

  for (const u of [u1, u2, u3]) {
    const t = table(u.page);
    await expect(u.page.getByRole('status', { name: '底池' })).toHaveText(`底池：${pot}`);
    await expect(t.locator('[data-seat]')).toHaveCount(4);
    // Measure once the deal animation has finished (cards fly out from the centre).
    await expect(t).toHaveAttribute('data-anim', 'idle');
    const tb = (await t.boundingBox()) as Box;
    const tc = center(tb);

    // Oval: corners are outside the felt, the middle is green.
    const shot = await u.page.screenshot({ clip: tb });
    const px = await u.page.evaluate(async (b64) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext('2d') as CanvasRenderingContext2D;
      ctx.drawImage(img, 0, 0);
      const at = (x: number, y: number) => Array.from(ctx.getImageData(x, y, 1, 1).data.slice(0, 3));
      return { corner: at(2, 2), mid: at(Math.floor(img.width / 2), Math.floor(img.height / 2)) };
    }, shot.toString('base64'));
    const [r, g, b] = px.mid as [number, number, number];
    expect(g).toBeGreaterThan(r);
    expect(g).toBeGreaterThan(b);
    expect(px.corner).not.toEqual(px.mid);

    // Own seat at the bottom centre.
    const me = t.locator('[data-seat][data-me="true"]');
    await expect(me).toHaveCount(1);
    const mc = center((await me.boundingBox()) as Box);
    expect(mc.y).toBeGreaterThan(tc.y);
    expect(Math.abs(mc.x - tc.x)).toBeLessThan(tb.width * 0.15);

    // Markers sit beside the right seats.
    const state = await pokerState(u.page, roomId);
    const seatCenters = new Map<number, { x: number; y: number }>();
    for (const s of state.seats) {
      seatCenters.set(s.seat, center((await t.locator(`[data-seat="${s.seat}"]`).boundingBox()) as Box));
    }
    for (const [name, flag] of [
      ['庄家', 'isDealer'],
      ['小盲', 'isSmallBlind'],
      ['大盲', 'isBigBlind'],
    ] as const) {
      const marker = t.getByRole('img', { name, exact: true });
      await expect(marker).toHaveCount(1);
      const m = center((await marker.boundingBox()) as Box);
      const owner = state.seats.find((s) => s[flag])?.seat as number;
      const nearest = [...seatCenters].sort((a, b2) => dist(a[1], m) - dist(b2[1], m))[0]?.[0];
      expect(nearest).toBe(owner);
    }

    // Pot near the centre.
    const potCenter = center((await u.page.getByRole('status', { name: '底池' }).boundingBox()) as Box);
    expect(dist(potCenter, tc)).toBeLessThan(Math.min(tb.width, tb.height) / 4);

    // Own hole cards face up and named like the API; others as 牌背.
    const mine = state.seats.find((s) => s.userId && s.holeCards)?.holeCards as string[];
    const myCards = me.locator('[role="img"][data-card]');
    await expect(myCards).toHaveCount(2);
    expect(await myCards.evaluateAll((els) => els.map((e) => e.getAttribute('data-card')))).toEqual(mine);
    const othersInHand = state.seats.filter((s) => s.seat !== state.you.seat && s.inHand && !s.folded).length;
    await expect(t.locator('[data-seat][data-me="false"]').getByRole('img', { name: '牌背' })).toHaveCount(othersInHand * 2);
    await expect(t.locator('[data-seat][data-me="false"] [data-card]')).toHaveCount(0);
  }

  // Bot seat is labelled.
  await expect(table(u1.page).getByRole('region', { name: '座位 4：电脑 1' })).toContainText('电脑');
  await close(players);
});

test('操作区：不是自己回合时不可用，轮到自己时显示跟注金额；快捷金额与范围提示', async ({ browser }) => {
  const { players, roomId } = await pokerRoom(browser, ['ta1', 'ta2']);
  const [u1, u2] = players as [(typeof players)[0], (typeof players)[0]];
  await startHand(u1.page);

  // Heads-up: U1 is dealer / small blind and acts first preflop.
  const bar2 = actionArea(u2.page);
  await expect(bar2).toHaveAttribute('data-active', 'false');
  for (const name of ['弃牌', '过牌', '跟注', '加注']) {
    await expect(bar2.getByRole('button', { name, exact: true })).toBeDisabled();
  }

  const bar = actionArea(u1.page);
  await expect(bar).toHaveAttribute('data-active', 'true');
  await expect(bar.getByRole('button', { name: '弃牌' })).toBeEnabled();
  await expect(bar.getByRole('button', { name: '过牌' })).toBeDisabled();
  await expect(bar.getByRole('button', { name: '跟注 5' })).toBeEnabled();
  await expect(bar.getByRole('button', { name: '加注' })).toBeEnabled();

  const st = await pokerState(u1.page, roomId);
  const legal = st.you.legal as NonNullable<typeof st.you.legal>;
  const slider = bar.getByRole('slider', { name: '加注金额' });
  await expect(slider).toHaveAttribute('min', String(legal.minRaiseTo));
  await expect(slider).toHaveAttribute('max', String(legal.maxRaiseTo));

  // TD-019: committed 5 + call 5 + round(ratio × (15 + 5)).
  const amount = bar.getByRole('spinbutton', { name: '金额' });
  await bar.getByRole('button', { name: '半个底池' }).click();
  await expect(amount).toHaveValue('20');
  await bar.getByRole('button', { name: '一个底池' }).click();
  await expect(amount).toHaveValue('30');
  await bar.getByRole('button', { name: '最大' }).click();
  await expect(amount).toHaveValue(String(legal.maxRaiseTo));

  await amount.fill(String(legal.minRaiseTo - 1));
  await expect(bar.getByRole('alert')).toContainText(`${legal.minRaiseTo}`);
  await expect(bar.getByRole('alert')).toContainText(`${legal.maxRaiseTo}`);
  await expect(bar.getByRole('button', { name: '加注' })).toBeDisabled();
  await amount.fill(String(legal.minRaiseTo));
  await expect(bar.getByRole('alert')).toHaveCount(0);

  // TS-34: U1 folds, U2 wins without any hole card being revealed.
  await bar.getByRole('button', { name: '弃牌' }).click();
  for (const u of [u1, u2]) {
    const result = u.page.getByRole('status', { name: '本手结果' });
    await expect(result).toContainText(`${u2.username} 赢得底池 15`);
    await expect(table(u.page).locator('[data-seat][data-me="false"] [data-card]')).toHaveCount(0);
  }
  await close(players);
});

test('摊牌：双方底牌翻开，高亮赢家的五张牌，显示牌型与赢得筹码', async ({ browser }) => {
  const { players, roomId } = await pokerRoom(browser, ['ts1', 'ts2']);
  const [u1, u2] = players as [(typeof players)[0], (typeof players)[0]];
  await startHand(u1.page);
  const handNumber = (await pokerState(u1.page, roomId)).handNumber;
  // The action that ends the hand answers with the showdown snapshot (the next hand starts shortly after).
  let final: PokerView | null = null;
  for (const u of [u1, u2]) {
    u.page.on('response', async (res) => {
      if (!res.url().endsWith('/poker/action') || res.status() !== 200) return;
      const p = ((await res.json()) as { room: { poker: PokerView } }).room.poker;
      if (p.handNumber === handNumber && p.winners.length > 0) final = p;
    });
  }
  // Record what the page shows the moment the result appears.
  await u1.page.evaluate(() => {
    const w = window as unknown as { __shown: unknown };
    const sample = () => {
      const res = document.querySelector('[aria-label="本手结果"]');
      if (res && document.querySelectorAll('[data-highlight="true"]').length > 0) {
        w.__shown = {
          faces: document.querySelectorAll('[data-seat] [data-card]').length,
          highlighted: [...document.querySelectorAll('[data-highlight="true"]')].map((e) => e.getAttribute('data-card')),
          text: res.textContent ?? '',
          cards: [...document.querySelectorAll('.poker-table [data-card]')].map((e) => {
            const path = e.querySelector('svg.pc-suit path');
            const rank = e.querySelector('.pc-rank');
            return {
              card: e.getAttribute('data-card'),
              color: getComputedStyle(e).color,
              suitFill: path ? getComputedStyle(path).fill : null,
              suitSize: path ? path.getBoundingClientRect().width : 0,
              rank: rank?.textContent ?? '',
              rankColor: rank ? getComputedStyle(rank).color : null,
            };
          }),
        };
        return;
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });

  // Check / call down to showdown.
  for (let i = 0; i < 12; i += 1) {
    const st = await pokerState(u1.page, roomId);
    if (st.handNumber !== handNumber || st.winners.length > 0) break;
    const actor = [u1, u2].find((u) => st.seats.find((s) => s.seat === st.toActSeat)?.name === u.username);
    if (!actor) break;
    const bar = actionArea(actor.page);
    await expect(bar).toHaveAttribute('data-active', 'true');
    const check = bar.getByRole('button', { name: '过牌' });
    if (await check.isEnabled()) await check.click();
    else await bar.getByRole('button', { name: /^跟注/ }).click();
    await expect
      .poll(async () => {
        const next = await pokerState(u1.page, roomId);
        return next.handNumber !== handNumber || next.actions.length > st.actions.length;
      })
      .toBe(true);
  }

  await expect.poll(() => u1.page.evaluate(() => (window as unknown as { __shown?: unknown }).__shown)).toBeTruthy();
  const shown = (await u1.page.evaluate(() => (window as unknown as { __shown: unknown }).__shown)) as {
    faces: number;
    highlighted: string[];
    text: string;
    cards: { card: string; color: string; suitFill: string | null; suitSize: number; rank: string; rankColor: string | null }[];
  };
  expect(shown.faces).toBe(4);

  // AC-28: exactly the winners' best five cards are highlighted, and the hand name and amount are shown.
  await expect.poll(() => final).not.toBeNull();
  const result = final as unknown as PokerView;
  const winnerSeats = new Set(result.winners.map((w) => w.seat));
  const expected = new Set(result.showdown.filter((s) => winnerSeats.has(s.seat)).flatMap((s) => s.bestCards));
  expect(expected.size).toBeGreaterThanOrEqual(5);
  expect(new Set(shown.highlighted)).toEqual(expected);
  for (const w of result.winners) {
    const label = result.showdown.find((s) => s.seat === w.seat)?.handLabel as string;
    expect(label).toBeTruthy();
    expect(shown.text).toContain(`${w.name} ${label} 赢得 ${w.amount}`);
  }

  // AC-22: every face shows a suit graphic in the card's colour; hearts / diamonds red, spades / clubs dark.
  expect(shown.cards).toHaveLength(9);
  const rgb = (c: string | null) => (c?.match(/\d+/g) ?? []).slice(0, 3).map(Number) as [number, number, number];
  for (const c of shown.cards) {
    expect(c.suitSize, c.card).toBeGreaterThan(0);
    expect(c.suitFill, c.card).toBe(c.color);
    expect(c.rankColor, c.card).toBe(c.color);
    expect(c.rank, c.card).toBe(c.card[0] === 'T' ? '10' : c.card[0]);
    const [r, g, b] = rgb(c.color);
    if (c.card[1] === 'h' || c.card[1] === 'd') {
      expect(r - g, c.card).toBeGreaterThan(80);
      expect(r - b, c.card).toBeGreaterThan(80);
    } else {
      expect(Math.max(r, g, b), c.card).toBeLessThanOrEqual(80);
    }
  }
  await close(players);
});

test('动画：开始一手时牌桌进入发牌动画，底牌途经牌桌中心与座位之间', async ({ browser }) => {
  const { players } = await pokerRoom(browser, ['tn1', 'tn2']);
  const [u1] = players as [(typeof players)[0]];
  await u1.page.evaluate(() => {
    const w = window as unknown as { __anims: string[]; __midFrame: boolean };
    w.__anims = [];
    w.__midFrame = false;
    const t = document.querySelector('.poker-table') as HTMLElement;
    new MutationObserver(() => {
      const a = t.getAttribute('data-anim');
      if (a) w.__anims.push(a);
    }).observe(t, { attributes: true, attributeFilter: ['data-anim'] });
    const sample = () => {
      if (t.getAttribute('data-anim') === 'dealing') {
        for (const c of t.querySelectorAll('[data-anim-card="hole"]')) {
          if (getComputedStyle(c).transform !== 'none') w.__midFrame = true;
        }
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await startHand(u1.page);
  await expect
    .poll(() => u1.page.evaluate(() => (window as unknown as { __anims: string[] }).__anims))
    .toContain('dealing');
  expect(await u1.page.evaluate(() => (window as unknown as { __midFrame: boolean }).__midFrame)).toBe(true);
  await close(players);
});

test('动画：一轮下注结束时筹码推入底池，翻开公共牌时有翻牌过程', async ({ browser }) => {
  const { players } = await pokerRoom(browser, ['tc1', 'tc2']);
  const [u1, u2] = players as [(typeof players)[0], (typeof players)[0]];
  await startHand(u1.page);
  await expect(table(u1.page)).toHaveAttribute('data-anim', 'idle');
  await u1.page.evaluate(() => {
    const w = window as unknown as { __anims: string[]; __chipMid: boolean; __revealMid: boolean };
    w.__anims = [];
    w.__chipMid = false;
    w.__revealMid = false;
    const t = document.querySelector('.poker-table') as HTMLElement;
    new MutationObserver(() => {
      const a = t.getAttribute('data-anim');
      if (a) w.__anims.push(a);
    }).observe(t, { attributes: true, attributeFilter: ['data-anim'] });
    const centre = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    };
    const sample = () => {
      const phase = t.getAttribute('data-anim');
      if (phase === 'collecting') {
        const pot = centre(t.querySelector('[data-pot-anchor]') as Element);
        for (const chip of t.querySelectorAll('[data-flying-chip]')) {
          const anchor = t.querySelector(`[data-bet-anchor="${chip.getAttribute('data-flying-chip')}"]`) as Element;
          const from = centre(anchor);
          const c = centre(chip);
          if (Math.hypot(c.x - from.x, c.y - from.y) > 3 && Math.hypot(c.x - pot.x, c.y - pot.y) > 3) w.__chipMid = true;
        }
      }
      if (phase === 'revealing') {
        for (const c of t.querySelectorAll('[data-anim-card="board"]')) {
          if (getComputedStyle(c).transform !== 'none') w.__revealMid = true;
        }
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });

  // Heads-up preflop: U1 (small blind) calls, U2 checks — the bets go to the pot and the flop is dealt.
  await actionArea(u1.page).getByRole('button', { name: '跟注 5' }).click();
  const bar2 = actionArea(u2.page);
  await expect(bar2).toHaveAttribute('data-active', 'true');
  await bar2.getByRole('button', { name: '过牌' }).click();

  await expect
    .poll(() => u1.page.evaluate(() => (window as unknown as { __anims: string[] }).__anims))
    .toEqual(expect.arrayContaining(['collecting', 'revealing']));
  await expect(table(u1.page)).toHaveAttribute('data-anim', 'idle');
  const seen = await u1.page.evaluate(() => {
    const w = window as unknown as { __anims: string[]; __chipMid: boolean; __revealMid: boolean };
    return { anims: w.__anims, chipMid: w.__chipMid, revealMid: w.__revealMid };
  });
  expect(seen.anims.indexOf('collecting')).toBeLessThan(seen.anims.indexOf('revealing'));
  expect(seen.chipMid).toBe(true);
  expect(seen.revealMid).toBe(true);
  await expect(table(u1.page).getByRole('region', { name: '公共牌' }).locator('[data-card]')).toHaveCount(3);
  await close(players);
});

test('座位高亮与状态：轮到谁该座位在所有人页面高亮，弃牌与等待下一手', async ({ browser }) => {
  const { players, roomId, roomPath } = await pokerRoom(browser, ['tq1', 'tq2', 'tq3']);
  const pages = players.map((p) => p.page);
  const host = pages[0] as Page;
  await startHand(host);

  const expectActing = async (on: Page[], acting: number) => {
    const st = await pokerState(host, roomId);
    for (const page of on) {
      for (const s of st.seats) {
        const seat = table(page).locator(`[data-seat="${s.seat}"]`);
        await expect(seat).toHaveAttribute('data-acting', s.seat === acting ? 'true' : 'false');
        if (s.seat === acting) await expect(seat).toContainText('行动中');
      }
    }
  };
  const ring = (page: Page, seat: number) =>
    table(page)
      .locator(`[data-seat="${seat}"] .seat-info`)
      .evaluate((e) => `${getComputedStyle(e).borderColor} ${getComputedStyle(e).boxShadow}`);

  const first = (await pokerState(host, roomId)).toActSeat as number;
  await expectActing(pages, first);
  const actingStyle = await ring(host, first);

  // The player to act folds: the highlight moves on for everybody and the seat shows 弃牌.
  const st = await pokerState(host, roomId);
  const actor = players.find((p) => st.seats.find((s) => s.seat === first)?.name === p.username) as (typeof players)[0];
  await actionArea(actor.page).getByRole('button', { name: '弃牌' }).click();
  await expect.poll(async () => (await pokerState(host, roomId)).toActSeat).not.toBe(first);
  const second = (await pokerState(host, roomId)).toActSeat as number;
  expect(second).not.toBeNull();
  await expectActing(pages, second);
  for (const page of pages) await expect(table(page).locator(`[data-seat="${first}"]`)).toContainText('弃牌');
  expect(await ring(host, first)).not.toBe(actingStyle);
  expect(await ring(host, second)).toBe(actingStyle);

  // A player joining mid-hand waits for the next hand.
  const u4 = await newUser(browser, 'tq4');
  expect((await u4.page.request.post(`/api/rooms/${roomId}/join`, { data: {} })).status()).toBe(200);
  await u4.page.goto(roomPath);
  await expect(table(u4.page)).toBeVisible();
  const seat4 = (await pokerState(host, roomId)).seats.find((s) => s.name === u4.username)?.seat as number;
  for (const page of [...pages, u4.page]) {
    await expect(table(page).locator(`[data-seat="${seat4}"]`)).toContainText('等待下一手');
  }
  await close([...players, u4]);
});

test('座位筹码：余额为负时座位筹码为红色，非负时不是红色', async ({ browser }) => {
  test.setTimeout(180_000);
  const { players, roomId } = await pokerRoom(browser, ['tg1', 'tg2']);
  const [u1] = players as [(typeof players)[0]];
  await startHand(u1.page);
  const balance = async (page: Page) =>
    ((await (await page.request.get('/api/me')).json()) as { user: { chips: number } }).user.chips;

  // Data through public play (design: 造数): whoever acts goes to the hand cap, the other calls.
  let negative: (typeof players)[0] | undefined;
  for (let i = 0; i < 300 && !negative; i++) {
    const st = await pokerState(u1.page, roomId);
    const actor = players.find((p) => st.seats.find((s) => s.seat === st.toActSeat)?.name === p.username);
    const legal = actor ? (await pokerState(actor.page, roomId)).you.legal : null;
    if (actor && legal) {
      const data = legal.raise
        ? { type: 'raise', amount: legal.maxRaiseTo }
        : legal.bet
          ? { type: 'bet', amount: legal.maxRaiseTo }
          : legal.call
            ? { type: 'call' }
            : { type: 'check' };
      await actor.page.request.post(`/api/rooms/${roomId}/poker/action`, { data });
    } else {
      await u1.page.waitForTimeout(100);
    }
    for (const p of players) if ((await balance(p.page)) < 0) negative = p;
  }
  expect(negative).toBeDefined();
  const neg = negative as (typeof players)[0];
  const other = players.find((p) => p !== neg) as (typeof players)[0];
  expect(await balance(other.page)).toBeGreaterThanOrEqual(0);

  for (const page of [neg.page, other.page]) {
    const t = table(page);
    const negChips = t.getByRole('region', { name: new RegExp(`：${neg.username}$`) }).locator('[data-negative]');
    await expect(negChips).toHaveAttribute('data-negative', 'true');
    await expect(negChips).toHaveText(/筹码 -\d+/);
    await expect(negChips).toHaveCSS('color', 'rgb(214, 48, 49)');
    const okChips = t.getByRole('region', { name: new RegExp(`：${other.username}$`) }).locator('[data-negative]');
    await expect(okChips).toHaveAttribute('data-negative', 'false');
    await expect(okChips).not.toHaveCSS('color', 'rgb(214, 48, 49)');
  }
  await close(players);
});
