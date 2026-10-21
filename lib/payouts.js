'use strict';
/**
 * Реквизиты и запросы на выплату.
 * В Offer18 нет API биллинга, поэтому реквизиты и заявки хранятся у нас (data/payouts.json),
 * а админ выплачивает деньги и отмечает заявку командой `npm run payouts`.
 * Доступный баланс = подтверждённый доход (из отчётов Offer18) − выплачено − в обработке.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FILE = process.env.PAYOUTS_FILE || path.join(__dirname, '..', 'data', 'payouts.json');
const MIN = Math.max(1, Number(process.env.MIN_PAYOUT) || 10);

const METHODS = {
  kaspi: { re: /^\d{16}$/, norm: (v) => v.replace(/[\s-]/g, '') },
  card: { re: /^\d{16}$/, norm: (v) => v.replace(/[\s-]/g, '') },
  usdt: { re: /^T[1-9A-HJ-NP-Za-km-z]{33}$/, norm: (v) => v.trim() },
  bank: { re: /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/, norm: (v) => v.replace(/\s/g, '').toUpperCase() },
};

let db = null;
let chain = Promise.resolve();

function load() {
  if (db) return db;
  try {
    db = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch { db = null; }
  if (!db || typeof db !== 'object') db = {};
  if (!db.details || typeof db.details !== 'object') db.details = {};
  if (!Array.isArray(db.payouts)) db.payouts = [];
  return db;
}

function persist() {
  const data = JSON.stringify(db, null, 2);
  chain = chain.then(async () => {
    await fs.promises.mkdir(path.dirname(FILE), { recursive: true });
    const tmp = FILE + '.' + process.pid + '.tmp';
    await fs.promises.writeFile(tmp, data);
    await fs.promises.rename(tmp, FILE);
  }).catch((e) => console.error('[payouts] save failed:', e.message));
  return chain;
}

const same = (a, b) => String(a) === String(b);
const money = (v) => Math.round(v * 100) / 100;

function validDetails(method, value) {
  const m = METHODS[method];
  if (!m) return null;
  const v = m.norm(String(value || '').trim());
  return m.re.test(v) ? v : null;
}

async function setDetails(aid, method, value) {
  const v = validDetails(method, value);
  if (!v) return null;
  load().details[String(aid)] = { method, value: v, updatedAt: new Date().toISOString() };
  await persist();
  return { method, value: v };
}

const getDetails = (aid) => load().details[String(aid)] || null;
const listFor = (aid) => load().payouts.filter((p) => same(p.affiliateId, aid)).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

function sums(aid) {
  const mine = listFor(aid);
  const sum = (st) => money(mine.filter((p) => p.status === st).reduce((s, p) => s + p.amount, 0));
  return { paid: sum('paid'), processing: sum('pending') };
}

async function request(aid, email, amount, available) {
  const d = getDetails(aid);
  if (!d) return { error: 'no_details' };
  const a = money(Number(amount));
  if (!Number.isFinite(a) || a < MIN) return { error: 'amount_min' };
  if (a > available + 0.001) return { error: 'amount_max' };
  const p = {
    id: crypto.randomUUID(), affiliateId: String(aid), email, amount: a,
    method: d.method, details: d.value, status: 'pending', createdAt: new Date().toISOString(),
  };
  load().payouts.push(p);
  await persist();
  return { payout: p };
}

function listAll(status = 'pending') {
  return load().payouts.filter((p) => !status || p.status === status);
}

async function mark(id, status) {
  const p = load().payouts.find((x) => x.id === id || x.id.startsWith(id));
  if (!p || p.status !== 'pending') return null;
  p.status = status;
  p.doneAt = new Date().toISOString();
  await persist();
  return p;
}

module.exports = { METHODS, MIN, setDetails, getDetails, listFor, sums, request, listAll, mark, FILE };
