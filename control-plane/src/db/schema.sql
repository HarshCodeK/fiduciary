CREATE TABLE IF NOT EXISTS idempotency_keys (
  key TEXT PRIMARY KEY,
  params_hash TEXT NOT NULL,
  status TEXT NOT NULL,               -- 'pending' | 'completed' | 'failed'
  params_json TEXT,                   -- original params (for violation diff)
  response_json TEXT,                 -- cached response for replay
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS consent_tokens (
  token_id TEXT PRIMARY KEY,
  action TEXT NOT NULL,               -- e.g. 'capture_payment'
  amount_paise INTEGER NOT NULL,
  merchant_id TEXT NOT NULL,
  order_id TEXT NOT NULL,             -- bound to a specific order
  issued_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,    -- single-use flag
  signature TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  order_id TEXT PRIMARY KEY,          -- Razorpay order_* id
  product_id TEXT NOT NULL,
  status TEXT NOT NULL,               -- created | authorized | captured | settled | refunded | failed
  amount_paise INTEGER NOT NULL,      -- amount actually paid (effective price)
  sticker_price_paise INTEGER NOT NULL,
  effective_price_paise INTEGER,      -- after offers
  budget_paise INTEGER NOT NULL,
  rescued INTEGER NOT NULL DEFAULT 0, -- 1 if effective price enabled the purchase
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,           -- order_created | idempotency_replay | idempotency_violation | consent_issued | consent_verified | consent_rejected | payment_captured | ...
  actor TEXT NOT NULL DEFAULT 'agent',
  payload_json TEXT NOT NULL,
  prev_hash TEXT NOT NULL,
  this_hash TEXT NOT NULL,            -- sha256(prev_hash + payload_json + seq)
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS purchase_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id TEXT NOT NULL,
  category TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  amount_paise INTEGER NOT NULL,
  purchased_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  product_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  price_paise INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS offers (
  offer_id TEXT PRIMARY KEY,
  product_id TEXT,                    -- null = category-wide or global
  category TEXT,
  type TEXT NOT NULL,                 -- 'percent' | 'flat'
  value INTEGER NOT NULL,             -- percent (20 = 20%) or flat paise
  max_discount_paise INTEGER,         -- cap for percent offers
  active INTEGER NOT NULL DEFAULT 1
);
