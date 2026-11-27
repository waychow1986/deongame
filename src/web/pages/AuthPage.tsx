import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { api, errorMessage } from '../api.js';
import { ConnectionStatus } from '../components/ConnectionStatus.js';

export function AuthPage({ mode }: { mode: 'register' | 'login' }) {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isRegister = mode === 'register';

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (username.trim() === '') {
      setError('用户名为必填项');
      return;
    }
    if (password.trim() === '') {
      setError('密码为必填项');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (isRegister) await api.register(username, password);
      else await api.login(username, password);
      navigate('/lobby', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page narrow auth-page">
      <ConnectionStatus state="ok" />
      <div className="auth-brand">
        <div className="brand-name">DeonGame</div>
        <p className="brand-tagline">盲棋与德州扑克，随时开一局</p>
      </div>
      <div className="card auth-card">
      <h1>{isRegister ? '注册' : '登录'}</h1>
      <form onSubmit={onSubmit} noValidate className="stack">
        <label className="field">
          <span>用户名</span>
          <input
            type="text"
            name="username"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </label>
        <label className="field">
          <span>密码</span>
          <input
            type="password"
            name="password"
            autoComplete={isRegister ? 'new-password' : 'current-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && (
          <div role="alert" className="error">
            {error}
          </div>
        )}
        <button type="submit" disabled={busy}>
          {isRegister ? '注册' : '登录'}
        </button>
      </form>
      <p className="auth-switch">
        {isRegister ? <Link to="/login">已有账号？去登录</Link> : <Link to="/register">没有账号？去注册</Link>}
      </p>
      </div>
    </main>
  );
}
