import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import type { GameType, RoomListItem, UserDto } from '../../shared/protocol.js';
import { api, errorMessage } from '../api.js';

const GAME_LABEL: Record<GameType, string> = { chess: '中国象棋', poker: '德州扑克' };

export function LobbyPage() {
  const navigate = useNavigate();
  const [me, setMe] = useState<UserDto | null>(null);
  const [rooms, setRooms] = useState<RoomListItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const { rooms } = await api.listRooms();
      setRooms(rooms);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    api
      .me()
      .then(({ user }) => {
        if (cancelled) return;
        if (user.currentRoomId) {
          navigate(`/room/${user.currentRoomId}`, { replace: true });
          return;
        }
        setMe(user);
        void refresh();
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [navigate, refresh]);

  async function act(fn: () => Promise<{ room: { roomId: string } }>) {
    setBusy(true);
    setError(null);
    try {
      const { room } = await fn();
      navigate(`/room/${room.roomId}`);
    } catch (err) {
      setError(errorMessage(err));
      void refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page">
      <h1>游戏大厅</h1>
      <section aria-label="我的信息" className="card">
        {me && (
          <ul className="info">
            <li>用户名：{me.username}</li>
            <li>积分：{me.rating}</li>
            <li>筹码：{me.chips}</li>
          </ul>
        )}
      </section>
      <div className="actions">
        <button type="button" disabled={busy} onClick={() => act(() => api.createRoom('chess'))}>
          开中国象棋房间
        </button>
        <button type="button" disabled={busy} onClick={() => act(() => api.createRoom('poker'))}>
          开德州扑克房间
        </button>
        <button type="button" disabled={busy} onClick={() => act(() => api.createAiGame())}>
          与电脑下盲棋
        </button>
        <button type="button" onClick={() => void refresh()}>
          刷新房间列表
        </button>
      </div>
      {error && (
        <div role="alert" className="error">
          {error}
        </div>
      )}
      <div className="table-wrap">
        <table aria-label="房间列表">
          <thead>
            <tr>
              <th scope="col">游戏类型</th>
              <th scope="col">房主</th>
              <th scope="col">人数</th>
              <th scope="col">状态</th>
              <th scope="col">操作</th>
            </tr>
          </thead>
          <tbody>
            {rooms.map((r) => (
              <tr key={r.id}>
                <td>{GAME_LABEL[r.game]}</td>
                <td>{r.hostUsername}</td>
                <td>
                  {r.players}/{r.capacity}
                </td>
                <td>{r.full ? '已满' : '可加入'}</td>
                <td>
                  {!r.full && (
                    <button type="button" disabled={busy} onClick={() => act(() => api.joinRoom(r.id))}>
                      加入
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rooms.length === 0 && <p className="muted">暂无房间</p>}
      </div>
    </main>
  );
}
