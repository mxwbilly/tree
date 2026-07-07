// Seller/company info for printed documents (quote/PI/packing list/invoice).
// Configured via env vars (same pattern as ADMIN_EMAIL/SMTP_*) rather than a
// DB table — this is static business info, not something that changes via
// the admin UI day-to-day.
export function getCompanyInfo(env) {
  return {
    name: env.COMPANY_NAME || 'GreenSmart',
    addressLines: String(env.COMPANY_ADDRESS || '').split('\n').filter(Boolean),
    email: env.COMPANY_EMAIL || env.ADMIN_EMAIL || '',
    phone: env.COMPANY_PHONE || '',
    website: env.COMPANY_WEBSITE || 'novagardenhome.com',
    bankInfo: String(env.COMPANY_BANK_INFO || '').split('\n').filter(Boolean)
  };
}
