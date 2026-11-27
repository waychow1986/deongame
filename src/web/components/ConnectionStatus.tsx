export type ConnectionState = 'loading' | 'ok' | 'reconnecting';

const TEXT: Record<ConnectionState, string> = {
  loading: '加载中…',
  ok: '',
  reconnecting: '连接已断开，正在重连…',
};

export function ConnectionStatus({ state }: { state: ConnectionState }) {
  return (
    <div role="status" aria-label="连接状态" data-state={state} className="connection-status">
      {TEXT[state]}
    </div>
  );
}
