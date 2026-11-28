import { expect, test, type Page } from '@playwright/test';
import { leaveRoomConfirmed, openRoomViaDialog, ROOM_URL } from './support/lobby.js';
import { newUser } from './support/users.js';

function roomRow(page: Page, host: string) {
  return page.getByRole('table', { name: '房间列表' }).getByRole('row').filter({ hasText: host });
}

test('开象棋房间，另一用户在大厅看到并加入，第三人看到已满', async ({ browser }) => {
  const alice = await newUser(browser, 'host');
  const bob = await newUser(browser, 'guest');
  const carol = await newUser(browser, 'third');

  await alice.page.goto('/lobby');
  await openRoomViaDialog(alice.page, { game: 'chess' });
  await expect(alice.page.getByRole('heading', { name: '中国象棋房间' })).toBeVisible();
  await expect(alice.page).toHaveURL(ROOM_URL);
  const roomPath = new URL(alice.page.url()).pathname;
  await alice.page.goto(roomPath);
  await expect(alice.page.getByRole('heading', { name: '中国象棋房间' })).toBeVisible();
  await expect(alice.page).toHaveURL(ROOM_URL);

  await bob.page.goto('/lobby');
  const row = roomRow(bob.page, alice.username);
  await expect(row).toContainText('中国象棋·盲棋');
  await expect(row).toContainText('1/2');
  await expect(row).toContainText('等待中');
  await row.getByRole('button', { name: '加入' }).click();
  await expect(bob.page.getByRole('heading', { name: '中国象棋房间' })).toBeVisible();
  expect(new URL(bob.page.url()).pathname).toBe(roomPath);
  await expect(bob.page.getByRole('status', { name: '对局状态' })).toContainText('你执黑');
  await expect(alice.page.getByRole('status', { name: '对局状态' })).toContainText('你执红');
  await expect(alice.page.getByRole('status', { name: '对局状态' })).toContainText('轮到你走棋');

  await carol.page.goto('/lobby');
  const fullRow = roomRow(carol.page, alice.username);
  await expect(fullRow).toContainText('2/2');
  await expect(fullRow).toContainText('已满员');
  await expect(fullRow.getByRole('button', { name: '加入' })).toBeDisabled();

  await leaveRoomConfirmed(bob.page);
  await expect(bob.page.getByRole('heading', { name: '游戏大厅' })).toBeVisible();
  const aliceResult = alice.page.getByRole('dialog', { name: '对局结果' });
  await expect(aliceResult.getByRole('button', { name: '回到大厅' })).toBeVisible();
  await aliceResult.getByRole('button', { name: '回到大厅' }).click();
  await expect(alice.page.getByRole('heading', { name: '游戏大厅' })).toBeVisible();

  // The lobby list refreshes itself (TD-004), so no manual refresh is needed.
  await expect(roomRow(carol.page, alice.username)).toHaveCount(0);

  for (const u of [alice, bob, carol]) await u.context.close();
});

test('未登录直接打开房间页面被带到登录页', async ({ page, browser }) => {
  const alice = await newUser(browser, 'rhost');
  await alice.page.goto('/lobby');
  await openRoomViaDialog(alice.page, { game: 'poker' });
  await expect(alice.page).toHaveURL(ROOM_URL);

  await page.goto(new URL(alice.page.url()).pathname);
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('button', { name: '登录' })).toBeVisible();

  await leaveRoomConfirmed(alice.page);
  await alice.context.close();
});

test('手机视口：开德州扑克房间、加入与离开，无横向滚动', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', '只在手机项目运行');
  const alice = await newUser(browser, 'mhost');
  const bob = await newUser(browser, 'mguest');

  await alice.page.goto('/lobby');
  await openRoomViaDialog(alice.page, { game: 'poker' });
  await expect(alice.page.getByRole('heading', { name: '德州扑克房间' })).toBeVisible();

  await bob.page.goto('/lobby');
  const row = roomRow(bob.page, alice.username);
  await expect(row).toContainText('德州扑克');
  await expect(row).toContainText('1/9');
  const noHorizontalScroll = () =>
    bob.page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
  expect(await noHorizontalScroll()).toBe(true);
  await row.getByRole('button', { name: '加入' }).click();
  await expect(bob.page.getByRole('heading', { name: '德州扑克房间' })).toBeVisible();
  await expect(alice.page.getByText(bob.username)).toBeVisible();
  expect(await noHorizontalScroll()).toBe(true);

  await leaveRoomConfirmed(bob.page);
  await expect(bob.page.getByRole('heading', { name: '游戏大厅' })).toBeVisible();
  await leaveRoomConfirmed(alice.page);
  await expect(alice.page.getByRole('heading', { name: '游戏大厅' })).toBeVisible();

  for (const u of [alice, bob]) await u.context.close();
});
