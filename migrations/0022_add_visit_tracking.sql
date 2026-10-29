-- 0022: 新增访问记录表 visits，用于 IP 访问量统计（日报 IP Top10）
-- 字段：ip(访问者IP) / path(访问路径) / country(CF-IPCountry) / user_agent(截断UA) / is_crawler(是否爬虫) / created_at(时间)
-- 现阶段爬虫照常记录（is_crawler=1 标记），用于观察哪些平台抓取站点；后期流量上来后可改为跳过。
-- 保留期 100 天，由定期清理任务（或手动 SQL）处理

CREATE TABLE IF NOT EXISTS visits (
  id TEXT PRIMARY KEY,
  ip TEXT NOT NULL,
  path TEXT,
  country TEXT,
  user_agent TEXT,
  is_crawler INTEGER DEFAULT 0,
  created_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_visits_ip_created_at
ON visits(ip, created_at);

CREATE INDEX IF NOT EXISTS idx_visits_created_at
ON visits(created_at);
