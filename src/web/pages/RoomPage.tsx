import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import {
  ERROR_MESSAGES,
  type ChessColor,
  type ChessReason,
  type ChessView,
  type RoomSnapshot,
} from '../../shared/protocol.js';
import { diffChess, diffPoker, soundsFor } from '../../shared/ui/events.js';
import { orientationFor } from '../../shared/ui/board.js';
import { ApiRequestError, api, errorMessage } from '../api.js';
import { playSound } from '../audio/sound.js';
import { ChessBoard, pieceLabel } from '../components/ChessBoard.js';
import { ConnectionStatus, type ConnectionState } from '../components/ConnectionStatus.js';
import { Modal } from '../components/Modal.js';
import { PokerTable } from '../components/PokerTable.js';
import { MobileSoundHint, MuteButton } from '../components/SoundControls.js';
import { Toast, useToast } from '../components/Toast.js';
import { useRoomFeed } from '../hooks/useRoomFeed.js';
import { connectSocket } from '../socket.js';

const LEAVE_CONSEQUENCE = {
  chess: '对局中离开将判负',
  poker: '本手进行中离开将弃牌并让出座位',
} as const;

/** Keyed by room id so "再来一局" starts with a fresh snapshot queue and board state. */
export function RoomPage() {
  const { id = '' } = useParams();
  return <RoomView key={id} id={id} />;
}

function RoomView({ id }: { id: string }) {
  const navigate = useNavigate();
  const feed = useRoomFeed();
  const { room, prev, push } = feed;
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const [conn, setConn] = useState<ConnectionState>('loading');
  const [confirmLeave, setConfirmLeave] = useState(false);

  const backToLobbyClosed = useCallback(() => {
    navigate('/lobby', { replace: true, state: { notice: ERROR_MESSAGES.ROOM_NOT_FOUND } });
  }, [navigate]);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      api
        .roomState(id)
        .then(({ room }) => {
          if (cancelled) return;
          push(room);
          setConn('ok');
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          if (err instanceof ApiRequestError && (err.status === 404 || err.status === 403)) backToLobbyClosed();
          else if (err instanceof ApiRequestError && err.code === 'NETWORK_ERROR') setConn('reconnecting');
          else setError(errorMessage(err));
        });
    };
    load();
    const socket = connectSocket();
    // Every (re)connect re-reads the authoritative state, so a reconnect shows the latest position (FR-110).
    socket.on('connect', load);
    socket.on('disconnect', () => {
      if (!cancelled) setConn('reconnecting');
    });
    socket.on('connect_error', () => {
      if (!cancelled) setConn('reconnecting');
    });
    socket.on('room:state', (snap: RoomSnapshot) => {
      if (snap.roomId === id) push(snap);
    });
    socket.on('room:closed', (msg: { roomId: string }) => {
      if (msg.roomId === id) navigate('/lobby', { replace: true });
    });
    return () => {
      cancelled = true;
      socket.close();
    };
  }, [id, navigate, backToLobbyClosed, push]);

  // Sounds follow the displayed snapshot, so they line up with what the board shows (FR-091).
  useEffect(() => {
    if (!room || !prev) return;
    const events = [
      ...(room.chess ? diffChess(prev.chess, room.chess) : []),
      ...(room.poker ? diffPoker(prev.poker, room.poker) : []),
    ];
    for (const name of soundsFor(events)) playSound(name);
  }, [room, prev]);

  async function leave() {
    setConfirmLeave(false);
    try {
      await api.leaveRoom(id);
    } catch (err) {
      const msg = errorMessage(err);
      // Already outside the room: just go back.
      if (!/不在|不存在/.test(msg)) {
        setError(msg);
        return;
      }
    }
    navigate('/lobby', { replace: true });
  }

  async function act(fn: () => Promise<{ room: RoomSnapshot }>) {
    try {
      const res = await fn();
      setError(null);
      push(res.room);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function pokerAction(type: 'fold' | 'check' | 'call' | 'bet' | 'raise', amount?: number) {
    try {
      const res = await api.pokerAction(id, type, amount);
      setError(null);
      push(res.room);
    } catch (err) {
      // A refused action means the table moved on: explain why and show the latest state (FR-084).
      setError(errorMessage(err));
      api
        .roomState(id)
        .then(({ room }) => push(room))
        .catch(() => undefined);
    }
  }

  async function move(from: string, to: string) {
    try {
      const res = await api.chessMove(id, from, to);
      push(res.room);
    } catch (err) {
      // The board only offers server-provided targets; a refusal means the position moved on, so resync.
      toast.show(errorMessage(err));
      api
        .roomState(id)
        .then(({ room }) => push(room))
        .catch(() => undefined);
    }
  }

  async function playAgain() {
    try {
      const res = room?.mode === 'ai' ? await api.createAiGame() : await api.createRoom('chess');
      navigate(`/room/${res.room.roomId}`);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const title =
    room?.game === 'poker'
      ? '德州扑克房间'
      : room?.mode === 'ai'
        ? '与电脑对战'
        : room?.game === 'chess'
          ? '中国象棋房间'
          : '房间';

  return (
    <main className="page room-page">
      <ConnectionStatus state={conn} />
      <div className="nav-bar">
        <h1>{title}</h1>
        <div className="actions">
          <MuteButton />
          <button type="button" onClick={() => navigate('/lobby')}>
            回到大厅
          </button>
          <button type="button" className="secondary" onClick={() => setConfirmLeave(true)}>
            离开房间
          </button>
        </div>
      </div>
      <MobileSoundHint />
      {error && (
        <div role="alert" className="error">
          {error}
        </div>
      )}
      {room && (
        <>
          <section aria-label="房间成员" className="card">
            <p>
              人数：{room.game === 'poker' ? (room.poker?.seats.length ?? 0) : room.members.length}/{room.capacity}
            </p>
            <ul className="info">
              {room.members.map((m) => (
                <li key={m.userId}>
                  {m.username}
                  {m.userId === room.hostUserId ? '（房主）' : ''}
                </li>
              ))}
            </ul>
          </section>
          {room.chess && (
            <ChessPanel
              chess={room.chess}
              animate={feed.animate}
              onAnimDone={feed.animDone}
              onHint={toast.show}
              onMove={(from, to) => void move(from, to)}
              onResign={() => void act(() => api.chessResign(id))}
              onOfferDraw={() => void act(() => api.chessDrawOffer(id))}
              onRespondDraw={(accept) => void act(() => api.chessDrawResponse(id, accept))}
              onBackToLobby={() => void leave()}
              onPlayAgain={() => void playAgain()}
              youId={room.you.userId}
            />
          )}
          {room.poker && (
            <PokerTable
              poker={room.poker}
              isHost={room.hostUserId === room.you.userId}
              capacity={room.capacity}
              onStart={() => void act(() => api.pokerStart(id))}
              onAddBot={() => void act(() => api.addPokerBot(id))}
              onAction={(type, amount) => void pokerAction(type, amount)}
            />
          )}
        </>
      )}
      <Toast message={toast.message} />
      {confirmLeave && (
        <Modal title="确认离开房间" onClose={() => setConfirmLeave(false)}>
          <p>{LEAVE_CONSEQUENCE[room?.game ?? 'chess']}</p>
          <div className="actions">
            <button type="button" onClick={() => void leave()}>
              确认离开
            </button>
            <button type="button" className="secondary" onClick={() => setConfirmLeave(false)}>
              取消
            </button>
          </div>
        </Modal>
      )}
    </main>
  );
}

const REASONS: Record<ChessReason, string> = {
  checkmate: '将死',
  stalemate: '困毙',
  resign: '认输',
  draw_agreed: '双方同意和棋',
  bare_kings: '双方只剩将帅',
};

const SIDE_NAME: Record<ChessColor, string> = { red: '红方', black: '黑方' };

interface ChessPanelProps {
  chess: ChessView;
  youId: string;
  animate: boolean;
  onAnimDone: () => void;
  onHint: (message: string) => void;
  onMove: (from: string, to: string) => void;
  onResign: () => void;
  onOfferDraw: () => void;
  onRespondDraw: (accept: boolean) => void;
  onBackToLobby: () => void;
  onPlayAgain: () => void;
}

function CapturedList({ chess, side }: { chess: ChessView; side: ChessColor }) {
  const label = `${SIDE_NAME[side]}被吃`;
  const list = chess.captured.filter((c) => c.side === side);
  return (
    <div className={`captured-row ${side}`}>
      <span className="captured-title">{label}</span>
      <ul aria-label={label} className="captured-list">
        {list.map((c, i) => (
          <li key={i}>{pieceLabel(c.side, c.piece)}</li>
        ))}
      </ul>
    </div>
  );
}

function ChessPanel(props: ChessPanelProps) {
  const { chess } = props;
  const playing = chess.status === 'active' && chess.yourColor !== null;
  const offerToMe = playing && chess.drawOffer !== null && chess.drawOffer.by !== chess.yourColor;
  // Each side's captured list sits on that side of the board (A-6).
  const bottom: ChessColor = orientationFor(chess.yourColor) === 'red-bottom' ? 'red' : 'black';
  const top: ChessColor = bottom === 'red' ? 'black' : 'red';
  return (
    <>
      <ChessStatus chess={chess} />
      <section aria-label="被吃的棋子" className="chess-area">
        <CapturedList chess={chess} side={top} />
        {chess.status !== 'waiting' && (
          <ChessBoard
            chess={chess}
            animate={props.animate}
            onMove={props.onMove}
            onAnimDone={props.onAnimDone}
            onHint={props.onHint}
          />
        )}
        <CapturedList chess={chess} side={bottom} />
      </section>
      {playing && (
        <div className="actions">
          <button type="button" onClick={props.onResign}>
            认输
          </button>
          <button type="button" onClick={props.onOfferDraw}>
            提和
          </button>
          {offerToMe && (
            <>
              <button type="button" onClick={() => props.onRespondDraw(true)}>
                同意和棋
              </button>
              <button type="button" onClick={() => props.onRespondDraw(false)}>
                拒绝和棋
              </button>
            </>
          )}
        </div>
      )}
      {chess.result && (
        <ChessResult chess={chess} youId={props.youId} onBack={props.onBackToLobby} onPlayAgain={props.onPlayAgain} />
      )}
    </>
  );
}

interface ChessResultProps {
  chess: ChessView;
  youId: string;
  onBack: () => void;
  onPlayAgain: () => void;
}

function ChessResult({ chess, youId, onBack, onPlayAgain }: ChessResultProps) {
  const result = chess.result;
  if (!result) return null;
  let headline = '和棋';
  let mark = '和';
  if (result.outcome !== 'draw') {
    const winner = result.outcome === 'red_win' ? 'red' : 'black';
    if (chess.yourColor === null) {
      headline = winner === 'red' ? '红方胜' : '黑方胜';
      mark = '胜';
    } else if (winner === chess.yourColor) {
      headline = '你赢了';
      mark = '胜';
    } else {
      headline = '你输了';
      mark = '负';
    }
  }
  const mine = result.ratingChanges.find((c) => c.userId === youId);
  return (
    <div role="dialog" aria-label="对局结果" aria-modal="true" className="dialog-backdrop">
      <div className="dialog card chess-result" data-outcome={mark}>
        <p className="result-mark" aria-label="结果">
          {mark}
        </p>
        <h2>{headline}</h2>
        <p>原因：{REASONS[result.reason]}</p>
        {!result.settled ? (
          <p>积分结算中</p>
        ) : (
          mine && (
            <>
              <p>积分变化：{mine.delta > 0 ? `+${mine.delta}` : String(mine.delta)}</p>
              <p>最新积分 {mine.rating}</p>
            </>
          )
        )}
        <div className="actions">
          {chess.yourColor !== null && (
            <button type="button" onClick={onPlayAgain}>
              再来一局
            </button>
          )}
          <button type="button" className="secondary" onClick={onBack}>
            回到大厅
          </button>
        </div>
      </div>
    </div>
  );
}

function ChessStatus({ chess }: { chess: ChessView }) {
  const parts: string[] = [];
  if (chess.yourColor) parts.push(chess.yourColor === 'red' ? '你执红' : '你执黑');
  if (chess.status === 'waiting') parts.push('等待对手加入');
  else if (chess.status === 'active') {
    const turn = chess.turn === 'red' ? '轮到红方' : '轮到黑方';
    parts.push(chess.turn === chess.yourColor ? `${turn} · 轮到你走棋` : turn);
    if (chess.inCheck) parts.push('将军');
    if (chess.drawOffer) parts.push(chess.drawOffer.by === chess.yourColor ? '已提和，等待对方回应' : '对方提和');
    // Kept in the server state, so it also shows after a reload (FR-036).
    if (chess.drawDeclined?.by === chess.yourColor) parts.push('对方拒绝了提和');
  } else parts.push('对局已结束');
  return (
    <div role="status" aria-label="对局状态" className="card">
      {parts.join('，')}
    </div>
  );
}
