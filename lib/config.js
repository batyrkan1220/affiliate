'use strict';
require('dotenv').config();
const crypto = require('crypto');

const bool = (v) => ['1', 'true', 'yes', 'on'].includes(String(v || '').toLowerCase());
const num = (v, d) => (Number.isFinite(+v) && +v > 0 ? +v : d);

const cfg = {
  port: num(process.env.PORT, 3000),
  demo: bool(process.env.DEMO),
  cookieSecure: bool(process.env.COOKIE_SECURE),
  trustProxy: bool(process.env.TRUST_PROXY),
  sessionSecret: process.env.SESSION_SECRET || '',
  o18: {
    base: (process.env.O18_BASE || 'https://api.offer18.com').replace(/\/+$/, ''),
    mid: process.env.O18_MID || '',
    apiKey: process.env.O18_API_KEY || '',
    secretKey: process.env.O18_SECRET_KEY || '',
    bodyFormat: (process.env.O18_BODY_FORMAT || 'form').toLowerCase() === 'json' ? 'json' : 'form',
  },
  registration: bool(process.env.REGISTRATION_OPEN), // регистрация вебмастеров закрыта, пока не включена явно
  newAffiliateStatus: /^approved$/i.test(process.env.NEW_AFFILIATE_STATUS || '') ? 'Approved' : 'Pending',
  reportTz: process.env.REPORT_TZ || '5',
  defaultCurrency: process.env.DEFAULT_CURRENCY || 'USD',
  reportPageSize: num(process.env.REPORT_PAGE_SIZE, 1000),
  reportMaxRows: num(process.env.REPORT_MAX_ROWS, 100000),
};

if (cfg.demo) {
  if (!cfg.sessionSecret) cfg.sessionSecret = crypto.randomBytes(32).toString('hex');
} else {
  const missing = [];
  if (!cfg.o18.mid) missing.push('O18_MID');
  if (!cfg.o18.apiKey) missing.push('O18_API_KEY');
  if (!cfg.o18.secretKey) missing.push('O18_SECRET_KEY');
  if (!cfg.sessionSecret) missing.push('SESSION_SECRET');
  if (missing.length) {
    console.error(
      `\nMissing configuration: ${missing.join(', ')}\n` +
        `Copy .env.example to .env and fill it in, or run "npm run demo" to try the cabinet with sample data.\n`
    );
    process.exit(1);
  }
}

module.exports = cfg;
