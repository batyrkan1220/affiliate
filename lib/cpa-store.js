'use strict';
/**
 * Storage for the CPA network: advertisers, offers, offer access, clicks, conversions, postback log.
 * Production: Teliks' own Supabase (PostgREST, service role, server only).
 * Demo (DEMO=1): the same interface in memory, seeded with sample data.
 */
const cfg = require('./config');
const { ApiError } = require('./errors');

const enc = encodeURIComponent;
const dbErr = () => new ApiError('Database error', 502, 'upstream_error');
const num = (v) => Number(v) || 0;

/* ───────────────────────── Supabase ───────────────────────── */
function supabaseStore() {
  const { call } = require('./supabase');
  const q = async (path, opts) => {
    const r = await call(path, opts);
    if (!r.ok) {
      if (r.status === 409 || (r.data && r.data.code === '23505')) { const e = new ApiError('Duplicate', 409, 'duplicate'); e.dup = true; throw e; }
      throw dbErr();
    }
    return r;
  };
  const rows = async (path) => (await q(path)).data || [];
  const one = async (path) => (await rows(path))[0] || null;
  const insert = async (table, body) => (await q(`/rest/v1/${table}`, { method: 'POST', body, prefer: 'return=representation' })).data[0];
  const patch = async (path, body) => ((await q(path, { method: 'PATCH', body, prefer: 'return=representation' })).data || [])[0] || null;
  const rpc = async (fn, args) => (await q(`/rest/v1/rpc/${fn}`, { method: 'POST', body: args })).data;

  return {
    advList: () => rows('/rest/v1/advertisers?select=*&order=created_at.desc&limit=500'),
    advGet: (id) => one(`/rest/v1/advertisers?id=eq.${enc(id)}&select=*`),
    advByKeyHash: (h) => one(`/rest/v1/advertisers?api_key_hash=eq.${enc(h)}&select=*`),
    advCreate: (row) => insert('advertisers', row),
    advUpdate: (id, p) => patch(`/rest/v1/advertisers?id=eq.${enc(id)}`, p),

    offerList: () => rows('/rest/v1/offers?select=*&order=created_at.desc&limit=1000'),
    offerGet: (id) => one(`/rest/v1/offers?id=eq.${enc(id)}&select=*`),
    offerCreate: (row) => insert('offers', row),
    offerUpdate: (id, p) => patch(`/rest/v1/offers?id=eq.${enc(id)}`, { ...p, updated_at: new Date().toISOString() }),

    accessList: ({ user, status } = {}) => rows(`/rest/v1/offer_access?select=*${user ? `&user_id=eq.${enc(user)}` : ''}${status ? `&status=eq.${enc(status)}` : ''}&order=created_at.desc&limit=1000`),
    accessGet: (offer, user) => one(`/rest/v1/offer_access?offer_id=eq.${enc(offer)}&user_id=eq.${enc(user)}&select=*`),
    async accessUpsert(offer, user, status) {
      const r = await q('/rest/v1/offer_access?on_conflict=offer_id,user_id', {
        method: 'POST', prefer: 'resolution=merge-duplicates,return=representation',
        body: { offer_id: offer, user_id: user, status, decided_at: status === 'pending' ? null : new Date().toISOString() },
      });
      return r.data[0];
    },

    partnerByCode: (code) => one(`/rest/v1/partners?trendme_code=eq.${enc(code)}&select=user_id,trendme_code,name,active,postback_url`),
    partnerByUid: (uid) => one(`/rest/v1/partners?user_id=eq.${enc(uid)}&select=user_id,trendme_code,name,active,postback_url`),
    setPostback: (uid, url) => patch(`/rest/v1/partners?user_id=eq.${enc(uid)}`, { postback_url: url || null }),

    clickInsert: (row) => q('/rest/v1/clicks', { method: 'POST', body: row, prefer: 'return=minimal' }),
    clickGet: (id) => one(`/rest/v1/clicks?id=eq.${enc(id)}&select=*`),

    convInsert: (row) => insert('conversions', row),
    convGet: (id) => one(`/rest/v1/conversions?id=eq.${enc(id)}&select=*`),
    convFind: ({ offer_id, goal, external_id, click_id }) => (external_id
      ? one(`/rest/v1/conversions?offer_id=eq.${enc(offer_id)}&goal=eq.${enc(goal)}&external_id=eq.${enc(external_id)}&select=*`)
      : one(`/rest/v1/conversions?click_id=eq.${enc(click_id)}&goal=eq.${enc(goal)}&external_id=is.null&select=*`)),
    convUpdate: (id, p) => patch(`/rest/v1/conversions?id=eq.${enc(id)}`, { ...p, updated_at: new Date().toISOString() }),
    async convList({ user, offer, offers, advertiser, status, fromIso, toIso, limit = 50, offset = 0 } = {}) {
      const f = [
        user && `user_id=eq.${enc(user)}`, offer && `offer_id=eq.${enc(offer)}`, advertiser && `advertiser_id=eq.${enc(advertiser)}`,
        offers && `offer_id=in.(${offers.map((o) => `"${o}"`).join(',')})`,
        status && `status=eq.${enc(status)}`, fromIso && `created_at=gte.${enc(fromIso)}`, toIso && `created_at=lt.${enc(toIso)}`,
      ].filter(Boolean).join('&');
      const r = await call(`/rest/v1/conversions?select=*${f ? '&' + f : ''}&order=created_at.desc&limit=${limit}&offset=${offset}`, { prefer: 'count=exact' });
      if (!r.ok) throw dbErr();
      const total = Number((r.range.split('/')[1] || '0').replace('*', '0')) || (r.data || []).length;
      return { rows: r.data || [], total };
    },

    clickRows: (user, fromIso, toIso) => rpc('cpa_click_rows', { p_user: user || null, p_from: fromIso, p_to: toIso }).then((d) => d || []),
    daily: (fromIso, toIso) => rpc('cpa_daily', { p_from: fromIso, p_to: toIso }).then((d) => d || []),
    balances: (user) => rpc('cpa_balances', { p_user: user || null }).then((d) => (d || []).map((x) => ({ user_id: x.user_id, approved_kzt: num(x.approved_kzt), pending_kzt: num(x.pending_kzt) }))),
    capUsed: (offer, sinceIso) => rpc('cpa_cap_used', { p_offer: offer, p_since: sinceIso }).then(num),
    releaseHolds: () => rpc('cpa_release_holds', {}).then(num),

    logInsert: (row) => q('/rest/v1/postback_log', { method: 'POST', body: row, prefer: 'return=minimal' }).catch(() => {}),
    logList: ({ limit = 200 } = {}) => rows(`/rest/v1/postback_log?select=*&order=created_at.desc&limit=${limit}`),

    paidSplit: async (uid) => (await rows(`/rest/v1/payout_requests?status=eq.paid${uid ? `&user_id=eq.${enc(uid)}` : ''}&select=user_id,amount_kzt,trendme_kzt&limit=10000`)),
    setRequestTrendme: (id, kzt) => patch(`/rest/v1/payout_requests?id=eq.${enc(id)}&status=eq.processing`, { trendme_kzt: kzt }),
  };
}

/* ───────────────────────── memory (demo) ───────────────────────── */
function memoryStore() {
  const crypto = require('crypto');
  const D = { adv: [], offers: [], access: [], clicks: new Map(), conv: [], log: [], postback: new Map(), paid: [] };
  const now = () => new Date().toISOString();
  const ALM = 5 * 3600000;
  const day = (iso) => new Date(Date.parse(iso) + ALM).toISOString().slice(0, 10);
  const hour = (iso) => new Date(Date.parse(iso) + ALM).getUTCHours();
  const inRange = (iso, a, b) => (!a || iso >= a) && (!b || iso < b);
  const clone = (x) => (x ? JSON.parse(JSON.stringify(x)) : null);
  const uuid = () => crypto.randomUUID();
  const demoPartners = [{ user_id: 'demo-user', trendme_code: 'demo2026', name: 'Demo partner', active: true }];

  // seed: one advertiser, two offers, 30 days of traffic for the demo partner
  const advId = uuid();
  D.adv.push({ id: advId, name: 'Demo Bank', company: 'ТОО «Демо Банк»', email: 'cpa@demobank.kz', telegram: '@demobank_cpa', website: 'https://demobank.kz', notes: '', api_key_hash: crypto.createHash('sha256').update('adv_demo_key_000000000000000000000000').digest('hex'), api_key_prefix: 'adv_demo', status: 'active', created_at: '2026-09-15T05:00:00Z' });
  const offerRows = [
    { id: 'demobank-card', name: 'Демо Банк — дебетовая карта', model: 'CPA', categories: ['Финансы', 'Банки'], geo: ['KZ'], goals: [{ code: 'lead', name: 'Заявка', payout_type: 'fixed', payout: 500, revenue_type: 'fixed', revenue: 800 }, { code: 'sale', name: 'Выдача карты', payout_type: 'fixed', payout: 4000, revenue_type: 'fixed', revenue: 6000 }], hold_days: 7, daily_cap: 200, access: 'approval' },
    { id: 'demoshop', name: 'DemoShop — интернет-магазин', model: 'CPS', categories: ['E-commerce'], geo: ['KZ', 'UZ'], goals: [{ code: 'sale', name: 'Оплаченный заказ', payout_type: 'percent', payout: 8, revenue_type: 'percent', revenue: 12 }], hold_days: 14, daily_cap: null, access: 'open' },
  ];
  for (const o of offerRows) {
    D.offers.push({
      advertiser_id: advId, description: 'Демо-оффер для проверки CPA-платформы. Клиент переходит по ссылке, выполняет целевое действие, рекламодатель присылает постбэк.',
      kpi: 'Запрещены мотивированный трафик, брендовый контекст, спам.', logo_url: null, preview_url: 'https://example.com/',
      target_url: `https://example.com/landing?click_id={click_id}&aff={aff_id}&sub1={sub1}`, status: 'active',
      created_at: '2026-09-20T05:00:00Z', updated_at: '2026-09-20T05:00:00Z', ...o,
    });
  }
  D.access.push({ offer_id: 'demobank-card', user_id: 'demo-user', status: 'approved', created_at: '2026-09-21T05:00:00Z', decided_at: '2026-09-21T06:00:00Z' });
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const SRC = ['instagram', 'tiktok', 'telegram', 'youtube'];
  for (let d = 29; d >= 0; d--) {
    for (const o of D.offers) {
      const n = 10 + Math.floor(rnd() * 30);
      for (let i = 0; i < n; i++) {
        const t = new Date(Date.now() - d * 86400000 - Math.floor(rnd() * 80000000)).toISOString();
        if (t > now()) continue;
        const id = crypto.randomBytes(10).toString('hex');
        const c = { id, offer_id: o.id, user_id: 'demo-user', sub1: rnd() < 0.5 ? 'stories' : 'reels', sub2: '', sub3: '', sub4: '', sub5: '', source: SRC[Math.floor(rnd() * 4)], sub_aff_id: null, aff_click_id: null, ip: `10.0.${Math.floor(rnd() * 50)}.${Math.floor(rnd() * 200)}`, country: 'KZ', device: rnd() < 0.8 ? 'mobile' : 'desktop', os: rnd() < 0.6 ? 'Android' : 'iOS', browser: 'Chrome', ua: '', referer: '', created_at: t };
        D.clicks.set(id, c);
        if (rnd() < 0.12) {
          const g = o.goals[o.goals.length > 1 && rnd() < 0.3 ? 1 : 0];
          const sale = g.payout_type === 'percent' ? 5000 + Math.floor(rnd() * 30000) : null;
          const pay = g.payout_type === 'percent' ? Math.round(sale * g.payout) / 100 : g.payout;
          const rev = g.revenue_type === 'percent' ? Math.round(sale * g.revenue) / 100 : g.revenue;
          const st = d > o.hold_days ? (rnd() < 0.85 ? 'approved' : 'rejected') : 'pending';
          D.conv.push({ id: uuid(), click_id: id, offer_id: o.id, user_id: 'demo-user', advertiser_id: advId, goal: g.code, external_id: `ORD-${Math.floor(rnd() * 1e6)}`, status: st, adv_status: st === 'pending' ? 'approved' : st, payout_kzt: pay, revenue_kzt: rev, sale_amount_kzt: sale, sub1: c.sub1, sub2: '', sub3: '', sub4: '', sub5: '', source: c.source, country: 'KZ', note: null, hold_until: st === 'pending' ? new Date(Date.parse(t) + o.hold_days * 86400000).toISOString() : null, created_at: t, updated_at: t });
        }
      }
    }
  }

  const dupCheck = (row) => D.conv.find((c) => c.offer_id === row.offer_id && c.goal === row.goal && (row.external_id ? c.external_id === row.external_id : !c.external_id && c.click_id === row.click_id));
  const A = async (x) => clone(x);

  return {
    advList: () => A([...D.adv].sort((a, b) => (a.created_at < b.created_at ? 1 : -1))),
    advGet: (id) => A(D.adv.find((a) => a.id === id)),
    advByKeyHash: (h) => A(D.adv.find((a) => a.api_key_hash === h)),
    advCreate: (row) => { const a = { id: uuid(), status: 'active', created_at: now(), ...row }; D.adv.push(a); return A(a); },
    advUpdate: (id, p) => { const a = D.adv.find((x) => x.id === id); if (a) Object.assign(a, p); return A(a); },

    offerList: () => A([...D.offers].sort((a, b) => (a.created_at < b.created_at ? 1 : -1))),
    offerGet: (id) => A(D.offers.find((o) => o.id === id)),
    offerCreate: (row) => {
      if (D.offers.some((o) => o.id === row.id)) { const e = new ApiError('Duplicate', 409, 'duplicate'); e.dup = true; return Promise.reject(e); }
      const o = { status: 'active', access: 'approval', hold_days: 0, daily_cap: null, categories: [], geo: [], goals: [], created_at: now(), updated_at: now(), ...row };
      D.offers.push(o); return A(o);
    },
    offerUpdate: (id, p) => { const o = D.offers.find((x) => x.id === id); if (o) Object.assign(o, p, { updated_at: now() }); return A(o); },

    accessList: ({ user, status } = {}) => A(D.access.filter((a) => (!user || a.user_id === user) && (!status || a.status === status))),
    accessGet: (offer, user) => A(D.access.find((a) => a.offer_id === offer && a.user_id === user)),
    accessUpsert: (offer, user, status) => {
      let a = D.access.find((x) => x.offer_id === offer && x.user_id === user);
      if (!a) { a = { offer_id: offer, user_id: user, created_at: now() }; D.access.push(a); }
      Object.assign(a, { status, decided_at: status === 'pending' ? null : now() });
      return A(a);
    },

    partnerByCode: (code) => A(demoPartners.map((p) => ({ ...p, postback_url: D.postback.get(p.user_id) || null })).find((p) => p.trendme_code === code)),
    partnerByUid: (uid) => A(demoPartners.map((p) => ({ ...p, postback_url: D.postback.get(p.user_id) || null })).find((p) => p.user_id === uid)),
    setPostback: (uid, url) => { D.postback.set(uid, url || null); return A({}); },

    clickInsert: (row) => { D.clicks.set(row.id, { created_at: now(), ...row }); return A({}); },
    clickGet: (id) => A(D.clicks.get(id)),

    convInsert: (row) => {
      if (dupCheck(row)) { const e = new ApiError('Duplicate', 409, 'duplicate'); e.dup = true; return Promise.reject(e); }
      const c = { id: uuid(), created_at: now(), updated_at: now(), ...row }; D.conv.push(c); return A(c);
    },
    convGet: (id) => A(D.conv.find((c) => c.id === id)),
    convFind: (k) => A(dupCheck(k)),
    convUpdate: (id, p) => { const c = D.conv.find((x) => x.id === id); if (c) Object.assign(c, p, { updated_at: now() }); return A(c); },
    convList: ({ user, offer, offers, advertiser, status, fromIso, toIso, limit = 50, offset = 0 } = {}) => {
      const all = D.conv.filter((c) => (!user || c.user_id === user) && (!offer || c.offer_id === offer) && (!offers || offers.includes(c.offer_id)) &&
        (!advertiser || c.advertiser_id === advertiser) && (!status || c.status === status) && inRange(c.created_at, fromIso, toIso))
        .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
      return A({ rows: all.slice(offset, offset + limit), total: all.length });
    },

    clickRows: (user, fromIso, toIso) => {
      const m = new Map();
      for (const c of D.clicks.values()) {
        if ((user && c.user_id !== user) || !inRange(c.created_at, fromIso, toIso)) continue;
        const r = { day: day(c.created_at), hour: hour(c.created_at), offer_id: c.offer_id, country: c.country || '', device: c.device || '', os: c.os || '', browser: c.browser || '', source: c.source || '', sub1: c.sub1 || '', sub2: c.sub2 || '', sub3: c.sub3 || '', sub4: c.sub4 || '', sub5: c.sub5 || '' };
        const k = Object.values(r).join('|');
        const g = m.get(k) || { ...r, clicks: 0, ips: new Set() };
        g.clicks++; g.ips.add(c.ip); m.set(k, g);
      }
      return A([...m.values()].map(({ ips, ...g }) => ({ ...g, uniq: ips.size })));
    },
    daily: (fromIso, toIso) => {
      const m = new Map();
      const get = (d, o, u) => {
        const k = `${d}|${o}|${u}`;
        if (!m.has(k)) m.set(k, { day: d, offer_id: o, user_id: u, clicks: 0, ips: new Set(), approved: 0, pending: 0, rejected: 0, payout_kzt: 0, pending_payout_kzt: 0, revenue_kzt: 0, pending_revenue_kzt: 0, sales_kzt: 0 });
        return m.get(k);
      };
      for (const c of D.clicks.values()) if (inRange(c.created_at, fromIso, toIso)) { const g = get(day(c.created_at), c.offer_id, c.user_id); g.clicks++; g.ips.add(c.ip); }
      for (const c of D.conv) {
        if (!inRange(c.created_at, fromIso, toIso)) continue;
        const g = get(day(c.created_at), c.offer_id, c.user_id);
        g[c.status]++;
        if (c.status === 'approved') { g.payout_kzt += num(c.payout_kzt); g.revenue_kzt += num(c.revenue_kzt); }
        if (c.status === 'pending') { g.pending_payout_kzt += num(c.payout_kzt); g.pending_revenue_kzt += num(c.revenue_kzt); }
        if (c.status !== 'rejected') g.sales_kzt += num(c.sale_amount_kzt);
      }
      return A([...m.values()].map(({ ips, ...g }) => ({ ...g, uniq: ips.size })));
    },
    balances: (user) => {
      const m = new Map();
      for (const c of D.conv) {
        if (user && c.user_id !== user) continue;
        const b = m.get(c.user_id) || { user_id: c.user_id, approved_kzt: 0, pending_kzt: 0 };
        if (c.status === 'approved') b.approved_kzt += num(c.payout_kzt);
        if (c.status === 'pending') b.pending_kzt += num(c.payout_kzt);
        m.set(c.user_id, b);
      }
      return A([...m.values()]);
    },
    capUsed: (offer, sinceIso) => A(D.conv.filter((c) => c.offer_id === offer && c.created_at >= sinceIso && c.status !== 'rejected').length),
    releaseHolds: () => {
      let n = 0;
      for (const c of D.conv) if (c.status === 'pending' && c.adv_status === 'approved' && c.hold_until && c.hold_until <= now()) { c.status = 'approved'; c.updated_at = now(); n++; }
      return A(n);
    },

    logInsert: (row) => { D.log.unshift({ id: D.log.length + 1, created_at: now(), ...row }); D.log.length = Math.min(D.log.length, 500); return A({}); },
    logList: ({ limit = 200 } = {}) => A(D.log.slice(0, limit)),

    paidSplit: (uid) => A(D.paid.filter((p) => !uid || p.user_id === uid)),
    setRequestTrendme: () => A({}),
  };
}

module.exports = cfg.demo ? memoryStore() : supabaseStore();
