import { POKER_BIG_BLIND, POKER_HAND_COMMIT_CAP, POKER_SMALL_BLIND } from '../../shared/constants.js';
import { HAND_LABELS, legalActions, potTotal } from '../../shared/poker/index.js';
import type { ChessColor, ChessSquareView, PokerSeatView, PokerView, RoomSnapshot } from '../../shared/protocol.js';
import { isInCheck } from '../../shared/xiangqi/index.js';
import { COMPUTER_NAME, handActive, POKER_DEFAULT_CHIPS, roomStatus, type PokerTableState, type Room } from './roomManager.js';

/** The only place where room state leaves the server; output is tailored to the viewer. */
export function viewFor(room: Room, viewerUserId: string): RoomSnapshot {
  const snap: RoomSnapshot = {
    roomId: room.id,
    game: room.game,
    mode: room.mode,
    version: room.version,
    hostUserId: room.hostUserId,
    members: room.members.map((m) => ({ userId: m.userId, username: m.username })),
    capacity: room.capacity,
    status: roomStatus(room),
    you: { userId: viewerUserId },
  };
  if (room.chess) {
    const c = room.chess;
    let yourColor: ChessColor | null = null;
    if (c.players.red?.userId === viewerUserId) yourColor = 'red';
    else if (c.players.black?.userId === viewerUserId) yourColor = 'black';
    snap.chess = {
      gameId: c.id,
      status: c.status,
      players: {
        red: c.players.red ? { userId: c.players.red.userId, username: c.players.red.username } : null,
        black: c.players.black
          ? { userId: c.players.black.userId, username: c.players.black.username }
          : room.mode === 'ai'
            ? { computer: true, username: COMPUTER_NAME }
            : null,
      },
      yourColor,
      turn: c.turn,
      inCheck: c.status === 'active' && isInCheck(c.board, c.turn),
      // Covered pieces never expose their identity, not even to their owner (FR-023).
      board: Object.entries(c.board)
        .map(([pos, p]): ChessSquareView => ({ pos, side: p.side, piece: p.revealed ? p.type : 'hidden' }))
        .sort((a, b) => (a.pos < b.pos ? -1 : a.pos > b.pos ? 1 : 0)),
      captured: c.captured.map((x) => ({ side: x.side, piece: x.piece })),
      lastMove: c.lastMove
        ? {
            from: c.lastMove.from,
            to: c.lastMove.to,
            side: c.lastMove.side,
            ...(c.lastMove.revealed ? { revealed: c.lastMove.revealed } : {}),
            ...(c.lastMove.captured ? { captured: { ...c.lastMove.captured } } : {}),
          }
        : null,
      drawOffer: c.drawOffer ? { by: c.drawOffer.by } : null,
      result: c.result
        ? {
            outcome: c.result.outcome,
            reason: c.result.reason,
            settled: c.result.settled,
            ratingChanges: c.result.ratingChanges.map((r) => ({ ...r })),
          }
        : null,
    };
  }
  if (room.poker) snap.poker = pokerView(room.poker, viewerUserId);
  return snap;
}

/** Hole cards appear only for the viewer's own seat or seats revealed at showdown (FR-052, FR-056). */
function pokerView(poker: PokerTableState, viewerUserId: string): PokerView {
  const hand = poker.hand;
  const active = handActive(poker);
  const nameOf = (seat: number) => poker.handPlayers[seat]?.name ?? poker.seats[seat]?.name ?? '';
  const yourSeatIdx = poker.seats.findIndex((s) => s?.kind === 'human' && s.userId === viewerUserId);
  const yourSeat = yourSeatIdx >= 0 ? yourSeatIdx : null;
  const seats = poker.seats.flatMap((s, seat): PokerSeatView[] => {
    if (!s) return [];
    // Hand data belongs to the seat only if the same occupant started the hand there.
    const starter = poker.handPlayers[seat];
    const sameOccupant = !!starter && starter.kind === s.kind && starter.userId === s.userId;
    const hp = hand && sameOccupant ? hand.players.find((p) => p.seat === seat) : undefined;
    const balance = s.userId ? (poker.balances[s.userId] ?? POKER_DEFAULT_CHIPS) : (s.chips ?? POKER_DEFAULT_CHIPS);
    // A bot's chips are updated when its hand ends; until then subtract what it has put in.
    const unsettled = !hp
      ? 0
      : s.userId
        ? poker.settledUserIds.includes(s.userId)
          ? 0
          : hp.committed
        : active
          ? hp.committed
          : 0;
    const revealed = hand?.showdown.find((x) => x.seat === seat && hp);
    const own = !!hp && s.userId === viewerUserId;
    return [
      {
        seat,
        kind: s.kind,
        ...(s.userId ? { userId: s.userId } : {}),
        name: s.name,
        chips: balance - unsettled,
        committedThisHand: hp?.committed ?? 0,
        committedThisRound: hp?.roundBet ?? 0,
        inHand: !!hp,
        folded: hp?.folded ?? false,
        atCap: !!hp && hp.committed >= POKER_HAND_COMMIT_CAP,
        waitingNextHand: s.waitingNextHand ?? false,
        isDealer: !!hand && hand.dealerSeat === seat,
        isSmallBlind: !!hand && hand.sbSeat === seat,
        isBigBlind: !!hand && hand.bbSeat === seat,
        ...(hp && (own || revealed) ? { holeCards: [...hp.hole] } : {}),
      },
    ];
  });
  const yourHandSeat = yourSeat !== null && seats.find((x) => x.seat === yourSeat)?.inHand ? yourSeat : null;
  return {
    handId: hand?.id ?? null,
    handNumber: poker.handNumber,
    stage: hand?.stage ?? 'idle',
    blinds: { small: POKER_SMALL_BLIND, big: POKER_BIG_BLIND },
    handCommitCap: POKER_HAND_COMMIT_CAP,
    board: hand ? [...hand.board] : [],
    pot: hand ? potTotal(hand) : 0,
    currentBet: hand?.currentBet ?? 0,
    toActSeat: active ? (hand?.toAct ?? null) : null,
    seats,
    actions: (hand?.actions ?? []).map((a) => ({
      seat: a.seat,
      name: nameOf(a.seat),
      type: a.type,
      amount: a.amount,
      ...(a.to !== undefined ? { to: a.to } : {}),
    })),
    showdown: (hand?.showdown ?? []).map((x) => ({
      seat: x.seat,
      holeCards: [...x.holeCards],
      handRank: x.handRank,
      handLabel: HAND_LABELS[x.handRank],
    })),
    winners: (hand?.winners ?? []).map((w) => ({ seat: w.seat, name: nameOf(w.seat), amount: w.amount })),
    you: {
      seat: yourSeat,
      legal: active && hand && yourHandSeat !== null && hand.toAct === yourHandSeat ? legalActions(hand, yourHandSeat) : null,
    },
  };
}
