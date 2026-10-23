'use strict';
const path = require('path');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const cfg = require('./lib/config');
const db = require('./lib/supabase');
const mock = require('./lib/mock');
const trendme = require('./lib/trendme');
const { ApiError } = require('./lib/errors');
const stats = require('./lib/stats');
const offers = require('./lib/offers');
const payouts = require('./lib/payouts');
const cpa = require('./lib/cpa');

const app = express();
if (cfg.trustProxy) app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'"],
        'style-src': ["'self'", 'https://fonts.googleapis.com'],
        'font-src': ['https://fonts.gstatic.com'],
        'img-src': ["'self'", 'https:', 'data:'],
        'connect-src': ["'self'"],
        'frame-ancestors': ["'none'"],
        'base-uri': ["'self'"],
        'form-action': ["'self'"],
      },
    },
  })
);
app.use(express.json({ limit: '32kb' }));
app.use(
  session({
    name: 'wm.sid',
    secret: cfg.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', secure: cfg.cookieSecure, maxAge: 1000 * 60 * 60 * 12 },
  })
);

// State-changing calls must come from our own frontend (blocks simple cross-site form posts).
// /api/v1 is the advertiser API (authorised by its key, called server-to-server).
app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/v1/')) return next();
  if (req.method !== 'GET' && req.get('x-requested-with') !== 'fetch') {
    return res.status(400).json({ error: 'bad_request' });
  }
  next();
});

const baseUrl = (req) => (cfg.demo ? `${req.protocol}://${req.get('host')}` : cfg.publicUrl);
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);
const requireAuth = (req, res, next) => (req.session.aff ? next() : res.status(401).json({ error: 'unauthorized' }));
const tooMany = (req, res) => res.status(429).json({ error: 'too_many_requests' });
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, handler: tooMany });
const payoutLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 20, handler: tooMany });
const requestLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 30, handler: tooMany });

/* ───────────────────────── auth ───────────────────────── */
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;
const str = (v, max = 120) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function startSession(req, aff) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => {
      if (err) return reject(err);
      req.session.aff = aff;
      resolve();
    });
  });
}

app.post('/api/auth/login', loginLimiter, wrap(async (req, res) => {
  const email = str(req.body.email, 254).toLowerCase();
  const password = typeof req.body.password === 'string' ? req.body.password.slice(0, 200) : '';
  if (!EMAIL_RE.test(email) || !password) throw new ApiError('Invalid email or password', 401, 'invalid_credentials');
  // Partner logins live in Teliks' Supabase Auth; the partner row maps the login to a TrendMe partner code.
  const { userId } = cfg.demo ? mock.signIn(email, password) : await db.signIn(email, password);
  const partner = cfg.demo ? mock.partner() : await db.partnerByUser(userId);
  if (!partner || !partner.active) throw new ApiError('Account is not active', 403, 'account_inactive');
  if (!cfg.demo) {
    // TrendMe can also switch a partner off (then there are no new clients or commissions).
    const today = new Date(Date.now() + 5 * 3600 * 1000).toISOString().slice(0, 10);
    // If TrendMe is asleep or unreachable the login still works (Teliks data is local); it is woken up meanwhile.
    trendme.wake();
    const s = await trendme.summarySafe(partner.trendme_code, today, today).catch((e) => (e.code === 'partner_not_found' ? null : Promise.reject(e)));
    if (!s || !s.partner || s.partner.active === false) throw new ApiError('Account is not active', 403, 'account_inactive');
  }
  await startSession(req, { id: partner.trendme_code, uid: userId, email, name: partner.name, admin: !!partner.is_admin });
  res.json({ id: partner.trendme_code, email, name: partner.name });
}));

app.get('/api/auth/config', (req, res) => res.json({ registration: cfg.registration }));

const registerLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 5, handler: tooMany });

// Self-registration: login in Teliks' Supabase Auth → partner created in TrendMe (default %) → linked here.
app.post('/api/auth/register', registerLimiter, wrap(async (req, res) => {
  if (!cfg.registration) throw new ApiError('Registration is closed', 403, 'registration_closed');
  const b = req.body || {};
  const email = str(b.email, 254).toLowerCase();
  const password = typeof b.password === 'string' ? b.password.slice(0, 200) : '';
  const firstName = str(b.firstName, 60);
  const lastName = str(b.lastName, 60);
  const mobile = str(b.mobile, 20).replace(/[^\d+]/g, '');
  const country = str(b.country, 60);
  const imType = ['telegram', 'whatsapp', 'instagram', 'skype', 'other'].includes(b.imType) ? b.imType : 'telegram';
  const imValue = str(b.imValue, 80);
  const company = str(b.company, 100);
  const bad = (field) => { throw new ApiError('Invalid ' + field, 400, 'invalid_' + field); };
  if (!firstName) bad('firstName');
  if (!lastName) bad('lastName');
  if (!EMAIL_RE.test(email)) bad('email');
  if (password.length < 8) bad('password');
  if (mobile.replace(/\D/g, '').length < 7) bad('mobile');
  if (!country) bad('country');
  if (!imValue) bad('imValue');
  if (cfg.demo) throw new ApiError('Registration is closed in demo mode', 403, 'registration_closed');

  const name = `${firstName} ${lastName}`.slice(0, 80);
  const userId = await db.createUser(email, password, name);
  let p;
  try {
    // TrendMe gets only what it needs (name, Telegram username); email and contacts stay in Teliks.
    p = await trendme.createPartner({ name, teliksUserId: userId, telegram: imType === 'telegram' ? imValue : undefined });
    await db.insertPartner({ user_id: userId, trendme_code: p.code, name, email, active: p.active !== false });
  } catch (e) {
    await db.deleteUser(userId);
    throw e;
  }
  if (p.active === false) return res.json({ pending: true });
  await startSession(req, { id: p.code, uid: userId, email, name });
  res.json({ id: p.code, email, name, pending: false });
}));

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('wm.sid');
    res.json({ ok: true });
  });
});

app.get('/api/me', requireAuth, (req, res) => {
  const a = req.session.aff;
  res.json({ id: a.id, email: a.email, name: a.name || '', demo: cfg.demo, admin: !!a.admin });
});

/* ───────────────────────── helpers ───────────────────────── */
function rangeOf(req) {
  let from = String(req.query.from || ''), to = String(req.query.to || '');
  if (!from && !to) { // default: the last 30 days (Almaty)
    to = new Date(Date.now() + 5 * 3600 * 1000).toISOString().slice(0, 10);
    from = new Date(Date.parse(to) - 29 * 86400000).toISOString().slice(0, 10);
  }
  const r = stats.validRange(from, to);
  if (!r) throw new ApiError('Invalid date range (max 92 days)', 400, 'invalid_range');
  return r;
}

const csvCell = (v) => {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // neutralise spreadsheet formula injection
  return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

/* ───────────────────────── dashboard ───────────────────────── */
app.get('/api/dashboard', requireAuth, wrap(async (req, res) => {
  const r = rangeOf(req);
  const aff = req.session.aff;
  const prev = stats.previousRange(r);
  const [cur, before] = await Promise.all([stats.getRows(aff, r.from, r.to), stats.getRows(aff, prev.from, prev.to)]);
  const names = await offerNames(req);
  const topOffers = stats.group(cur.rows, 'offer').slice(0, 6).map((o) => ({ ...o, label: o.label || names.get(o.key) || '' }));
  res.json({
    range: r,
    currency: stats.currencyOf(cur.rows),
    truncated: cur.truncated,
    totals: stats.total(cur.rows),
    previous: stats.total(before.rows),
    daily: stats.dailySeries(cur.rows, r.from, r.to),
    topOffers,
    topCountries: stats.group(cur.rows, 'country').slice(0, 6),
  });
}));

async function offerNames(req) {
  try {
    return new Map((await offers.forAffiliateList(req.session.aff, baseUrl(req))).map((o) => [o.id, o.name]));
  } catch {
    return new Map();
  }
}

/* ───────────────────────── statistics ───────────────────────── */
async function buildStats(req) {
  const r = rangeOf(req);
  const by = Object.prototype.hasOwnProperty.call(stats.GROUPS, req.query.group) ? req.query.group : 'date';
  const offer = String(req.query.offer || '').slice(0, 40);
  const data = await stats.getRows(req.session.aff, r.from, r.to);
  const rows = offer ? data.rows.filter((x) => x.offerId === offer) : data.rows;
  const names = by === 'offer' ? await offerNames(req) : new Map();
  const groups = stats.group(rows, by).map((g) => (by === 'offer' ? { ...g, label: g.label || names.get(g.key) || '' } : g));
  return { range: r, by, currency: stats.currencyOf(data.rows), truncated: data.truncated, totals: stats.total(rows), rows: groups };
}

app.get('/api/stats', requireAuth, wrap(async (req, res) => res.json(await buildStats(req))));

app.get('/api/stats/export.csv', requireAuth, wrap(async (req, res) => {
  const s = await buildStats(req);
  const head = [s.by, 'impressions', 'clicks', 'unique_clicks', 'conversions', 'approved', 'pending', 'rejected', 'earnings', 'approved_earnings', 'pending_earnings', 'cr_percent', 'epc'];
  const lines = [head.join(',')];
  for (const g of s.rows) {
    lines.push([
      g.label ? `${g.key} ${g.label}` : g.key, g.impressions, g.clicks, g.unique, g.conversions, g.approved, g.pending, g.rejected,
      g.earnings, g.approvedEarnings, g.pendingEarnings, (g.cr * 100).toFixed(2), g.epc.toFixed(4),
    ].map(csvCell).join(','));
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="stats_${s.by}_${s.range.from}_${s.range.to}.csv"`);
  res.send('\uFEFF' + lines.join('\r\n'));
}));

/* ───────────────────────── conversions log ───────────────────────── */
app.get('/api/conversions', requireAuth, wrap(async (req, res) => {
  const r = rangeOf(req);
  const status = ['approved', 'pending', 'rejected'].includes(req.query.status) ? req.query.status : '';
  const offer = String(req.query.offer || '').slice(0, 40);
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const perPage = 50;
  const data = await stats.getRows(req.session.aff, r.from, r.to);
  const all = stats.conversionLog(data.rows, { status, offer });
  const slice = all.slice((page - 1) * perPage, page * perPage);
  res.json({
    range: r, currency: stats.currencyOf(data.rows), truncated: data.truncated,
    total: all.length, page, perPage,
    rows: slice.map((x) => ({
      time: x.time, offerId: x.offerId, offerName: x.offerName, event: x.event, price: x.price, currency: x.currency,
      status: x.status, country: x.country, clickId: x.clickId, sub1: x.sub1, sub2: x.sub2, sub3: x.sub3, sub4: x.sub4, sub5: x.sub5,
    })),
  });
}));

/* ───────────────────────── offers ───────────────────────── */
const inList = (arr, v) => arr.some((x) => x.toLowerCase() === v.toLowerCase());

app.get('/api/offers', requireAuth, wrap(async (req, res) => {
  const all = await offers.forAffiliateList(req.session.aff, baseUrl(req));
  const q = String(req.query.q || '').trim().toLowerCase().slice(0, 80);
  const category = String(req.query.category || '');
  const model = String(req.query.model || '');
  const country = String(req.query.country || '');
  const access = ['approved', 'open', 'pending'].includes(req.query.access) ? req.query.access : '';

  const facets = {
    categories: [...new Set(all.flatMap((o) => o.categories))].sort(),
    models: [...new Set(all.map((o) => o.model).filter(Boolean))].sort(),
    countries: [...new Set(all.flatMap((o) => o.geo.allow))].sort(),
  };

  let rows = all.filter((o) =>
    (!q || o.name.toLowerCase().includes(q) || o.id.includes(q)) &&
    (!category || inList(o.categories, category)) &&
    (!model || o.model.toLowerCase() === model.toLowerCase()) &&
    (!country || !o.geo.allow.length || inList(o.geo.allow, country)) &&
    (!access || o.access === access)
  );
  const rank = { approved: 0, pending: 1, open: 2, rejected: 3 };
  rows.sort((a, b) => rank[a.access] - rank[b.access] || a.name.localeCompare(b.name));

  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const perPage = 24;
  res.json({ total: rows.length, page, perPage, facets, rows: rows.slice((page - 1) * perPage, page * perPage) });
}));

// Compact list of connected offers (for selects and the link builder).
app.get('/api/offers/approved', requireAuth, wrap(async (req, res) => {
  const all = await offers.forAffiliateList(req.session.aff, baseUrl(req));
  res.json(
    all.filter((o) => o.access === 'approved')
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((o) => ({ id: o.id, name: o.name, trackingUrl: o.trackingUrl, impressionUrl: o.impressionUrl }))
  );
}));

app.get('/api/offers/:id', requireAuth, wrap(async (req, res) => {
  const all = await offers.forAffiliateList(req.session.aff, baseUrl(req));
  const o = all.find((x) => x.id === req.params.id);
  if (!o) return res.status(404).json({ error: 'not_found' });
  res.json(o);
}));

app.post('/api/offers/request', requireAuth, requestLimiter, wrap(async (req, res) => {
  const ids = Array.isArray(req.body && req.body.offerIds) ? req.body.offerIds.map(String) : [];
  res.json({ result: await offers.requestAccess(req.session.aff, ids) });
}));

/* ───────────────────────── partner postback (global) ───────────────────────── */
app.get('/api/postback', requireAuth, wrap(async (req, res) => {
  const p = await cpa.store.partnerByUid(req.session.aff.uid);
  res.json({ url: (p && p.postback_url) || '' });
}));

app.put('/api/postback', requireAuth, payoutLimiter, wrap(async (req, res) => {
  const v = cpa.validPostbackUrl(String((req.body && req.body.url) || ''));
  if (v === null) throw new ApiError('Postback URL must be https://', 400, 'invalid_postback');
  await cpa.store.setPostback(req.session.aff.uid, v);
  res.json({ url: v || '' });
}));

/* ───────────────────────── finance ───────────────────────── */
// Balance = TrendMe (earned − paid there) + Teliks offers (approved − paid from Teliks) − open requests.
// Conversions still on hold or waiting for the advertiser are shown as "pending".
async function balanceOf(aff, tmLifetime) {
  const [processing, nat, paid] = await Promise.all([payouts.processing(aff.uid), cpa.store.balances(aff.uid), payouts.paidRows(aff.uid)]);
  const n = nat[0] || { approved_kzt: 0, pending_kzt: 0 };
  const paidNative = paid.reduce((x, p) => x + Math.max(0, p.amount_kzt - (p.trendme_kzt == null ? p.amount_kzt : p.trendme_kzt)), 0);
  const tmAvail = Math.max(0, tmLifetime.earnedKzt - tmLifetime.paidOutKzt);
  const earned = tmLifetime.earnedKzt + n.approved_kzt;
  const paidAll = tmLifetime.paidOutKzt + paidNative;
  return {
    available: Math.max(0, Math.floor(tmAvail + n.approved_kzt - paidNative - processing)),
    pending: Math.round(n.pending_kzt), processing, paid: paidAll, earned: Math.round(earned),
    tmAvail, nativeAvail: Math.max(0, n.approved_kzt - paidNative),
  };
}

// strict: TrendMe must answer (used before creating a request, so the balance is exact).
async function financeOf(aff, { strict = false } = {}) {
  const today = new Date(Date.now() + 5 * 3600 * 1000).toISOString().slice(0, 10);
  const [s, details, list] = await Promise.all([
    strict ? trendme.summary(aff.id, today, today) : trendme.summarySafe(aff.id, today, today),
    payouts.getDetails(aff.uid),
    payouts.listFor(aff.uid),
  ]);
  const b = await balanceOf(aff, s.lifetime);
  return {
    currency: 'KZT',
    minPayout: payouts.MIN,
    balance: { available: b.available, pending: b.pending, processing: b.processing, paid: b.paid, earned: b.earned },
    partial: !!s.unavailable, // TrendMe asleep: its part of the balance is not counted yet
    details,
    openRequest: list.some((p) => p.status === 'pending'),
    payouts: list.slice(0, 50).map((p) => ({ id: p.id, ref: p.ref, note: p.note, amount: p.amount, method: p.method, details: p.details, status: p.status, createdAt: p.createdAt, processedAt: p.processedAt })),
  };
}

app.get('/api/finance', requireAuth, wrap(async (req, res) => res.json(await financeOf(req.session.aff))));

app.put('/api/finance/details', requireAuth, payoutLimiter, wrap(async (req, res) => {
  const d = await payouts.setDetails(req.session.aff.uid, String(req.body.method || ''), req.body.value);
  if (!d) throw new ApiError('Invalid payment details', 400, 'invalid_details');
  res.json({ details: d });
}));

app.post('/api/finance/payout', requireAuth, payoutLimiter, wrap(async (req, res) => {
  const aff = req.session.aff;
  let f;
  try { f = await financeOf(aff, { strict: true }); } catch (e) {
    if (e.code === 'upstream_unavailable' || e.code === 'upstream_error') throw new ApiError('Balance is being recalculated, try again in a minute', 503, 'balance_unavailable');
    throw e;
  }
  const r = await payouts.request(aff.uid, req.body.amount, f.balance.available);
  if (r.error) throw new ApiError('Payout request rejected', r.error === 'has_pending' ? 409 : 400, r.error);
  res.json(await financeOf(aff));
}));

app.post('/api/finance/payout/:id/cancel', requireAuth, payoutLimiter, wrap(async (req, res) => {
  if (!/^[0-9a-f-]{36}$/.test(req.params.id)) throw new ApiError('Bad request', 400, 'bad_request');
  await payouts.cancel(req.session.aff.uid, req.params.id);
  res.json(await financeOf(req.session.aff));
}));

/* ───────────────────────── Teliks admin ───────────────────────── */
// Teliks has its own admin (partners.is_admin in Teliks' Supabase). TrendMe never reads this data;
// a paid request is reported to TrendMe only as "partner <code> was paid N ₸".
const requireAdmin = (req, res, next) => (req.session.aff && req.session.aff.admin ? next() : res.status(403).json({ error: 'forbidden' }));

const demoPartners = () => [
  { user_id: 'demo-user', trendme_code: 'demo2026', name: 'Demo partner', email: 'teliks.demo@example.com', active: true, is_admin: true, payout_method: 'kaspi', payout_value: '4400430212345678', created_at: '2026-10-01T00:00:00Z' },
];
const adminPartners = () => (cfg.demo ? Promise.resolve(demoPartners()) : db.listPartners());
const adminRequests = () => payouts.allRows();
const partnerFor = async (uid) => {
  if (!cfg.demo) return db.partnerByUser(uid);
  const p = demoPartners().find((x) => x.user_id === uid);
  const d = p && (await payouts.getDetails(uid));
  return p ? { ...p, ...(d ? { payout_method: d.method, payout_value: d.value } : {}) } : null;
};

function requestView(r, byUser) {
  const p = byUser.get(r.user_id) || {};
  return { id: r.id, code: p.trendme_code || '', name: p.name || '', email: p.email || '', amount: r.amount_kzt, method: r.method, details: r.details, status: r.status, createdAt: r.created_at, processedAt: r.processed_at, note: r.note || '', ref: r.paid_ref || '', processedBy: r.processed_by || '' };
}

// Network dashboard: TrendMe numbers (per partner, per day, conversions) + Teliks data (accounts, payouts).
app.get('/api/admin/dashboard', requireAuth, requireAdmin, wrap(async (req, res) => {
  const r = rangeOf(req);
  const [ov, partners, requests, nat, paidRows] = await Promise.all([require('./lib/trendme').overviewSafe(r.from, r.to), adminPartners(), adminRequests(), cpa.store.balances(null), payouts.paidRows(null)]);
  if (ov.unavailable) { // TrendMe asleep: list Teliks partners with empty TrendMe numbers
    const { ZERO } = require('./lib/trendme');
    ov.partners = partners.map((p) => ({ code: p.trendme_code, name: p.name, percent: null, active: p.active, telegram: null, createdAt: p.created_at, link: '', period: { ...ZERO }, lifetime: { ...ZERO, balanceKzt: 0 } }));
  }
  const byCode = new Map(partners.map((p) => [p.trendme_code, p]));
  const natBy = new Map(nat.map((b) => [b.user_id, b]));
  const paidNat = new Map();
  for (const x of paidRows) paidNat.set(x.user_id, (paidNat.get(x.user_id) || 0) + Math.max(0, x.amount_kzt - (x.trendme_kzt == null ? x.amount_kzt : x.trendme_kzt)));
  const byUser = new Map(partners.map((p) => [p.user_id, p]));
  const inRange = (iso) => { const d = new Date(Date.parse(iso) + 5 * 3600000).toISOString().slice(0, 10); return d >= r.from && d <= r.to; };
  const reqs = requests.map((x) => requestView(x, byUser));
  const sum = (arr) => arr.reduce((n, x) => n + x.amount, 0);
  const rows = ov.partners.map((p) => {
    const t = byCode.get(p.code);
    const mine = reqs.filter((x) => x.code === p.code);
    const processing = sum(mine.filter((x) => x.status === 'processing'));
    const nb = t ? natBy.get(t.user_id) : null;
    const native = { approvedKzt: nb ? Math.round(nb.approved_kzt) : 0, pendingKzt: nb ? Math.round(nb.pending_kzt) : 0, paidKzt: t ? paidNat.get(t.user_id) || 0 : 0 };
    native.balanceKzt = Math.max(0, native.approvedKzt - native.paidKzt);
    return {
      ...p,
      native,
      teliks: t ? { uid: t.user_id, email: t.email || '', active: t.active, admin: t.is_admin, payout: t.payout_method ? `${t.payout_method} ${t.payout_value}` : '', registeredAt: t.created_at } : null,
      processingKzt: processing,
      availableKzt: Math.max(0, p.lifetime.balanceKzt + native.balanceKzt - processing),
    };
  });
  const T = (k) => ov.partners.reduce((n, p) => n + (p.period[k] || 0), 0);
  res.json({
    trendmeUnavailable: !!ov.unavailable,
    range: r,
    totals: {
      partners: ov.partners.length, activePartners: ov.partners.filter((p) => p.active).length,
      newPartners: partners.filter((p) => inRange(p.created_at)).length,
      visits: T('visits'), users: T('users'), buyers: T('buyers'), paidOrders: T('paidOrders'), revenueKzt: T('revenueKzt'),
      earnedKzt: T('earnedKzt'), reversedKzt: T('reversedKzt'),
      paidOutKzt: sum(reqs.filter((x) => x.status === 'paid' && x.processedAt && inRange(x.processedAt))),
      processingKzt: sum(reqs.filter((x) => x.status === 'processing')), processingCount: reqs.filter((x) => x.status === 'processing').length,
      balanceKzt: rows.reduce((n, p) => n + p.lifetime.balanceKzt + p.native.balanceKzt, 0),
    },
    daily: ov.daily,
    partners: rows,
    commissions: ov.commissions.map((c) => ({ ...c, name: (byCode.get(c.code) || {}).name || c.code })),
    requests: reqs,
  });
}));

app.get('/api/admin/partner/:code', requireAuth, requireAdmin, wrap(async (req, res) => {
  if (!/^[a-z0-9]{4,24}$/.test(req.params.code)) throw new ApiError('Bad request', 400, 'bad_request');
  const r = rangeOf(req);
  const [s, partners, requests] = await Promise.all([require('./lib/trendme').summarySafe(req.params.code, r.from, r.to), adminPartners(), adminRequests()]);
  const byUser = new Map(partners.map((p) => [p.user_id, p]));
  const t = partners.find((p) => p.trendme_code === req.params.code) || null;
  res.json({
    range: r, summary: s,
    teliks: t ? { uid: t.user_id, email: t.email || '', active: t.active, admin: t.is_admin, payout: t.payout_method ? `${t.payout_method} ${t.payout_value}` : '', registeredAt: t.created_at } : null,
    requests: requests.filter((x) => t && x.user_id === t.user_id).map((x) => requestView(x, byUser)),
  });
}));

app.get('/api/admin/requests.csv', requireAuth, requireAdmin, wrap(async (req, res) => {
  const status = ['processing', 'paid', 'rejected', 'cancelled'].includes(req.query.status) ? req.query.status : '';
  const [partners, requests] = await Promise.all([adminPartners(), adminRequests()]);
  const byUser = new Map(partners.map((p) => [p.user_id, p]));
  const rows = requests.map((x) => requestView(x, byUser)).filter((x) => !status || x.status === status);
  const lines = [['created_at', 'processed_at', 'status', 'partner', 'email', 'code', 'amount_kzt', 'method', 'details', 'payment_ref', 'note', 'processed_by'].join(',')];
  for (const x of rows) lines.push([x.createdAt, x.processedAt || '', x.status, x.name, x.email, x.code, x.amount, x.method, x.details, x.ref, x.note, x.processedBy].map(csvCell).join(','));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="teliks_payouts${status ? '_' + status : ''}.csv"`);
  res.send('\uFEFF' + lines.join('\r\n'));
}));

// Balance check for one request: what the partner has without this request (TrendMe must answer).
async function requestCheck(r) {
  const p = await partnerFor(r.user_id);
  if (!p) throw new ApiError('Partner not found', 404, 'partner_not_found');
  const today = new Date(Date.now() + 5 * 3600 * 1000).toISOString().slice(0, 10);
  const [s, nat, paid, rows] = await Promise.all([
    trendme.summary(p.trendme_code, today, today).catch((e) => (e.code === 'partner_not_found' ? { lifetime: { earnedKzt: 0, paidOutKzt: 0 } } : Promise.reject(e))),
    cpa.store.balances(r.user_id), payouts.paidRows(r.user_id), payouts.allRows(),
  ]);
  const n = nat[0] || { approved_kzt: 0, pending_kzt: 0 };
  const paidNative = paid.reduce((x, q) => x + Math.max(0, q.amount_kzt - (q.trendme_kzt == null ? q.amount_kzt : q.trendme_kzt)), 0);
  const tm = { earned: s.lifetime.earnedKzt, paid: s.lifetime.paidOutKzt, available: Math.max(0, s.lifetime.earnedKzt - s.lifetime.paidOutKzt) };
  const cpaB = { approved: Math.round(n.approved_kzt), pending: Math.round(n.pending_kzt), paid: paidNative, available: Math.max(0, Math.floor(n.approved_kzt - paidNative)) };
  const otherOpen = rows.filter((x) => x.user_id === r.user_id && x.status === 'processing' && x.id !== r.id).reduce((a, x) => a + x.amount_kzt, 0);
  const available = Math.max(0, tm.available + cpaB.available - otherOpen);
  return { partner: { code: p.trendme_code, name: p.name, email: p.email || '', active: p.active, payout: p.payout_method ? `${p.payout_method} ${p.payout_value}` : '' }, tm, cpa: cpaB, otherOpen, available, enough: r.amount_kzt <= available, detailsChanged: !!p.payout_value && p.payout_value !== r.details };
}

app.get('/api/admin/requests/:id/check', requireAuth, requireAdmin, wrap(async (req, res) => {
  if (!/^[0-9a-f-]{36}$/.test(req.params.id)) throw new ApiError('Bad request', 400, 'bad_request');
  const r = await payouts.getRow(req.params.id);
  if (!r) throw new ApiError('Not found', 404, 'not_found');
  const byUser = new Map((await adminPartners()).map((p) => [p.user_id, p]));
  res.json({ request: requestView(r, byUser), check: r.status === 'processing' ? await requestCheck(r) : null });
}));

app.post('/api/admin/requests/:id', requireAuth, requireAdmin, payoutLimiter, wrap(async (req, res) => {
  const b = req.body || {};
  const action = b.action;
  if (!['paid', 'rejected'].includes(action) || !/^[0-9a-f-]{36}$/.test(req.params.id)) throw new ApiError('Bad request', 400, 'bad_request');
  const ref = str(b.ref, 200);
  const note = str(b.note, 300);
  const r = await payouts.getRow(req.params.id);
  if (!r || r.status !== 'processing') throw new ApiError('Заявка уже обработана', 409, 'already_processed');
  if (action === 'rejected' && note.length < 3) throw new ApiError('Укажите причину отказа — партнёр её увидит', 400, 'note_required');
  if (action === 'paid') {
    const c = await requestCheck(r);
    if (!c.enough && b.force !== true) throw new ApiError(`Недостаточно баланса: доступно ${c.available} ₸, в заявке ${r.amount_kzt} ₸. Возможно, часть конверсий отменили.`, 409, 'insufficient');
    // The part covered by TrendMe earnings is recorded in TrendMe (idempotent by request id);
    // the rest pays Teliks-offer earnings. The split is saved first so a retry repeats it exactly.
    let tmPart = r.trendme_kzt;
    if (tmPart == null) {
      tmPart = Math.min(r.amount_kzt, c.tm.available);
      await payouts.setTrendmePart(r.id, tmPart);
    }
    if (tmPart > 0) await trendme.recordPayout(c.partner.code, tmPart, r.id);
  }
  const ok = await payouts.close(r.id, action, { note: note || null, paid_ref: action === 'paid' ? ref || null : null, processed_by: req.session.aff.email || null });
  if (!ok) throw new ApiError('Заявка уже обработана', 409, 'already_processed');
  res.json({ ok: true });
}));

app.post('/api/admin/partners/:uid', requireAuth, requireAdmin, wrap(async (req, res) => {
  if (!/^[0-9a-f-]{36}$/.test(req.params.uid)) throw new ApiError('Bad request', 400, 'bad_request');
  await db.setPartnerActive(req.params.uid, !!(req.body && req.body.active));
  res.json({ ok: true });
}));

/* ───────────────────────── CPA network (tracking, postbacks, advertiser API, admin) ───────────────────────── */
app.use('/postback', express.urlencoded({ extended: false, limit: '16kb' }));
require('./lib/routes-cpa')(app, { wrap, requireAuth, requireAdmin, rangeOf, csvCell, adminPartners });

// Demo uploads (production files are served by Supabase Storage).
app.get('/media/:name', (req, res) => {
  const f = cfg.demo ? require('./lib/media').demoFile(String(req.params.name)) : null;
  if (!f) return res.status(404).end();
  res.set('Content-Type', f.type).set('Cache-Control', 'max-age=3600').send(f.buf);
});

/* ───────────────────────── static + errors ───────────────────────── */
app.use('/api', (req, res) => res.status(404).json({ error: 'not_found' }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: 0, etag: true }));

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (err instanceof ApiError) return res.status(err.status).json({ error: err.code, message: err.message });
  if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'bad_request' });
  if (err && err.type === 'entity.too.large') return res.status(413).json({ error: 'file_too_large', message: 'Файл больше 3 МБ' });
  console.error('[server]', err && err.stack ? err.stack : err);
  res.status(500).json({ error: 'server_error' });
});

app.listen(cfg.port, () => {
  console.log(`Teliks: http://localhost:${cfg.port}${cfg.demo ? '  (DEMO mode — sample data)' : ''}`);
});
