import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import type { RoomSnapshot } from '../../shared/protocol.js';
import { api, errorMessage } from '../api.js';
import { connectSocket } from '../socket.js';

export function RoomPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [room, setRoom] = useState<RoomSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

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
          {room.chess && <ChessStatus room={room} />}
          {room.poker && <p className="muted">{room.members.length > 1 ? '玩家已入座' : '等待其他玩家加入'}</p>}
        </>
      )}
      <div className="actions">
        <button type="button" onClick={() => void leave()}>
          {room?.chess?.status === 'finished' ? '返回大厅' : '离开房间'}
        </button>
      </div>
    </main>
  );
}

function ChessStatus({ room }: { room: RoomSnapshot }) {
  const chess = room.chess;
  if (!chess) return null;
  const parts: string[] = [];
  if (chess.yourColor) parts.push(chess.yourColor === 'red' ? '你执红' : '你执黑');
  if (chess.status === 'waiting') parts.push('等待对手加入');
  else if (chess.status === 'active') {
    parts.push(chess.turn === chess.yourColor ? '轮到你走棋' : chess.turn === 'red' ? '轮到红方' : '轮到黑方');
  } else parts.push('对局已结束');
  return (
    <div role="status" aria-label="对局状态" className="card">
      {parts.join('，')}
    </div>
  );
}
