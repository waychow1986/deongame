import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { ERROR_MESSAGES, type ChessReason, type ChessView, type RoomSnapshot } from '../../shared/protocol.js';
import { ApiRequestError, api, errorMessage } from '../api.js';
import { ChessBoard, pieceLabel } from '../components/ChessBoard.js';
import { ConnectionStatus, type ConnectionState } from '../components/ConnectionStatus.js';
import { Modal } from '../components/Modal.js';
import { PokerTable } from '../components/PokerTable.js';
import { connectSocket } from '../socket.js';

const LEAVE_CONSEQUENCE = {
  chess: '对局中离开将判负',
  poker: '本手进行中离开将弃牌并让出座位',
} as const;

export function RoomPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [room, setRoom] = useState<RoomSnapshot | null>(null);
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
          setRoom(room);
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
      if (snap.roomId !== id) return;
      setRoom((prev) => (prev && prev.version > snap.version ? prev : snap));
    });
    socket.on('room:closed', (msg: { roomId: string }) => {
      if (msg.roomId === id) navigate('/lobby', { replace: true });
    });
    return () => {
      cancelled = true;
      socket.close();
    };
  }, [id, navigate, backToLobbyClosed]);

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
      setRoom((prev) => (prev && prev.version > res.room.version ? prev : res.room));
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
    <main className="page">
      <ConnectionStatus state={conn} />
      <div className="nav-bar">
        <h1>{title}</h1>
        <div className="actions">
          <button type="button" onClick={() => navigate('/lobby')}>
            回到大厅
          </button>
          <button type="button" className="secondary" onClick={() => setConfirmLeave(true)}>
            离开房间
          </button>
        </div>
      </div>
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
              onMove={(from, to) => void act(() => api.chessMove(id, from, to))}
              onResign={() => void act(() => api.chessResign(id))}
              onOfferDraw={() => void act(() => api.chessDrawOffer(id))}
              onRespondDraw={(accept) => void act(() => api.chessDrawResponse(id, accept))}
              onBackToLobby={() => void leave()}
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
              onAction={(type, amount) => void act(() => api.pokerAction(id, type, amount))}
            />
          )}
        </>
      )}
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

interface ChessPanelProps {
  chess: ChessView;
  youId: string;
  onMove: (from: string, to: string) => void;
  onResign: () => void;
  onOfferDraw: () => void;
  onRespondDraw: (accept: boolean) => void;
  onBackToLobby: () => void;
}

function ChessPanel(props: ChessPanelProps) {
  const { chess } = props;
  const playing = chess.status === 'active' && chess.yourColor !== null;
  const offerToMe = playing && chess.drawOffer !== null && chess.drawOffer.by !== chess.yourColor;
  return (
    <>
      <ChessStatus chess={chess} />
      {chess.status !== 'waiting' && <ChessBoard chess={chess} onMove={props.onMove} />}
      <section aria-label="被吃的棋子" className="card">
        <h2 className="sub">被吃的棋子</h2>
        <ul className="info">
          {chess.captured.map((c, i) => (
            <li key={i}>{pieceLabel(c.side, c.piece)}</li>
          ))}
        </ul>
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
      {chess.result && <ChessResult chess={chess} youId={props.youId} onBack={props.onBackToLobby} />}
    </>
  );
}

function ChessResult({ chess, youId, onBack }: { chess: ChessView; youId: string; onBack: () => void }) {
  const result = chess.result;
  if (!result) return null;
  let headline = '和棋';
  if (result.outcome !== 'draw') {
    const winner = result.outcome === 'red_win' ? 'red' : 'black';
    headline = chess.yourColor === null ? (winner === 'red' ? '红方胜' : '黑方胜') : winner === chess.yourColor ? '你赢了' : '你输了';
  }
  const mine = result.ratingChanges.find((c) => c.userId === youId);
  return (
    <div role="dialog" aria-label="对局结果" aria-modal="true" className="dialog-backdrop">
      <div className="dialog card">
        <h2>{headline}</h2>
        <p>原因：{REASONS[result.reason]}</p>
        {!result.settled ? (
          <p>结算中</p>
        ) : (
          mine && (
            <>
              <p>积分变化：{mine.delta > 0 ? `+${mine.delta}` : String(mine.delta)}</p>
              <p>当前积分：{mine.rating}</p>
            </>
          )
        )}
        <button type="button" onClick={onBack}>
          返回大厅
        </button>
      </div>
    </div>
  );
}

function ChessStatus({ chess }: { chess: ChessView }) {
  const parts: string[] = [];
  if (chess.yourColor) parts.push(chess.yourColor === 'red' ? '你执红' : '你执黑');
  if (chess.status === 'waiting') parts.push('等待对手加入');
  else if (chess.status === 'active') {
    parts.push(chess.turn === chess.yourColor ? '轮到你走棋' : chess.turn === 'red' ? '轮到红方' : '轮到黑方');
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
