-- 生产库 greensmart-prod 增量同步脚本（幂等，可重复执行）
-- 生成时间：2026-09-21
-- 作用：把生产 D1 从"半迁移"状态补齐到 schema.sql 的最终形态。
-- 背景：生产库已有 12 张业务表，但部分表缺字段、且缺 payments / sales_order_inquiries 两张表。
-- 注意：所有 ADD COLUMN 均带非空默认值或可空，SQLite 可安全执行；重复执行会因"列已存在"报错，
--       建议执行前先确认各列是否已存在（见下方核对命令）。

-- ============ 1. customers 补字段（对应 0003 + 0012） ============
ALTER TABLE customers ADD COLUMN default_currency TEXT NOT NULL DEFAULT 'USD';
ALTER TABLE customers ADD COLUMN default_incoterm TEXT;
ALTER TABLE customers ADD COLUMN payment_terms TEXT;
ALTER TABLE customers ADD COLUMN default_port TEXT;
ALTER TABLE customers ADD COLUMN shipping_address TEXT;
ALTER TABLE customers ADD COLUMN internal_notes TEXT;

-- ============ 2. sales_orders 补字段（对应 0006/0007/0009/0010 + 财务字段） ============
ALTER TABLE sales_orders ADD COLUMN shipping_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE sales_orders ADD COLUMN expected_delivery_date TEXT;
ALTER TABLE sales_orders ADD COLUMN estimated_shipment_date TEXT;
ALTER TABLE sales_orders ADD COLUMN actual_shipment_date TEXT;
ALTER TABLE sales_orders ADD COLUMN production_status TEXT NOT NULL DEFAULT 'not_started';
ALTER TABLE sales_orders ADD COLUMN fulfillment_timeline_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE sales_orders ADD COLUMN actual_product_cost REAL;
ALTER TABLE sales_orders ADD COLUMN actual_freight REAL;
ALTER TABLE sales_orders ADD COLUMN bank_fee REAL;
ALTER TABLE sales_orders ADD COLUMN other_fee REAL;
ALTER TABLE sales_orders ADD COLUMN financial_currency TEXT;
ALTER TABLE sales_orders ADD COLUMN financial_note TEXT;
ALTER TABLE sales_orders ADD COLUMN financial_locked_at TEXT;
ALTER TABLE sales_orders ADD COLUMN financial_locked_by TEXT;

-- ============ 3. documents 补字段（对应 0004/0008/0011） ============
ALTER TABLE documents ADD COLUMN mail_to TEXT;
ALTER TABLE documents ADD COLUMN mail_status TEXT;
ALTER TABLE documents ADD COLUMN mail_sent_at TEXT;
ALTER TABLE documents ADD COLUMN mail_message_id TEXT;
ALTER TABLE documents ADD COLUMN mail_attempted_at TEXT;
ALTER TABLE documents ADD COLUMN mail_error TEXT;
ALTER TABLE documents ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE documents ADD COLUMN voided_at TEXT;
ALTER TABLE documents ADD COLUMN voided_by TEXT;
ALTER TABLE documents ADD COLUMN void_reason TEXT;

-- ============ 4. 建缺失表 payments（对应 0005） ============
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

-- ============ 5. 建缺失表 sales_order_inquiries（对应 0002） ============
CREATE TABLE IF NOT EXISTS sales_order_inquiries (
  order_id TEXT NOT NULL,
  inquiry_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (order_id, inquiry_id),
  FOREIGN KEY (order_id) REFERENCES sales_orders(id),
  FOREIGN KEY (inquiry_id) REFERENCES inquiries(id)
);
CREATE INDEX IF NOT EXISTS idx_sales_order_inquiries_order_id ON sales_order_inquiries(order_id);

-- ============ 6. documents 缺失索引（schema.sql 有，生产库需确认） ============
CREATE INDEX IF NOT EXISTS idx_documents_order_id ON documents(order_id);
CREATE INDEX IF NOT EXISTS idx_documents_type ON documents(type);
