-- 0021: 从产品详情页配置中移除厂家通用的「运输说明 shipping」与「交期说明 leadTime」
-- 这些信息与具体产品无关，已集中到首页优势栏（proof-strip 第 3 张卡片 Export terms and delivery）
-- 详情页仅保留产品专属的 MOQ 阶梯(moqLadder)、规格表、FAQ、图集、相关产品

UPDATE products SET spec_json = json_remove(
  spec_json,
  '$.detail.shipping',
  '$.detail.leadTime',
  '$.detail.translations.vi.shipping',
  '$.detail.translations.vi.leadTime',
  '$.detail.translations.th.shipping',
  '$.detail.translations.th.leadTime',
  '$.detail.translations.id.shipping',
  '$.detail.translations.id.leadTime'
)
WHERE json_extract(spec_json, '$.detail.enabled') = 1;
