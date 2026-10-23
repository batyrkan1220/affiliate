'use strict';
/**
 * Payout details and payout requests (Teliks' Supabase: partners, payout_requests; memory in DEMO).
 *
 * Flow: partner sees the available balance → requests a payout (one open request at a time) →
 * the Teliks admin checks the balance and marks it paid (with a payment reference) or rejects it
 * (with a reason) → the partner sees the result. The partner may cancel a request while it is open.
 * Available = TrendMe (earned − paid there) + Teliks offers (approved − paid from Teliks) − open requests.
 */
const cfg = require('./config');
const db = require('./supabase');
const { ApiError } = require('./errors');

const MIN = Math.max(1, Number(process.env.MIN_PAYOUT) || 5000);

const METHODS = {
  kaspi: { re: /^(\+?7\d{10}|\d{16})$/, norm: (v) => v.replace(/[\s()-]/g, '') },
  card: { re: /^\d{16}$/, norm: (v) => v.replace(/[\s-]/g, '') },
  usdt: { re: /^T[1-9A-HJ-NP-Za-km-z]{33}$/, norm: (v) => v.trim() },
  bank: { re: /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/, norm: (v) => v.replace(/\s/g, '').toUpperCase() },
};

// Demo mode keeps everything in memory.
const demo = { details: new Map(), requests: [] };
const now = () => new Date().toISOString();

function validDetails(method, value) {
  const m = METHODS[method];
  if (!m) return null;
  const v = m.norm(String(value || '').trim());
  return m.re.test(v) ? v : null;
}

async function getDetails(uid) {
  if (cfg.demo) return demo.details.get(uid) || null;
  const p = await db.partnerByUser(uid);
  return p && p.payout_method ? { method: p.payout_method, value: p.payout_value, updatedAt: p.payout_updated_at } : null;
}

async function setDetails(uid, method, value) {
  const v = validDetails(method, value);
  if (!v) return null;
  if (cfg.demo) demo.details.set(uid, { method, value: v, updatedAt: now() });
  else await db.setPayoutDetails(uid, method, v);
  return { method, value: v };
}

/* ───── raw rows ───── */
const rowsFor = async (uid) => (cfg.demo ? demo.requests.filter((r) => r.user_id === uid) : db.payoutRequests(uid));
const allRows = async () => (cfg.demo ? [...demo.requests] : db.listRequests(''));
const getRow = async (id) => (cfg.demo ? demo.requests.find((r) => r.id === id) || null : db.getRequest(id));

async function close(id, status, extra = {}, uid = null) {
  if (!cfg.demo) return db.closeRequest(id, status, extra, uid);
  const r = demo.requests.find((x) => x.id === id && x.status === 'processing' && (!uid || x.user_id === uid));
  if (!r) return false;
  Object.assign(r, { status, processed_at: now() }, extra);
  return true;
}

async function setTrendmePart(id, kzt) {
  if (cfg.demo) { const r = demo.requests.find((x) => x.id === id); if (r) r.trendme_kzt = kzt; return; }
  await require('./cpa').store.setRequestTrendme(id, kzt);
}

// Paid requests (for the "paid from Teliks earnings" part of the balance).
async function paidRows(uid) {
  if (cfg.demo) return demo.requests.filter((r) => r.status === 'paid' && (!uid || r.user_id === uid)).map((r) => ({ user_id: r.user_id, amount_kzt: r.amount_kzt, trendme_kzt: r.trendme_kzt }));
  return require('./cpa').store.paidSplit(uid);
}

/* ───── partner side ───── */
const view = (r) => ({
  id: r.id, amount: r.amount_kzt, method: r.method, details: r.details,
  status: r.status === 'processing' ? 'pending' : r.status, createdAt: r.created_at, processedAt: r.processed_at || null,
  note: r.note || '', ref: r.paid_ref || '',
});

async function listFor(uid) {
  return (await rowsFor(uid)).map(view);
}

async function processing(uid) {
  return (await rowsFor(uid)).filter((p) => p.status === 'processing').reduce((s, p) => s + p.amount_kzt, 0);
}

async function request(uid, amount, available) {
  const d = await getDetails(uid);
  if (!d) return { error: 'no_details' };
  const a = Math.floor(Number(amount));
  if (!Number.isFinite(a) || a < MIN) return { error: 'amount_min' };
  if ((await rowsFor(uid)).some((r) => r.status === 'processing')) return { error: 'has_pending' };
  if (a > available) return { error: 'amount_max' };
  if (cfg.demo) demo.requests.unshift({ id: require('crypto').randomUUID(), user_id: uid, amount_kzt: a, method: d.method, details: d.value, status: 'processing', created_at: now() });
  else await db.createPayoutRequest(uid, a, d.method, d.value);
  return { ok: true };
}

async function cancel(uid, id) {
  const ok = await close(id, 'cancelled', { note: 'Отменено партнёром' }, uid);
  if (!ok) throw new ApiError('Request is not open', 409, 'not_open');
}

module.exports = { METHODS, MIN, getDetails, setDetails, listFor, processing, request, cancel, allRows, getRow, close, setTrendmePart, paidRows };
