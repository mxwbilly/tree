ALTER TABLE customers ADD COLUMN default_currency TEXT NOT NULL DEFAULT 'USD';
ALTER TABLE customers ADD COLUMN default_incoterm TEXT;
ALTER TABLE customers ADD COLUMN payment_terms TEXT;
ALTER TABLE customers ADD COLUMN default_port TEXT;
ALTER TABLE customers ADD COLUMN shipping_address TEXT;
ALTER TABLE customers ADD COLUMN internal_notes TEXT;
