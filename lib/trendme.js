'use strict';
/**
 * TrendMe partner API (server-to-server, shared secret). One call returns everything for a
 * partner and period: totals, per-day numbers, commissions, lifetime earnings and links.
 */
const cfg = require('./config');
const { ApiError } = require('./errors');

const cache = new Map();
const TTL = 60 * 1000;

async function fetchSummary(code, from, to) {
  let res;
  try {
    res = await fetch(`${cfg.trendme.url}/api/partner-api/summary?code=${encodeURIComponent(code)}&from=${from}&to=${to}`, {
      headers: { Authorization: `Bearer ${cfg.trendme.secret}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(45000), // a sleeping Render instance needs up to ~50 s to wake
    });
  } catch {
    throw new ApiError('TrendMe is unavailable', 503, 'upstream_unavailable');
  }
  if (res.status === 404) throw new ApiError('Partner not found', 404, 'partner_not_found');
  if (!res.ok) throw new ApiError('TrendMe API error', 502, 'upstream_error');
  return res.json();
}

function summary(code, from, to) {
  if (cfg.demo) {
    const x = require('./mock').summary(code, from, to);
    x.lifetime = { ...x.lifetime, paidOutKzt: x.lifetime.paidOutKzt + (demoPaid.get(code) || 0) };
    return Promise.resolve(x);
  }
  const key = `${code}|${from}|${to}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.promise;
  const promise = fetchSummary(code, from, to);
  cache.set(key, { at: Date.now(), promise });
  promise.catch(() => cache.delete(key));
  if (cache.size > 100) cache.delete(cache.keys().next().value);
  return promise;
}

/** Self-registration: TrendMe creates the partner (default %) and returns its code. */
async function createPartner(body) {
  let res;
  try {
    res = await fetch(`${cfg.trendme.url}/api/partner-api/partners`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.trendme.secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new ApiError('TrendMe is unavailable', 503, 'upstream_unavailable');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || !data.code) throw new ApiError('Registration failed', 502, 'registration_failed');
  return data; // { code, active }
}

/** A payout made from Teliks is recorded in TrendMe so the partner's balance there matches. */
const demoPaid = new Map();
async function recordPayout(code, amountKzt, ref) {
  if (cfg.demo) { demoPaid.set(code, (demoPaid.get(code) || 0) + amountKzt); return; }
  let res;
  try {
    res = await fetch(`${cfg.trendme.url}/api/partner-api/payouts`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.trendme.secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, amountKzt, ref, note: 'Teliks' }),
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new ApiError('TrendMe is unavailable', 503, 'upstream_unavailable');
  }
  if (!res.ok) throw new ApiError('TrendMe API error', 502, 'upstream_error');
  cache.clear();
}

/** Network-wide numbers for the Teliks admin. */
function overview(from, to) {
  if (cfg.demo) return Promise.resolve(require('./mock').overview(from, to));
  const key = `overview|${from}|${to}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.promise;
  const promise = (async () => {
    let res;
    try {
      res = await fetch(`${cfg.trendme.url}/api/partner-api/overview?from=${from}&to=${to}`, {
        headers: { Authorization: `Bearer ${cfg.trendme.secret}`, Accept: 'application/json' }, signal: AbortSignal.timeout(45000),
      });
    } catch {
      throw new ApiError('TrendMe is unavailable', 503, 'upstream_unavailable');
    }
    if (!res.ok) throw new ApiError('TrendMe API error', 502, 'upstream_error');
    return res.json();
  })();
  cache.set(key, { at: Date.now(), promise });
  promise.catch(() => cache.delete(key));
  return promise;
}

const down = (e) => e && (e.code === 'upstream_unavailable' || e.code === 'upstream_error');
const ZERO = { visits: 0, users: 0, buyers: 0, paidOrders: 0, revenueKzt: 0, earnedKzt: 0, reversedKzt: 0, paidOutKzt: 0 };

/** Like summary(), but while TrendMe is asleep/unreachable returns empty TrendMe numbers
 *  (flag `unavailable`) so the cabinet still works on Teliks' own data. */
function summarySafe(code, from, to) {
  return summary(code, from, to).catch((e) => {
    if (!down(e)) throw e;
    return { unavailable: true, partner: { code, name: '', percent: null, active: true }, links: {}, currency: 'KZT', period: { ...ZERO }, lifetime: { earnedKzt: 0, reversedKzt: 0, paidOutKzt: 0 }, daily: [], commissions: [] };
  });
}

function overviewSafe(from, to) {
  return overview(from, to).catch((e) => {
    if (!down(e)) throw e;
    return { unavailable: true, currency: 'KZT', partners: [], daily: [], commissions: [] };
  });
}

/** Fire-and-forget request that starts waking a sleeping TrendMe instance. */
let lastWake = 0;
function wake() {
  if (cfg.demo || Date.now() - lastWake < 60000) return;
  lastWake = Date.now();
  fetch(`${cfg.trendme.url}/api/partner-api/summary`, { headers: { Authorization: `Bearer ${cfg.trendme.secret}` }, signal: AbortSignal.timeout(60000) }).catch(() => {});
}

module.exports = { summary, summarySafe, createPartner, recordPayout, overview, overviewSafe, wake, ZERO };
