ALTER TABLE sales_orders ADD COLUMN inquiry_id TEXT REFERENCES inquiries(id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_orders_inquiry_id
ON sales_orders(inquiry_id)
WHERE inquiry_id IS NOT NULL;
