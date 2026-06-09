/**
 * GreenSmart — optional inquiry API (your own backend / serverless / form service).
 *
 * inquiryApiUrl: POST endpoint. Body: JSON with form fields + lang + source.
 *   Your API must allow CORS from the site origin (or use a same-origin proxy).
 * inquiryApiBearer: optional "Authorization: Bearer …" (do not use high‑privilege
 *   secrets in public static sites; prefer a backend that holds real secrets).
 * gaMeasurementId: optional GA4 Measurement ID, e.g. "G-XXXXXXXXXX".
 *
 * Leave inquiryApiUrl empty to keep the built‑in demo submit (no network).
 */
window.GREENSMART_CONFIG = {
    gaMeasurementId: 'G-Q1RKVL7JZB',
    inquiryApiUrl: '/api/inquiries',
    inquiryApiBearer: ''
};
