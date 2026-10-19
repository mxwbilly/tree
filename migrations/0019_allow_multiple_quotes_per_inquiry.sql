-- 放开「一个询盘只能关联一份报价单」的限制：允许同一询盘（客户）多次报价、每次独立成单。
-- 原表 inquiry_id 带 UNIQUE 约束，需重建表移除该约束；主键 (order_id, inquiry_id) 保持不变，
-- 因此同一订单仍可合并多个询盘、同一询盘可对应多份报价单（订单）。
CREATE TABLE sales_order_inquiries_new (
  order_id TEXT NOT NULL,
  inquiry_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (order_id, inquiry_id),
  FOREIGN KEY (order_id) REFERENCES sales_orders(id),
  FOREIGN KEY (inquiry_id) REFERENCES inquiries(id)
);

INSERT INTO sales_order_inquiries_new (order_id, inquiry_id, created_at)
  SELECT order_id, inquiry_id, created_at FROM sales_order_inquiries;

DROP TABLE sales_order_inquiries;
ALTER TABLE sales_order_inquiries_new RENAME TO sales_order_inquiries;

CREATE INDEX IF NOT EXISTS idx_sales_order_inquiries_order_id ON sales_order_inquiries(order_id);
CREATE INDEX IF NOT EXISTS idx_sales_order_inquiries_inquiry_id ON sales_order_inquiries(inquiry_id);
