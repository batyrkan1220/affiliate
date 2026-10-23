'use strict';
require('dotenv').config();
const crypto = require('crypto');

const bool = (v) => ['1', 'true', 'yes', 'on'].includes(String(v || '').toLowerCase());
const num = (v, d) => (Number.isFinite(+v) && +v > 0 ? +v : d);
const url = (v, d = '') => String(v || d).trim().replace(/\/+$/, '');

const cfg = {
  port: num(process.env.PORT, 3000),
  demo: bool(process.env.DEMO),
  cookieSecure: bool(process.env.COOKIE_SECURE),
  trustProxy: bool(process.env.TRUST_PROXY),
  sessionSecret: process.env.SESSION_SECRET || '',
  // Teliks' own Supabase project: partner logins (Auth) + payout details and requests.
  supabase: {
    url: url(process.env.SUPABASE_URL),
    anonKey: process.env.SUPABASE_ANON_KEY || '',
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  },
  // TrendMe partner API: the numbers (visits, clients, payments, commissions) come from TrendMe.
  trendme: {
    url: url(process.env.TRENDME_API_URL, 'https://trendme.kz'),
    secret: process.env.TRENDME_API_SECRET || '',
  },
  // Self-registration on teliks.ink (REGISTRATION_OPEN=0 closes it; admin can still create logins in TrendMe).
  registration: bool(process.env.DEMO) ? false : process.env.REGISTRATION_OPEN === undefined ? true : bool(process.env.REGISTRATION_OPEN),
  // Public address of this cabinet: tracking links /c/<offer>/<aff> and the postback URL use it.
  publicUrl: url(process.env.PUBLIC_URL, 'https://teliks.ink'),
  defaultCurrency: 'KZT',
};

if (cfg.demo) {
  if (!cfg.sessionSecret) cfg.sessionSecret = crypto.randomBytes(32).toString('hex');
} else {
  const missing = [];
  if (!cfg.supabase.url) missing.push('SUPABASE_URL');
  if (!cfg.supabase.anonKey) missing.push('SUPABASE_ANON_KEY');
  if (!cfg.supabase.serviceKey) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if (!cfg.trendme.secret) missing.push('TRENDME_API_SECRET');
  if (!cfg.sessionSecret) missing.push('SESSION_SECRET');
  if (missing.length) {
    console.error(`\nMissing configuration: ${missing.join(', ')}\nCopy .env.example to .env and fill it in, or run "npm run demo".\n`);
    process.exit(1);
  }
}

module.exports = cfg;
