CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  payment_type TEXT NOT NULL,
  amount REAL NOT NULL,
  currency TEXT NOT NULL,
  received_at TEXT NOT NULL,
  reference_no TEXT,
  note TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (order_id) REFERENCES sales_orders(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_payments_order_id ON payments(order_id);
