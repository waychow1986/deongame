import { expect, test, type Browser, type Page } from '@playwright/test';
import { openRoomViaDialog } from './support/lobby.js';
import { uniqueName } from './support/users.js';
import { actionArea, pokerState } from './support/poker.js';

const WIDTHS = [360, 390, 430] as const;

async function phoneUser(browser: Browser, width: number, label: string) {
  const context = await browser.newContext({ viewport: { width, height: 860 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const username = uniqueName(label);
  const res = await page.request.post('/api/auth/register', { data: { username, password: 'pw-123456' } });
  expect(res.status()).toBe(201);
  return { context, page, username };
}

/** No horizontal scroll, and every visible button (except board intersections) is at least 44×44. */
async function checkLayout(page: Page, width: number, what: string): Promise<void> {
  const r = await page.evaluate(() => {
    const small: string[] = [];
    const outside: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>('button, [role="button"]')) {
      if (el.closest('[role="group"][aria-label="棋盘"]')) continue;
      const b = el.getBoundingClientRect();
      if (b.width === 0 && b.height === 0) continue;
      const name = el.getAttribute('aria-label') ?? el.textContent ?? '';
      if (b.width < 44 || b.height < 44) small.push(`${name} ${b.width.toFixed(0)}x${b.height.toFixed(0)}`);
      if (b.left < -0.5 || b.right > window.innerWidth + 0.5) outside.push(name);
    }
    return { scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth, small, outside };
  });
  expect(r.scrollWidth, `${what} @${width} 横向滚动`).toBeLessThanOrEqual(r.innerWidth);
  expect(r.small, `${what} @${width} 小于 44 的按钮`).toEqual([]);
  expect(r.outside, `${what} @${width} 超出视口的按钮`).toEqual([]);
}

async function inViewport(page: Page, selector: string, width: number): Promise<void> {
  const b = await page.locator(selector).first().boundingBox();
  expect(b, selector).not.toBeNull();
  if (!b) return;
  expect(b.x, selector).toBeGreaterThanOrEqual(-0.5);
  expect(b.x + b.width, selector).toBeLessThanOrEqual(width + 0.5);
}

for (const width of WIDTHS) {
  test(`手机竖屏 ${width}：登录、注册、大厅、象棋房间、扑克房间无横向滚动且按钮不小于 44`, async ({ browser }) => {
    const anon = await browser.newContext({ viewport: { width, height: 860 }, isMobile: true, hasTouch: true });
    const ap = await anon.newPage();
    for (const path of ['/login', '/register']) {
      await ap.goto(path);
      await expect(ap.locator('form')).toBeVisible();
      await inViewport(ap, 'form', width);
      await checkLayout(ap, width, path);
    }
    await anon.close();

    const u = await phoneUser(browser, width, `m${width}`);
    await u.page.goto('/lobby');
    const pokerCard = u.page.getByRole('button', { name: /^德州扑克/ });
    await expect(pokerCard).toBeVisible();
    await checkLayout(u.page, width, '大厅');

    await openRoomViaDialog(u.page, { game: 'chess', mode: 'ai' });
    await expect(u.page.getByRole('group', { name: '棋盘' })).toBeVisible();
    await inViewport(u.page, '[role="group"][aria-label="棋盘"]', width);
    await checkLayout(u.page, width, '象棋房间');
    await u.context.close();

    // The chess game keeps running, so the poker room is opened by a second phone user.
    const p = await phoneUser(browser, width, `mp${width}`);
    await p.page.goto('/lobby');
    await openRoomViaDialog(p.page, { game: 'poker' });
    await p.page.getByRole('button', { name: '添加电脑玩家' }).click();
    await p.page.getByRole('button', { name: '开始牌局' }).click();
    await expect(actionArea(p.page)).toHaveAttribute('data-active', 'true');
    await expect(p.page.getByRole('region', { name: '牌桌' })).toHaveAttribute('data-shape', 'portrait');
    await inViewport(p.page, '.poker-table', width);
    await inViewport(p.page, '[aria-label="操作区"]', width);
    await checkLayout(p.page, width, '扑克房间');
    await p.context.close();
  });
}

test('手机竖屏 360：点按完成一步象棋走棋与一次扑克行动', async ({ browser }) => {
  const u = await phoneUser(browser, 360, 'mtap');
  await u.page.goto('/lobby');
  await openRoomViaDialog(u.page, { game: 'chess', mode: 'ai' });
  const board = u.page.getByRole('group', { name: '棋盘' });
  await board.getByRole('button', { name: 'a3 红暗子' }).tap();
  await board.getByRole('button', { name: 'a4 空' }).tap();
  await expect(board.getByRole('button', { name: /^a4 红(帅|仕|相|马|车|炮|兵)$/ })).toBeVisible();
  await u.context.close();

  // The chess game is still running, so the poker tap uses a second phone user.
  const p = await phoneUser(browser, 360, 'mtap2');
  await p.page.goto('/lobby');
  await openRoomViaDialog(p.page, { game: 'poker' });
  const roomId = new URL(p.page.url()).pathname.split('/').pop() as string;
  await p.page.getByRole('button', { name: '添加电脑玩家' }).tap();
  await p.page.getByRole('button', { name: '开始牌局' }).tap();
  const bar = actionArea(p.page);
  await expect(bar).toHaveAttribute('data-active', 'true');
  const before = (await pokerState(p.page, roomId)).actions.length;
  await bar.getByRole('button', { name: '跟注 5' }).tap();
  await expect
    .poll(async () => (await pokerState(p.page, roomId)).actions.some((a, i) => i >= before && a.type === 'call'))
    .toBe(true);
  await p.context.close();
});
