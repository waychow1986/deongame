import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import type { ChessReason, ChessView, RoomSnapshot } from '../../shared/protocol.js';
import { api, errorMessage } from '../api.js';
import { ChessBoard, pieceLabel } from '../components/ChessBoard.js';
import { connectSocket } from '../socket.js';

export function RoomPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [room, setRoom] = useState<RoomSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drawDeclined, setDrawDeclined] = useState(false);
  const prevChess = useRef<ChessView | null>(null);

  useEffect(() => {
    const prev = prevChess.current;
    const next = room?.chess ?? null;
    if (prev && next && prev.gameId === next.gameId) {
      const sameMove = JSON.stringify(prev.lastMove) === JSON.stringify(next.lastMove);
      // Our offer disappeared without a move and the game goes on: the opponent declined it.
      if (prev.drawOffer?.by === next.yourColor && !next.drawOffer && next.status === 'active' && sameMove) {
        setDrawDeclined(true);
      } else if (!sameMove || next.drawOffer || next.status !== 'active') {
        setDrawDeclined(false);
      }
    }
    prevChess.current = next;
  }, [room]);

  useEffect(() => {
    let cancelled = false;
    api
      .roomState(id)
      .then(({ room }) => {
        if (!cancelled) setRoom(room);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(errorMessage(err));
      });
    const socket = connectSocket();
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
  }, [id, navigate]);

  async function leave() {
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

  const title = room?.game === 'poker' ? '德州扑克房间' : room?.game === 'chess' ? '中国象棋房间' : '房间';

  return (
    <main className="page">
      <h1>{title}</h1>
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
              drawDeclined={drawDeclined}
              onMove={(from, to) => void act(() => api.chessMove(id, from, to))}
              onResign={() => void act(() => api.chessResign(id))}
              onOfferDraw={() => void act(() => api.chessDrawOffer(id))}
              onRespondDraw={(accept) => void act(() => api.chessDrawResponse(id, accept))}
              onBackToLobby={() => void leave()}
              youId={room.you.userId}
            />
          )}
          {room.poker && <p className="muted">{room.members.length > 1 ? '玩家已入座' : '等待其他玩家加入'}</p>}
        </>
      )}
      {!room?.chess?.result && (
        <div className="actions">
          <button type="button" onClick={() => void leave()}>
            {room?.chess?.status === 'finished' ? '返回大厅' : '离开房间'}
          </button>
        </div>
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
  drawDeclined: boolean;
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
      <ChessStatus chess={chess} drawDeclined={props.drawDeclined} />
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

function ChessStatus({ chess, drawDeclined }: { chess: ChessView; drawDeclined: boolean }) {
  const parts: string[] = [];
  if (chess.yourColor) parts.push(chess.yourColor === 'red' ? '你执红' : '你执黑');
  if (chess.status === 'waiting') parts.push('等待对手加入');
  else if (chess.status === 'active') {
    parts.push(chess.turn === chess.yourColor ? '轮到你走棋' : chess.turn === 'red' ? '轮到红方' : '轮到黑方');
    if (chess.inCheck) parts.push('将军');
    if (chess.drawOffer) parts.push(chess.drawOffer.by === chess.yourColor ? '已提和，等待对方回应' : '对方提和');
    if (drawDeclined) parts.push('对方拒绝了提和');
  } else parts.push('对局已结束');
  return (
    <div role="status" aria-label="对局状态" className="card">
      {parts.join('，')}
    </div>
  );
}
