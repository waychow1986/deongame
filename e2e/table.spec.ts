import { expect, test, type Page } from '@playwright/test';
import { actionArea, close, pokerRoom, pokerState, table } from './support/poker.js';

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
  // The next hand starts shortly after the result, so record what the page shows the moment it appears.
  await u1.page.evaluate(() => {
    const w = window as unknown as { __shown: unknown };
    const sample = () => {
      const res = document.querySelector('[aria-label="本手结果"]');
      if (res && document.querySelectorAll('[data-highlight="true"]').length > 0) {
        w.__shown = {
          faces: document.querySelectorAll('[data-seat] [data-card]').length,
          highlighted: [...document.querySelectorAll('[data-highlight="true"]')].map((e) => e.getAttribute('data-card')),
          text: res.textContent ?? '',
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
  };
  expect(shown.faces).toBe(4);
  expect(new Set(shown.highlighted).size).toBeGreaterThanOrEqual(5);
  expect(shown.text).toMatch(/赢得 \d+/);
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
