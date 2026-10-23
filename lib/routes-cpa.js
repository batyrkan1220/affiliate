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

  app.post('/api/admin/advertisers/:id/delete', ...A, wrap(async (req, res) => {
    if (!/^[0-9a-f-]{36}$/.test(req.params.id)) throw new ApiError('Bad request', 400, 'bad_request');
    const a = await store.advGet(req.params.id);
    if (!a) throw new ApiError('Not found', 404, 'not_found');
    if (a.integration) throw new ApiError('Встроенную интеграцию удалить нельзя', 400, 'builtin');
    const n = (await store.offerList()).filter((o) => o.advertiser_id === a.id).length;
    if (n) throw new ApiError(`У рекламодателя ${n} оффер(ов). Сначала удалите их или переведите рекламодателя на паузу.`, 409, 'has_offers');
    await store.advDelete(a.id);
    cpa.bust();
    res.json({ ok: true });
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
      range: r, traffic: cpa.TRAFFIC_LABELS,
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

  const OFFER_ID = /^[a-z0-9][a-z0-9_-]{1,31}$/;

  // Offer card: stats for the period by partner and by day, conversion count, access.
  app.get('/api/admin/offers/:id', ...A, wrap(async (req, res) => {
    if (!OFFER_ID.test(req.params.id)) throw new ApiError('Bad request', 400, 'bad_request');
    const r = rangeOf(req);
    const { fromIso, toIso } = cpa.rangeIso(r.from, r.to);
    const o = await store.offerGet(req.params.id);
    if (!o) throw new ApiError('Not found', 404, 'not_found');
    const [daily, partners, access, convTotal, adv] = await Promise.all([store.daily(fromIso, toIso), adminPartners(), store.accessList({}), store.convCount(o.id), store.advGet(o.advertiser_id)]);
    const pn = new Map(partners.map((p) => [p.user_id, p]));
    const blank = () => ({ clicks: 0, uniq: 0, approved: 0, pending: 0, rejected: 0, payout: 0, pendingPayout: 0, revenue: 0, pendingRevenue: 0, sales: 0 });
    const add = (g, x) => { g.clicks += num(x.clicks); g.uniq += num(x.uniq); g.approved += num(x.approved); g.pending += num(x.pending); g.rejected += num(x.rejected); g.payout += num(x.payout_kzt); g.pendingPayout += num(x.pending_payout_kzt); g.revenue += num(x.revenue_kzt); g.pendingRevenue += num(x.pending_revenue_kzt); g.sales += num(x.sales_kzt); };
    const T = blank(), byDay = new Map(), byUser = new Map();
    for (const x of daily) {
      if (x.offer_id !== o.id) continue;
      add(T, x);
      const d = String(x.day).slice(0, 10);
      if (!byDay.has(d)) byDay.set(d, { day: d, ...blank() });
      add(byDay.get(d), x);
      if (!byUser.has(x.user_id)) byUser.set(x.user_id, blank());
      add(byUser.get(x.user_id), x);
    }
    res.json({
      range: r, offer: o, advertiser: adv ? { id: adv.id, name: adv.name, status: adv.status } : null, live: cpa.offerLive(o), convTotal, totals: T,
      daily: [...byDay.values()].sort((a, b) => (a.day < b.day ? 1 : -1)),
      partners: [...byUser.entries()].map(([uid, g]) => ({ uid, name: (pn.get(uid) || {}).name || '', code: (pn.get(uid) || {}).trendme_code || '', ...g })).sort((a, b) => b.payout + b.pendingPayout - (a.payout + a.pendingPayout) || b.clicks - a.clicks),
      access: access.filter((a) => a.offer_id === o.id).map((a) => ({ ...a, name: (pn.get(a.user_id) || {}).name || '', code: (pn.get(a.user_id) || {}).trendme_code || '', email: (pn.get(a.user_id) || {}).email || '' })),
    });
  }));

  // Quick status: active / paused / archived.
  app.post('/api/admin/offers/:id/status', ...A, wrap(async (req, res) => {
    const status = String((req.body && req.body.status) || '');
    if (!OFFER_ID.test(req.params.id) || !['active', 'paused', 'archived'].includes(status)) throw new ApiError('Bad request', 400, 'bad_request');
    const o = await store.offerUpdate(req.params.id, { status });
    if (!o) throw new ApiError('Not found', 404, 'not_found');
    cpa.bust();
    res.json({ ok: true, status: o.status });
  }));

  // Delete: only an offer without conversions (clicks and access go with it); otherwise archive it.
  app.post('/api/admin/offers/:id/delete', ...A, wrap(async (req, res) => {
    if (!OFFER_ID.test(req.params.id)) throw new ApiError('Bad request', 400, 'bad_request');
    if (!(await store.offerGet(req.params.id))) throw new ApiError('Not found', 404, 'not_found');
    const n = await store.convCount(req.params.id);
    if (n > 0) throw new ApiError(`У оффера ${n} конверс. — удалить нельзя, чтобы не потерять начисления партнёров. Переведите его в архив.`, 409, 'has_conversions');
    if (!req.body || req.body.confirm !== req.params.id) throw new ApiError('Подтвердите удаление: введите ID оффера', 400, 'confirm_required');
    await store.offerDelete(req.params.id);
    cpa.bust();
    res.json({ ok: true });
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
    const [daily, offers, balances, paid] = await Promise.all([store.daily(fromIso, toIso), store.offerList(), store.balances(null), require('./payouts').paidRows(null)]);
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

  /* ───────── unified conversions log: TrendMe orders + CPA conversions ───────── */
  const TM_PAY = { pending: 'ожидает оплаты', succeeded: 'оплачен', failed: 'оплата не прошла', cancelled: 'отменён', refunded: 'возврат' };
  function tmRow(o, pn) {
    const sandbox = /sandbox/.test(o.provider || '');
    let status = 'pending', payout = 0, note = '';
    if (o.paymentStatus === 'succeeded' && o.commissionStatus === 'earned') { status = 'approved'; payout = num(o.commissionKzt); }
    else if (o.paymentStatus === 'succeeded') { status = 'rejected'; note = sandbox ? 'тестовая оплата (sandbox) — без начисления' : 'без начисления (партнёр был отключён)'; }
    else if (o.paymentStatus === 'refunded' || o.commissionStatus === 'reversed') { status = 'rejected'; payout = num(o.commissionKzt); note = 'возврат — начисление отменено'; }
    else if (o.paymentStatus === 'failed' || o.paymentStatus === 'cancelled') { status = 'rejected'; note = TM_PAY[o.paymentStatus]; }
    else { payout = Math.floor(num(o.amountKzt) * num(o.percent) / 100); note = 'ждём оплату клиента'; }
    const p = pn.get(o.code) || {};
    return {
      id: 'tm-' + o.order, source: 'trendme', time: o.time, updated: o.updated, offer_id: 'trendme', offer: 'TrendMe — AI тренд-видео', advertiser: 'TrendMe',
      code: o.code, partner: p.name || o.code, goal: 'оплата заказа', txid: o.order, click_id: null, status,
      adv_label: TM_PAY[o.paymentStatus] || o.paymentStatus, payout, revenue: status === 'rejected' ? 0 : num(o.amountKzt), sale: num(o.amountKzt),
      percent: num(o.percent), hold_until: null, note, sub1: null, source_traffic: null, country: null,
    };
  }
  async function allConversions(req) {
    const r = rangeOf(req);
    const { fromIso, toIso } = cpa.rangeIso(r.from, r.to);
    const status = ['approved', 'pending', 'rejected'].includes(req.query.status) ? req.query.status : '';
    const src = ['trendme', 'cpa'].includes(req.query.source) ? req.query.source : '';
    const offer = /^[a-z0-9][a-z0-9_-]{1,31}$/.test(String(req.query.offer || '')) ? String(req.query.offer) : '';
    const code = /^[a-z0-9]{4,24}$/.test(String(req.query.code || '')) ? String(req.query.code) : '';
    const partners = await adminPartners();
    const pByCode = new Map(partners.map((p) => [p.trendme_code, p]));
    const wantTm = (!src || src === 'trendme') && (!offer || offer === 'trendme');
    const wantCpa = (!src || src === 'cpa') && offer !== 'trendme';
    const pu = code ? pByCode.get(code) : null;
    const [tm, cp, offers, advs] = await Promise.all([
      wantTm ? require('./trendme').overviewSafe(r.from, r.to) : null,
      wantCpa && (!code || pu) ? store.convList({ user: pu && pu.user_id, offer, fromIso, toIso, limit: 5000, offset: 0 }) : { rows: [], total: 0 },
      store.offerList(), store.advList(),
    ]);
    const on = new Map(offers.map((o) => [o.id, o.name]));
    const an = new Map(advs.map((a) => [a.id, a.name]));
    const pn = new Map(partners.map((p) => [p.user_id, p]));
    let rows = [];
    if (tm) {
      // TrendMe partner names (partners without a Teliks login too)
      const tmNames = new Map((tm.partners || []).map((p) => [p.code, { name: p.name }]));
      for (const [k, v] of pByCode) tmNames.set(k, { name: v.name });
      rows = (tm.orders || []).filter((o) => !code || o.code === code).map((o) => tmRow(o, tmNames));
    }
    for (const c of cp.rows) {
      rows.push({
        id: c.id, source: 'cpa', time: c.created_at, updated: c.updated_at, offer_id: c.offer_id, offer: on.get(c.offer_id) || c.offer_id, advertiser: an.get(c.advertiser_id) || '',
        code: (pn.get(c.user_id) || {}).trendme_code || '', partner: (pn.get(c.user_id) || {}).name || '', goal: c.goal, txid: c.external_id, click_id: c.click_id,
        status: c.status, adv_label: { approved: 'подтвердил', pending: 'в обработке', rejected: 'отклонил' }[c.adv_status] || '—',
        payout: r2(c.payout_kzt), revenue: c.status === 'rejected' ? 0 : r2(c.revenue_kzt), sale: c.sale_amount_kzt == null ? null : r2(c.sale_amount_kzt), percent: null,
        hold_until: c.hold_until, note: c.note || '', sub1: c.sub1, source_traffic: c.source, country: c.country,
      });
    }
    rows.sort((a, b) => (a.time < b.time ? 1 : -1));
    const counts = { all: rows.length, pending: 0, approved: 0, rejected: 0 };
    const sums = { approvedPayout: 0, pendingPayout: 0, approvedRevenue: 0, sales: 0 };
    for (const x of rows) {
      counts[x.status]++;
      if (x.status === 'approved') { sums.approvedPayout += x.payout; sums.approvedRevenue += x.revenue; }
      if (x.status === 'pending') sums.pendingPayout += x.payout;
      if (x.status !== 'rejected' && x.sale) sums.sales += x.sale;
    }
    if (status) rows = rows.filter((x) => x.status === status);
    return { range: r, trendmeUnavailable: !!(tm && tm.unavailable), counts, sums, total: rows.length, rows };
  }

  /* ───────── reports: one table grouped by any dimension (CPA + TrendMe where it applies) ───────── */
  const REPORT_GROUPS = {
    date: 'Дата', offer: 'Оффер', partner: 'Партнёр', advertiser: 'Рекламодатель', sub1: 'sub1', sub2: 'sub2', sub3: 'sub3', sub4: 'sub4', sub5: 'sub5',
    source: 'Источник (source)', country: 'Страна', device: 'Устройство', os: 'ОС', browser: 'Браузер', hour: 'Час',
  };
  const TM_GROUPS = ['date', 'offer', 'partner', 'advertiser'];
  const ALMD = (iso) => new Date(Date.parse(iso) + 5 * 3600000).toISOString().slice(0, 10);
  const ALMH = (iso) => new Date(Date.parse(iso) + 5 * 3600000).getUTCHours();

  async function report(req) {
    const r = rangeOf(req);
    const { fromIso, toIso } = cpa.rangeIso(r.from, r.to);
    const by = Object.prototype.hasOwnProperty.call(REPORT_GROUPS, req.query.group) ? req.query.group : 'date';
    const src = ['trendme', 'cpa'].includes(req.query.source) ? req.query.source : '';
    const offerF = OFFER_ID.test(String(req.query.offer || '')) ? String(req.query.offer) : '';
    const codeF = /^[a-z0-9]{4,24}$/.test(String(req.query.code || '')) ? String(req.query.code) : '';
    const partners = await adminPartners();
    const pByCode = new Map(partners.map((p) => [p.trendme_code, p]));
    const pByUid = new Map(partners.map((p) => [p.user_id, p]));
    const uidF = codeF ? (pByCode.get(codeF) || {}).user_id || '__none__' : '';
    const wantCpa = src !== 'trendme' && offerF !== 'trendme';
    const wantTm = src !== 'cpa' && TM_GROUPS.includes(by) && (!offerF || offerF === 'trendme');
    const [offers, advs, clicks, conv, tm] = await Promise.all([
      store.offerList(), store.advList(),
      wantCpa ? store.clickRows(uidF && uidF !== '__none__' ? uidF : null, fromIso, toIso) : [],
      wantCpa ? store.convList({ user: uidF && uidF !== '__none__' ? uidF : undefined, offer: offerF || undefined, fromIso, toIso, limit: 10000 }) : { rows: [] },
      wantTm ? require('./trendme').overviewSafe(r.from, r.to) : null,
    ]);
    const om = new Map(offers.map((o) => [o.id, o]));
    const am = new Map(advs.map((a) => [a.id, a.name]));
    const tmAdv = advs.find((a) => a.integration === 'trendme');
    const label = (k) => {
      if (by === 'offer') return k === 'trendme' ? 'TrendMe — AI тренд-видео' : (om.get(k) || {}).name || k;
      if (by === 'partner') { const p = pByUid.get(k) || pByCode.get(k); return p ? `${p.name} (${p.trendme_code})` : k; }
      if (by === 'advertiser') return k === 'trendme' ? 'TrendMe' : am.get(k) || k;
      if (by === 'hour') return `${String(k).padStart(2, '0')}:00`;
      return k === '' ? '—' : k;
    };
    const m = new Map();
    const g = (k) => {
      const key = String(k ?? '');
      if (!m.has(key)) m.set(key, { key, clicks: 0, uniq: 0, conversions: 0, approved: 0, pending: 0, rejected: 0, sales: 0, revenue: 0, payout: 0, pendingPayout: 0, pendingRevenue: 0 });
      return m.get(key);
    };
    // CPA clicks (already grouped by day/hour/offer/geo/device/subs; user filter applied in SQL)
    const clickKey = (x) => ({ date: String(x.day).slice(0, 10), hour: x.hour, offer: x.offer_id, advertiser: (om.get(x.offer_id) || {}).advertiser_id, country: x.country, device: x.device, os: x.os, browser: x.browser, source: x.source, sub1: x.sub1, sub2: x.sub2, sub3: x.sub3, sub4: x.sub4, sub5: x.sub5 }[by]);
    if (wantCpa) {
      for (const x of clicks) {
        if (offerF && x.offer_id !== offerF) continue;
        if (uidF === '__none__') continue;
        if (by === 'partner') continue; // clicks per partner come from the daily RPC below
        const row = g(clickKey(x)); row.clicks += num(x.clicks); row.uniq += num(x.uniq);
      }
      if (by === 'partner' && uidF !== '__none__') {
        for (const x of await store.daily(fromIso, toIso)) {
          if ((offerF && x.offer_id !== offerF) || (uidF && x.user_id !== uidF)) continue;
          const row = g(x.user_id); row.clicks += num(x.clicks); row.uniq += num(x.uniq);
        }
      }
      // conversions; device/os/browser come from their click
      const needClick = ['device', 'os', 'browser'].includes(by);
      const cmap = needClick ? new Map((await store.clicksByIds([...new Set(conv.rows.map((c) => c.click_id).filter(Boolean))])).map((c) => [c.id, c])) : null;
      for (const c of uidF === '__none__' ? [] : conv.rows) {
        const ck = cmap ? cmap.get(c.click_id) || {} : {};
        const k = { date: ALMD(c.created_at), hour: ALMH(c.created_at), offer: c.offer_id, partner: c.user_id, advertiser: c.advertiser_id, country: c.country || '', source: c.source || '', sub1: c.sub1 || '', sub2: c.sub2 || '', sub3: c.sub3 || '', sub4: c.sub4 || '', sub5: c.sub5 || '', device: ck.device || '', os: ck.os || '', browser: ck.browser || '' }[by];
        const row = g(k);
        row.conversions++; row[c.status]++;
        if (c.status !== 'rejected') row.sales += num(c.sale_amount_kzt);
        if (c.status === 'approved') { row.revenue += num(c.revenue_kzt); row.payout += num(c.payout_kzt); }
        if (c.status === 'pending') { row.pendingRevenue += num(c.revenue_kzt); row.pendingPayout += num(c.payout_kzt); }
      }
    }
    // TrendMe: visits per day/partner + every order of referred customers
    let tmNote = '';
    if (wantTm && tm) {
      if (tm.unavailable) tmNote = 'TrendMe сейчас просыпается — его данные появятся через минуту.';
      const tmKey = (code, day) => ({ date: day, offer: 'trendme', advertiser: tmAdv ? tmAdv.id : 'trendme', partner: (pByCode.get(code) || {}).user_id || code }[by]);
      if (by === 'partner') {
        for (const p of tm.partners || []) { if (codeF && p.code !== codeF) continue; const row = g(tmKey(p.code)); row.clicks += num(p.period.visits); row.uniq += num(p.period.visits); }
      } else if (!codeF) {
        for (const d of tm.daily || []) { const row = g(tmKey('', String(d.day).slice(0, 10))); row.clicks += num(d.visits); row.uniq += num(d.visits); }
      } else {
        const p = (tm.partners || []).find((x) => x.code === codeF);
        if (p && by !== 'date') { const row = g(tmKey(codeF)); row.clicks += num(p.period.visits); row.uniq += num(p.period.visits); }
      }
      for (const o of tm.orders || []) {
        if (codeF && o.code !== codeF) continue;
        const row = g(tmKey(o.code, ALMD(o.time)));
        const paid = o.paymentStatus === 'succeeded' && o.commissionStatus === 'earned';
        const pend = o.paymentStatus === 'pending';
        const st = paid ? 'approved' : pend ? 'pending' : 'rejected';
        row.conversions++; row[st]++;
        if (st !== 'rejected') row.sales += num(o.amountKzt);
        if (paid) { row.revenue += num(o.amountKzt); row.payout += num(o.commissionKzt); }
        if (pend) { row.pendingRevenue += num(o.amountKzt); row.pendingPayout += Math.floor(num(o.amountKzt) * num(o.percent) / 100); }
      }
    }
    let rows = [...m.values()].map((x) => ({ ...x, label: label(x.key), sales: r2(x.sales), revenue: r2(x.revenue), payout: r2(x.payout), pendingPayout: r2(x.pendingPayout), pendingRevenue: r2(x.pendingRevenue) }));
    rows = by === 'date' ? rows.sort((a, b) => (a.key < b.key ? 1 : -1)) : by === 'hour' ? rows.sort((a, b) => Number(a.key) - Number(b.key)) : rows.sort((a, b) => b.payout + b.pendingPayout - (a.payout + a.pendingPayout) || b.clicks - a.clicks);
    const T = rows.reduce((t, x) => { for (const k of ['clicks', 'uniq', 'conversions', 'approved', 'pending', 'rejected', 'sales', 'revenue', 'payout', 'pendingPayout', 'pendingRevenue']) t[k] += x[k]; return t; }, { clicks: 0, uniq: 0, conversions: 0, approved: 0, pending: 0, rejected: 0, sales: 0, revenue: 0, payout: 0, pendingPayout: 0, pendingRevenue: 0 });
    return { range: r, group: by, groups: REPORT_GROUPS, trendmeIncluded: wantTm, note: tmNote || (!TM_GROUPS.includes(by) && src !== 'cpa' ? 'Разрез доступен только для CPA-офферов: TrendMe не передаёт sub-параметры, ГЕО и устройства.' : ''), totals: T, rows };
  }

  app.get('/api/admin/report', ...A, wrap(async (req, res) => res.json(await report(req))));
  app.get('/api/admin/report.csv', ...A, wrap(async (req, res) => {
    const d = await report(req);
    const head = [d.groups[d.group], 'clicks', 'unique', 'conversions', 'approved', 'pending', 'rejected', 'cr_%', 'sales_kzt', 'revenue_kzt', 'payout_kzt', 'profit_kzt', 'pending_payout_kzt', 'epc_kzt'];
    const lines = [head.map(csvCell).join(',')];
    for (const x of d.rows) lines.push([x.label, x.clicks, x.uniq, x.conversions, x.approved, x.pending, x.rejected, x.clicks ? Math.round((x.conversions / x.clicks) * 10000) / 100 : '', x.sales, x.revenue, x.payout, r2(x.revenue - x.payout), x.pendingPayout, x.clicks ? r2(x.payout / x.clicks) : ''].map(csvCell).join(','));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="teliks_report_${d.group}_${d.range.from}_${d.range.to}.csv"`);
    res.send('﻿' + lines.join('\r\n'));
  }));

  app.get('/api/admin/conversions', ...A, wrap(async (req, res) => {
    const pageN = Math.max(1, parseInt(req.query.page, 10) || 1);
    const d = await allConversions(req);
    res.json({ ...d, page: pageN, perPage: 100, rows: d.rows.slice((pageN - 1) * 100, pageN * 100) });
  }));

  app.get('/api/admin/conversions.csv', ...A, wrap(async (req, res) => {
    const d = await allConversions(req);
    const head = ['time', 'source', 'offer_id', 'advertiser', 'partner_code', 'partner', 'goal', 'order_or_txid', 'click_id', 'status', 'advertiser_status', 'sale_kzt', 'revenue_kzt', 'payout_kzt', 'hold_until', 'sub1', 'traffic_source', 'country', 'note'];
    const lines = [head.join(',')];
    for (const c of d.rows) lines.push([c.time, c.source, c.offer_id, c.advertiser, c.code, c.partner, c.goal, c.txid, c.click_id, c.status, c.adv_label, c.sale, c.revenue, c.payout, c.hold_until, c.sub1, c.source_traffic, c.country, c.note].map(csvCell).join(','));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="teliks_conversions_${d.range.from}_${d.range.to}.csv"`);
    res.send('﻿' + lines.join('\r\n'));
  }));

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
