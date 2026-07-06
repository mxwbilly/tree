// Shared by the exchange-rates domain (HTTP lookup) and the Calculation
// Engine (internal use during quote/profit calculations) so "what's the
// current rate for this pair" is defined in exactly one place.
export async function getLatestExchangeRate(env, base, quote, dateStr) {
  if (base === quote) {
    return { baseCurrency: base, quoteCurrency: quote, rate: 1, effectiveDate: dateStr, synthetic: true };
  }
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
