'use strict';
/**
 * Minimal Supabase client (no SDK): password sign-in for partners and server-side table access
 * with the service role key. The service key never leaves this server.
 */
const cfg = require('./config');
const { ApiError } = require('./errors');

async function call(path, { method = 'GET', body, key = cfg.supabase.serviceKey, prefer } = {}) {
  let res;
  try {
    res = await fetch(cfg.supabase.url + path, {
      method,
      headers: {
        apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json',
        ...(prefer ? { Prefer: prefer } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new ApiError('Database unavailable', 503, 'upstream_unavailable');
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  return { ok: res.ok, status: res.status, data };
}

/** Email + password → Supabase Auth user id (or invalid_credentials). */
async function signIn(email, password) {
  const r = await call('/auth/v1/token?grant_type=password', { method: 'POST', key: cfg.supabase.anonKey, body: { email, password } });
  if (!r.ok || !r.data || !r.data.user) throw new ApiError('Invalid email or password', 401, 'invalid_credentials');
  return { userId: r.data.user.id, email: r.data.user.email };
}

const enc = encodeURIComponent;

async function partnerByUser(userId) {
  const r = await call(`/rest/v1/partners?user_id=eq.${enc(userId)}&select=*`);
  if (!r.ok) throw new ApiError('Database error', 502, 'upstream_error');
  return (r.data && r.data[0]) || null;
}

async function setPayoutDetails(userId, method, value) {
  const r = await call(`/rest/v1/partners?user_id=eq.${enc(userId)}`, {
    method: 'PATCH', prefer: 'return=minimal',
    body: { payout_method: method, payout_value: value, payout_updated_at: new Date().toISOString() },
  });
  if (!r.ok) throw new ApiError('Database error', 502, 'upstream_error');
}

async function payoutRequests(userId) {
  const r = await call(`/rest/v1/payout_requests?user_id=eq.${enc(userId)}&select=id,amount_kzt,method,details,status,created_at&order=created_at.desc&limit=50`);
  if (!r.ok) throw new ApiError('Database error', 502, 'upstream_error');
  return r.data || [];
}

async function createPayoutRequest(userId, amount, method, details) {
  const r = await call('/rest/v1/payout_requests', { method: 'POST', prefer: 'return=minimal', body: { user_id: userId, amount_kzt: amount, method, details } });
  if (!r.ok) throw new ApiError('Database error', 502, 'upstream_error');
}

module.exports = { signIn, partnerByUser, setPayoutDetails, payoutRequests, createPayoutRequest };
