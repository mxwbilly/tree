-- Order fulfillment dates stay separate from commercial document status.
-- This lets sales track promised delivery and shipment timing without
-- rewriting the quote/PI/payment workflow.
ALTER TABLE sales_orders ADD COLUMN expected_delivery_date TEXT;
ALTER TABLE sales_orders ADD COLUMN estimated_shipment_date TEXT;
ALTER TABLE sales_orders ADD COLUMN actual_shipment_date TEXT;
ALTER TABLE sales_orders ADD COLUMN production_status TEXT NOT NULL DEFAULT 'not_started';

CREATE INDEX IF NOT EXISTS idx_sales_orders_expected_delivery
  ON sales_orders(expected_delivery_date);
