'use strict';
/**
 * Offers: loads the network-wide list once (cached), then reduces every offer to what ONE
 * affiliate is allowed to see. The network list contains advertiser prices, other affiliates,
 * raw advertiser URLs and private notes — none of that may reach a webmaster's browser.
 */
const api = require('./offer18');

const TTL = 5 * 60 * 1000;
let cache = { at: 0, promise: null };

async function fetchAll() {
  const all = {};
  for (let page = 1; page <= 50; page++) {
    const chunk = await api.listOffers({ page, limit: 100 });
    const ids = Object.keys(chunk);
    if (!ids.length) break;
    let fresh = 0;
    for (const id of ids) if (!all[id]) { all[id] = chunk[id]; fresh++; }
    if (!fresh || ids.length < 100) break;
  }
  return all;
}

function raw() {
  if (cache.promise && Date.now() - cache.at < TTL) return cache.promise;
  cache = { at: Date.now(), promise: fetchAll() };
  cache.promise.catch(() => { cache = { at: 0, promise: null }; });
  return cache.promise;
}

function bust() { cache = { at: 0, promise: null }; }

const list = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);
const sameId = (a, b) => Number(a) === Number(b) && String(a).trim() !== '';

function findMine(affiliates, aid) {
  if (!affiliates || typeof affiliates !== 'object') return null;
  for (const [k, v] of Object.entries(affiliates)) if (sameId(k, aid)) return v || {};
  return null;
}

function accessOf(o, mine) {
  if (mine) {
    const s = String(mine.status || '').toLowerCase();
    if (s.includes('approv')) return 'approved';
    if (s.includes('pend')) return 'pending';
    if (s.includes('reject') || s.includes('block')) return 'rejected';
    return mine.tracking_url ? 'approved' : 'pending';
  }
  return String(o.visibility || '').toLowerCase() === 'public' ? 'open' : 'hidden';
}

/** Does a payout rule apply to this affiliate? Conditions are OR-groups of AND-conditions. */
function ruleConditions(rule, aid) {
  const groups = Array.isArray(rule.condition) ? rule.condition : [];
  if (!groups.length) return { applies: true, text: [] };
  for (const g of groups) {
    const conds = Array.isArray(g) ? g : [g];
    const affConds = conds.filter((c) => c && c.field === 'affiliate_id');
    const affOk = affConds.every((c) => {
      const ids = list(c.value);
      const hit = ids.some((x) => sameId(x, aid));
      return c.operator_type === 'not_equal' ? !hit : hit;
    });
    if (affOk) {
      const text = conds
        .filter((c) => c && c.field !== 'affiliate_id')
        .map((c) => ({ field: c.field, op: c.operator_type, value: c.value }));
      return { applies: true, text };
    }
  }
  return { applies: false, text: [] };
}

function forAffiliate(o, aid) {
  const mine = findMine(o.affiliates, aid);
  const access = accessOf(o, mine);
  if (access === 'hidden') return null;

  const payouts = [];
  for (const r of Array.isArray(o.payout) ? o.payout : []) {
    const c = ruleConditions(r, aid);
    if (c.applies) {
      payouts.push({
        price: Number(r.affiliate_price) || 0,
        model: r.affiliate_model || o.model_affiliate || '',
        currency: r.currency || o.currency || '',
        conditions: c.text,
      });
    }
  }

  const caps = [];
  for (const c of Array.isArray(o.capping) ? o.capping : []) {
    if (String(c.affiliate_visibility || 'show') !== 'show') continue;
    if (c.rule_type === 'affiliate_capping' && c.affiliates && !list(c.affiliates).some((x) => sameId(x, aid))) continue;
    caps.push({ type: c.type, period: c.period, value: c.value, event: c.event || '' });
  }

  const approved = access === 'approved';
  return {
    id: String(o.offerid),
    name: o.offer_name || o.name || '',
    logo: /^https:\/\//i.test(o.logo || '') ? o.logo : '',
    categories: list(o.category),
    currency: o.currency || '',
    price: Number(o.price_affiliate) || 0,
    model: o.model_affiliate || '',
    access,
    start: o.start_datetime || '',
    end: o.end_datetime || '',
    previewUrl: /^https?:\/\//i.test(o.preview_url || '') ? o.preview_url : '',
    description: o.offer_description || '',
    kpi: o.offer_kpi || '',
    geo: { allow: list(o.country_allow), block: list(o.country_block) },
    os: list(o.os_allow), device: list(o.device_allow), browser: list(o.browser_allow),
    payouts,
    caps,
    events: (Array.isArray(o.events) ? o.events : []).map((e) => ({ name: e.event_name, token: e.event_token })),
    creatives: (Array.isArray(o.creatives) ? o.creatives : [])
      .filter((c) => /^https:\/\//i.test(c.url || ''))
      .map((c) => ({ type: c.type, url: c.url })),
    trackingUrl: approved && mine ? mine.tracking_url || '' : '',
    impressionUrl: approved && mine ? mine.impression_url || '' : '',
  };
}

async function forAffiliateList(aid) {
  const all = await raw();
  return Object.values(all).map((o) => forAffiliate(o, aid)).filter(Boolean);
}

module.exports = { forAffiliateList, bust };
