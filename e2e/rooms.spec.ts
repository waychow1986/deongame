import { expect, test, type Page } from '@playwright/test';
import { newUser } from './support/users.js';

function roomRow(page: Page, host: string) {
  return page.getByRole('table', { name: '房间列表' }).getByRole('row').filter({ hasText: host });
}

test('开象棋房间，另一用户在大厅看到并加入，第三人看到已满', async ({ browser }) => {
  const alice = await newUser(browser, 'host');
  const bob = await newUser(browser, 'guest');
  const carol = await newUser(browser, 'third');

  await alice.page.goto('/lobby');
  await alice.page.getByRole('button', { name: '开中国象棋房间' }).click();
  await expect(alice.page.getByRole('heading', { name: '中国象棋房间' })).toBeVisible();

  await bob.page.goto('/lobby');
  const row = roomRow(bob.page, alice.username);
  await expect(row).toContainText('中国象棋');
  await expect(row).toContainText('1/2');
  await expect(row).toContainText('可加入');
  await row.getByRole('button', { name: '加入' }).click();
  await expect(bob.page.getByRole('heading', { name: '中国象棋房间' })).toBeVisible();
  await expect(bob.page.getByRole('status', { name: '对局状态' })).toContainText('你执黑');
  await expect(alice.page.getByRole('status', { name: '对局状态' })).toContainText('你执红');
  await expect(alice.page.getByRole('status', { name: '对局状态' })).toContainText('轮到你走棋');

  await carol.page.goto('/lobby');
  const fullRow = roomRow(carol.page, alice.username);
  await expect(fullRow).toContainText('2/2');
  await expect(fullRow).toContainText('已满');
  await expect(fullRow.getByRole('button', { name: '加入' })).toHaveCount(0);

  await bob.page.getByRole('button', { name: '离开房间' }).click();
  await expect(bob.page.getByRole('heading', { name: '游戏大厅' })).toBeVisible();
  await expect(alice.page.getByRole('button', { name: '返回大厅' })).toBeVisible();
  await alice.page.getByRole('button', { name: '返回大厅' }).click();
  await expect(alice.page.getByRole('heading', { name: '游戏大厅' })).toBeVisible();

  await carol.page.getByRole('button', { name: '刷新房间列表' }).click();
  await expect(roomRow(carol.page, alice.username)).toHaveCount(0);

  for (const u of [alice, bob, carol]) await u.context.close();
});

test('手机视口：开德州扑克房间、加入与离开，无横向滚动', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', '只在手机项目运行');
  const alice = await newUser(browser, 'mhost');
  const bob = await newUser(browser, 'mguest');

  await alice.page.goto('/lobby');
  await alice.page.getByRole('button', { name: '开德州扑克房间' }).click();
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

  await bob.page.getByRole('button', { name: '离开房间' }).click();
  await expect(bob.page.getByRole('heading', { name: '游戏大厅' })).toBeVisible();
  await alice.page.getByRole('button', { name: '离开房间' }).click();
  await expect(alice.page.getByRole('heading', { name: '游戏大厅' })).toBeVisible();

  for (const u of [alice, bob]) await u.context.close();
});
