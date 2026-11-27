import { expect, test } from '@playwright/test';
import { newUser } from './support/users.js';

test('与电脑下盲棋：创建即开局，用户走棋后电脑自动应着', async ({ browser }) => {
  const u = await newUser(browser, 'aichess');
  await u.page.goto('/lobby');
  await u.page.getByRole('button', { name: '与电脑下盲棋' }).click();
  await expect(u.page.getByRole('heading', { name: '与电脑对战' })).toBeVisible();
  const status = u.page.getByRole('status', { name: '对局状态' });
  await expect(status).toContainText('轮到你走棋');

  const board = u.page.getByRole('group', { name: '棋盘' });
  await board.getByRole('button', { name: 'a3 红暗子' }).click();
  await board.getByRole('button', { name: 'a4 空' }).click();
  await expect(board.getByRole('button', { name: /^a4 红(帅|仕|相|马|车|炮|兵)$/ })).toBeVisible();
  await expect(status).toContainText('轮到你走棋', { timeout: 15_000 });

  const roomId = new URL(u.page.url()).pathname.split('/').pop() as string;
  const lobby = (await (await u.page.request.get('/api/rooms')).json()) as { rooms: { id: string }[] };
  expect(lobby.rooms.map((r) => r.id)).not.toContain(roomId);
});

test('德州扑克电脑玩家：房主添加电脑后与之开局，电脑自动行动', async ({ browser }) => {
  const host = await newUser(browser, 'pbot');
  await host.page.goto('/lobby');
  await host.page.getByRole('button', { name: '开德州扑克房间' }).click();
  await expect(host.page.getByRole('heading', { name: '德州扑克房间' })).toBeVisible();

  const start = host.page.getByRole('button', { name: '开始牌局' });
  await expect(start).toBeDisabled();
  await host.page.getByRole('button', { name: '添加电脑玩家' }).click();
  const botSeat = host.page.getByRole('region', { name: '座位 2：电脑 1' });
  await expect(botSeat).toContainText('电脑');
  await expect(botSeat).toContainText('筹码：1000');

  await start.click();
  await expect(host.page.getByRole('status', { name: '底池' })).toHaveText('底池：15');
  await expect(host.page.getByRole('button', { name: '添加电脑玩家' })).toBeDisabled();

  // Heads-up the host is dealer and acts first; after the call the bot must act on its own.
  await host.page.getByRole('button', { name: '跟注 5' }).click();
  await expect(host.page.getByRole('log', { name: '牌局记录' })).toContainText(/电脑 1 (过牌|加注到|弃牌|下注)/, {
    timeout: 15_000,
  });
});
