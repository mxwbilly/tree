-- Completed orders need a stable actual-cost basis. All values are stored in
-- the order currency so later supplier price or FX changes cannot alter it.
ALTER TABLE sales_orders ADD COLUMN actual_product_cost REAL;
ALTER TABLE sales_orders ADD COLUMN actual_freight REAL;
ALTER TABLE sales_orders ADD COLUMN bank_fee REAL;
ALTER TABLE sales_orders ADD COLUMN other_fee REAL;
ALTER TABLE sales_orders ADD COLUMN financial_currency TEXT;
ALTER TABLE sales_orders ADD COLUMN financial_note TEXT;
ALTER TABLE sales_orders ADD COLUMN financial_locked_at TEXT;
ALTER TABLE sales_orders ADD COLUMN financial_locked_by TEXT;

CREATE INDEX IF NOT EXISTS idx_sales_orders_financial_locked_at ON sales_orders(financial_locked_at);
