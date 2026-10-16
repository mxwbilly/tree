-- 报价有效期与汇率锁定：报价单/PI 出具时冻结这两项约束，防止汇率波动或改期回溯影响已发出单据。
ALTER TABLE sales_orders ADD COLUMN quote_valid_days INTEGER NOT NULL DEFAULT 30;
ALTER TABLE sales_orders ADD COLUMN quote_valid_until TEXT;
ALTER TABLE sales_orders ADD COLUMN quote_exchange_rate REAL;
ALTER TABLE sales_orders ADD COLUMN quote_exchange_rate_date TEXT;
