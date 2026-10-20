CREATE TABLE users (
  id uuid PRIMARY KEY,
  username text NOT NULL UNIQUE CHECK (username ~ '^[a-z0-9_]{3,24}$'),
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE user_settings (
  user_id uuid PRIMARY KEY REFERENCES users(id),
  preferences jsonb NOT NULL DEFAULT '{}'
);
CREATE TABLE wallets (
  user_id uuid PRIMARY KEY REFERENCES users(id),
  balance bigint NOT NULL CHECK (balance BETWEEN 0 AND 9007199254740991)
);
CREATE TABLE sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE TABLE rooms (
  id uuid PRIMARY KEY,
  creator_id uuid NOT NULL REFERENCES users(id),
  creation_action_id uuid NOT NULL,
  seq bigint NOT NULL DEFAULT 0 CHECK (seq >= 0),
  state jsonb NOT NULL,
  UNIQUE (creator_id, creation_action_id)
);
CREATE TABLE room_seats (
  room_id uuid NOT NULL REFERENCES rooms(id),
  seat smallint NOT NULL CHECK (seat BETWEEN 0 AND 8),
  user_id uuid NOT NULL UNIQUE REFERENCES users(id),
  stack bigint NOT NULL CHECK (stack BETWEEN 0 AND 9007199254740991),
  reserved_until timestamptz,
  PRIMARY KEY (room_id, seat)
);
CREATE TABLE hands (
  id uuid PRIMARY KEY,
  room_id uuid NOT NULL REFERENCES rooms(id),
  initial_total bigint NOT NULL CHECK (initial_total > 0),
  private_state jsonb NOT NULL,
  completed boolean NOT NULL DEFAULT false
);
CREATE TABLE room_events (
  room_id uuid NOT NULL REFERENCES rooms(id),
  seq bigint NOT NULL CHECK (seq > 0),
  hand_id uuid REFERENCES hands(id),
  kind text NOT NULL,
  private_view jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, seq)
);
CREATE TABLE action_receipts (
  room_id uuid NOT NULL REFERENCES rooms(id),
  user_id uuid NOT NULL REFERENCES users(id),
  action_id uuid NOT NULL,
  fingerprint text NOT NULL,
  reply jsonb NOT NULL,
  PRIMARY KEY (room_id, user_id, action_id)
);
CREATE TABLE hand_results (
  hand_id uuid NOT NULL REFERENCES hands(id),
  user_id uuid NOT NULL REFERENCES users(id),
  seat smallint NOT NULL,
  start_stack bigint NOT NULL,
  end_stack bigint NOT NULL CHECK (end_stack >= 0),
  payout bigint NOT NULL CHECK (payout >= 0),
  net bigint NOT NULL,
  PRIMARY KEY (hand_id, user_id),
  CHECK (net = end_stack - start_stack)
);
CREATE TABLE chip_ledger (
  entry_id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  room_id uuid REFERENCES rooms(id),
  hand_id uuid REFERENCES hands(id),
  account text NOT NULL CHECK (account IN ('wallet', 'seat')),
  reason text NOT NULL,
  delta bigint NOT NULL,
  balance_after bigint NOT NULL CHECK (balance_after BETWEEN 0 AND 9007199254740991),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((account = 'wallet') OR room_id IS NOT NULL)
);
