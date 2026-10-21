'use strict';
const cfg = require('./config');
const api = require('./offer18');

const FIELDS = [
  'date', 'time', 'offer', 'offer_name', 'event', 'impressions', 'clicks', 'unique_clicks', 'conversion',
  'affiliate_model', 'affiliate_price', 'currency', 'country', 'device', 'os', 'browser', 's_affiliate', 'source',
  'aff_click_id', 'aff_sub1', 'aff_sub2', 'aff_sub3', 'aff_sub4', 'aff_sub5', 'status',
].join(',');

/* ───────── dates ───────── */
const DAY = 86400000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const toMs = (s) => Date.parse(s + 'T00:00:00Z');
const toStr = (ms) => new Date(ms).toISOString().slice(0, 10);

function validRange(from, to) {
  if (!DATE_RE.test(from || '') || !DATE_RE.test(to || '')) return null;
  const a = toMs(from), b = toMs(to);
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return null;
  if ((b - a) / DAY > 92) return null; // keeps upstream load sane
  return { from, to, days: (b - a) / DAY + 1 };
}

function previousRange({ from, days }) {
  const prevTo = toMs(from) - DAY;
  return { from: toStr(prevTo - (days - 1) * DAY), to: toStr(prevTo) };
}

/* ───────── row normalisation ───────── */
function normalize(raw) {
  const m = {};
  for (const [k, v] of Object.entries(raw)) m[k.toLowerCase().replace(/_/g, '')] = v;
  const get = (...keys) => {
    for (const k of keys) if (m[k] !== undefined && m[k] !== null && m[k] !== '') return m[k];
    return '';
  };
  const n = (v) => (Number.isFinite(+v) ? +v : 0);
  const conversions = n(get('conversions', 'conversion'));
  let status = String(get('status')).toLowerCase();
  if (conversions > 0) {
    if (!status) status = 'approved';
    else if (/reject|declin|fail|cancel/.test(status)) status = 'rejected';
    else if (/approv/.test(status)) status = 'approved';
    else status = 'pending';
  } else status = '';
  const time = String(get('time'));
  return {
    date: String(get('date')) || time.slice(0, 10),
    time,
    offerId: String(get('offerid', 'offer')),
    offerName: String(get('offername')),
    event: String(get('event')),
    impressions: n(get('impressions')),
    clicks: n(get('clicks')),
    unique: n(get('uniqueclicks')),
    conversions,
    price: n(get('affiliateprice')),
    model: String(get('affiliatemodel')),
    currency: String(get('currency')),
    country: String(get('country')),
    device: String(get('device')),
    os: String(get('os')),
    browser: String(get('browser')),
    source: String(get('source')),
    subAffiliate: String(get('subaffiliate')),
    clickId: String(get('affclickid')),
    sub1: String(get('affsub1')), sub2: String(get('affsub2')), sub3: String(get('affsub3')),
    sub4: String(get('affsub4')), sub5: String(get('affsub5')),
    status,
  };
}

/* ───────── fetching (paged + short cache) ───────── */
const cache = new Map(); // key -> { at, promise }
const TTL = 60 * 1000;

async function loadRows(aid, from, to) {
  const size = cfg.reportPageSize;
  const rows = [];
  let truncated = false;
  let firstOfPrev = null;
  for (let page = 0; page < 1000; page++) {
    const { records } = await api.getReport({
      affiliate: aid, date_from: from, date_end: to, timezone: cfg.reportTz,
      results: size, page, fields: FIELDS, sort_by: 'date', sort_type: 'asc',
    });
    if (!records.length) break;
    const sig = JSON.stringify(records[0]);
    if (page > 0 && sig === firstOfPrev) break; // upstream ignored paging; avoid looping on the same page
    firstOfPrev = sig;
    for (const r of records) rows.push(normalize(r));
    if (records.length < size) break;
    if (rows.length >= cfg.reportMaxRows) { truncated = true; break; }
  }
  return { rows, truncated };
}

function getRows(aid, from, to) {
  const key = `${aid}|${from}|${to}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.promise;
  const promise = loadRows(aid, from, to);
  cache.set(key, { at: Date.now(), promise });
  promise.catch(() => cache.delete(key));
  if (cache.size > 60) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) cache.delete(oldest[0]);
  }
  return promise;
}

/* ───────── aggregation ───────── */
const money = (v) => Math.round(v * 100) / 100;

function emptyAcc() {
  return { impressions: 0, clicks: 0, unique: 0, conversions: 0, approved: 0, pending: 0, rejected: 0, approvedEarnings: 0, pendingEarnings: 0, rejectedEarnings: 0 };
}

function add(acc, r) {
  acc.impressions += r.impressions;
  acc.clicks += r.clicks;
  acc.unique += r.unique;
  if (r.conversions > 0) {
    acc.conversions += r.conversions;
    if (r.status === 'approved') { acc.approved += r.conversions; acc.approvedEarnings += r.price; }
    else if (r.status === 'pending') { acc.pending += r.conversions; acc.pendingEarnings += r.price; }
    else { acc.rejected += r.conversions; acc.rejectedEarnings += r.price; }
  }
}

function finish(acc) {
  const earnings = acc.approvedEarnings + acc.pendingEarnings;
  return {
    impressions: acc.impressions,
    clicks: acc.clicks,
    unique: acc.unique,
    conversions: acc.conversions,
    approved: acc.approved,
    pending: acc.pending,
    rejected: acc.rejected,
    approvedEarnings: money(acc.approvedEarnings),
    pendingEarnings: money(acc.pendingEarnings),
    rejectedEarnings: money(acc.rejectedEarnings),
    earnings: money(earnings),
    cr: acc.clicks ? acc.conversions / acc.clicks : 0,
    epc: acc.clicks ? earnings / acc.clicks : 0,
    ctr: acc.impressions ? acc.clicks / acc.impressions : 0,
  };
}

const GROUPS = {
  date: (r) => r.date,
  hour: (r) => (r.time ? r.time.slice(11, 13) + ':00' : ''),
  offer: (r) => r.offerId,
  country: (r) => r.country,
  device: (r) => r.device,
  os: (r) => r.os,
  browser: (r) => r.browser,
  event: (r) => r.event,
  source: (r) => r.source,
  sub1: (r) => r.sub1, sub2: (r) => r.sub2, sub3: (r) => r.sub3, sub4: (r) => r.sub4, sub5: (r) => r.sub5,
};

function total(rows) {
  const acc = emptyAcc();
  for (const r of rows) add(acc, r);
  return finish(acc);
}

function group(rows, by) {
  const keyFn = GROUPS[by] || GROUPS.date;
  const map = new Map();
  for (const r of rows) {
    const key = keyFn(r) || '—';
    let g = map.get(key);
    if (!g) { g = { key, label: '', acc: emptyAcc() }; map.set(key, g); }
    if (by === 'offer' && r.offerName) g.label = r.offerName;
    add(g.acc, r);
  }
  const out = [...map.values()].map((g) => ({ key: g.key, label: g.label, ...finish(g.acc) }));
  return out.sort((a, b) => (by === 'date' || by === 'hour' ? (a.key < b.key ? -1 : 1) : b.earnings - a.earnings || b.clicks - a.clicks));
}

function dailySeries(rows, from, to) {
  const byDate = new Map(group(rows, 'date').map((d) => [d.key, d]));
  const out = [];
  for (let t = toMs(from); t <= toMs(to); t += DAY) {
    const k = toStr(t);
    const d = byDate.get(k);
    out.push({ date: k, clicks: d ? d.clicks : 0, conversions: d ? d.conversions : 0, earnings: d ? d.earnings : 0 });
  }
  return out;
}

function currencyOf(rows) {
  for (const r of rows) if (r.currency) return r.currency;
  return cfg.defaultCurrency;
}

function conversionLog(rows, { status, offer }) {
  return rows
    .filter((r) => r.conversions > 0 && (!status || r.status === status) && (!offer || r.offerId === offer))
    .sort((a, b) => (a.time < b.time ? 1 : -1));
}

module.exports = {
  validRange, previousRange, getRows, total, group, dailySeries, currencyOf, conversionLog, GROUPS,
};
