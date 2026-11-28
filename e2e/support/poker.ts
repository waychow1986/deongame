import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import type { PokerView } from '../../src/shared/protocol.js';
import { openRoomViaDialog } from './lobby.js';
import { newUser } from './users.js';

export type Player = { context: BrowserContext; page: Page; username: string };

export async function pokerState(page: Page, roomId: string): Promise<PokerView> {
  const res = await page.request.get(`/api/rooms/${roomId}/state`);
  return ((await res.json()) as { room: { poker: PokerView } }).room.poker;
}

/** Host opens a poker room through the lobby; the others join through the API and open the room page. */
export async function pokerRoom(
  browser: Browser,
  labels: string[],
  capacity?: number,
): Promise<{ players: Player[]; roomId: string; roomPath: string }> {
  const players: Player[] = [];
  for (const l of labels) players.push(await newUser(browser, l));
  const host = players[0] as Player;
  await host.page.goto('/lobby');
  await openRoomViaDialog(host.page, capacity === undefined ? { game: 'poker' } : { game: 'poker', capacity });
  const roomPath = new URL(host.page.url()).pathname;
  const roomId = roomPath.split('/').pop() as string;
  for (const p of players.slice(1)) {
    expect((await p.page.request.post(`/api/rooms/${roomId}/join`, { data: {} })).status()).toBe(200);
    await p.page.goto(roomPath);
  }
  for (const p of players) await expect(p.page.getByRole('region', { name: '牌桌' })).toBeVisible();
  return { players, roomId, roomPath };
}

export const table = (page: Page) => page.getByRole('region', { name: '牌桌' });
export const actionArea = (page: Page) => page.getByRole('region', { name: '操作区' });

export async function close(players: Player[]): Promise<void> {
  for (const p of players) await p.context.close();
}
