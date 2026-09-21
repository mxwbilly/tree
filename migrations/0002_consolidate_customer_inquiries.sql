-- One quote/order may consolidate multiple product inquiries from one buyer.
CREATE TABLE IF NOT EXISTS sales_order_inquiries (
  order_id TEXT NOT NULL,
  inquiry_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (order_id, inquiry_id),
  FOREIGN KEY (order_id) REFERENCES sales_orders(id),
  FOREIGN KEY (inquiry_id) REFERENCES inquiries(id)
);

-- Preserve links created by the earlier one-inquiry-per-order version.
INSERT OR IGNORE INTO sales_order_inquiries (order_id, inquiry_id, created_at)
SELECT id, inquiry_id, created_at
FROM sales_orders
WHERE inquiry_id IS NOT NULL;

DROP INDEX IF EXISTS idx_sales_orders_inquiry_id;

CREATE INDEX IF NOT EXISTS idx_sales_order_inquiries_order_id
ON sales_order_inquiries(order_id);
