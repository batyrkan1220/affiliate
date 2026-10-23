'use strict';
/**
 * CPA engine: tracking clicks, advertiser postbacks (S2S), statuses with hold, partner postbacks.
 *
 * Flow:  partner link  /c/<offer>/<aff>?sub1=…  → click saved, click_id generated
 *        → redirect to the advertiser's target URL with {click_id} filled in
 *        → advertiser calls  /postback?key=…&click_id=…&goal=…&status=…&amount=…&txid=…
 *        → conversion saved (payout for the partner, revenue for the network) → partner postback.
 */
const crypto = require('crypto');
const dns = require('dns').promises;
const net = require('net');
const store = require('./cpa-store');
const { ApiError } = require('./errors');

const ALM = 5 * 3600000;
const almatyDayStart = (ms = Date.now()) => new Date(Math.floor((ms + ALM) / 86400000) * 86400000 - ALM).toISOString();
const rangeIso = (from, to) => ({ fromIso: new Date(Date.parse(from + 'T00:00:00Z') - ALM).toISOString(), toIso: new Date(Date.parse(to + 'T00:00:00Z') + 86400000 - ALM).toISOString() });

/* ───── small caches (offers and partners are read on every click) ───── */
const cache = new Map();
async function cached(key, ttl, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.v;
  const v = await fn();
  cache.set(key, { at: Date.now(), v });
  if (cache.size > 2000) cache.delete(cache.keys().next().value);
  return v;
}
const bust = () => cache.clear();
const offerCached = (id) => cached('o:' + id, 30000, () => store.offerGet(id));
const partnerCached = (code) => cached('p:' + code, 60000, () => store.partnerByCode(code));
const accessCached = (offer, uid) => cached(`a:${offer}:${uid}`, 30000, () => store.accessGet(offer, uid));

/* ───── keys ───── */
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
function newApiKey() {
  const key = 'adv_' + crypto.randomBytes(24).toString('base64url');
  return { key, hash: sha(key), prefix: key.slice(0, 10) };
}
async function advertiserByKey(key) {
  if (typeof key !== 'string' || key.length < 20 || key.length > 80) return null;
  const a = await store.advByKeyHash(sha(key));
  return a && a.status === 'active' ? a : null;
}

/* ───── request details ───── */
const BOT_RE = /bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|telegrambot|vkshare|curl|wget|python-requests|headless/i;
function parseUA(ua = '') {
  const device = /ipad|tablet/i.test(ua) ? 'tablet' : /mobi|iphone|android/i.test(ua) ? 'mobile' : ua ? 'desktop' : '';
  const os = /android/i.test(ua) ? 'Android' : /iphone|ipad|ios/i.test(ua) ? 'iOS' : /windows/i.test(ua) ? 'Windows' : /mac os/i.test(ua) ? 'macOS' : /linux/i.test(ua) ? 'Linux' : '';
  const browser = /instagram/i.test(ua) ? 'Instagram' : /telegram/i.test(ua) ? 'Telegram' : /yabrowser/i.test(ua) ? 'Yandex' : /samsungbrowser/i.test(ua) ? 'Samsung'
    : /edg\//i.test(ua) ? 'Edge' : /opr\//i.test(ua) ? 'Opera' : /firefox|fxios/i.test(ua) ? 'Firefox' : /chrome|crios/i.test(ua) ? 'Chrome' : /safari/i.test(ua) ? 'Safari' : '';
  return { device, os, browser };
}
const countryOf = (req) => {
  const c = String(req.get('cf-ipcountry') || req.get('x-vercel-ip-country') || req.get('x-country-code') || '').toUpperCase();
  return /^[A-Z]{2}$/.test(c) && c !== 'XX' ? c : '';
};
const ipOf = (req) => { const ip = String(req.ip || '').replace(/^::ffff:/, ''); return net.isIP(ip) ? ip : null; };
const clean = (v, max = 100) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/* ───── macros ───── */
function fill(template, values) {
  return String(template).replace(/\{([a-z0-9_]+)\}/gi, (m, k) => (Object.prototype.hasOwnProperty.call(values, k) ? encodeURIComponent(values[k] == null ? '' : String(values[k])) : m));
}

/* ───── clicks ───── */
async function click(req, offerId, affCode) {
  const offer = /^[a-z0-9][a-z0-9_-]{1,31}$/.test(offerId) ? await offerCached(offerId) : null;
  const partner = /^[a-z0-9]{4,24}$/.test(affCode) ? await partnerCached(affCode) : null;
  if (!offer || offer.status === 'archived') return { error: 'not_found' };
  if (offer.status !== 'active') return { error: 'paused', fallback: offer.preview_url };
  if (!partner || !partner.active) return { error: 'not_found', fallback: offer.preview_url };
  if (offer.access !== 'open') {
    const a = await accessCached(offer.id, partner.user_id);
    if (!a || a.status !== 'approved') return { error: 'no_access', fallback: offer.preview_url };
  }
  const q = req.query || {};
  const pick = (...names) => { for (const n of names) if (typeof q[n] === 'string' && q[n]) return clean(q[n]); return ''; };
  const id = crypto.randomBytes(12).toString('hex');
  const ua = clean(req.get('user-agent') || '', 400);
  const row = {
    id, offer_id: offer.id, user_id: partner.user_id,
    sub1: pick('sub1', 'aff_sub1', 'aff_sub'), sub2: pick('sub2', 'aff_sub2'), sub3: pick('sub3', 'aff_sub3'), sub4: pick('sub4', 'aff_sub4'), sub5: pick('sub5', 'aff_sub5'),
    source: pick('source'), sub_aff_id: pick('sub_aff_id'), aff_click_id: pick('aff_click_id', 'clickid'),
    ip: ipOf(req), country: countryOf(req), ...parseUA(ua), ua, referer: clean(req.get('referer') || '', 400),
  };
  const values = { click_id: id, aff_id: partner.trendme_code, offer_id: offer.id, sub1: row.sub1, sub2: row.sub2, sub3: row.sub3, sub4: row.sub4, sub5: row.sub5, source: row.source, sub_aff_id: row.sub_aff_id };
  if (BOT_RE.test(ua)) return { url: fill(offer.target_url, { ...values, click_id: '' }), bot: true };
  await store.clickInsert(row);
  return { url: fill(offer.target_url, values), clickId: id };
}

/* ───── statuses ───── */
const APPROVED = ['approved', 'approve', 'confirmed', 'confirm', 'success', 'paid', 'sale', '1', 'accepted'];
const REJECTED = ['rejected', 'reject', 'declined', 'decline', 'cancelled', 'canceled', 'cancel', 'fraud', 'trash', 'refund', 'refunded', '-1', '2'];
const normStatus = (s) => { const v = String(s || '').toLowerCase().trim(); return APPROVED.includes(v) ? 'approved' : REJECTED.includes(v) ? 'rejected' : 'pending'; };

function goalOf(offer, code) {
  const goals = Array.isArray(offer.goals) ? offer.goals : [];
  if (!goals.length) return null;
  if (!code) return goals[0];
  return goals.find((g) => g.code === code) || null;
}
const amountOf = (type, value, sale) => (type === 'percent' ? (sale ? Math.round(sale * Number(value)) / 100 : 0) : Number(value) || 0);

// Advertiser status + hold → what the partner sees.
function finalStatus(adv, offer, createdAtIso) {
  if (adv !== 'approved') return { status: adv, hold_until: null };
  const hold = Number(offer.hold_days) || 0;
  if (!hold) return { status: 'approved', hold_until: null };
  const until = new Date(Date.parse(createdAtIso || new Date().toISOString()) + hold * 86400000).toISOString();
  return until <= new Date().toISOString() ? { status: 'approved', hold_until: until } : { status: 'pending', hold_until: until };
}

/**
 * Advertiser postback / API conversion.
 * params: click_id (required), goal, status, amount (sale amount, ₸), txid (advertiser transaction id), comment
 */
async function conversion(adv, p, via = 'postback') {
  const clickId = clean(p.click_id || p.clickid || p.subid || '', 40);
  const txid = clean(p.txid || p.transaction_id || p.order_id || '', 100) || null;
  const goalCode = clean(p.goal || p.event || '', 32);
  const advStatus = normStatus(p.status);
  const saleRaw = p.amount ?? p.sum ?? p.sale_amount;
  const sale = saleRaw === undefined || saleRaw === '' ? null : Number(String(saleRaw).replace(',', '.'));
  const log = (ok, message, extra = {}) => store.logInsert({
    direction: 'in', advertiser_id: adv.id, ok, message, http_status: ok ? 200 : 400,
    summary: `${via}: click_id=${clickId || '—'} goal=${goalCode || '—'} status=${advStatus}${txid ? ' txid=' + txid : ''}${sale != null ? ' amount=' + sale : ''}`.slice(0, 600), ...extra,
  });
  const fail = async (code, msg) => { await log(false, msg); throw new ApiError(msg, code === 'not_found' ? 404 : 400, code); };

  if (!/^[A-Za-z0-9]{16,32}$/.test(clickId)) return fail('bad_click_id', 'click_id is missing or invalid');
  if (sale !== null && (!Number.isFinite(sale) || sale < 0 || sale > 1e9)) return fail('bad_amount', 'amount must be a number ≥ 0');
  const c = await store.clickGet(clickId);
  if (!c) return fail('not_found', 'click not found');
  const offer = await store.offerGet(c.offer_id);
  if (!offer || offer.advertiser_id !== adv.id) return fail('not_found', 'click not found');
  const goal = goalOf(offer, goalCode);
  if (!goal) return fail('bad_goal', `unknown goal "${goalCode}"`);

  const key = { offer_id: offer.id, goal: goal.code, external_id: txid, click_id: c.id };
  let existing = await store.convFind(key);
  if (existing) return update(existing, offer, goal, advStatus, sale, log);

  const payout = amountOf(goal.payout_type, goal.payout, sale);
  const revenue = amountOf(goal.revenue_type, goal.revenue, sale);
  let st = finalStatus(advStatus, offer, null);
  let note = null;
  if (offer.daily_cap && st.status !== 'rejected' && (await store.capUsed(offer.id, almatyDayStart())) >= offer.daily_cap) {
    st = { status: 'pending', hold_until: null };
    note = 'Превышен дневной кап — на ручной проверке';
  }
  let row;
  try {
    row = await store.convInsert({
      click_id: c.id, offer_id: offer.id, user_id: c.user_id, advertiser_id: adv.id, goal: goal.code, external_id: txid,
      status: st.status, adv_status: advStatus, hold_until: st.hold_until, payout_kzt: payout, revenue_kzt: revenue, sale_amount_kzt: sale,
      sub1: c.sub1, sub2: c.sub2, sub3: c.sub3, sub4: c.sub4, sub5: c.sub5, source: c.source, country: c.country, note,
    });
  } catch (e) {
    if (!e.dup) throw e;
    existing = await store.convFind(key);
    if (existing) return update(existing, offer, goal, advStatus, sale, log);
    throw e;
  }
  await log(true, 'created', { user_id: row.user_id, offer_id: row.offer_id, conversion_id: row.id });
  notifyPartner(row, c);
  return { ok: true, conversion_id: row.id, status: row.status, duplicate: false };
}

async function update(existing, offer, goal, advStatus, sale, log) {
  if (existing.adv_status === advStatus && (sale === null || Number(existing.sale_amount_kzt) === sale)) {
    await log(true, 'duplicate', { user_id: existing.user_id, offer_id: existing.offer_id, conversion_id: existing.id });
    return { ok: true, conversion_id: existing.id, status: existing.status, duplicate: true };
  }
  const patch = { adv_status: advStatus };
  if (sale !== null) {
    patch.sale_amount_kzt = sale;
    patch.payout_kzt = amountOf(goal.payout_type, goal.payout, sale);
    patch.revenue_kzt = amountOf(goal.revenue_type, goal.revenue, sale);
  }
  // A manual decision of the network admin is kept; otherwise follow the advertiser.
  if (!/вручную/.test(existing.note || '')) Object.assign(patch, finalStatus(advStatus, offer, existing.created_at));
  const row = await store.convUpdate(existing.id, patch);
  await log(true, `updated: ${existing.status} → ${row.status}`, { user_id: row.user_id, offer_id: row.offer_id, conversion_id: row.id });
  if (row.status !== existing.status) notifyPartner(row);
  return { ok: true, conversion_id: row.id, status: row.status, duplicate: false, updated: true };
}

/** Network admin overrides a status (approve / reject / back to pending). */
async function setStatusManually(id, status, who) {
  if (!['approved', 'pending', 'rejected'].includes(status)) throw new ApiError('Bad status', 400, 'bad_request');
  const c = await store.convGet(id);
  if (!c) throw new ApiError('Not found', 404, 'not_found');
  if (c.status === status) return c;
  const row = await store.convUpdate(id, { status, hold_until: null, note: `Изменено вручную (${who || 'admin'})`.slice(0, 300) });
  notifyPartner(row);
  return row;
}

/* ───── partner postback (outgoing) ───── */
function privateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80') || v.startsWith('::ffff:');
}

function validPostbackUrl(u) {
  if (!u) return '';
  let url;
  try { url = new URL(String(u).trim()); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password || String(u).length > 600) return null;
  if (net.isIP(url.hostname) || /^(localhost|.*\.local|.*\.internal)$/i.test(url.hostname)) return null;
  return url.toString().replace(/%7B/gi, '{').replace(/%7D/gi, '}');
}

async function sendPostback(urlTemplate, values) {
  const url = fill(urlTemplate, values);
  const u = new URL(url);
  const addrs = await dns.lookup(u.hostname, { all: true });
  if (!addrs.length || addrs.some((a) => privateIp(a.address))) throw new Error('host resolves to a private address');
  const res = await fetch(url, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(6000), headers: { 'User-Agent': 'Teliks-Postback/1.0' } });
  return { status: res.status, url: u.origin + u.pathname };
}

function notifyPartner(conv, clickRow) {
  (async () => {
    const p = await store.partnerByUid(conv.user_id);
    if (!p || !p.postback_url) return;
    const c = clickRow || (conv.click_id ? await store.clickGet(conv.click_id) : null) || {};
    const values = {
      click_id: conv.click_id || '', aff_click_id: c.aff_click_id || '', conversion_id: conv.id, offer_id: conv.offer_id, goal: conv.goal,
      status: conv.status, payout: Number(conv.payout_kzt) || 0, currency: 'KZT', sale_amount: conv.sale_amount_kzt == null ? '' : Number(conv.sale_amount_kzt),
      sub1: conv.sub1 || '', sub2: conv.sub2 || '', sub3: conv.sub3 || '', sub4: conv.sub4 || '', sub5: conv.sub5 || '', source: conv.source || '', sub_aff_id: c.sub_aff_id || '',
    };
    try {
      const r = await sendPostback(p.postback_url, values);
      await store.logInsert({ direction: 'out', user_id: conv.user_id, offer_id: conv.offer_id, conversion_id: conv.id, http_status: r.status, ok: r.status >= 200 && r.status < 400, summary: `${r.url} status=${conv.status}`, message: `HTTP ${r.status}` });
    } catch (e) {
      await store.logInsert({ direction: 'out', user_id: conv.user_id, offer_id: conv.offer_id, conversion_id: conv.id, ok: false, summary: `status=${conv.status}`, message: String(e && e.message || e).slice(0, 300) });
    }
  })().catch(() => {});
}

/* ───── offers: validation for the admin editor ───── */
const MODELS = ['CPA', 'CPL', 'CPS', 'CPI', 'RevShare'];
function validOffer(b, { isNew }) {
  const bad = (f, m) => { throw new ApiError(m || 'Invalid ' + f, 400, 'invalid_' + f); };
  const s = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const url = (v, re) => { const x = s(v, 1000); if (!x) return null; try { new URL(x); } catch { return undefined; } return re.test(x) ? x : undefined; };
  const out = {};
  if (isNew) {
    out.id = s(b.id, 32).toLowerCase();
    if (!/^[a-z0-9][a-z0-9_-]{1,31}$/.test(out.id)) bad('id', 'ID: латиница, цифры, - и _, 2–32 символа');
  }
  out.advertiser_id = s(b.advertiser_id, 40);
  if (!/^[0-9a-f-]{36}$/.test(out.advertiser_id)) bad('advertiser', 'Выберите рекламодателя');
  out.name = s(b.name, 120); if (!out.name) bad('name', 'Укажите название');
  out.description = s(b.description, 5000) || null;
  out.kpi = s(b.kpi, 3000) || null;
  out.logo_url = url(b.logo_url, /^https:\/\//); if (out.logo_url === undefined) bad('logo_url', 'Логотип: ссылка https://');
  out.preview_url = url(b.preview_url, /^https?:\/\//); if (out.preview_url === undefined) bad('preview_url', 'Превью: ссылка http(s)://');
  out.target_url = url(b.target_url, /^https?:\/\//);
  if (!out.target_url) bad('target_url', 'Целевая ссылка: http(s)://…');
  if (!out.target_url.includes('{click_id}')) bad('target_url', 'В целевой ссылке нужен макрос {click_id}');
  const list = (v) => (Array.isArray(v) ? v : String(v || '').split(',')).map((x) => String(x).trim()).filter(Boolean).slice(0, 30);
  out.categories = list(b.categories).map((x) => x.slice(0, 40));
  out.geo = list(b.geo).map((x) => x.toUpperCase()).filter((x) => /^[A-Z]{2}$/.test(x));
  out.model = MODELS.includes(b.model) ? b.model : 'CPA';
  const goals = Array.isArray(b.goals) ? b.goals.slice(0, 20) : [];
  out.goals = goals.map((g) => ({
    code: s(g.code, 32).toLowerCase(), name: s(g.name, 60),
    payout_type: g.payout_type === 'percent' ? 'percent' : 'fixed', payout: Math.max(0, Number(g.payout) || 0),
    revenue_type: g.revenue_type === 'percent' ? 'percent' : 'fixed', revenue: Math.max(0, Number(g.revenue) || 0),
  }));
  if (!out.goals.length) bad('goals', 'Добавьте хотя бы одну цель');
  const codes = new Set();
  for (const g of out.goals) {
    if (!/^[a-z0-9_-]{1,32}$/.test(g.code)) bad('goals', 'Код цели: латиница, цифры, - и _');
    if (codes.has(g.code)) bad('goals', `Цель «${g.code}» повторяется`);
    codes.add(g.code);
    if (!g.name) g.name = g.code;
    if ((g.payout_type === 'percent' && g.payout > 100) || (g.revenue_type === 'percent' && g.revenue > 100)) bad('goals', 'Процент не больше 100');
  }
  out.hold_days = Math.min(90, Math.max(0, parseInt(b.hold_days, 10) || 0));
  out.daily_cap = parseInt(b.daily_cap, 10) > 0 ? parseInt(b.daily_cap, 10) : null;
  out.access = ['open', 'approval', 'private'].includes(b.access) ? b.access : 'approval';
  out.status = ['active', 'paused', 'archived'].includes(b.status) ? b.status : 'active';
  return out;
}

function validAdvertiser(b) {
  const s = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const out = { name: s(b.name, 100), company: s(b.company, 120) || null, email: s(b.email, 254) || null, telegram: s(b.telegram, 64) || null, website: s(b.website, 300) || null, notes: s(b.notes, 2000) || null, status: b.status === 'paused' ? 'paused' : 'active' };
  if (!out.name) throw new ApiError('Укажите название', 400, 'invalid_name');
  if (out.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.email)) throw new ApiError('Неверный email', 400, 'invalid_email');
  if (out.website && !/^https?:\/\//.test(out.website)) throw new ApiError('Сайт: ссылка http(s)://', 400, 'invalid_website');
  return out;
}

module.exports = {
  store, bust, click, conversion, setStatusManually, advertiserByKey, newApiKey, normStatus, fill, validOffer, validAdvertiser,
  validPostbackUrl, rangeIso, almatyDayStart, MODELS,
};
