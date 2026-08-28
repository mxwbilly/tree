CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'sales',
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  phone TEXT,
  company TEXT,
  country TEXT,
  source TEXT,
  inquiry_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_inquiry_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_customers_created_at ON customers(created_at);

CREATE TABLE IF NOT EXISTS inquiries (
  id TEXT PRIMARY KEY,
  customer_id TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  assignee_id TEXT,
  lang TEXT,
  source TEXT,
  page_url TEXT,
  product TEXT,
  quantity TEXT,
  oem TEXT,
  port TEXT,
  deadline TEXT,
  message TEXT NOT NULL,
  contact_json TEXT NOT NULL,
  timeline_json TEXT NOT NULL DEFAULT '[]',
  quotes_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  FOREIGN KEY (assignee_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_inquiries_created_at ON inquiries(created_at);
CREATE INDEX IF NOT EXISTS idx_inquiries_status ON inquiries(status);
CREATE INDEX IF NOT EXISTS idx_inquiries_product ON inquiries(product);
CREATE INDEX IF NOT EXISTS idx_inquiries_assignee_id ON inquiries(assignee_id);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS activity_logs (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  actor_id TEXT,
  target_id TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at ON activity_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_activity_logs_target_id ON activity_logs(target_id);

-- ============================================================
-- ERP Phase 1: Master data (Product / Supplier / ExchangeRate / FreightRate)
-- ============================================================

CREATE TABLE IF NOT EXISTS suppliers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  contact_name TEXT,
  contact_phone TEXT,
  contact_email TEXT,
  location TEXT,
  payment_terms TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_suppliers_status ON suppliers(status);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  sku TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT,
  spec_json TEXT NOT NULL DEFAULT '{}',
  packaging_json TEXT NOT NULL DEFAULT '{}',
  default_supplier_id TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (default_supplier_id) REFERENCES suppliers(id)
);

CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
CREATE INDEX IF NOT EXISTS idx_products_status ON products(status);
CREATE INDEX IF NOT EXISTS idx_products_default_supplier_id ON products(default_supplier_id);

-- Cost for a product is NOT a self-maintained BOM calc — it is read from the
-- supplier's own quoted price tiers (SOHO model: production owned upstream).
CREATE TABLE IF NOT EXISTS supplier_price_tiers (
  id TEXT PRIMARY KEY,
  supplier_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  min_qty INTEGER NOT NULL,
  unit_cost REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'CNY',
  valid_from TEXT,
  valid_until TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
  FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE INDEX IF NOT EXISTS idx_supplier_price_tiers_product_id ON supplier_price_tiers(product_id);
CREATE INDEX IF NOT EXISTS idx_supplier_price_tiers_supplier_id ON supplier_price_tiers(supplier_id);

CREATE TABLE IF NOT EXISTS exchange_rates (
  id TEXT PRIMARY KEY,
  base_currency TEXT NOT NULL,
  quote_currency TEXT NOT NULL,
  rate REAL NOT NULL,
  effective_date TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_exchange_rates_pair_date ON exchange_rates(base_currency, quote_currency, effective_date);

-- Rate cards for quoting/CBM planning purposes, not live shipment tracking.
CREATE TABLE IF NOT EXISTS freight_rates (
  id TEXT PRIMARY KEY,
  origin_port TEXT NOT NULL,
  destination_port TEXT NOT NULL,
  container_type TEXT NOT NULL,
  rate REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  forwarder TEXT,
  valid_from TEXT,
  valid_until TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_freight_rates_route ON freight_rates(origin_port, destination_port, container_type);

-- ============================================================
-- ERP Phase 2: SalesOrder aggregate + Document snapshot
-- ============================================================

-- SalesOrder is the sole business-core aggregate: created as early as the
-- first quote (status starts at 'quoted'), carried through to 'paid'/'closed'.
-- current_lines_json holds the *mutable* current line items; each Document
-- below freezes a copy of whatever the lines were at the moment it was issued.
CREATE TABLE IF NOT EXISTS sales_orders (
  id TEXT PRIMARY KEY,
  order_no TEXT NOT NULL UNIQUE,
  customer_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'quoted',
  currency TEXT NOT NULL DEFAULT 'USD',
  current_lines_json TEXT NOT NULL DEFAULT '[]',
  incoterm TEXT,
  deposit_status TEXT NOT NULL DEFAULT 'unpaid',
  total_amount REAL NOT NULL DEFAULT 0,
  notes TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_sales_orders_customer_id ON sales_orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_sales_orders_status ON sales_orders(status);
CREATE INDEX IF NOT EXISTS idx_sales_orders_created_at ON sales_orders(created_at);
CREATE INDEX IF NOT EXISTS idx_sales_orders_status_created_at ON sales_orders(status, created_at);

-- One shared table for all 4 document types (quote / pi / packing_list /
-- invoice). Each row is an immutable snapshot — later changes to the order,
-- product cost, or exchange rate must never alter an already-issued document.
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  type TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  doc_no TEXT,
  snapshot_json TEXT NOT NULL,
  issued_by TEXT,
  issued_at TEXT NOT NULL,
  FOREIGN KEY (order_id) REFERENCES sales_orders(id),
  FOREIGN KEY (issued_by) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_documents_order_id ON documents(order_id);
CREATE INDEX IF NOT EXISTS idx_documents_type ON documents(type);
