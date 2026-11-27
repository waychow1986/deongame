CREATE TABLE users (
  id uuid PRIMARY KEY,
  username text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  rating integer NOT NULL DEFAULT 1000,
  chips_balance bigint NOT NULL DEFAULT 1000,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE INDEX sessions_user_id_idx ON sessions(user_id);

CREATE TABLE chess_results (
  game_id uuid PRIMARY KEY,
  red_user_id uuid NOT NULL,
  black_user_id uuid NULL,
  mode text NOT NULL,
  outcome text NOT NULL,
  reason text NOT NULL,
  finished_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE poker_settlements (
  hand_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id),
  delta bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (hand_id, user_id)
);
