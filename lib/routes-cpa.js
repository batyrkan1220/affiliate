'use strict';
/**
 * CPA network routes:
 *   GET  /c/:offer/:aff            tracking link (click → redirect to the advertiser)
 *   GET|POST /postback             advertiser S2S postback (key in query or header)
 *   /api/v1/*                      advertiser REST API (Authorization: Bearer <key>)
 *   /api/admin/cpa/*, advertisers, offers, access — Teliks admin
 */
const rateLimit = require('express-rate-limit');
const cfg = require('./config');
const cpa = require('./cpa');
const { ApiError } = require('./errors');

const { store } = cpa;
const num = (v) => Number(v) || 0;
const r2 = (v) => Math.round(num(v) * 100) / 100;

function page(title, text) {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title>
<link rel="stylesheet" href="/styles.css"></head><body class="plain-page"><main class="plain"><h1>${title}</h1><p>${text}</p></main></body></html>`;
}

module.exports = function mount(app, { wrap, requireAuth, requireAdmin, rangeOf, csvCell, adminPartners }) {
  const json429 = (req, res) => res.status(429).json({ ok: false, error: 'too_many_requests' });
  const clickLimiter = rateLimit({ windowMs: 60 * 1000, limit: 120, handler: (req, res) => res.status(429).type('html').send(page('Слишком много переходов', 'Попробуйте через минуту.')) });
  const pbLimiter = rateLimit({ windowMs: 60 * 1000, limit: 600, handler: json429 });
  const apiLimiter = rateLimit({ windowMs: 60 * 1000, limit: 300, handler: json429 });

  /* ───────── tracking link ───────── */
  app.get('/c/:offer/:aff', clickLimiter, wrap(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.set('Referrer-Policy', 'no-referrer');
    const r = await cpa.click(req, String(req.params.offer), String(req.params.aff));
    if (r.url) return res.redirect(302, r.url);
    if (r.fallback) return res.redirect(302, r.fallback);
    const msg = r.error === 'paused' ? ['Оффер приостановлен', 'Рекламодатель временно остановил приём трафика.'] : ['Ссылка недействительна', 'Проверьте ссылку или обратитесь к партнёру, который её дал.'];
    res.status(404).type('html').send(page(msg[0], msg[1]));
  }));

  /* ───────── advertiser auth ───────── */
  async function advAuth(req) {
    const h = String(req.get('authorization') || '');
    const key = (h.startsWith('Bearer ') ? h.slice(7) : '') || req.get('x-api-key') || (req.query && req.query.key) || (req.body && req.body.key) || '';
    const adv = await cpa.advertiserByKey(String(key).trim());
    if (!adv) throw new ApiError('Invalid or missing key', 401, 'unauthorized');
    return adv;
  }
  const apiErr = (res, e) => {
    if (e instanceof ApiError) return res.status(e.status).json({ ok: false, error: e.code, message: e.message });
    console.error('[cpa-api]', e && e.message ? e.message : e);
    return res.status(500).json({ ok: false, error: 'server_error' });
  };
  const advRoute = (fn) => (req, res) => advAuth(req).then((adv) => fn(adv, req, res)).catch((e) => apiErr(res, e));

  /* ───────── S2S postback ───────── */
  const postback = advRoute(async (adv, req, res) => {
    const p = { ...(req.query || {}), ...(req.body && typeof req.body === 'object' ? req.body : {}) };
    res.json(await cpa.conversion(adv, p, 'postback'));
  });
  app.get('/postback', pbLimiter, postback);
  app.post('/postback', pbLimiter, postback);

  /* ───────── advertiser REST API ───────── */
  const advRange = (req) => {
    const r = rangeOf(req);
    return { ...r, ...cpa.rangeIso(r.from, r.to) };
  };
  const advOffers = async (adv) => (await store.offerList()).filter((o) => o.advertiser_id === adv.id);
  const convOut = (c, codes) => ({
    id: c.id, click_id: c.click_id, offer_id: c.offer_id, aff_id: codes.get(c.user_id) || null, goal: c.goal, txid: c.external_id,
    status: c.status, advertiser_status: c.adv_status, revenue: r2(c.revenue_kzt), sale_amount: c.sale_amount_kzt == null ? null : r2(c.sale_amount_kzt),
    currency: 'KZT', sub1: c.sub1 || null, sub2: c.sub2 || null, sub3: c.sub3 || null, sub4: c.sub4 || null, sub5: c.sub5 || null,
    country: c.country || null, hold_until: c.hold_until, created_at: c.created_at, updated_at: c.updated_at,
  });
  const partnerCodes = async () => new Map((await adminPartners()).map((p) => [p.user_id, p.trendme_code]));

  app.get('/api/v1/me', apiLimiter, advRoute(async (adv, req, res) => {
    res.json({ ok: true, advertiser: { id: adv.id, name: adv.name, status: adv.status }, postback_url: `${cfg.publicUrl}/postback` });
  }));

  app.get('/api/v1/offers', apiLimiter, advRoute(async (adv, req, res) => {
    const list = await advOffers(adv);
    res.json({
      ok: true,
      offers: list.map((o) => ({
        id: o.id, name: o.name, status: o.status, model: o.model, target_url: o.target_url, hold_days: o.hold_days, daily_cap: o.daily_cap, geo: o.geo,
        goals: (o.goals || []).map((g) => ({ code: g.code, name: g.name, revenue_type: g.revenue_type, revenue: g.revenue })),
      })),
    });
  }));

  app.get('/api/v1/stats', apiLimiter, advRoute(async (adv, req, res) => {
    const r = advRange(req);
    const mine = new Set((await advOffers(adv)).map((o) => o.id));
    const rows = (await store.daily(r.fromIso, r.toIso)).filter((x) => mine.has(x.offer_id));
    const m = new Map();
    for (const x of rows) {
      const k = `${String(x.day).slice(0, 10)}|${x.offer_id}`;
      const g = m.get(k) || { date: String(x.day).slice(0, 10), offer_id: x.offer_id, clicks: 0, unique_clicks: 0, approved: 0, pending: 0, rejected: 0, revenue: 0, pending_revenue: 0, sales: 0 };
      g.clicks += num(x.clicks); g.unique_clicks += num(x.uniq); g.approved += num(x.approved); g.pending += num(x.pending); g.rejected += num(x.rejected);
      g.revenue += num(x.revenue_kzt); g.pending_revenue += num(x.pending_revenue_kzt); g.sales += num(x.sales_kzt);
      m.set(k, g);
    }
    const out = [...m.values()].map((g) => ({ ...g, revenue: r2(g.revenue), pending_revenue: r2(g.pending_revenue), sales: r2(g.sales) })).sort((a, b) => (a.date < b.date ? -1 : 1));
    res.json({ ok: true, from: r.from, to: r.to, currency: 'KZT', rows: out });
  }));

  app.get('/api/v1/conversions', apiLimiter, advRoute(async (adv, req, res) => {
    const r = advRange(req);
    const status = ['approved', 'pending', 'rejected'].includes(req.query.status) ? req.query.status : '';
    const offer = /^[a-z0-9_-]{2,32}$/.test(String(req.query.offer || '')) ? String(req.query.offer) : '';
    const pageN = Math.max(1, parseInt(req.query.page, 10) || 1);
    const per = Math.min(500, Math.max(1, parseInt(req.query.per_page, 10) || 100));
    const d = await store.convList({ advertiser: adv.id, offer, status, fromIso: r.fromIso, toIso: r.toIso, limit: per, offset: (pageN - 1) * per });
    const codes = await partnerCodes();
    res.json({ ok: true, from: r.from, to: r.to, page: pageN, per_page: per, total: d.total, conversions: d.rows.map((c) => convOut(c, codes)) });
  }));

  // Same as the postback, as JSON.
  app.post('/api/v1/conversions', apiLimiter, advRoute(async (adv, req, res) => {
    res.json(await cpa.conversion(adv, req.body || {}, 'api'));
  }));

  /* ───────── admin: advertisers ───────── */
  const A = [requireAuth, requireAdmin];
  const advView = (a) => ({ id: a.id, name: a.name, company: a.company, email: a.email, telegram: a.telegram, website: a.website, notes: a.notes, status: a.status, keyPrefix: a.api_key_prefix, hasKey: !!a.api_key_hash, integration: a.integration || null, createdAt: a.created_at });
  const BUILTIN = { trendme: [{ id: 'trendme', name: 'TrendMe — AI тренд-видео', status: 'active', builtin: true }] };

  app.get('/api/admin/advertisers', ...A, wrap(async (req, res) => {
    const [advs, offers] = await Promise.all([store.advList(), store.offerList()]);
    res.json({ postbackUrl: `${cfg.publicUrl}/postback`, apiUrl: `${cfg.publicUrl}/api/v1`, rows: advs.map((a) => ({ ...advView(a), offers: [...(BUILTIN[a.integration] || []), ...offers.filter((o) => o.advertiser_id === a.id).map((o) => ({ id: o.id, name: o.name, status: o.status }))] })) });
  }));

  app.post('/api/admin/advertisers', ...A, wrap(async (req, res) => {
    const row = cpa.validAdvertiser(req.body || {});
    const k = cpa.newApiKey();
    const a = await store.advCreate({ ...row, api_key_hash: k.hash, api_key_prefix: k.prefix });
    res.json({ advertiser: advView(a), apiKey: k.key });
  }));

  app.post('/api/admin/advertisers/:id', ...A, wrap(async (req, res) => {
    if (!/^[0-9a-f-]{36}$/.test(req.params.id)) throw new ApiError('Bad request', 400, 'bad_request');
    const a = await store.advUpdate(req.params.id, cpa.validAdvertiser(req.body || {}));
    if (!a) throw new ApiError('Not found', 404, 'not_found');
    cpa.bust();
    res.json({ advertiser: advView(a) });
  }));

  app.post('/api/admin/advertisers/:id/key', ...A, wrap(async (req, res) => {
    if (!/^[0-9a-f-]{36}$/.test(req.params.id)) throw new ApiError('Bad request', 400, 'bad_request');
    const cur = await store.advGet(req.params.id);
    if (cur && cur.integration) throw new ApiError('Встроенная интеграция работает по API без ключа рекламодателя', 400, 'builtin');
    const k = cpa.newApiKey();
    const a = await store.advUpdate(req.params.id, { api_key_hash: k.hash, api_key_prefix: k.prefix });
    if (!a) throw new ApiError('Not found', 404, 'not_found');
    res.json({ apiKey: k.key, keyPrefix: k.prefix });
  }));

  app.get('/api/admin/postbacks', ...A, wrap(async (req, res) => {
    const [log, advs, partners] = await Promise.all([store.logList({ limit: 300 }), store.advList(), adminPartners()]);
    const an = new Map(advs.map((a) => [a.id, a.name]));
    const pn = new Map(partners.map((p) => [p.user_id, p.name]));
    res.json({ rows: log.map((l) => ({ ...l, advertiser: an.get(l.advertiser_id) || '', partner: pn.get(l.user_id) || '' })) });
  }));

  /* ───────── admin: offers ───────── */
  app.get('/api/admin/offers', ...A, wrap(async (req, res) => {
    const r = rangeOf(req);
    const { fromIso, toIso } = cpa.rangeIso(r.from, r.to);
    const [offers, advs, daily, access, partners, tm] = await Promise.all([store.offerList(), store.advList(), store.daily(fromIso, toIso), store.accessList({}), adminPartners(), require('./trendme').overviewSafe(r.from, r.to)]);
    const an = new Map(advs.map((a) => [a.id, a.name]));
    const pn = new Map(partners.map((p) => [p.user_id, p]));
    const st = new Map();
    for (const x of daily) {
      const g = st.get(x.offer_id) || { clicks: 0, uniq: 0, approved: 0, pending: 0, rejected: 0, payout: 0, pendingPayout: 0, revenue: 0, pendingRevenue: 0, sales: 0 };
      g.clicks += num(x.clicks); g.uniq += num(x.uniq); g.approved += num(x.approved); g.pending += num(x.pending); g.rejected += num(x.rejected);
      g.payout += num(x.payout_kzt); g.pendingPayout += num(x.pending_payout_kzt); g.revenue += num(x.revenue_kzt); g.pendingRevenue += num(x.pending_revenue_kzt); g.sales += num(x.sales_kzt);
      st.set(x.offer_id, g);
    }
    res.json({
      range: r,
      builtin: (() => { // TrendMe: built-in offer, numbers come from the TrendMe API
        const P = tm.partners || [];
        const sum = (k) => P.reduce((x, p) => x + (Number((p.period || {})[k]) || 0), 0);
        const pcts = P.map((p) => Number(p.percent)).filter((x) => Number.isFinite(x));
        return [{
          id: 'trendme', name: 'TrendMe — AI тренд-видео', advertiser: 'TrendMe', model: 'RevShare', unavailable: !!tm.unavailable,
          percentMin: pcts.length ? Math.min(...pcts) : null, percentMax: pcts.length ? Math.max(...pcts) : null,
          partners: P.length, activePartners: P.filter((p) => p.active).length,
          stats: { clicks: sum('visits'), users: sum('users'), conversions: sum('paidOrders'), revenue: sum('revenueKzt'), payout: sum('earnedKzt'), reversed: sum('reversedKzt') },
          links: { bot: 'https://t.me/Trendmekzbot?start=p_<код>', app: 'https://t.me/Trendmekzbot?startapp=p_<код>', site: 'https://trendme.kz/?ref=<код>' },
        }];
      })(),
      advertisers: advs.filter((a) => !a.integration).map((a) => ({ id: a.id, name: a.name, status: a.status })),
      rows: offers.map((o) => ({
        ...o, advertiser: an.get(o.advertiser_id) || '', stats: st.get(o.id) || null,
        access_rows: access.filter((a) => a.offer_id === o.id).map((a) => ({ ...a, name: (pn.get(a.user_id) || {}).name || '', code: (pn.get(a.user_id) || {}).trendme_code || '', email: (pn.get(a.user_id) || {}).email || '' })),
      })),
    });
  }));

  app.post('/api/admin/offers', ...A, wrap(async (req, res) => {
    const row = cpa.validOffer(req.body || {}, { isNew: true });
    const adv = await store.advGet(row.advertiser_id);
    if (!adv) throw new ApiError('Рекламодатель не найден', 400, 'invalid_advertiser');
    if (adv.integration) throw new ApiError('У TrendMe оффер встроенный — отдельный оффер не нужен', 400, 'builtin');
    try {
      res.json({ offer: await store.offerCreate(row) });
    } catch (e) {
      if (e.dup) throw new ApiError('Оффер с таким ID уже есть', 409, 'duplicate');
      throw e;
    }
  }));

  app.post('/api/admin/offers/:id', ...A, wrap(async (req, res) => {
    if (!/^[a-z0-9][a-z0-9_-]{1,31}$/.test(req.params.id)) throw new ApiError('Bad request', 400, 'bad_request');
    const row = cpa.validOffer(req.body || {}, { isNew: false });
    const adv = await store.advGet(row.advertiser_id);
    if (!adv) throw new ApiError('Рекламодатель не найден', 400, 'invalid_advertiser');
    if (adv.integration) throw new ApiError('У TrendMe оффер встроенный — отдельный оффер не нужен', 400, 'builtin');
    const o = await store.offerUpdate(req.params.id, row);
    if (!o) throw new ApiError('Not found', 404, 'not_found');
    cpa.bust();
    res.json({ offer: o });
  }));

  // Access: approve / reject a partner's request, or grant access directly.
  app.post('/api/admin/access', ...A, wrap(async (req, res) => {
    const b = req.body || {};
    const status = ['approved', 'rejected', 'pending'].includes(b.status) ? b.status : '';
    const offer = String(b.offer_id || ''), user = String(b.user_id || '');
    if (!status || !/^[a-z0-9][a-z0-9_-]{1,31}$/.test(offer) || !/^[0-9a-z-]{6,40}$/.test(user)) throw new ApiError('Bad request', 400, 'bad_request');
    if (!(await store.offerGet(offer))) throw new ApiError('Not found', 404, 'not_found');
    await store.accessUpsert(offer, user, status);
    cpa.bust();
    res.json({ ok: true });
  }));

  app.get('/api/admin/access', ...A, wrap(async (req, res) => {
    const status = ['approved', 'rejected', 'pending'].includes(req.query.status) ? req.query.status : '';
    const [rows, offers, partners] = await Promise.all([store.accessList({ status }), store.offerList(), adminPartners()]);
    const on = new Map(offers.map((o) => [o.id, o.name]));
    const pn = new Map(partners.map((p) => [p.user_id, p]));
    res.json({ rows: rows.map((a) => ({ ...a, offer: on.get(a.offer_id) || a.offer_id, name: (pn.get(a.user_id) || {}).name || '', code: (pn.get(a.user_id) || {}).trendme_code || '', email: (pn.get(a.user_id) || {}).email || '' })) });
  }));

  /* ───────── admin: CPA conversions and network numbers ───────── */
  app.get('/api/admin/cpa/overview', ...A, wrap(async (req, res) => {
    const r = rangeOf(req);
    const { fromIso, toIso } = cpa.rangeIso(r.from, r.to);
    await store.releaseHolds().catch(() => 0);
    const [daily, offers, balances, paid] = await Promise.all([store.daily(fromIso, toIso), store.offerList(), store.balances(null), store.paidSplit(null)]);
    const T = { clicks: 0, uniq: 0, approved: 0, pending: 0, rejected: 0, payout: 0, pendingPayout: 0, revenue: 0, pendingRevenue: 0, sales: 0 };
    const byDay = new Map(), byUser = new Map();
    const add = (g, x) => {
      g.clicks += num(x.clicks); g.uniq += num(x.uniq); g.approved += num(x.approved); g.pending += num(x.pending); g.rejected += num(x.rejected);
      g.payout += num(x.payout_kzt); g.pendingPayout += num(x.pending_payout_kzt); g.revenue += num(x.revenue_kzt); g.pendingRevenue += num(x.pending_revenue_kzt); g.sales += num(x.sales_kzt);
    };
    for (const x of daily) {
      add(T, x);
      const d = String(x.day).slice(0, 10);
      if (!byDay.has(d)) byDay.set(d, { day: d, clicks: 0, uniq: 0, approved: 0, pending: 0, rejected: 0, payout: 0, pendingPayout: 0, revenue: 0, pendingRevenue: 0, sales: 0 });
      add(byDay.get(d), x);
      if (!byUser.has(x.user_id)) byUser.set(x.user_id, { clicks: 0, uniq: 0, approved: 0, pending: 0, rejected: 0, payout: 0, pendingPayout: 0, revenue: 0, pendingRevenue: 0, sales: 0 });
      add(byUser.get(x.user_id), x);
    }
    const paidNative = new Map();
    for (const p of paid) paidNative.set(p.user_id, (paidNative.get(p.user_id) || 0) + Math.max(0, p.amount_kzt - (p.trendme_kzt == null ? p.amount_kzt : p.trendme_kzt)));
    res.json({
      range: r, totals: T, daily: [...byDay.values()].sort((a, b) => (a.day < b.day ? 1 : -1)),
      activeOffers: offers.filter((o) => o.status === 'active').length, offers: offers.length,
      users: Object.fromEntries([...byUser.entries()]),
      balances: Object.fromEntries(balances.map((b) => [b.user_id, { approved: b.approved_kzt, pending: b.pending_kzt, paid: paidNative.get(b.user_id) || 0, available: Math.max(0, b.approved_kzt - (paidNative.get(b.user_id) || 0)) }])),
    });
  }));

  async function adminConversions(req, limit, offset) {
    const r = rangeOf(req);
    const { fromIso, toIso } = cpa.rangeIso(r.from, r.to);
    const status = ['approved', 'pending', 'rejected'].includes(req.query.status) ? req.query.status : '';
    const offer = /^[a-z0-9][a-z0-9_-]{1,31}$/.test(String(req.query.offer || '')) ? String(req.query.offer) : '';
    const partners = await adminPartners();
    const code = String(req.query.code || '');
    const pu = code ? partners.find((p) => p.trendme_code === code) : null;
    if (code && !pu) return { range: r, total: 0, rows: [] };
    const [d, offers, advs] = await Promise.all([store.convList({ user: pu && pu.user_id, offer, status, fromIso, toIso, limit, offset }), store.offerList(), store.advList()]);
    const on = new Map(offers.map((o) => [o.id, o.name]));
    const an = new Map(advs.map((a) => [a.id, a.name]));
    const pn = new Map(partners.map((p) => [p.user_id, p]));
    return {
      range: r, total: d.total,
      rows: d.rows.map((c) => ({
        id: c.id, time: c.created_at, updated: c.updated_at, offer_id: c.offer_id, offer: on.get(c.offer_id) || c.offer_id, advertiser: an.get(c.advertiser_id) || '',
        code: (pn.get(c.user_id) || {}).trendme_code || '', partner: (pn.get(c.user_id) || {}).name || '', goal: c.goal, txid: c.external_id, click_id: c.click_id,
        status: c.status, adv_status: c.adv_status, payout: r2(c.payout_kzt), revenue: r2(c.revenue_kzt), sale: c.sale_amount_kzt == null ? null : r2(c.sale_amount_kzt),
        hold_until: c.hold_until, note: c.note, sub1: c.sub1, sub2: c.sub2, source: c.source, country: c.country,
      })),
    };
  }

  app.get('/api/admin/cpa/conversions', ...A, wrap(async (req, res) => {
    const pageN = Math.max(1, parseInt(req.query.page, 10) || 1);
    res.json({ page: pageN, perPage: 100, ...(await adminConversions(req, 100, (pageN - 1) * 100)) });
  }));

  app.get('/api/admin/cpa/conversions.csv', ...A, wrap(async (req, res) => {
    const d = await adminConversions(req, 10000, 0);
    const head = ['time', 'offer_id', 'advertiser', 'partner_code', 'goal', 'txid', 'click_id', 'status', 'advertiser_status', 'payout_kzt', 'revenue_kzt', 'sale_kzt', 'hold_until', 'sub1', 'sub2', 'source', 'country', 'note'];
    const lines = [head.join(',')];
    for (const c of d.rows) lines.push([c.time, c.offer_id, c.advertiser, c.code, c.goal, c.txid, c.click_id, c.status, c.adv_status, c.payout, c.revenue, c.sale, c.hold_until, c.sub1, c.sub2, c.source, c.country, c.note].map(csvCell).join(','));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="teliks_conversions_${d.range.from}_${d.range.to}.csv"`);
    res.send('﻿' + lines.join('\r\n'));
  }));

  app.post('/api/admin/cpa/conversions/:id', ...A, wrap(async (req, res) => {
    if (!/^[0-9a-f-]{36}$/.test(req.params.id)) throw new ApiError('Bad request', 400, 'bad_request');
    const c = await cpa.setStatusManually(req.params.id, String((req.body && req.body.status) || ''), req.session.aff.email);
    res.json({ ok: true, status: c.status });
  }));

  // Hold release runs in the background as well (and on each admin overview).
  const timer = setInterval(() => store.releaseHolds().catch(() => {}), 10 * 60 * 1000);
  if (timer.unref) timer.unref();

};
