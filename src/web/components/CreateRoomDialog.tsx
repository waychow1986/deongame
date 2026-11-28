import { useState, type FormEvent } from 'react';
import type { GameType } from '../../shared/protocol.js';
import { POKER_CAPACITY } from '../../shared/constants.js';
import { gameLabel } from '../../shared/ui/lobby.js';
import { Modal } from './Modal.js';

export type CreateChoice = { game: 'chess'; mode: 'online' | 'ai' } | { game: 'poker'; capacity: number };

const CAPACITY_OPTIONS = Array.from({ length: POKER_CAPACITY - 1 }, (_, i) => i + 2);

export function CreateRoomDialog({
  initialGame,
  busy,
  onConfirm,
  onClose,
}: {
  initialGame: GameType;
  busy: boolean;
  onConfirm: (choice: CreateChoice) => void;
  onClose: () => void;
}) {
  const [game, setGame] = useState<GameType>(initialGame);
  const [mode, setMode] = useState<'online' | 'ai'>('online');
  const [capacity, setCapacity] = useState(POKER_CAPACITY);

  function submit(e: FormEvent) {
    e.preventDefault();
    onConfirm(game === 'chess' ? { game, mode } : { game, capacity });
  }

  return (
    <Modal title="开房间" onClose={onClose}>
      <form className="create-form" onSubmit={submit}>
        <fieldset role="radiogroup" aria-label="游戏类型">
          <legend>游戏类型</legend>
          <div className="choice-row">
            {(['chess', 'poker'] as const).map((g) => (
              <label key={g} className="choice">
                <input type="radio" name="game" value={g} checked={game === g} onChange={() => setGame(g)} />
                {gameLabel(g)}
              </label>
            ))}
          </div>
        </fieldset>
        {game === 'chess' ? (
          <fieldset role="radiogroup" aria-label="对战方式">
            <legend>对战方式</legend>
            <div className="choice-row">
              <label className="choice">
                <input type="radio" name="mode" value="online" checked={mode === 'online'} onChange={() => setMode('online')} />
                联机对战
              </label>
              <label className="choice">
                <input type="radio" name="mode" value="ai" checked={mode === 'ai'} onChange={() => setMode('ai')} />
                和电脑对战
              </label>
            </div>
          </fieldset>
        ) : (
          <label className="field">
            <span>人数上限</span>
            <select aria-label="人数上限" value={capacity} onChange={(e) => setCapacity(Number(e.target.value))}>
              {CAPACITY_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="actions">
          <button type="submit" disabled={busy}>
            确认
          </button>
          <button type="button" className="secondary" onClick={onClose}>
            取消
          </button>
        </div>
      </form>
    </Modal>
  );
}
