import { expect, test, type Page } from '@playwright/test';
import { newUser } from './support/users.js';

async function startGame(browser: Parameters<typeof newUser>[0]) {
  const red = await newUser(browser, 'cred');
  const black = await newUser(browser, 'cblack');
  await red.page.goto('/lobby');
  await red.page.getByRole('button', { name: '开中国象棋房间' }).click();
  await expect(red.page.getByRole('heading', { name: '中国象棋房间' })).toBeVisible();
  const roomPath = new URL(red.page.url()).pathname;
  const roomId = roomPath.split('/').pop() as string;
  const joined = await black.page.request.post(`/api/rooms/${roomId}/join`, { data: {} });
  expect(joined.status()).toBe(200);
  await black.page.goto(roomPath);
  await expect(black.page.getByRole('status', { name: '对局状态' })).toContainText('你执黑');
  return { red, black };
}

function board(page: Page) {
  return page.getByRole('group', { name: '棋盘' });
}

test('联机揭棋：走棋实时同步、拒绝提和、认输后双方看到结果与积分', async ({ browser }) => {
  const { red, black } = await startGame(browser);
  await expect(board(red.page).getByRole('button')).toHaveCount(90);
  await expect(board(red.page).getByRole('button', { name: 'e0 红帅' })).toBeVisible();
  await expect(board(red.page).getByRole('button', { name: 'a3 红暗子' })).toBeVisible();

  await board(red.page).getByRole('button', { name: 'a3 红暗子' }).click();
  await expect(board(red.page).getByRole('button', { name: 'a3 红暗子' })).toHaveAttribute('aria-pressed', 'true');
  await board(red.page).getByRole('button', { name: 'a4 空' }).click();

  const revealed = board(black.page).getByRole('button', { name: /^a4 红(帅|仕|相|马|车|炮|兵)$/ });
  await expect(revealed).toBeVisible();
  await expect(board(black.page).getByRole('button', { name: 'a3 空' })).toBeVisible();
  await expect(black.page.getByRole('status', { name: '对局状态' })).toContainText('轮到你走棋');
  await expect(red.page.getByRole('status', { name: '对局状态' })).toContainText('轮到黑方');

  await black.page.getByRole('button', { name: '提和' }).click();
  await red.page.getByRole('button', { name: '拒绝和棋' }).click();
  await expect(black.page.getByRole('status', { name: '对局状态' })).toContainText('对方拒绝了提和');
  await expect(red.page.getByRole('button', { name: '同意和棋' })).toHaveCount(0);

  await red.page.getByRole('button', { name: '认输' }).click();
  const redResult = red.page.getByRole('dialog', { name: '对局结果' });
  await expect(redResult).toContainText('你输了');
  await expect(redResult).toContainText('认输');
  await expect(redResult).toContainText('积分变化：-10');
  await expect(redResult).toContainText('当前积分：990');
  const blackResult = black.page.getByRole('dialog', { name: '对局结果' });
  await expect(blackResult).toContainText('你赢了');
  await expect(blackResult).toContainText('积分变化：+10');
  await expect(blackResult).toContainText('当前积分：1010');

  await blackResult.getByRole('button', { name: '返回大厅' }).click();
  await expect(black.page.getByRole('heading', { name: '游戏大厅' })).toBeVisible();
  await redResult.getByRole('button', { name: '返回大厅' }).click();
  await expect(red.page.getByRole('heading', { name: '游戏大厅' })).toBeVisible();
  for (const u of [red, black]) await u.context.close();
});

test('手机视口：棋盘完整显示无横向滚动，黑方视角旋转且可走棋，不合规走法被拒', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', '只在手机项目运行');
  const { red, black } = await startGame(browser);
  const noHorizontalScroll = (page: Page) =>
    page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
  await expect(board(black.page).getByRole('button')).toHaveCount(90);
  expect(await noHorizontalScroll(black.page)).toBe(true);

  // Rotated view: black's own king sits near the bottom of the screen.
  const blackKing = await board(black.page).getByRole('button', { name: 'e9 黑将' }).boundingBox();
  const redKing = await board(black.page).getByRole('button', { name: 'e0 红帅' }).boundingBox();
  expect(blackKing && redKing && blackKing.y > redKing.y).toBe(true);

  await board(red.page).getByRole('button', { name: 'a0 红暗子' }).click();
  await board(red.page).getByRole('button', { name: 'a4 空' }).click();
  await expect(red.page.getByRole('alert')).toContainText('走法不合规');
  await expect(board(red.page).getByRole('button', { name: 'a0 红暗子' })).toBeVisible();

  await board(red.page).getByRole('button', { name: 'e3 红暗子' }).click();
  await board(red.page).getByRole('button', { name: 'e4 空' }).click();
  await expect(black.page.getByRole('status', { name: '对局状态' })).toContainText('轮到你走棋');
  await board(black.page).getByRole('button', { name: 'e6 黑暗子' }).click();
  await board(black.page).getByRole('button', { name: 'e5 空' }).click();
  await expect(red.page.getByRole('status', { name: '对局状态' })).toContainText('轮到你走棋');
  await expect(board(red.page).getByRole('button', { name: /^e5 黑/ })).toBeVisible();
  expect(await noHorizontalScroll(red.page)).toBe(true);

  await black.page.getByRole('button', { name: '离开房间' }).click();
  await expect(red.page.getByRole('dialog', { name: '对局结果' })).toContainText('你赢了');
  await red.page.getByRole('dialog', { name: '对局结果' }).getByRole('button', { name: '返回大厅' }).click();
  for (const u of [red, black]) await u.context.close();
});
