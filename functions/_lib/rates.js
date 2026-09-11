// Shared by the exchange-rates domain (HTTP lookup) and the Calculation
// Engine (internal use during quote/profit calculations) so "what's the
// current rate for this pair" is defined in exactly one place.
async function findLatestStoredRate(env, base, quote, dateStr) {
  const row = await env.DB.prepare(`
    SELECT * FROM exchange_rates
    WHERE base_currency = ? AND quote_currency = ? AND effective_date <= ?
    ORDER BY effective_date DESC LIMIT 1
  `).bind(base, quote, dateStr).first();
  if (!row) return null;
  return {
    id: row.id,
    baseCurrency: row.base_currency,
    quoteCurrency: row.quote_currency,
    rate: row.rate,
    effectiveDate: row.effective_date
  };
}

// Public rates are synchronized as CNY pairs. A stored direct pair always wins;
// otherwise calculate a cross rate through CNY so costing can use any pair.
export async function getLatestExchangeRate(env, base, quote, dateStr) {
  if (base === quote) {
    return { baseCurrency: base, quoteCurrency: quote, rate: 1, effectiveDate: dateStr, synthetic: true };
  }
  const direct = await findLatestStoredRate(env, base, quote, dateStr);
  if (direct) return direct;

  const bridgeCurrency = 'CNY';
  const [basePerCny, quotePerCny] = await Promise.all([
    base === bridgeCurrency
      ? Promise.resolve({ rate: 1, effectiveDate: dateStr })
      : findLatestStoredRate(env, bridgeCurrency, base, dateStr),
    quote === bridgeCurrency
      ? Promise.resolve({ rate: 1, effectiveDate: dateStr })
      : findLatestStoredRate(env, bridgeCurrency, quote, dateStr)
  ]);
  if (!basePerCny || !quotePerCny || !Number(basePerCny.rate) || !Number(quotePerCny.rate)) return null;

  return {
    baseCurrency: base,
    quoteCurrency: quote,
    rate: Number(quotePerCny.rate) / Number(basePerCny.rate),
    effectiveDate: String(basePerCny.effectiveDate) < String(quotePerCny.effectiveDate)
      ? basePerCny.effectiveDate
      : quotePerCny.effectiveDate,
    synthetic: true,
    source: 'cny-cross'
  };
}
