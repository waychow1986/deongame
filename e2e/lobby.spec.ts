import { expect, test, type Page } from '@playwright/test';
import { leaveRoomConfirmed, openRoomViaDialog, ROOM_URL } from './support/lobby.js';
import { newUser, uniqueName } from './support/users.js';

function roomRow(page: Page, host: string) {
  return page.getByRole('table', { name: '房间列表' }).getByRole('row').filter({ hasText: `${host}的房间` });
}

async function meOf(page: Page) {
  const res = await page.request.get('/api/me');
  return ((await res.json()) as { user: { currentRoomId: string | null; activeRoomId: string | null } }).user;
}

test('顶栏显示名称、用户名、积分与筹码；退出登录后需重新登录', async ({ browser }) => {
  const u = await newUser(browser, 'top');
  await u.page.goto('/lobby');
  const banner = u.page.getByRole('banner');
  await expect(banner.getByRole('heading', { name: 'DeonGame' })).toBeVisible();
  const info = banner.getByRole('region', { name: '我的信息' });
  await expect(info).toContainText(u.username);
  await expect(info).toContainText('象棋积分 1000');
  await expect(info).toContainText('扑克筹码 1000');
  await expect(info.locator('[data-negative]')).toHaveAttribute('data-negative', 'false');
  await expect(u.page.getByRole('status', { name: '连接状态' })).toHaveAttribute('data-state', 'ok');

  await info.getByRole('button', { name: '退出登录' }).click();
  await expect(u.page).toHaveURL(/\/login$/);
  await u.page.goto('/lobby');
  await expect(u.page).toHaveURL(/\/login$/);
  expect((await u.page.request.get('/api/me')).status()).toBe(401);
  await u.context.close();
});

test('登录后停在大厅，回到对局、回到大厅与确认离开房间', async ({ browser }) => {
  const red = await newUser(browser, 'back');
  const black = await newUser(browser, 'backb');
  await red.page.goto('/lobby');
  await openRoomViaDialog(red.page, { game: 'chess' });
  const roomPath = new URL(red.page.url()).pathname;
  const roomId = roomPath.split('/').pop() as string;
  expect((await black.page.request.post(`/api/rooms/${roomId}/join`, { data: {} })).status()).toBe(200);

  // Opening the site again lands in the lobby, not the room (AC-1), with a way back (AC-2).
  await red.page.goto('/');
  await expect(red.page).toHaveURL(/\/lobby$/);
  await expect(red.page.getByRole('heading', { name: 'DeonGame' })).toBeVisible();
  const resume = red.page.getByRole('button', { name: '回到对局' });
  await expect(resume).toBeVisible();
  for (const card of [/^中国象棋·盲棋/, /^德州扑克/]) {
    await expect(red.page.getByRole('button', { name: card })).toBeDisabled();
  }
  await expect(red.page.locator('.game-cards')).toContainText('你有进行中的对局');

  await resume.click();
  await expect(red.page).toHaveURL(new RegExp(`${roomPath}$`));
  await expect(red.page.getByRole('status', { name: '对局状态' })).toContainText('你执红');

  // "回到大厅" keeps the game (AC-3).
  await red.page.getByRole('button', { name: '回到大厅' }).click();
  await expect(red.page).toHaveURL(/\/lobby$/);
  await expect(red.page.getByRole('button', { name: '回到对局' })).toBeVisible();
  expect((await meOf(red.page)).activeRoomId).toBe(roomId);
  await red.page.getByRole('button', { name: '回到对局' }).click();
  await expect(red.page).toHaveURL(ROOM_URL);

  // "离开房间" asks first; cancel keeps everything.
  await red.page.getByRole('button', { name: '离开房间' }).click();
  const confirm = red.page.getByRole('dialog', { name: '确认离开房间' });
  await expect(confirm).toContainText('对局中离开将判负');
  await confirm.getByRole('button', { name: '取消' }).click();
  await expect(confirm).toHaveCount(0);
  await expect(red.page).toHaveURL(ROOM_URL);
  expect((await meOf(red.page)).activeRoomId).toBe(roomId);

  await leaveRoomConfirmed(red.page);
  await expect(red.page).toHaveURL(/\/lobby$/);
  await expect(red.page.getByRole('heading', { name: 'DeonGame' })).toBeVisible();
  await expect(red.page.getByRole('button', { name: '回到对局' })).toHaveCount(0);
  await expect(black.page.request.get('/api/me').then((r) => r.json())).resolves.toMatchObject({
    user: { rating: 1010 },
  });
  for (const u of [red, black]) await u.context.close();
});

test('游戏卡片与开房间弹窗：取消三种方式不开房，扑克人数上限生效', async ({ browser }) => {
  const host = await newUser(browser, 'card');
  const viewer = await newUser(browser, 'view');
  await viewer.page.goto('/lobby');
  await host.page.goto('/lobby');

  const chessCard = host.page.getByRole('button', { name: /^中国象棋·盲棋/ });
  await expect(chessCard.getByRole('img')).toBeVisible();
  await chessCard.click();
  const dialog = host.page.getByRole('dialog', { name: '开房间' });
  await expect(dialog.getByRole('radiogroup', { name: '游戏类型' }).getByRole('radio', { name: '中国象棋·盲棋' })).toBeChecked();
  await expect(dialog.getByRole('radiogroup', { name: '对战方式' }).getByRole('radio')).toHaveCount(2);
  await expect(dialog.getByRole('combobox', { name: '人数上限' })).toHaveCount(0);
  await dialog.getByRole('button', { name: '取消' }).click();
  await expect(dialog).toHaveCount(0);

  const pokerCard = host.page.getByRole('button', { name: /^德州扑克/ });
  await pokerCard.click();
  await expect(dialog.getByRole('radio', { name: '德州扑克' })).toBeChecked();
  const capacity = dialog.getByRole('combobox', { name: '人数上限' });
  await expect(capacity).toHaveValue('9');
  await expect(capacity.getByRole('option')).toHaveText(['2', '3', '4', '5', '6', '7', '8', '9']);
  await dialog.getByRole('button', { name: '关闭' }).click();
  await expect(dialog).toHaveCount(0);

  await pokerCard.click();
  await host.page.getByTestId('dialog-backdrop').click({ position: { x: 5, y: 5 } });
  await expect(dialog).toHaveCount(0);
  expect((await meOf(host.page)).currentRoomId).toBeNull();

  await openRoomViaDialog(host.page, { game: 'poker', capacity: 2 });
  await expect(host.page.getByRole('heading', { name: '德州扑克房间' })).toBeVisible();

  // The viewer's lobby updates without reloading (AC-8).
  const row = roomRow(viewer.page, host.username);
  await expect(row).toContainText('德州扑克', { timeout: 5_000 });
  await expect(row).toContainText('1/2');
  await expect(row).toContainText('等待中');
  await expect(row.getByRole('button', { name: '加入' })).toBeEnabled();

  const guest = await newUser(browser, 'fill');
  const roomId = new URL(host.page.url()).pathname.split('/').pop() as string;
  expect((await guest.page.request.post(`/api/rooms/${roomId}/join`, { data: {} })).status()).toBe(200);
  await expect(row).toContainText('2/2', { timeout: 5_000 });
  await expect(row).toContainText('已满员');
  await expect(row.getByRole('button', { name: '加入' })).toBeDisabled();
  await expect(host.page.getByRole('button', { name: '添加电脑玩家' })).toBeDisabled();
  for (const u of [host, viewer, guest]) await u.context.close();
});

test('加入时房间已变化：中文说明原因并留在大厅；打开已关闭的房间回到大厅', async ({ browser }) => {
  const host = await newUser(browser, 'gone');
  const viewer = await newUser(browser, 'late');
  const rival = await newUser(browser, 'rival');
  const created = await host.page.request.post('/api/rooms', { data: { game: 'chess' } });
  const roomId = ((await created.json()) as { room: { roomId: string } }).room.roomId;

  await viewer.page.goto('/lobby');
  const row = roomRow(viewer.page, host.username);
  await expect(row.getByRole('button', { name: '加入' })).toBeEnabled();
  // Freeze the viewer's list so the click races the join below.
  await viewer.page.route('**/api/rooms', (route) => new Promise(() => void route));
  expect((await rival.page.request.post(`/api/rooms/${roomId}/join`, { data: {} })).status()).toBe(200);
  await row.getByRole('button', { name: '加入' }).click();
  await expect(viewer.page.getByRole('alert')).toContainText(/房间/);
  await expect(viewer.page).toHaveURL(/\/lobby$/);
  expect((await meOf(viewer.page)).currentRoomId).toBeNull();
  await viewer.page.unrouteAll({ behavior: 'ignoreErrors' });

  expect((await host.page.request.post(`/api/rooms/${roomId}/leave`, { data: {} })).status()).toBe(200);
  expect((await rival.page.request.post(`/api/rooms/${roomId}/leave`, { data: {} })).status()).toBe(200);
  await viewer.page.goto(`/room/${roomId}`);
  await expect(viewer.page).toHaveURL(/\/lobby$/);
  await expect(viewer.page.getByRole('alert')).toContainText('房间不存在或已关闭');
  for (const u of [host, viewer, rival]) await u.context.close();
});

test('出错说明：用户名过长与网络连接失败', async ({ page, context }) => {
  await page.goto('/register');
  await page.getByRole('textbox', { name: '用户名' }).fill('a'.repeat(201));
  await page.getByLabel('密码').fill('pw-123456');
  await page.getByRole('button', { name: '注册' }).click();
  await expect(page.getByRole('alert')).toContainText('用户名');
  await expect(page).toHaveURL(/\/register$/);

  await page.getByRole('textbox', { name: '用户名' }).fill(uniqueName('off'));
  await context.setOffline(true);
  await page.getByRole('button', { name: '注册' }).click();
  await expect(page.getByRole('alert')).toHaveText('网络连接失败，请检查网络后重试');
  await context.setOffline(false);
});

test('断线时显示正在重连，恢复后自动刷新为最新状态', async ({ browser }) => {
  const u = await newUser(browser, 'net');
  await u.page.goto('/lobby');
  const status = u.page.getByRole('status', { name: '连接状态' });
  await expect(status).toHaveAttribute('data-state', 'ok');
  await u.context.setOffline(true);
  await expect(status).toHaveAttribute('data-state', 'reconnecting', { timeout: 5_000 });
  await expect(status).toHaveText('连接已断开，正在重连…');
  const created = await u.page.request.post('/api/rooms', { data: { game: 'chess' } });
  expect(created.status()).toBe(201);
  await u.context.setOffline(false);
  await expect(status).toHaveAttribute('data-state', 'ok', { timeout: 5_000 });
  await expect(u.page.getByRole('button', { name: '回到对局' })).toBeVisible();
  await u.context.close();
});

test('房间页断线后显示正在重连，恢复后显示最新局面', async ({ browser }) => {
  const red = await newUser(browser, 'rnet');
  const black = await newUser(browser, 'rnetb');
  await red.page.goto('/lobby');
  await openRoomViaDialog(red.page, { game: 'chess' });
  const status = red.page.getByRole('status', { name: '连接状态' });
  await expect(status).toHaveAttribute('data-state', 'ok');
  await red.context.setOffline(true);
  await expect(status).toHaveAttribute('data-state', 'reconnecting', { timeout: 10_000 });
  const roomId = new URL(red.page.url()).pathname.split('/').pop() as string;
  expect((await black.page.request.post(`/api/rooms/${roomId}/join`, { data: {} })).status()).toBe(200);
  await red.context.setOffline(false);
  await expect(status).toHaveAttribute('data-state', 'ok', { timeout: 15_000 });
  await expect(red.page.getByRole('status', { name: '对局状态' })).toContainText('轮到你走棋');
  for (const u of [red, black]) await u.context.close();
});
