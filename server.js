'use strict';
const path = require('path');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const cfg = require('./lib/config');
const api = require('./lib/offer18');
const { ApiError } = require('./lib/errors');
const stats = require('./lib/stats');
const offers = require('./lib/offers');
const requests = require('./lib/requests');

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
app.use('/api', (req, res, next) => {
  if (req.method !== 'GET' && req.get('x-requested-with') !== 'fetch') {
    return res.status(400).json({ error: 'bad_request' });
  }
  next();
});

const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);
const requireAuth = (req, res, next) => (req.session.aff ? next() : res.status(401).json({ error: 'unauthorized' }));
const tooMany = (req, res) => res.status(429).json({ error: 'too_many_requests' });
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, handler: tooMany });
const registerLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 5, handler: tooMany });
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
  const { affiliateId } = await api.affiliateLogin(email, password);
  await startSession(req, { id: affiliateId, email });
  res.json({ id: affiliateId, email });
}));

app.post('/api/auth/register', registerLimiter, wrap(async (req, res) => {
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

  const { affiliateId } = await api.affiliateCreate({
    first_name: firstName,
    last_name: lastName,
    email,
    password,
    mobile,
    company,
    country,
    im_type: imType,
    im_value: imValue,
    signup_ip: req.ip,
    status: cfg.newAffiliateStatus,
  });

  if (cfg.newAffiliateStatus === 'Approved') {
    await startSession(req, { id: affiliateId, email, name: `${firstName} ${lastName}` });
    return res.json({ id: affiliateId, email, pending: false });
  }
  res.json({ pending: true });
}));

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('wm.sid');
    res.json({ ok: true });
  });
});

app.get('/api/me', requireAuth, (req, res) => {
  const a = req.session.aff;
  res.json({ id: a.id, email: a.email, name: a.name || '', demo: cfg.demo });
});

/* ───────────────────────── helpers ───────────────────────── */
function rangeOf(req) {
  const r = stats.validRange(String(req.query.from || ''), String(req.query.to || ''));
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
  const aid = req.session.aff.id;
  const prev = stats.previousRange(r);
  const [cur, before] = await Promise.all([stats.getRows(aid, r.from, r.to), stats.getRows(aid, prev.from, prev.to)]);
  const names = await offerNames(aid);
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

// Оффер, на который вебмастер уже подал заявку, показываем как «на рассмотрении».
const withRequests = (aid, list) =>
  list.map((o) => (o.access === 'open' && requests.has(aid, o.id) ? { ...o, access: 'pending', requested: true } : o));

async function offerNames(aid) {
  try {
    return new Map((await offers.forAffiliateList(aid)).map((o) => [o.id, o.name]));
  } catch {
    return new Map();
  }
}

/* ───────────────────────── statistics ───────────────────────── */
async function buildStats(req) {
  const r = rangeOf(req);
  const by = Object.prototype.hasOwnProperty.call(stats.GROUPS, req.query.group) ? req.query.group : 'date';
  const offer = String(req.query.offer || '').slice(0, 40);
  const aid = req.session.aff.id;
  const data = await stats.getRows(aid, r.from, r.to);
  const rows = offer ? data.rows.filter((x) => x.offerId === offer) : data.rows;
  const names = by === 'offer' ? await offerNames(aid) : new Map();
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
  const data = await stats.getRows(req.session.aff.id, r.from, r.to);
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
  const all = withRequests(req.session.aff.id, await offers.forAffiliateList(req.session.aff.id));
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
  const all = await offers.forAffiliateList(req.session.aff.id);
  res.json(
    all.filter((o) => o.access === 'approved')
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((o) => ({ id: o.id, name: o.name, trackingUrl: o.trackingUrl, impressionUrl: o.impressionUrl }))
  );
}));

app.get('/api/offers/:id', requireAuth, wrap(async (req, res) => {
  const all = withRequests(req.session.aff.id, await offers.forAffiliateList(req.session.aff.id));
  const o = all.find((x) => x.id === req.params.id);
  if (!o) return res.status(404).json({ error: 'not_found' });
  res.json(o);
}));

// Заявка на доступ к офферу. Ключи Offer18 вебмастера не вводят: заявку обрабатывает админ.
app.post('/api/offers/request', requireAuth, requestLimiter, wrap(async (req, res) => {
  const ids = (Array.isArray(req.body.offerIds) ? req.body.offerIds : [])
    .map((x) => String(x).replace(/\D/g, '')).filter(Boolean).slice(0, 20);
  if (!ids.length) throw new ApiError('No offers selected', 400, 'invalid_offers');
  const aff = req.session.aff;
  const all = await offers.forAffiliateList(aff.id);
  const result = {};
  for (const id of ids) {
    const o = all.find((x) => x.id === id);
    if (!o || (o.access !== 'open' && o.access !== 'pending')) { result[id] = 'not_allowed'; continue; }
    if (o.access === 'open') await requests.add({ affiliateId: aff.id, email: aff.email, offerId: id, offerName: o.name });
    result[id] = 'pending';
  }
  res.json({ result });
}));

/* ───────────────────────── static + errors ───────────────────────── */
app.use('/api', (req, res) => res.status(404).json({ error: 'not_found' }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: 0, etag: true }));

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (err instanceof ApiError) return res.status(err.status).json({ error: err.code, message: err.message });
  if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'bad_request' });
  console.error('[server]', err && err.stack ? err.stack : err);
  res.status(500).json({ error: 'server_error' });
});

app.listen(cfg.port, () => {
  console.log(`Teliks: http://localhost:${cfg.port}${cfg.demo ? '  (DEMO mode — sample data, login demo@example.com / demo1234)' : ''}`);
});
