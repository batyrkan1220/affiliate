'use strict';
const cfg = require('./config');
const trendme = require('./trendme');

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

/* ───────── rows from the TrendMe partner API ─────────
 * Per-day link opens become click rows; every commission becomes one conversion row
 * (price = the partner's commission in ₸, status earned → approved, reversed → rejected).
 * The aggregation below is unchanged.
 */
const OFFER_ID = 'trendme';
const OFFER_NAME = 'TrendMe';
const blank = { impressions: 0, clicks: 0, unique: 0, conversions: 0, price: 0, model: 'RevShare', currency: 'KZT', country: 'KZ', device: '', os: '', browser: '', source: '', subAffiliate: '', clickId: '', sub1: '', sub2: '', sub3: '', sub4: '', sub5: '', status: '', event: '', offerId: OFFER_ID, offerName: OFFER_NAME };

const almatyDate = (iso) => new Date(Date.parse(iso) + 5 * 3600 * 1000).toISOString().slice(0, 10);
const almatyTime = (iso) => new Date(Date.parse(iso) + 5 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ');

async function getRows(code, from, to) {
  const s = await trendme.summary(code, from, to);
  const rows = [];
  for (const d of s.daily || []) {
    if (d.visits) rows.push({ ...blank, date: d.day, time: `${d.day} 00:00:00`, clicks: d.visits, unique: d.visits });
  }
  for (const c of s.commissions || []) {
    rows.push({
      ...blank, date: almatyDate(c.time), time: almatyTime(c.time), event: 'sale', conversions: 1,
      price: c.commissionKzt, status: c.status === 'reversed' ? 'rejected' : 'approved', clickId: c.order,
      sub1: String(c.amountKzt), sub2: `${c.percent}%`,
    });
  }
  return { rows, truncated: false, summary: s };
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

function currencyOf() {
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
