'use strict';
/**
 * Thin client for the Offer18 API (https://knowledgebase.offer18.com).
 *
 * Everything here uses the NETWORK credentials (mid / api-key / secret-key), which live
 * only in the server's environment. Each call that returns affiliate data is scoped to
 * one affiliate id by the caller, so a webmaster only ever sees their own numbers.
 */
const cfg = require('./config');
const { ApiError } = require('./errors');

async function request(method, path, { query = {}, body, network = true } = {}) {
  const url = new URL(cfg.o18.base + path);
  const q = network
    ? { mid: cfg.o18.mid, 'api-key': cfg.o18.apiKey, 'secret-key': cfg.o18.secretKey, ...query }
    : query;
  for (const [k, v] of Object.entries(q)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }

  const opts = { method, headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(25000) };
  if (body) {
    if (cfg.o18.bodyFormat === 'json') {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    } else {
      opts.headers['Content-Type'] = 'application/x-www-form-urlencoded';
      opts.body = new URLSearchParams(Object.entries(body).map(([k, v]) => [k, String(v ?? '')])).toString();
    }
  }

  let res;
  try {
    res = await fetch(url, opts);
  } catch {
    throw new ApiError('Offer18 is unreachable', 504, 'upstream_unreachable');
  }
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError('Offer18 returned an unexpected response', 502, 'upstream_bad_response');
  }
}

const ok = (j) => String(j && (j.status ?? j.response)) === '200';
const describe = (j) => String((j && (j.response || j.message || j.error || j.status)) || 'unknown');

async function affiliateLogin(email, password) {
  const j = await request('POST', '/api/m/affiliate_login', { body: { mail: email, password } });
  if (ok(j) && j.affiliate_id) return { affiliateId: Number(j.affiliate_id) };
  const reason = JSON.stringify(j).toLowerCase();
  console.warn('[offer18] affiliate_login rejected:', describe(j));
  if (/pending|not approved|inactive|blocked|suspend/.test(reason)) {
    throw new ApiError('Account is not active', 403, 'account_inactive');
  }
  throw new ApiError('Invalid email or password', 401, 'invalid_credentials');
}

async function affiliateCreate(data) {
  const j = await request('POST', '/api/m/affiliate', { query: { action: 'create' }, body: data });
  if (ok(j) && j.affiliate_id) return { affiliateId: Number(j.affiliate_id) };
  const reason = JSON.stringify(j).toLowerCase();
  console.warn('[offer18] affiliate create rejected:', describe(j));
  if (/exist|already|duplicate|registered/.test(reason)) throw new ApiError('Email already registered', 409, 'email_exists');
  throw new ApiError('Registration failed', 400, 'registration_failed');
}

/** One page of the network offers list: returns an object keyed by offer id. */
async function listOffers({ page = 1, limit = 100 } = {}) {
  const j = await request('GET', '/api/m/offers', { query: { action: 'list', status: 1, limit, page } });
  if (j && j.data && typeof j.data === 'object') return j.data;
  if (page > 1) return {};
  if (ok(j)) return {};
  throw new ApiError('Could not load offers: ' + describe(j), 502, 'offers_failed');
}

/** One page of report rows for a single affiliate. */
async function getReport(params) {
  const j = await request('GET', '/api/m/report', { query: params });
  if (Array.isArray(j && j.reports)) return { records: j.reports, timezone: j.timezone };
  if (ok(j) || /no (record|data)/i.test(describe(j))) return { records: [], timezone: j && j.timezone };
  throw new ApiError('Could not load statistics: ' + describe(j), 502, 'report_failed');
}

/** Affiliate-level call: needs the webmaster's own API key (Account » API Access). */
async function requestOffers(affiliateId, key, offerIds) {
  const list = offerIds.join(',');
  const j = await request('POST', '/api/af/offer_request', {
    network: false,
    query: { key, aid: affiliateId, mid: cfg.o18.mid, offer_id: list },
    body: { offer_id: list },
  });
  if (j && typeof j === 'object' && !Array.isArray(j)) {
    const out = {};
    for (const id of offerIds) if (typeof j[id] === 'string') out[id] = j[id];
    if (Object.keys(out).length) return out;
  }
  console.warn('[offer18] offer_request rejected:', describe(j));
  throw new ApiError('Offer request failed. Check the API key.', 400, 'request_failed');
}

const real = { affiliateLogin, affiliateCreate, listOffers, getReport, requestOffers };
module.exports = cfg.demo ? require('./mock') : real;
