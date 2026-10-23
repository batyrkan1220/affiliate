'use strict';
/**
 * Offers a partner sees: TrendMe (native integration, bot links) + the network's own CPA offers
 * (advertisers added in the Teliks admin, tracked by /c/<offer>/<aff> links and postbacks).
 */
const cfg = require('./config');
const trendme = require('./trendme');
const { store } = require('./cpa');

const today = () => new Date(Date.now() + 5 * 3600 * 1000).toISOString().slice(0, 10);

async function trendmeOffer(code) {
  const d = today();
  const s = await trendme.summarySafe(code, d, d);
  const p = s.partner || {};
  const links = s.links || {};
  const extra = [links.app && `Mini App: ${links.app}`, links.site && `Сайт: ${links.site}`].filter(Boolean).join('\n');
  return {
    id: 'trendme',
    name: 'TrendMe — AI тренд-видео',
    logo: '',
    categories: ['AI video', 'Telegram'],
    currency: '%',
    price: Number(p.percent) || 0,
    model: 'RevShare',
    access: 'approved',
    start: '', end: '',
    previewUrl: links.site ? links.site.split('?')[0] : 'https://trendme.kz',
    description:
      `Клиент открывает бот по вашей ссылке, делает видео со своим лицом и оплачивает через Kaspi.\n` +
      `Вы получаете ${Number(p.percent) || 0}% с каждой его оплаты — не только первой. Клиент закрепляется за вами навсегда.\n` +
      (extra ? `\nДругие ссылки:\n${extra}` : ''),
    kpi: 'Только мотивированный трафик. Запрещены спам, мотивация «за деньги», вводящие в заблуждение обещания.',
    geo: { allow: ['KZ'], block: [] },
    os: [], device: [], browser: [],
    payouts: [{ price: Number(p.percent) || 0, model: 'RevShare', currency: '%', conditions: [] }],
    caps: [],
    events: [{ name: 'sale', token: 'sale' }],
    creatives: [],
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
    start: '', end: '',
    previewUrl: o.preview_url || '',
    description: o.description || '',
    kpi: [o.kpi, o.hold_days ? `Холд: ${o.hold_days} дн. — после подтверждения рекламодателем деньги станут доступны через ${o.hold_days} дн.` : ''].filter(Boolean).join('\n\n'),
    geo: { allow: o.geo || [], block: [] },
    os: [], device: [], browser: [],
    payouts: goals.map((g) => ({
      price: Number(g.payout) || 0, model: o.model, currency: g.payout_type === 'percent' ? '%' : 'KZT',
      conditions: [{ field: 'цель', op: 'is_equal', value: g.name || g.code }],
    })),
    caps: o.daily_cap ? [{ type: 'конверсии', period: 'в день', value: o.daily_cap, event: '' }] : [],
    events: goals.map((g) => ({ name: g.name || g.code, token: g.code })),
    creatives: [],
    trackingUrl: access === 'approved' ? `${base}/c/${o.id}/${code}` : '',
    impressionUrl: '',
    native: true,
  };
}

/** aff = session partner { id: code, uid } */
async function forAffiliateList(aff, base = cfg.publicUrl) {
  const [tm, list, access] = await Promise.all([trendmeOffer(aff.id), store.offerList(), store.accessList({ user: aff.uid })]);
  const byOffer = new Map(access.map((a) => [a.offer_id, a]));
  const native = list
    .filter((o) => o.status === 'active' && (o.access !== 'private' || (byOffer.get(o.id) || {}).status === 'approved'))
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
