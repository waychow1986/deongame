import { useCallback, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import type { GameType, RoomListItem, UserDto } from '../../shared/protocol.js';
import { ACTIVE_GAME_REASON, gameLabel, joinState, roomName, statusLabel } from '../../shared/ui/lobby.js';
import { ApiRequestError, api, errorMessage } from '../api.js';
import { ConnectionStatus, type ConnectionState } from '../components/ConnectionStatus.js';
import { CreateRoomDialog, type CreateChoice } from '../components/CreateRoomDialog.js';
import { ChessIcon, PokerIcon } from '../components/GameIcons.js';
import { TopBar } from '../components/TopBar.js';
import { usePolling } from '../hooks/usePolling.js';

const LOBBY_POLL_MS = 2000;

const GAME_CARDS: { game: GameType; intro: string; Icon: typeof ChessIcon }[] = [
  { game: 'chess', intro: '棋子背面朝上，翻开才知道是谁，与好友或电脑对弈。', Icon: ChessIcon },
  { game: 'poker', intro: '2～9 人同桌，用筹码下注比牌型，可添加电脑玩家。', Icon: PokerIcon },
];

export function LobbyPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const notice = (location.state as { notice?: string } | null)?.notice ?? null;
  const [me, setMe] = useState<UserDto | null>(null);
  const [rooms, setRooms] = useState<RoomListItem[]>([]);
  const [conn, setConn] = useState<ConnectionState>('loading');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialogGame, setDialogGame] = useState<GameType | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [{ rooms }, { user }] = await Promise.all([api.listRooms(), api.me()]);
      setRooms(rooms);
      setMe(user);
      setConn('ok');
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === 'NETWORK_ERROR') setConn('reconnecting');
      else setError(errorMessage(err));
    }
  }, []);

  usePolling(refresh, LOBBY_POLL_MS);

  const activeRoomId = me?.activeRoomId ?? null;
  const hasActiveGame = activeRoomId !== null;

  async function enter(fn: () => Promise<{ room: { roomId: string } }>) {
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

  function onCreate(choice: CreateChoice) {
    setDialogGame(null);
    if (choice.game === 'chess') {
      void enter(() => (choice.mode === 'ai' ? api.createAiGame() : api.createRoom('chess')));
    } else {
      void enter(() => api.createRoom('poker', choice.capacity));
    }
  }

  async function logout() {
    setBusy(true);
    try {
      await api.logout();
      navigate('/login', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="page top">
        <ConnectionStatus state={conn} />
        <TopBar me={me} busy={busy} onLogout={() => void logout()} />
      </div>
      <main className="page lobby">
        <h2 className="lobby-title">游戏大厅</h2>
        {notice && (
          <div role="alert" className="error">
            {notice}
          </div>
        )}
        {error && (
          <div role="alert" className="error">
            {error}
          </div>
        )}
        {activeRoomId && (
          <div className="card resume">
            <p>你有一局进行中的对局</p>
            <button type="button" onClick={() => navigate(`/room/${activeRoomId}`)}>
              回到对局
            </button>
          </div>
        )}
        <div className="game-cards">
          {GAME_CARDS.map(({ game, intro, Icon }) => (
            <button
              key={game}
              type="button"
              className="game-card"
              aria-labelledby={`game-${game}-title game-${game}-intro`}
              disabled={busy || hasActiveGame}
              onClick={() => setDialogGame(game)}
            >
              <Icon className="game-icon" />
              <span className="game-text">
                <span className="game-title" id={`game-${game}-title`}>
                  {gameLabel(game)}
                </span>
                <span className="game-intro" id={`game-${game}-intro`}>
                  {intro}
                </span>
                {hasActiveGame && <span className="game-blocked">{ACTIVE_GAME_REASON}</span>}
              </span>
            </button>
          ))}
        </div>
        <h2 className="lobby-title">房间列表</h2>
        <div className="card table-wrap">
          <table aria-label="房间列表">
            <thead>
              <tr>
                <th scope="col">房间名</th>
                <th scope="col">游戏类型</th>
                <th scope="col">人数</th>
                <th scope="col">状态</th>
                <th scope="col">操作</th>
              </tr>
            </thead>
            <tbody>
              {rooms.map((r) => {
                const state = joinState(r, hasActiveGame);
                return (
                  <tr key={r.id} data-room-id={r.id}>
                    <td className="room-name">{roomName(r)}</td>
                    <td>{gameLabel(r.game)}</td>
                    <td>
                      {r.players}/{r.capacity}
                    </td>
                    <td>
                      <span className="status-badge" data-status={r.status}>
                        {statusLabel(r.status)}
                      </span>
                    </td>
                    <td>
                      <span className="join-cell">
                        <button
                          type="button"
                          disabled={busy || !state.joinable}
                          onClick={() => void enter(() => api.joinRoom(r.id))}
                        >
                          加入
                        </button>
                        {!state.joinable && <span className="join-reason">{state.reason}</span>}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {rooms.length === 0 && <p className="muted empty">暂无房间，点上方的游戏卡片开一个吧</p>}
        </div>
      </main>
      {dialogGame && (
        <CreateRoomDialog
          initialGame={dialogGame}
          busy={busy}
          onConfirm={onCreate}
          onClose={() => setDialogGame(null)}
        />
      )}
    </>
  );
}
