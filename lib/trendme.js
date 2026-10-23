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
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new ApiError('TrendMe is unavailable', 503, 'upstream_unavailable');
  }
  if (res.status === 404) throw new ApiError('Partner not found', 404, 'partner_not_found');
  if (!res.ok) throw new ApiError('TrendMe API error', 502, 'upstream_error');
  return res.json();
}

function summary(code, from, to) {
  if (cfg.demo) return Promise.resolve(require('./mock').summary(code, from, to));
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
async function recordPayout(code, amountKzt, ref) {
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
        headers: { Authorization: `Bearer ${cfg.trendme.secret}`, Accept: 'application/json' }, signal: AbortSignal.timeout(25000),
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

module.exports = { summary, createPartner, recordPayout, overview };
