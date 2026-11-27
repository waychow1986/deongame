import { ERROR_MESSAGES, type ErrorCode } from '../shared/protocol.js';

const STATUS: Record<ErrorCode, number> = {
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  INVALID_CREDENTIALS: 401,
  NOT_IN_ROOM: 403,
  NOT_HOST: 403,
  ROOM_NOT_FOUND: 404,
  USERNAME_TAKEN: 409,
  ROOM_FULL: 409,
  ALREADY_IN_ROOM: 409,
  UNSUPPORTED_MEDIA_TYPE: 415,
  INTERNAL_ERROR: 500,
  NOT_YOUR_TURN: 409,
  ILLEGAL_MOVE: 409,
  GAME_NOT_ACTIVE: 409,
  DRAW_OFFER_PENDING: 409,
  NO_DRAW_OFFER: 409,
  ILLEGAL_ACTION: 409,
  HAND_IN_PROGRESS: 409,
  NOT_ENOUGH_PLAYERS: 409,
};

export class AppError extends Error {
  readonly status: number;
  constructor(
    readonly code: ErrorCode,
    message?: string,
  ) {
    super(message ?? ERROR_MESSAGES[code]);
    this.status = STATUS[code];
  }
}
