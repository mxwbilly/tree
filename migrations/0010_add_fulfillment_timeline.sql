-- Operational export milestones belong to the order workflow, not to the
-- commercial document snapshot. Each node stores a date and optional note.
ALTER TABLE sales_orders ADD COLUMN fulfillment_timeline_json TEXT NOT NULL DEFAULT '{}';
