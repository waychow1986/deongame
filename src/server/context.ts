import type pg from 'pg';
import type { Rng } from '../shared/rng.js';
import type { SessionStore } from './auth/sessions.js';
import type { AppConfig } from './config.js';
import type { UserRepository } from './db/users.js';
import type { Logger } from './logger.js';
import type { RoomManager } from './rooms/roomManager.js';

export interface Broadcaster {
  /** Pushes the latest per-viewer snapshot of the room to the given users. */
  roomChanged(roomId: string, userIds: string[]): void;
}

export interface AppContext {
  config: AppConfig;
  logger: Logger;
  rng: Rng;
  pool: pg.Pool;
  users: UserRepository;
  sessions: SessionStore;
  rooms: RoomManager;
  broadcaster: Broadcaster;
}
