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
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  return { ok: res.ok, status: res.status, data, range: res.headers.get('content-range') || '' };
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
  const r = await call(`/rest/v1/payout_requests?user_id=eq.${enc(userId)}&select=id,amount_kzt,method,details,status,created_at,trendme_kzt&order=created_at.desc&limit=50`);
  if (!r.ok) throw new ApiError('Database error', 502, 'upstream_error');
  return r.data || [];
}

async function createPayoutRequest(userId, amount, method, details) {
  const r = await call('/rest/v1/payout_requests', { method: 'POST', prefer: 'return=minimal', body: { user_id: userId, amount_kzt: amount, method, details } });
  if (!r.ok) throw new ApiError('Database error', 502, 'upstream_error');
}

/** Admin API (service role): create a confirmed login. */
async function createUser(email, password, name) {
  const r = await call('/auth/v1/admin/users', { method: 'POST', body: { email, password, email_confirm: true, user_metadata: { name } } });
  if (!r.ok || !r.data || !r.data.id) {
    const msg = JSON.stringify(r.data || {});
    if (r.status === 422 || /already|registered|exists/i.test(msg)) throw new ApiError('Email already registered', 409, 'email_exists');
    throw new ApiError('Registration failed', 502, 'registration_failed');
  }
  return r.data.id;
}

async function deleteUser(id) {
  await call(`/auth/v1/admin/users/${enc(id)}`, { method: 'DELETE' }).catch(() => {});
}

async function insertPartner(row) {
  const r = await call('/rest/v1/partners', { method: 'POST', prefer: 'return=minimal', body: row });
  if (!r.ok) throw new ApiError('Registration failed', 502, 'registration_failed');
}

/* ── Teliks admin ── */
async function listPartners() {
  const r = await call('/rest/v1/partners?select=user_id,trendme_code,name,email,active,is_admin,payout_method,payout_value,created_at&order=created_at.desc&limit=500');
  if (!r.ok) throw new ApiError('Database error', 502, 'upstream_error');
  return r.data || [];
}

async function setPartnerActive(userId, active) {
  const r = await call(`/rest/v1/partners?user_id=eq.${enc(userId)}&is_admin=eq.false`, { method: 'PATCH', prefer: 'return=minimal', body: { active: !!active } });
  if (!r.ok) throw new ApiError('Database error', 502, 'upstream_error');
}

async function listRequests(status) {
  const q = status ? `&status=eq.${enc(status)}` : '';
  const r = await call(`/rest/v1/payout_requests?select=id,user_id,amount_kzt,method,details,status,created_at,processed_at,trendme_kzt${q}&order=created_at.desc&limit=200`);
  if (!r.ok) throw new ApiError('Database error', 502, 'upstream_error');
  return r.data || [];
}

async function getRequest(id) {
  const r = await call(`/rest/v1/payout_requests?id=eq.${enc(id)}&select=*`);
  if (!r.ok) throw new ApiError('Database error', 502, 'upstream_error');
  return (r.data && r.data[0]) || null;
}

/** Closes a request only if it is still open (no double processing). Returns true when changed. */
async function closeRequest(id, status) {
  const r = await call(`/rest/v1/payout_requests?id=eq.${enc(id)}&status=eq.processing`, {
    method: 'PATCH', prefer: 'return=representation', body: { status, processed_at: new Date().toISOString() },
  });
  if (!r.ok) throw new ApiError('Database error', 502, 'upstream_error');
  return Array.isArray(r.data) && r.data.length > 0;
}

module.exports = {
  call, signIn, partnerByUser, setPayoutDetails, payoutRequests, createPayoutRequest, createUser, deleteUser, insertPartner,
  listPartners, setPartnerActive, listRequests, getRequest, closeRequest,
};
