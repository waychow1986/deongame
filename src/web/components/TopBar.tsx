import type { UserDto } from '../../shared/protocol.js';

export function TopBar({ me, onLogout, busy }: { me: UserDto | null; onLogout: () => void; busy: boolean }) {
  return (
    <header className="top-bar">
      <h1>DeonGame</h1>
      <section aria-label="我的信息" className="me">
        {me && (
          <>
            <span className="username">{me.username}</span>
            <span className="stat">
              象棋积分 <span className="value">{me.rating}</span>
            </span>
            <span className="stat">
              扑克筹码{' '}
              <span className="value" data-negative={me.chips < 0 ? 'true' : 'false'}>
                {me.chips}
              </span>
            </span>
          </>
        )}
        <button type="button" disabled={busy} onClick={onLogout}>
          退出登录
        </button>
      </section>
    </header>
  );
}
