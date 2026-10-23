'use strict';
/**
 * Demo backend (DEMO=1): sample TrendMe partner numbers so the cabinet works without keys.
 * Login: DEMO_EMAIL / DEMO_PASSWORD.
 */
const { ApiError } = require('./errors');

const DEMO_EMAIL = (process.env.DEMO_EMAIL || 'teliks.demo@example.com').toLowerCase();
const DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'Tk-7vQ4mX9rLp2';
const CODE = 'demo2026';

function rng(seedStr) {
  let h = 1779033703 ^ seedStr.length;
  for (let i = 0; i < seedStr.length; i++) { h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = h >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function signIn(email, password) {
  if (email !== DEMO_EMAIL || password !== DEMO_PASSWORD) throw new ApiError('Invalid email or password', 401, 'invalid_credentials');
  return { userId: 'demo-user', email };
}

const partner = () => ({ trendme_code: CODE, name: 'Demo partner', active: true, is_admin: true });

function summary(code, from, to) {
  const DAY = 86400000;
  const daily = [];
  const commissions = [];
  const prices = [1490, 1990, 2490, 2990];
  const todayMs = Date.parse(new Date(Date.now() + 5 * 3600000).toISOString().slice(0, 10) + 'T00:00:00Z');
  for (let t = Date.parse(from + 'T00:00:00Z'); t <= Math.min(Date.parse(to + 'T00:00:00Z'), todayMs); t += DAY) {
    const day = new Date(t).toISOString().slice(0, 10);
    const r = rng(code + day);
    const visits = Math.floor(r() * 60) + 5;
    const users = Math.floor(visits * (0.2 + r() * 0.2));
    const paid = Math.floor(users * (0.1 + r() * 0.25));
    let revenue = 0, earned = 0;
    for (let i = 0; i < paid; i++) {
      const amount = prices[Math.floor(r() * prices.length)];
      const commission = Math.floor(amount * 0.2);
      const reversed = r() < 0.05;
      if (!reversed) { revenue += amount; earned += commission; }
      commissions.push({ time: new Date(t + Math.floor(r() * DAY) - 5 * 3600000).toISOString(), order: `TV-${100000 + Math.floor(r() * 900000)}`, amountKzt: amount, percent: 20, commissionKzt: commission, status: reversed ? 'reversed' : 'earned' });
    }
    daily.unshift({ day, visits, users, paidOrders: paid, revenueKzt: revenue, earnedKzt: earned });
  }
  const earnedKzt = commissions.filter((c) => c.status === 'earned').reduce((s, c) => s + c.commissionKzt, 0);
  return {
    partner: { code, name: 'Demo partner', percent: 20, active: true },
    links: { bot: `https://t.me/Trendmekzbot?start=p_${code}`, app: `https://t.me/Trendmekzbot?startapp=p_${code}`, site: `https://trendme.kz/?ref=${code}` },
    currency: 'KZT',
    period: (() => { const e = commissions.filter((c) => c.status === 'earned'); const sum = (k) => daily.reduce((n, d) => n + d[k], 0); return { visits: sum('visits'), users: sum('users'), buyers: e.length, paidOrders: e.length, revenueKzt: e.reduce((n, c) => n + c.amountKzt, 0), earnedKzt: e.reduce((n, c) => n + c.commissionKzt, 0), reversedKzt: 0, paidOutKzt: 0 }; })(),
    lifetime: { earnedKzt: earnedKzt + 48000, reversedKzt: 0, paidOutKzt: 40000 },
    daily,
    commissions: commissions.sort((a, b) => (a.time < b.time ? 1 : -1)),
  };
}

function overview(from, to) {
  const codes = ['demo2026', 'blogger01', 'target77'];
  const parts = codes.map((code, i) => {
    const s = summary(code, from, to);
    const earned = s.commissions.filter((c) => c.status === 'earned');
    const sum = (k) => s.daily.reduce((n, d) => n + d[k], 0);
    return {
      code, name: ['Demo partner', 'Aruzhan Blog', 'Target Pro'][i], percent: 20, active: true, telegram: null, createdAt: '2026-10-01T00:00:00Z',
      link: s.links.bot,
      period: { visits: sum('visits'), users: sum('users'), buyers: earned.length, paidOrders: earned.length, revenueKzt: earned.reduce((n, c) => n + c.amountKzt, 0), earnedKzt: earned.reduce((n, c) => n + c.commissionKzt, 0), reversedKzt: 0, paidOutKzt: 0 },
      lifetime: { visits: sum('visits'), users: sum('users'), paidOrders: earned.length, revenueKzt: 0, earnedKzt: s.lifetime.earnedKzt, reversedKzt: 0, paidOutKzt: s.lifetime.paidOutKzt, balanceKzt: s.lifetime.earnedKzt - s.lifetime.paidOutKzt },
      _s: s,
    };
  });
  const byDay = new Map();
  for (const p of parts) for (const d of p._s.daily) {
    const x = byDay.get(d.day) || { day: d.day, visits: 0, users: 0, paidOrders: 0, revenueKzt: 0, earnedKzt: 0 };
    x.visits += d.visits; x.users += d.users; x.paidOrders += d.paidOrders; x.revenueKzt += d.revenueKzt; x.earnedKzt += d.earnedKzt;
    byDay.set(d.day, x);
  }
  const commissions = parts.flatMap((p) => p._s.commissions.map((c) => ({ ...c, code: p.code }))).sort((a, b) => (a.time < b.time ? 1 : -1)).slice(0, 1000);
  return { currency: 'KZT', partners: parts.map(({ _s, ...p }) => p), daily: [...byDay.values()].sort((a, b) => (a.day < b.day ? 1 : -1)), commissions };
}

module.exports = { signIn, partner, summary, overview };
