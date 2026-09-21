-- Keep issued document numbers auditable while marking documents that must
-- never be sent to customers. Physical deletion would create number gaps.
ALTER TABLE documents ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE documents ADD COLUMN voided_at TEXT;
ALTER TABLE documents ADD COLUMN voided_by TEXT;
ALTER TABLE documents ADD COLUMN void_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_documents_status ON documents(status);
