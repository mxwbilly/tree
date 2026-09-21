// Seller/company info for printed documents (quote/PI/packing list/invoice).
// Configured via env vars (same pattern as ADMIN_EMAIL/SMTP_*) rather than a
// DB table — this is static business info, not something that changes via
// the admin UI day-to-day.
export function getCompanyInfo(env) {
  return {
    name: env.COMPANY_NAME || 'GreenSmart',
    legalName: env.COMPANY_LEGAL_NAME || '',
    addressLines: String(env.COMPANY_ADDRESS || '').split('\n').filter(Boolean),
    email: env.COMPANY_EMAIL || env.ADMIN_EMAIL || '',
    phone: env.COMPANY_PHONE || '',
    website: env.COMPANY_WEBSITE || 'novagardenhome.com',
    registrationNo: env.COMPANY_REGISTRATION_NO || '',
    taxId: env.COMPANY_TAX_ID || '',
    exportId: env.COMPANY_EXPORT_ID || '',
    bankInfo: String(env.COMPANY_BANK_INFO || '').split('\n').filter(Boolean)
  };
}

export async function getConfiguredCompanyInfo(env) {
  const fallback = getCompanyInfo(env);
  if (!env.DB) return fallback;
  try {
    const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'companyProfile'").first();
    const profile = row?.value ? JSON.parse(row.value) : {};
    return {
      ...fallback,
      ...profile,
      addressLines: Array.isArray(profile.addressLines)
        ? profile.addressLines.filter(Boolean)
        : String(profile.address || '').split('\n').filter(Boolean).length
          ? String(profile.address || '').split('\n').filter(Boolean)
          : fallback.addressLines,
      bankInfo: Array.isArray(profile.bankInfo)
        ? profile.bankInfo.filter(Boolean)
        : String(profile.bankInfo || '').split('\n').filter(Boolean).length
          ? String(profile.bankInfo || '').split('\n').filter(Boolean)
          : fallback.bankInfo
    };
  } catch {
    return fallback;
  }
}
