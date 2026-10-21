'use strict';
/**
 * Demo backend: returns data in the exact shapes documented for the Offer18 network API,
 * so the whole cabinet can be tried without credentials. Enabled with DEMO=1.
 * Login: demo@example.com / demo1234  (any newly registered account works too, but has no offers yet).
 */
const { ApiError } = require('./errors');

const DEMO_AID = 1001;
const users = new Map([['demo@example.com', { id: DEMO_AID, password: 'demo1234' }]]);
let nextId = 2001;

function rng(seedStr) {
  let h = 1779033703 ^ seedStr.length;
  for (let i = 0; i < seedStr.length; i++) {
    h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SAMPLE = [
  ['Zerno Bank — Card order', 'finance', 'CPA', 12.0, 'KZ,UZ', 'registration', 'public', 'approved'],
  ['Qazaq Delivery — App install', 'mobile apps', 'CPI', 1.1, 'KZ', 'install', 'public', 'approved'],
  ['Nomad VPN — Paid subscription', 'subscription offers', 'CPA', 7.5, 'KZ,RU,UA', 'purchase', 'public', 'approved'],
  ['Steppe Games — Android install', 'gaming, mobile apps', 'CPI', 0.8, 'KZ,RU,TR', 'install', 'public', 'approved'],
  ['Altyn Shop — Sale 8%', 'ecommerce', 'CPS', 8.0, 'KZ', 'purchase', 'public', 'approved'],
  ['LinguaPro — Free trial', 'education', 'CPL', 3.2, 'KZ,RU,UZ,KG', 'trial', 'public', 'approved'],
  ['Aqsha Loans — Lead', 'finance', 'CPL', 5.5, 'KZ', 'lead', 'public', 'approved'],
  ['Tulpar Taxi — First ride', 'mobile apps', 'CPA', 2.4, 'KZ', 'first_ride', 'public', 'pending'],
  ['Baiterek Travel — Booking', 'travel', 'CPS', 4.0, 'KZ,RU', 'booking', 'public', 'none'],
  ['Mira Fitness — Trial', 'health & fitness', 'CPA', 4.8, 'KZ,RU', 'trial', 'public', 'none'],
  ['Sky Academy — Course lead', 'education', 'CPL', 6.0, 'KZ,RU,UZ', 'lead', 'public', 'none'],
  ['Private Partners — Premium lead', 'finance', 'CPL', 18.0, 'KZ', 'lead', 'private', 'none'],
];

function buildOffers() {
  const data = {};
  SAMPLE.forEach((s, i) => {
    const [name, category, model, price, geo, event, visibility, access] = s;
    const id = String(10001 + i);
    const affiliates = {
      '00042': { name: 'Another Affiliate', status: 'approved', tracking_url: `https://demo.o18.click/c?o=${id}&m=1&a=42`, impression_url: '' },
      '00077': { name: 'Third Affiliate', status: 'approved', tracking_url: `https://demo.o18.click/c?o=${id}&m=1&a=77`, impression_url: '' },
    };
    if (access === 'approved' || access === 'pending') {
      affiliates[String(DEMO_AID).padStart(5, '0')] = {
        name: 'Demo Webmaster',
        status: access,
        tracking_url: `https://demo.o18.click/c?o=${id}&m=1&a=${DEMO_AID}`,
        impression_url: `https://demo.o18.click/i?o=${id}&m=1&a=${DEMO_AID}`,
      };
    }
    data[id] = {
      offerid: id,
      offer_name: name,
      logo: '',
      status: 'Approved',
      category,
      currency: 'USD',
      price_affiliate: String(price),
      model_affiliate: model,
      price_advertiser: String((price * 1.6).toFixed(2)),
      model_advertiser: model,
      advertiser_id: '11',
      external_offer_id: 'ext-' + id,
      app_id: '',
      visibility,
      deep_links: 'disabled',
      private_note: 'internal margin note — must never reach the browser',
      start_datetime: '2026-01-10 09:00:00',
      end_datetime: '2027-01-10 09:00:00',
      preview_url: 'https://example.com/preview/' + id,
      offer_description:
        'Traffic is accepted from social networks, messengers and content sites.\nNo incentivized or adult traffic. Brand bidding is not allowed.',
      offer_kpi: model === 'CPS' ? 'Average order value from 15 USD' : 'Approval rate from 40%',
      country_allow: geo,
      os_allow: model === 'CPI' ? 'android,ios' : '',
      device_allow: model === 'CPI' ? 'smartphone' : '',
      browser_allow: '',
      capping: [
        { affiliate_visibility: 'show', rule_type: 'shared_capping', event: '', type: 'approved_conversions', period: 'daily', value: 500, over_capping_action: 'conversion_pending', timezone: '', rule_id: '1' },
        { affiliate_visibility: 'show', rule_type: 'affiliate_capping', affiliates: '42', event: '', type: 'approved_conversions', period: 'daily', value: 50, rule_id: '2' },
        { affiliate_visibility: 'hide', rule_type: 'affiliate_capping', affiliates: String(DEMO_AID), event: '', type: 'gross_conversions', period: 'monthly', value: 9999, rule_id: '3' },
      ],
      events: [{ event_name: event, event_token: event }],
      payout: [
        { affiliate_price: String(price), advertiser_price: String(price * 1.6), currency: 'USD', affiliate_model: model, advertiser_model: model, condition: [[{ field: 'event', operator_type: 'is_equal', value: event }]], rule_id: '11' },
        { affiliate_price: String(price + 3), advertiser_price: '99', currency: 'USD', affiliate_model: model, advertiser_model: model, condition: [[{ field: 'affiliate_id', operator_type: 'is_equal', value: '00042' }]], rule_id: '12' },
        { affiliate_price: String(price + 1.5), advertiser_price: '99', currency: 'USD', affiliate_model: model, advertiser_model: model, condition: [[{ field: 'affiliate_id', operator_type: 'is_equal', value: String(DEMO_AID) }, { field: 'country', operator_type: 'is_equal', value: geo.split(',')[0] }]], rule_id: '13' },
      ],
      affiliates,
      impression_url: 'https://advertiser.example/imp',
      offer_url: 'https://advertiser.example/landing?secret=1',
      postback_type: 'S2S',
      fallback_url: 'https://advertiser.example/fallback',
      creatives: [],
    };
  });
  return data;
}

const OFFERS = buildOffers();

async function affiliateLogin(email, password) {
  const u = users.get(String(email).toLowerCase());
  if (!u || u.password !== password) throw new ApiError('Invalid email or password', 401, 'invalid_credentials');
  return { affiliateId: u.id };
}

async function affiliateCreate(data) {
  const email = String(data.email).toLowerCase();
  if (users.has(email)) throw new ApiError('Email already registered', 409, 'email_exists');
  const id = nextId++;
  users.set(email, { id, password: data.password });
  return { affiliateId: id };
}

async function listOffers({ page = 1, limit = 100 } = {}) {
  const ids = Object.keys(OFFERS);
  const slice = ids.slice((page - 1) * limit, page * limit);
  return Object.fromEntries(slice.map((id) => [id, OFFERS[id]]));
}

const DAY = 86400000;
const iso = (d) => d.toISOString().slice(0, 10);

function demoRows(from, to) {
  const rows = [];
  const mine = Object.values(OFFERS).filter((o) => o.affiliates['0' + DEMO_AID] && o.affiliates['0' + DEMO_AID].status === 'approved');
  const today = Date.now();
  for (let t = Date.parse(from + 'T00:00:00Z'); t <= Date.parse(to + 'T00:00:00Z'); t += DAY) {
    const date = iso(new Date(t));
    const ageDays = (today - t) / DAY;
    if (ageDays < -1) continue;
    mine.forEach((o, oi) => {
      const r = rng(date + o.offerid);
      const countries = o.country_allow.split(',').slice(0, 2);
      const weekend = [0, 6].includes(new Date(t).getUTCDay()) ? 0.8 : 1;
      const base = (60 + oi * 22) * (0.7 + r() * 0.7) * weekend * (1 + (60 - Math.min(ageDays, 60)) / 120);
      let clicksTotal = 0;
      countries.forEach((country, ci) => {
        ['desktop', 'smartphone'].forEach((device, di) => {
          const share = (ci === 0 ? 0.7 : 0.3) * (di === 0 ? 0.35 : 0.65);
          const clicks = Math.max(1, Math.round(base * share));
          clicksTotal += clicks;
          rows.push({
            Date: date, Time: `${date} 1${di}:${10 + ci * 7}:00`, OfferID: o.offerid, OfferName: o.offer_name,
            Sub_Affiliate: '', Event: '', Impressions: clicks * 4, Clicks: clicks, UniqueClicks: Math.round(clicks * 0.82),
            Conversions: 0, Affiliate_Model: o.model_affiliate, Affiliate_Price: 0, Currency: 'USD',
            Country: country, Device: device, OS: device === 'desktop' ? 'windows' : r() > 0.4 ? 'android' : 'ios',
            Browser: device === 'desktop' ? 'ch' : 'sa', Aff_Sub_1: ['telegram', 'instagram', 'youtube'][(oi + di + ci) % 3],
            Aff_Sub_2: '', Aff_Sub_3: '', Aff_Sub_4: '', Aff_Sub_5: '', Aff_Click_ID: '', Source: '', Status: '',
          });
        });
      });
      const crBase = { CPA: 0.045, CPI: 0.09, CPL: 0.06, CPS: 0.025 }[o.model_affiliate] || 0.04;
      const convs = Math.round(clicksTotal * crBase * (0.6 + r() * 0.8));
      const event = o.events[0].event_token;
      for (let c = 0; c < convs; c++) {
        const roll = r();
        let status = roll < 0.7 ? 'Approved' : roll < 0.92 ? 'Pending' : 'Rejected';
        if (status === 'Pending' && ageDays > 9) status = 'Approved';
        const hour = String(Math.floor(r() * 24)).padStart(2, '0');
        const price = o.model_affiliate === 'CPS' ? +(8 + r() * 20).toFixed(2) : +o.price_affiliate;
        rows.push({
          Date: date, Time: `${date} ${hour}:${String(Math.floor(r() * 60)).padStart(2, '0')}:${String(Math.floor(r() * 60)).padStart(2, '0')}`,
          OfferID: o.offerid, OfferName: o.offer_name, Sub_Affiliate: '', Event: event, Impressions: 0, Clicks: 0, UniqueClicks: 0,
          Conversions: 1, Affiliate_Model: o.model_affiliate, Affiliate_Price: status === 'Rejected' ? 0 : price, Currency: 'USD',
          Country: countries[r() > 0.75 ? 1 % countries.length : 0], Device: r() > 0.35 ? 'smartphone' : 'desktop', OS: r() > 0.5 ? 'android' : 'windows',
          Browser: 'ch', Aff_Sub_1: ['telegram', 'instagram', 'youtube'][Math.floor(r() * 3)], Aff_Sub_2: '', Aff_Sub_3: '', Aff_Sub_4: '', Aff_Sub_5: '',
          Aff_Click_ID: Math.floor(r() * 1e12).toString(16), Source: '', Status: status,
        });
      }
    });
  }
  return rows;
}

async function getReport(p) {
  if (String(p.affiliate) !== String(DEMO_AID)) return { records: [], timezone: '+5' };
  const all = demoRows(p.date_from, p.date_end);
  const size = Number(p.results) || 1000;
  const page = Number(p.page) || 0;
  return { records: all.slice(page * size, (page + 1) * size), timezone: '+5' };
}

module.exports = { affiliateLogin, affiliateCreate, listOffers, getReport };
