-- 报关清单项支持显式选择关联的单据版本。
-- doc_id 指向 documents.id，记录用户为该报关材料选定的单据版本；为空时前端回退到该类型最新版。
ALTER TABLE order_customs_items ADD COLUMN doc_id TEXT;
