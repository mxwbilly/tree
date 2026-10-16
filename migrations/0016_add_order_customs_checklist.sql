-- 报关材料清单：订单出运阶段的逐项材料核对表。
-- 每条记录代表一项需准备的报关材料，状态流转 pending(待准备) -> ready(已备齐) -> submitted(已提交货代)。
-- 按订单生成默认通用模板（约 10 项），可增删，支持记录谁在何时提交。
CREATE TABLE IF NOT EXISTS order_customs_items (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  item_key TEXT NOT NULL,
  label TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  checked_by TEXT,
  checked_at TEXT,
  note TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (order_id) REFERENCES sales_orders(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_order_customs_items_order_id ON order_customs_items(order_id);
