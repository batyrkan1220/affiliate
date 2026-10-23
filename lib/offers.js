'use strict';
/**
 * Offers a partner sees: TrendMe (native integration, bot links) + the network's own CPA offers
 * (advertisers added in the Teliks admin, tracked by /c/<offer>/<aff> links and postbacks).
 */
const cfg = require('./config');
const trendme = require('./trendme');
const { store, TRAFFIC_LABELS, offerLive, TM_DEFAULT } = require('./cpa');
const creativesOf = (list) => (list || []).map((c) => ({ url: c.url, type: /\.(png|jpe?g|gif|webp)(\?|$)/i.test(c.url) ? 'image' : c.name || 'файл' }));

const today = () => new Date(Date.now() + 5 * 3600 * 1000).toISOString().slice(0, 10);

async function trendmeOffer(code, row) {
  const d = today();
  const s = await trendme.summarySafe(code, d, d);
  const M = { ...TM_DEFAULT, ...(row ? Object.fromEntries(Object.keys(TM_DEFAULT).map((k) => [k, row[k]])) : {}) };
  const p = s.partner || {};
  const links = s.links || {};
  const extra = [links.app && `Mini App: ${links.app}`, links.site && `Сайт: ${links.site}`].filter(Boolean).join('\n');
  const pct = Number(p.percent) || 0;
  return {
    id: 'trendme',
    name: M.name,
    logo: M.logo_url || '',
    categories: M.categories || [],
    currency: '%',
    price: pct,
    model: 'RevShare',
    access: 'approved',
    start: '', end: '',
    previewUrl: M.preview_url || (links.site ? links.site.split('?')[0] : 'https://trendme.kz'),
    description: String(M.description || '').replace(/\{percent\}/g, String(pct)) + (extra ? `\n\nДругие ссылки:\n${extra}` : ''),
    kpi: [M.kpi,
      (M.traffic_allowed || []).length ? 'Разрешённый трафик: ' + M.traffic_allowed.map((k) => TRAFFIC_LABELS[k] || k).join(', ') : '',
      (M.traffic_banned || []).length ? 'Запрещённый трафик: ' + M.traffic_banned.map((k) => TRAFFIC_LABELS[k] || k).join(', ') : ''].filter(Boolean).join('\n\n'),
    geo: { allow: M.geo || [], block: [] },
    os: [], device: [], browser: [],
    payouts: [{ price: pct, model: 'RevShare', currency: '%', conditions: [] }],
    caps: [],
    events: [{ name: 'оплата заказа', token: 'sale' }],
    creatives: creativesOf(M.creatives),
    trackingUrl: links.bot || links.site || '',
    impressionUrl: '',
    native: false,
  };
}

const ACCESS = { approved: 'approved', pending: 'pending', rejected: 'rejected' };

function nativeOffer(o, accessRow, code, base) {
  const access = o.access === 'open' ? 'approved' : accessRow ? ACCESS[accessRow.status] : 'open';
  const goals = Array.isArray(o.goals) ? o.goals : [];
  const top = goals.reduce((m, g) => (Number(g.payout) > Number(m.payout || -1) ? g : m), goals[0] || {});
  return {
    id: o.id,
    name: o.name,
    logo: o.logo_url || '',
    categories: o.categories || [],
    currency: top.payout_type === 'percent' ? '%' : 'KZT',
    price: Number(top.payout) || 0,
    model: o.model,
    access,
    requested: access === 'pending',
    start: o.starts_on || '', end: o.ends_on || '',
    previewUrl: o.preview_url || '',
    description: o.description || '',
    kpi: [o.kpi,
      (o.traffic_allowed || []).length ? 'Разрешённый трафик: ' + o.traffic_allowed.map((k) => TRAFFIC_LABELS[k] || k).join(', ') : '',
      (o.traffic_banned || []).length ? 'Запрещённый трафик: ' + o.traffic_banned.map((k) => TRAFFIC_LABELS[k] || k).join(', ') : '',
      o.hold_days ? `Холд: ${o.hold_days} дн. — после подтверждения рекламодателем деньги станут доступны через ${o.hold_days} дн.` : ''].filter(Boolean).join('\n\n'),
    geo: { allow: o.geo || [], block: [] },
    os: [], device: [], browser: [],
    payouts: goals.map((g) => ({
      price: Number(g.payout) || 0, model: o.model, currency: g.payout_type === 'percent' ? '%' : 'KZT',
      conditions: [{ field: 'цель', op: 'is_equal', value: g.name || g.code }],
    })),
    caps: o.daily_cap ? [{ type: 'конверсии', period: 'в день', value: o.daily_cap, event: '' }] : [],
    events: goals.map((g) => ({ name: g.name || g.code, token: g.code })),
    creatives: creativesOf(o.creatives),
    trackingUrl: access === 'approved' ? `${base}/c/${o.id}/${code}` : '',
    impressionUrl: '',
    native: true,
  };
}

/** aff = session partner { id: code, uid } */
async function forAffiliateList(aff, base = cfg.publicUrl) {
  const [list, access] = await Promise.all([store.offerList(), store.accessList({ user: aff.uid })]);
  const tm = await trendmeOffer(aff.id, list.find((o) => o.integration === 'trendme'));
  const byOffer = new Map(access.map((a) => [a.offer_id, a]));
  const native = list
    .filter((o) => !o.integration && o.status === 'active' && offerLive(o) && (o.access !== 'private' || (byOffer.get(o.id) || {}).status === 'approved'))
    .map((o) => nativeOffer(o, byOffer.get(o.id), aff.id, base));
  return [tm, ...native];
}

/** Partner asks for access. Returns { id: 'pending' | 'approved' | 'not_allowed' }. */
async function requestAccess(aff, ids) {
  const out = {};
  for (const id of ids.slice(0, 20)) {
    if (id === 'trendme') { out[id] = 'approved'; continue; }
    const o = await store.offerGet(String(id));
    if (!o || o.status !== 'active' || o.access === 'private') { out[id] = 'not_allowed'; continue; }
    if (o.access === 'open') { out[id] = 'approved'; continue; }
    const a = await store.accessGet(o.id, aff.uid);
    if (a && a.status !== 'pending') { out[id] = a.status === 'approved' ? 'approved' : 'not_allowed'; continue; }
    await store.accessUpsert(o.id, aff.uid, 'pending');
    out[id] = 'pending';
  }
  return out;
}

function bust() {}

module.exports = { forAffiliateList, requestAccess, bust };
