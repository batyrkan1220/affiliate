'use strict';
/**
 * Payout details and payout requests, stored in Teliks' Supabase (tables partners, payout_requests).
 * The TrendMe admin pays and marks requests in the TrendMe admin panel; a paid request is recorded
 * there as a payout, so "paid" comes from TrendMe and "processing" from open requests here.
 * Available = earned (TrendMe) − paid (TrendMe) − processing requests.
 */
const cfg = require('./config');
const db = require('./supabase');

const MIN = Math.max(1, Number(process.env.MIN_PAYOUT) || 5000);

const METHODS = {
  kaspi: { re: /^(\+?7\d{10}|\d{16})$/, norm: (v) => v.replace(/[\s()-]/g, '') },
  card: { re: /^\d{16}$/, norm: (v) => v.replace(/[\s-]/g, '') },
  usdt: { re: /^T[1-9A-HJ-NP-Za-km-z]{33}$/, norm: (v) => v.trim() },
  bank: { re: /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/, norm: (v) => v.replace(/\s/g, '').toUpperCase() },
};

// Demo mode keeps everything in memory.
const demo = { details: new Map(), requests: [] };

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
  if (cfg.demo) demo.details.set(uid, { method, value: v, updatedAt: new Date().toISOString() });
  else await db.setPayoutDetails(uid, method, v);
  return { method, value: v };
}

async function listFor(uid) {
  const rows = cfg.demo ? demo.requests.filter((r) => r.user_id === uid) : await db.payoutRequests(uid);
  return rows.map((r) => ({
    id: r.id, amount: r.amount_kzt, method: r.method, details: r.details,
    status: r.status === 'processing' ? 'pending' : r.status, createdAt: r.created_at,
  }));
}

async function processing(uid) {
  return (await listFor(uid)).filter((p) => p.status === 'pending').reduce((s, p) => s + p.amount, 0);
}

async function request(uid, amount, available) {
  const d = await getDetails(uid);
  if (!d) return { error: 'no_details' };
  const a = Math.floor(Number(amount));
  if (!Number.isFinite(a) || a < MIN) return { error: 'amount_min' };
  if (a > available) return { error: 'amount_max' };
  if (cfg.demo) demo.requests.unshift({ id: String(Date.now()), user_id: uid, amount_kzt: a, method: d.method, details: d.value, status: 'processing', created_at: new Date().toISOString() });
  else await db.createPayoutRequest(uid, a, d.method, d.value);
  return { ok: true };
}

module.exports = { METHODS, MIN, getDetails, setDetails, listFor, processing, request };
