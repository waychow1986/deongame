import { expect, test, type Page } from '@playwright/test';
import { newUser } from './support/users.js';

type Sound = { name: string; played: boolean };

/** Registers sound and animation-phase collectors before any page script runs (testability contract). */
async function collect(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __sounds: Sound[]; __anims: string[] };
    w.__sounds = [];
    w.__anims = [];
    window.addEventListener('deongame:sound', (e) => w.__sounds.push((e as CustomEvent<Sound>).detail));
    new MutationObserver((records) => {
      for (const r of records) {
        const v = (r.target as Element).getAttribute('data-anim');
        if (v) w.__anims.push(v);
      }
    }).observe(document, { subtree: true, attributes: true, attributeFilter: ['data-anim'] });
  });
}

const sounds = (page: Page) => page.evaluate(() => (window as unknown as { __sounds: Sound[] }).__sounds.slice());
const anims = (page: Page) => page.evaluate(() => (window as unknown as { __anims: string[] }).__anims.slice());
const clearSounds = (page: Page) =>
  page.evaluate(() => {
    (window as unknown as { __sounds: Sound[] }).__sounds.length = 0;
  });

function board(page: Page) {
  return page.getByRole('group', { name: '棋盘' });
}

const cell = (page: Page, pos: string) => board(page).locator(`[data-pos="${pos}"]`);
const toast = (page: Page) => page.getByRole('status', { name: '操作提示' });
const status = (page: Page) => page.getByRole('status', { name: '对局状态' });

async function state(page: Page, roomId: string) {
  const res = await page.request.get(`/api/rooms/${roomId}/state`);
  expect(res.status()).toBe(200);
  return (await res.json()).room;
}

test('人机棋盘：结构、可走位置、提示、动画、上一步标记、音效与静音、结果与再来一局', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', '桌面项目运行');
  const u = await newUser(browser, 'bd');
  await collect(u.page);
  const created = await u.page.request.post('/api/chess/ai-games', { data: {} });
  expect(created.status()).toBe(201);
  const roomId: string = (await created.json()).room.roomId;
  await u.page.goto(`/room/${roomId}`);

  // Board structure and look (AC-11, AC-12).
  await expect(board(u.page).getByRole('button')).toHaveCount(90);
  await expect(board(u.page)).toHaveAttribute('data-orientation', 'red-bottom');
  await expect(board(u.page).getByText('楚河')).toBeVisible();
  await expect(board(u.page).getByText('汉界')).toBeVisible();
  const bg = await board(u.page).evaluate((el) => getComputedStyle(el).backgroundImage);
  expect(bg).toContain('gradient');
  await expect(u.page.getByText('听不到声音？请关闭手机静音模式')).toHaveCount(0);

  // Captured lists sit on their own side: red (you) below the board, black above (AC-19).
  const boardBox = await board(u.page).boundingBox();
  const redList = await u.page.getByRole('list', { name: '红方被吃' }).boundingBox();
  const blackList = await u.page.getByRole('list', { name: '黑方被吃' }).boundingBox();
  expect(boardBox && redList && blackList).toBeTruthy();
  expect(redList!.y).toBeGreaterThan(boardBox!.y + boardBox!.height / 2);
  expect(blackList!.y).toBeLessThan(boardBox!.y);

  // Tapping an opponent piece with nothing selected gives a short hint (AC-14).
  await board(u.page).getByRole('button', { name: 'a9 黑暗子' }).click();
  await expect(toast(u.page)).toContainText('这是对方的棋子');

  // Target dots equal the server's legal moves (AC-13).
  await board(u.page).getByRole('button', { name: 'a3 红暗子' }).click();
  await expect(cell(u.page, 'a3')).toHaveAttribute('aria-pressed', 'true');
  const legal = (await state(u.page, roomId)).chess.legalMoves as Record<string, string[]>;
  const a3Targets = legal.a3 ?? [];
  expect(a3Targets.length).toBeGreaterThan(0);
  await expect(board(u.page).locator('[data-marks~="target"]')).toHaveCount(a3Targets.length);
  const dots = await board(u.page).locator('[data-marks~="target"]').evaluateAll((els) =>
    els.map((e) => e.getAttribute('data-pos')),
  );
  expect(dots.sort()).toEqual([...a3Targets].sort());

  await board(u.page).getByRole('button', { name: 'a5 空' }).click();
  await expect(toast(u.page)).toContainText('这里不能走');

  // Move + reveal: the board goes through animation phases and back to idle (AC-15, AC-16).
  await board(u.page).getByRole('button', { name: 'a4 空' }).click();
  await expect.poll(() => anims(u.page)).toContain('moving');
  await expect.poll(() => anims(u.page)).toContain('flipping');
  await expect(board(u.page).getByRole('button', { name: /^a4 红(帅|仕|相|马|车|炮|兵)$/ })).toBeVisible();
  await expect(status(u.page)).toContainText('轮到你走棋');
  await expect(board(u.page)).toHaveAttribute('data-anim', 'idle');
  await expect(status(u.page)).toContainText('轮到红方');

  // Last-move marks follow the computer's move (AC-17).
  const afterAi = await state(u.page, roomId);
  const last = afterAi.chess.lastMove as { from: string; to: string; side: string };
  expect(last.side).toBe('black');
  await expect(cell(u.page, last.from)).toHaveAttribute('data-marks', /last-from/);
  await expect(cell(u.page, last.to)).toHaveAttribute('data-marks', /last-to/);

  // Sounds for own and computer moves, delivered to audio output (AC-31).
  await expect
    .poll(async () => (await sounds(u.page)).filter((s) => s.name === 'chess-move').length)
    .toBeGreaterThanOrEqual(2);
  expect((await sounds(u.page)).map((s) => s.name)).toContain('chess-flip');
  expect((await sounds(u.page)).every((s) => s.played)).toBe(true);

  // Muted: later sounds are not played (AC-32).
  const mute = u.page.getByRole('button', { name: '静音' });
  await expect(mute).toHaveAttribute('aria-pressed', 'false');
  await mute.click();
  await expect(mute).toHaveAttribute('aria-pressed', 'true');
  await clearSounds(u.page);
  const legal2 = afterAi.chess.legalMoves as Record<string, string[]>;
  const [from2, targets2] = Object.entries(legal2)[0] as [string, string[]];
  await cell(u.page, from2).click();
  await cell(u.page, targets2[0] as string).click();
  await expect.poll(async () => (await sounds(u.page)).length).toBeGreaterThan(0);
  expect((await sounds(u.page)).every((s) => !s.played)).toBe(true);
  await mute.click();
  await expect(mute).toHaveAttribute('aria-pressed', 'false');
  await expect(status(u.page)).toContainText('轮到你走棋');
  await expect(board(u.page)).toHaveAttribute('data-anim', 'idle');

  // Result dialog (AC-20).
  await clearSounds(u.page);
  await u.page.getByRole('button', { name: '认输' }).click();
  const result = u.page.getByRole('dialog', { name: '对局结果' });
  await expect(result).toContainText('负');
  await expect(result).toContainText('你输了');
  await expect(result).toContainText('积分变化：-10');
  await expect(result).toContainText('最新积分 990');
  await expect.poll(async () => (await sounds(u.page)).map((s) => s.name)).toContain('chess-end');
  await expect(result.getByRole('button', { name: '回到大厅' })).toBeVisible();

  // Play again against the computer: a fresh game, red to move, no captured pieces.
  await result.getByRole('button', { name: '再来一局' }).click();
  await expect(u.page).not.toHaveURL(new RegExp(roomId));
  await expect(u.page.getByRole('heading', { name: '与电脑对战' })).toBeVisible();
  await expect(status(u.page)).toContainText('你执红');
  await expect(status(u.page)).toContainText('轮到你走棋');
  await expect(board(u.page).getByRole('button', { name: 'a3 红暗子' })).toBeVisible();
  await expect(u.page.getByRole('list', { name: '红方被吃' }).getByRole('listitem')).toHaveCount(0);
  await expect(u.page.getByRole('list', { name: '黑方被吃' }).getByRole('listitem')).toHaveCount(0);
  await u.context.close();
});

test('联机棋盘：黑方视角旋转、非己方回合提示、轮次说明、胜方结果与联机再来一局', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', '桌面项目运行');
  const red = await newUser(browser, 'bdr');
  const black = await newUser(browser, 'bdb');
  const created = await red.page.request.post('/api/rooms', { data: { game: 'chess' } });
  expect(created.status()).toBe(201);
  const roomId: string = (await created.json()).room.roomId;
  expect((await black.page.request.post(`/api/rooms/${roomId}/join`, { data: {} })).status()).toBe(200);
  await red.page.goto(`/room/${roomId}`);
  await black.page.goto(`/room/${roomId}`);

  await expect(board(black.page)).toHaveAttribute('data-orientation', 'black-bottom');
  const blackKing = await cell(black.page, 'e9').boundingBox();
  const redKing = await cell(black.page, 'e0').boundingBox();
  expect(blackKing!.y).toBeGreaterThan(redKing!.y);
  // Black's own captured list sits below the board in the rotated view.
  const blackList = await black.page.getByRole('list', { name: '黑方被吃' }).boundingBox();
  const blackBoard = await board(black.page).boundingBox();
  expect(blackList!.y).toBeGreaterThan(blackBoard!.y + blackBoard!.height / 2);

  await expect(status(red.page)).toContainText('轮到红方 · 轮到你走棋');
  await expect(status(black.page)).toContainText('轮到红方');
  await expect(status(black.page)).not.toContainText('轮到你');

  await board(black.page).getByRole('button', { name: 'a6 黑暗子' }).click();
  await expect(toast(black.page)).toContainText('还没轮到你');
  await expect(cell(black.page, 'a6')).toHaveAttribute('aria-pressed', 'false');

  await red.page.getByRole('button', { name: '认输' }).click();
  const blackResult = black.page.getByRole('dialog', { name: '对局结果' });
  await expect(blackResult).toContainText('胜');
  await expect(blackResult).toContainText('你赢了');
  await expect(blackResult).toContainText('积分变化：+10');
  await expect(blackResult).toContainText('最新积分 1010');

  // Online play-again opens a new waiting room without inviting the old opponent (Q2).
  await blackResult.getByRole('button', { name: '再来一局' }).click();
  await expect(black.page).not.toHaveURL(new RegExp(roomId));
  await expect(black.page.getByRole('heading', { name: '中国象棋房间' })).toBeVisible();
  await expect(status(black.page)).toContainText('等待对手加入');
  const newRoomId = new URL(black.page.url()).pathname.split('/').pop() as string;
  const fresh = await state(black.page, newRoomId);
  expect(fresh.members).toHaveLength(1);
  for (const u of [red, black]) await u.context.close();
});

test('手机：未静音时显示静音模式提示，静音后隐藏；点按后音效交给音频输出', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', '只在手机项目运行');
  const u = await newUser(browser, 'bdm');
  await collect(u.page);
  const created = await u.page.request.post('/api/chess/ai-games', { data: {} });
  const roomId: string = (await created.json()).room.roomId;
  await u.page.goto(`/room/${roomId}`);
  const hint = u.page.getByText('听不到声音？请关闭手机静音模式');
  await expect(hint).toBeVisible();
  const mute = u.page.getByRole('button', { name: '静音' });
  await mute.tap();
  await expect(hint).toHaveCount(0);
  await mute.tap();
  await expect(hint).toBeVisible();

  await cell(u.page, 'a3').tap();
  await cell(u.page, 'a4').tap();
  await expect.poll(async () => (await sounds(u.page)).map((s) => s.name)).toContain('chess-move');
  expect((await sounds(u.page)).every((s) => s.played)).toBe(true);
  const overflow = await u.page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  );
  expect(overflow).toBe(true);
  await u.context.close();
});
